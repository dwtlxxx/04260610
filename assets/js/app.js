/**
 * app.js —— 应用入口与控制器
 *
 * 职责：
 *   1. 初始化主题与设备形态（含手动切换）
 *   2. 维护唯一的应用状态，变化后整体重渲染（数据驱动，避免状态不一致）
 *   3. 事件委托绑一次，不随渲染重复绑定
 *   4. 弹层：详情 / 发布
 *
 * 双端切换原理：
 *   断点判定 -> 渲染 views.js 中对应的函数 -> 结构完全不同，但数据与判定逻辑完全一致
 */

import {
  SOURCE, KIND, SOURCE_LABEL, KIND_LABEL, BOARD, BOARDS,
  buildDataset, getRawItems, visibleItems, smartSort, matchesFilters, summarize,
  parseTime, formatTime, STATUS, STATUS_LABEL,
  itemsOfBoard, tagCloud, boardsOf, itemFuzzyScore, statusRank, isFavored,
} from './logic.js';
import * as store from './store.js';
import { initTheme, cycleTheme, getCurrentMode, resolveTheme, THEME_MODE_LABEL } from './theme.js';
import {
  esc, h, ICON, toast, statusBadge, sourceTag, kindTag, credibilityBadge,
  fieldGrid, riskList, seriesNote, roleNote, completenessMeter, missingLine,
  pulse, flash, fadeInUp, busy, scrollToItem, staggerIn, fadeOut,
  captureRect, expandFromRect, collapseToRect,
} from './ui.js';
import {
  renderMobile, renderDesktop, statsBarHTML, feedSection,
  aiInDetail, relationsPanel,
} from './views.js';

const MOBILE_MAX = 767;      // <= 767px 视为手机
const DESKTOP_MIN = 1024;    // >= 1024px 进入桌面布局
const WIDE_MIN = 1280;       // >= 1280px 三栏才真正放得下
const CLOSE_MS = 260;        // 详情弹层收起（缩回来源卡片）的动画时长

/* ============================================================
 * 应用状态（单一数据源）
 * ============================================================ */

const state = {
  route: 'feed',                 // feed | mine | about
  board: 'all',                  // 当前板块（见 data.js 的 BOARD）
  device: 'mobile',              // 实际生效的形态
  viewMode: 'auto',              // auto | mobile | desktop
  quick: 'all',                  // 工具宫格快捷筛选
  activeTags: [],                // 已激活的标签
  timelineScope: 'official',     // 时间线显示范围：official | all | student
  aiPanel: null,                 // 展开中的 AI 面板：null | dock | sheet | detail
  filters: { keyword: '' },      // 侧栏 / 搜索
  sort: { key: 'smart', dir: 'asc' },
  favorites: [],
  now: new Date(),
  modal: null,                   // { type, id } | null
  modalOriginRect: null,         // 打开弹层时来源卡片的位置快照（用于"从卡片长出来"）
  totalCount: 0,
  tagCloud: [],
  isWide: false,                 // 是否达到宽屏（三栏真正放得下）
};

/* 供 views.js 使用的派生函数 */
state.summarize = summarize;
state.getResolvedTheme = resolveTheme;
Object.defineProperty(state, 'themeModeLabel', {
  get() { return THEME_MODE_LABEL[getCurrentMode()] || '跟随系统'; },
});

/* ============================================================
 * 数据加工
 * ============================================================ */

/** 依据 state 计算最终要展示的列表（板块 → 快捷筛选 → 标签 → 关键词 → 排序） */
function computeDataset() {
  const userItems = store.getUserItems();
  const all = buildDataset(state.now, userItems);
  state.totalCount = all.length;
  state.tagCloud = tagCloud(all);

  // 板块筛选
  let list;
  if (state.board === BOARD.TIMELINE) {
    // 时间线：默认只显示官方信息，可通过范围切换增删来源
    list = state.timelineScope === 'official'
      ? all.filter((i) => i.isOfficial)
      : state.timelineScope === 'student'
        ? all.filter((i) => !i.isOfficial)
        : all;
  } else {
    list = itemsOfBoard(all, state.board);
  }

  // 快捷筛选
  if (state.quick === 'urgent') list = list.filter((i) => i.status === STATUS.CLOSING);
  else if (state.quick === 'standby') list = list.filter((i) => i.status === STATUS.STANDBY);
  else if (state.quick === 'risk') list = list.filter((i) => i.credibility === 'suspect' || i.risks.length);
  else if (state.quick === 'newbie') list = list.filter((i) => matchesFilters(i, { audience: ['newbie'] }, state.now));
  else if (state.quick === 'today') list = list.filter((i) => matchesFilters(i, { time: ['today'] }, state.now));
  else if (state.quick === 'rolling') list = list.filter((i) => i.rolling || i.kind === KIND.RESOURCE);

  // 标签筛选（多标签之间为"或"）
  if (state.activeTags.length) {
    list = list.filter((i) => i.tags.some((t) => state.activeTags.includes(t)));
  }

  // 侧栏筛选 + 关键词
  list = list.filter((i) => matchesFilters(i, state.filters, state.now));

  // 排序
  const { key, dir } = state.sort;
  const sign = dir === 'asc' ? 1 : -1;
  const kw = (state.filters.keyword || '').trim();

  if (kw) {
    // 有搜索词时按【相关度】优先，其余条件作为次级排序。
    // 模糊匹配必须配相关性排序才有意义：否则"顺序不完全一致但相关"的结果
    // 会散落在列表各处，用户以为没搜到。
    list = [...list].sort((a, b) => {
      const sa = itemFuzzyScore(a, kw);
      const sb = itemFuzzyScore(b, kw);
      if (sa !== sb) return sb - sa;
      return statusRank(a.status) - statusRank(b.status);
    });
  } else if (key === 'smart') {
    list = smartSort(list, state.now);
  } else {
    list = [...list].sort((a, b) => {
      const val = (x) => {
        switch (key) {
          case 'source': return x.source === 'student' ? 2 : 1;
          case 'status': return x.statusLabel;
          case 'deadline': return parseTime(x.deadline)?.getTime() ?? Infinity;
          case 'startAt': return parseTime(x.startAt)?.getTime() ?? Infinity;
          case 'completeness': return x.completeness;
          default: return 0;
        }
      };
      const va = val(a); const vb = val(b);
      if (va === vb) return 0;
      return va > vb ? sign : -sign;
    });
  }
  return list;
}

/* ============================================================
 * 渲染
 * ============================================================ */

const appEl = document.getElementById('app');

function render() {
  state.now = new Date();
  state.favorites = store.getFavorites();
  // 响应式底层状态：宽屏信息供视图层决定列数与右栏，避免视图层各自判断
  state.isWide = window.innerWidth >= WIDE_MIN;
  const dataset = computeDataset();

  const html = state.device === 'mobile'
    ? renderMobile(state, dataset)
    : renderDesktop(state, dataset);

  // 保持滚动位置，避免重渲染后跳回顶部
  const scrollY = window.scrollY;
  appEl.setAttribute('data-device', state.device);
  /* ⚠ 同时把形态写到 <html> 上。
     原因：#modal-host 与 #toast-host 是 #app 的【兄弟节点】而不是子节点
     （见 index.html），所以 `.app[data-device='desktop'] .modal { ... }` 这类选择器
     永远不可能命中 —— 弹层与提示条曾因此长期沿用手机端规则且完全不报错。
     挂到 <html> 后，`.app` 内部与外部的元素都能按形态取样式。 */
  document.documentElement.setAttribute('data-device', state.device);
  appEl.innerHTML = html;
  appEl.setAttribute('aria-busy', 'false');
  window.scrollTo(0, scrollY);

  // 信息流入场动画：错落上浮（落差感来自每项延迟不同 + 卡片本身高度不一）
  animateFeed();

  // 搜索框聚焦状态保持
  if (state.focusSearch) {
    const input = document.getElementById('search-input');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      state.focusSearch = false;
    }
  }
}

/** 给信息流卡片播放入场动画。双列/单列通用。 */
function animateFeed() {
  const grid = appEl.querySelector('[data-feed-grid]');
  const cards = grid
    ? [...grid.querySelectorAll('.card')]
    : [...appEl.querySelectorAll('.main-col > .card')];
  staggerIn(cards, { distance: 12, step: 40, duration: 300 });
}

/** 只重渲染弹层内容（避免整页重绘导致弹层滚动位置丢失） */
function renderModal() {
  const host = document.getElementById('modal-host');
  if (!state.modal) {
    closeModalAnimated();
    return;
  }

  // ⚠ 发布弹层没有 id，必须先分流再查条目。
  //   早期实现无条件执行 find(id)，而 publish 的 id 为 "undefined"，
  //   必然查不到 → 走进 !item 分支把 state.modal 清空 → 弹层被自己关掉，
  //   表现为"点发布按钮没反应"。
  const isPublish = state.modal.type === 'publish';
  let content = '';
  let allItems = null;
  let rawItems = null;

  if (isPublish) {
    content = publishHTML();
  } else {
    // 详情弹层：需要完整数据集而非筛选后的列表
    //   ① 被筛选掉的相关帖子也要出现在关联面板里
    //   ② 纯补充通知（列表页隐藏）在关联面板中需要展示
    // rawItems 是【原始未合并】条目：关联面板的"变更对照"必须基于原始值，
    // 因为主条目的字段已被补充通知覆盖，用合并后的值对比会漏掉真正的变更。
    const userItems = store.getUserItems();
    allItems = buildDataset(state.now, userItems);
    rawItems = getRawItems(userItems);
    const id = String(state.modal.id);
    const item = allItems.find((x) => String(x.id) === id);
    if (!item) { state.modal = null; closeModalAnimated(); return; }
    content = detailHTML(item, allItems, rawItems);
  }

  const sameModal = state.modal.type === state._lastModalType
    && String(state.modal.id) === String(state._lastModalId);
  state._lastModalType = state.modal.type;
  state._lastModalId = state.modal.id;

  const scrollTop = host.querySelector('.modal')?.scrollTop ?? 0;
  // 每次重建弹层都推进一次"世代号"：关闭动画是异步收尾的，
  // 若收尾期间用户又打开了新弹层，那次的收尾必须作废（见 closeModalAnimated）。
  state._modalEpoch = (state._modalEpoch || 0) + 1;
  host.hidden = false;
  host.innerHTML = h`<div class="modal-mask" data-action="close-modal">
    <div class="modal ${isPublish ? '' : 'modal-wide'}" role="dialog" aria-modal="true"
         data-action="none">${content}</div>
  </div>`;
  document.body.style.overflow = 'hidden';

  const modalEl = host.querySelector('.modal');
  if (modalEl) {
    // 同一弹层的局部刷新（如发送留言后）保持滚动位置，不重播入场动画
    if (sameModal) {
      modalEl.scrollTop = scrollTop;
    } else {
      // 新开弹层：如果知道"点的是哪张卡片"，就让面板从那张卡片的位置和尺寸长出来。
      // 快照用完即清（只播一次），避免后续刷新时重复播放。
      const origin = state.modalOriginRect;
      state.modalOriginRect = null;
      if (origin) expandFromRect(origin, modalEl);
      else fadeInUp(modalEl, { distance: 14, duration: 240 });   // 无来源时的兜底
    }
  }
}

/**
 * 关闭弹层时该缩回哪里。
 * 优先用"当前这一条的卡片"（页面可能已滚动、或排版已变化），
 * 找不到再退回打开时的快照；两者都不可用就返回 null（退化为原地淡出）。
 */
function modalReturnRect() {
  const id = state._lastModalId;
  if (id !== null && id !== undefined) {
    let card = null;
    try {
      card = document.querySelector(
        `.main-col [data-action="open-detail"][data-id="${CSS.escape(String(id))}"]`,
      );
    } catch { card = null; }
    const rect = captureRect(card);
    // 卡片滚出可视区域时不做"缩回屏幕外"的动画，那样看起来像飞走了
    const vh = window.innerHeight || 0;
    if (rect && (!vh || (rect.top < vh && rect.top + rect.height > 0))) return rect;
  }
  return state.modalOriginRect;
}

/** 关闭弹层：先播放退出动画（缩回来源卡片），再移除 DOM（避免"点一下突然消失"的割裂感） */
function closeModalAnimated() {
  const host = document.getElementById('modal-host');
  const mask = host?.querySelector('.modal-mask');
  if (!mask) {
    if (host) { host.hidden = true; host.innerHTML = ''; }
    document.body.style.overflow = '';
    state._lastModalType = null;
    state._lastModalId = null;
    state.modalOriginRect = null;
    return;
  }
  if (mask.classList.contains('is-closing')) return;   // 防止重复触发
  mask.classList.add('is-closing');                    // 遮罩自身的淡出仍走 CSS
  const epoch = state._modalEpoch || 0;
  const done = () => {
    // ⚠ 收尾是异步的：如果这段时间里用户又点开了新的弹层（世代号已变），
    //    这次收尾必须直接作废，否则会把刚打开的新弹层一起清掉。
    if ((state._modalEpoch || 0) !== epoch) return;
    host.hidden = true;
    host.innerHTML = '';
    document.body.style.overflow = '';
    state._lastModalType = null;
    state._lastModalId = null;
    state.modalOriginRect = null;
  };
  // 用动画 Promise 兜底超时，保证任何情况下都能清理
  let finished = false;
  const finish = () => { if (!finished) { finished = true; done(); } };

  const panel = mask.querySelector('.modal');
  const anim = collapseToRect(modalReturnRect(), panel, { duration: CLOSE_MS });
  Promise.resolve(anim).then(finish).catch(finish);
  /* 兜底超时取动画时长的 3 倍：既能在动画 Promise 永远不 resolve 时保证清理，
     又不会因为某台设备掉了几帧就把还没播完的收起动画直接掐掉
     （原先写死 420ms，对 260ms 的动画余量只有 1.6 倍，偏紧）。 */
  setTimeout(finish, CLOSE_MS * 3);
}

/* ============================================================
 * 弹层内容
 * ============================================================ */

function detailHTML(item, allItems, rawItems) {
  const fav = isFavored(state, item);
  const mine = item.isUserPost;
  const comments = store.getComments(item.id);

  return h`
    <div class="modal-head">
      <div class="modal-head-main">
        <h2 class="modal-title">${esc(item.title)}</h2>
        <div class="modal-tags">
          ${sourceTag(item)}${kindTag(item)}${credibilityBadge(item)}${statusBadge(item)}
        </div>
      </div>
      <button class="icon-btn" data-action="close-modal" aria-label="关闭">${ICON.close}</button>
    </div>

    <div class="modal-body">
      <!-- 关联信息：置于顶部，便于在"同一件事的多条通知"之间跳转 -->
      ${relationsPanel(item, allItems, rawItems, state)}

      ${seriesNote(item)}
      ${roleNote(item)}

      <!-- 原文中的客观提示：只陈述"原文写了什么 / 没写什么"，
           不含建议与判断；解读与建议统一交给下方 AI 模块，
           避免用户分不清哪句来自原文、哪句是产品推断。 -->
      ${item.risks.length ? h`<div class="section quality-section">
        <div class="section-title">${ICON.warn} 原文中的客观提示 <span class="rule"></span>
          ${item.risks.length} 项</div>
        ${riskList(item, { mode: 'fact' })}
        <div class="raw-hint">以上仅为对原文内容的客观归纳，不含主观判断；解读与建议见下方 AI 模块。</div>
      </div>` : ''}

      <div class="section">
        <div class="section-title">关键信息 <span class="rule"></span>
          ${completenessMeter(item)}</div>
        ${fieldGrid(item)}
        ${missingLine(item)}
      </div>

      ${item.notes ? h`<div class="section">
        <div class="section-title">需要特别注意 <span class="rule"></span></div>
        <div class="raw-box">${esc(item.notes)}</div>
      </div>` : ''}

      <!-- AI 整合与解读：原文对照与质量解读统一收进这里 -->
      ${aiInDetail(item, state)}

      <div class="section">
        <div class="section-title">${ICON.chat} 提问与留言 <span class="rule"></span>${comments.length} 条</div>
        <div class="comment-list">
          ${comments.length ? comments.map((c) => h`<div class="comment">
              <div class="comment-meta">${esc(formatTime(c.at) || '刚刚')}</div>
              <div>${esc(c.text)}</div>
            </div>`).join('')
            : h`<div class="empty-desc">还没有留言。想找搭子、确认地点，都可以在这里提问。</div>`}
        </div>
        <div class="comment-form">
          <input type="text" id="comment-input" placeholder="提问或留言（如：场地确认了吗？还缺人吗？）" maxlength="200" />
          <button class="btn btn-primary" data-action="add-comment" data-id="${esc(item.id)}">发送</button>
        </div>
      </div>
    </div>

    <div class="modal-foot">
      <button class="btn-fav ${fav ? 'is-on' : ''}" data-action="toggle-fav" data-id="${esc(item.id)}">
        ${fav ? ICON.starFill : ICON.star}<span>${fav ? '已在日程中' : '加入我的日程'}</span>
      </button>
      <span class="grow" style="flex:1"></span>
      ${mine
        ? h`<button class="btn" data-action="delete-mine" data-id="${esc(item.id)}">删除我的发布</button>`
        : h`<button class="btn" data-action="report" data-id="${esc(item.id)}">${ICON.flag} 举报不实信息</button>`}
      <button class="btn btn-primary" data-action="close-modal">关闭</button>
    </div>`;
}

function publishHTML() {
  return h`
    <div class="modal-head">
      <div class="modal-head-main">
        <h2 class="modal-title">发布活动 / 招募</h2>
        <div class="raw-hint">你发布的内容会进入同一条信息流，并带有「学生自发」标记。
          信息越完整，同学们越容易判断是否参加——下方会实时检查。</div>
      </div>
      <button class="icon-btn" data-action="close-modal" aria-label="关闭">${ICON.close}</button>
    </div>

    <form class="modal-body" id="publish-form" novalidate>
      <div class="form-row">
        <label class="form-label" for="p-title">标题<span class="req">*</span></label>
        <input class="form-input" id="p-title" name="title" maxlength="60"
               placeholder="例：周末羽毛球约球 / 找 Git 学习搭子" required />
      </div>

      <div class="form-grid-2">
        <div class="form-row">
          <label class="form-label" for="p-kind">类型<span class="req">*</span></label>
          <select class="form-select" id="p-kind" name="kind">
            <option value="${KIND.MEETUP}">组局 / 约人</option>
            <option value="${KIND.ACTIVITY}">活动</option>
            <option value="${KIND.RECRUIT}">招募成员</option>
            <option value="${KIND.RESOURCE}">资料分享</option>
          </select>
        </div>
        <div class="form-row">
          <label class="form-label" for="p-startAt">活动时间<span class="req">*</span></label>
          <input class="form-input" id="p-startAt" name="startAt" type="datetime-local" required />
        </div>
      </div>

      <div class="form-grid-2">
        <div class="form-row">
          <label class="form-label" for="p-deadline">报名截止<span class="opt">选填</span></label>
          <input class="form-input" id="p-deadline" name="deadline" type="datetime-local" />
        </div>
        <div class="form-row">
          <label class="form-label" for="p-place">地点<span class="opt">选填</span></label>
          <input class="form-input" id="p-place" name="place" maxlength="40" placeholder="例：体育馆 3 号场" />
        </div>
      </div>

      <div class="form-grid-2">
        <div class="form-row">
          <label class="form-label" for="p-audience">面向对象<span class="opt">选填</span></label>
          <input class="form-input" id="p-audience" name="audience" maxlength="30" placeholder="例：全校学生 / 零基础" />
        </div>
        <div class="form-row">
          <label class="form-label" for="p-capacity">人数<span class="opt">选填</span></label>
          <input class="form-input" id="p-capacity" name="capacity" type="number" min="1" max="500" placeholder="例：8" />
        </div>
      </div>

      <div class="form-grid-2">
        <div class="form-row">
          <label class="form-label" for="p-cost">费用<span class="opt">选填</span></label>
          <input class="form-input" id="p-cost" name="cost" maxlength="20" placeholder="例：AA / 免费" />
        </div>
        <div class="form-row">
          <label class="form-label" for="p-weeklyHours">每周投入<span class="opt">选填</span></label>
          <input class="form-input" id="p-weeklyHours" name="weeklyHours" type="number" min="0" max="40" placeholder="小时" />
        </div>
      </div>

      <div class="form-row">
        <label class="form-label" for="p-notes">补充说明<span class="opt">选填</span></label>
        <textarea class="form-textarea" id="p-notes" name="notes" maxlength="300"
                  placeholder="例：欢迎零基础，报名后拉群；场地待确认"></textarea>
      </div>

      <div class="form-row">
        <div class="live-check" id="live-check"></div>
      </div>

      <div class="form-row" id="publish-error"></div>
    </form>

    <div class="modal-foot">
      <button class="btn" data-action="close-modal">取消</button>
      <span style="flex:1"></span>
      <button class="btn btn-primary" data-action="submit-publish">发布到信息流</button>
    </div>`;
}

/** 发布表单的实时信息质量检查 —— 让发布者自己看见"缺什么" */
function updateLiveCheck() {
  const box = document.getElementById('live-check');
  if (!box) return;
  const get = (id) => (document.getElementById(id)?.value || '').trim();
  const checks = [
    { label: '标题', ok: !!get('p-title') },
    { label: '活动时间', ok: !!get('p-startAt') },
    { label: '地点（线下活动建议填写）', ok: !!get('p-place') },
    { label: '面向对象（便于同学筛选）', ok: !!get('p-audience') },
    { label: '人数限制', ok: !!get('p-capacity') },
    { label: '费用说明', ok: !!get('p-cost') },
    { label: '补充说明', ok: !!get('p-notes') },
  ];
  const done = checks.filter((c) => c.ok).length;
  const pct = Math.round((done / checks.length) * 100);
  const level = pct >= 75 ? 'high' : pct >= 45 ? 'mid' : 'low';
  box.innerHTML = h`<div class="live-check-title">信息完整度检查 <b>${done}/${checks.length}</b></div>
    <div class="meter" style="margin-bottom:10px">
      <div class="meter-bar" style="width:100%">
        <i class="meter-fill meter-${level}" style="width:${pct}%"></i>
      </div>
    </div>
    <div class="live-list">
      ${checks.map((c) => h`<div class="live-item ${c.ok ? 'live-ok' : 'live-todo'}">
        <span>${c.ok ? '✓' : '○'}</span><span>${esc(c.label)}</span>
      </div>`).join('')}
    </div>
    <div class="form-hint">信息越完整，同学越容易判断是否参加；缺项会在列表中标为「未提供」。</div>`;
}

/* ============================================================
 * 事件处理（全部委托在 appEl 上，只绑一次）
 * ============================================================ */

/** 把界面偏好写入本地存储 —— 刷新/重开后保持用户的选择 */
function persistUIState() {
  store.setFilters(state.filters);
  store.setUiPrefs({
    board: state.board,
    quick: state.quick,
    activeTags: state.activeTags,
    sort: state.sort,
  });
}

/**
 * 更新状态并重渲染。
 *
 * 这里是渲染一致性的关键收口点：
 *   · render() 只重建主界面，**不处理弹层**
 *   · 因此只要弹层处于打开状态，任何状态变更都必须同时刷新弹层，
 *     否则会出现"点了没反应"——例如在详情弹层内展开 AI 面板时，
 *     状态已更新但弹层内容仍是旧的。
 *
 * soft=true 用于只影响弹层的改动（如收藏、留言），跳过主界面重建以保住滚动位置。
 */
function setState(patch, { soft = false } = {}) {
  Object.assign(state, patch);
  persistUIState();
  if (soft) {
    renderModal();
  } else {
    render();
    if (state.modal) renderModal();   // 弹层打开时必须同步刷新，否则内容滞后
  }
}

function currentDeviceFromViewport() {
  const w = window.innerWidth;
  if (state.viewMode === 'mobile') return 'mobile';
  if (state.viewMode === 'desktop') return 'desktop';
  return w >= DESKTOP_MIN ? 'desktop' : 'mobile';
}

function handleAction(e, el) {
  const action = el.dataset.action;

  switch (action) {
    case 'none':
      e.stopPropagation();
      return;

    case 'close-modal':
      // 关闭按钮与遮罩点击都由这里收敛；遮罩空白处由 modalHost 的委托处理
      setState({ modal: null }, { soft: true });
      e.stopPropagation();
      return;

    case 'nav':
      setState({ route: el.dataset.route, modal: null }, { soft: !!state.modal });
      window.scrollTo(0, 0);
      return;

    case 'quick': {
      const id = el.dataset.id;
      setState({ quick: state.quick === id ? 'all' : id });
      return;
    }

    case 'board': {
      const id = el.dataset.id;
      // 切到时间线时保留当前快捷/标签以外的筛选会导致空列表，
      // 因此切换视图时清空快捷筛选与标签，只保留关键词。
      setState({
        board: id, route: 'feed', quick: 'all', activeTags: [],
        modal: null, aiPanel: null,
      }, { soft: !!state.modal });
      window.scrollTo(0, 0);
      return;
    }

    case 'clear-search': {
      state.filters = { ...state.filters, keyword: '' };
      store.setFilters(state.filters);
      const input = document.getElementById('search-input');
      if (input) input.value = '';
      render();               // 重建顶栏以移除清空按钮
      const next = document.getElementById('search-input');
      if (next) next.focus();
      return;
    }

    case 'timeline-scope': {
      setState({ timelineScope: el.dataset.id });
      return;
    }

    case 'ai-toggle': {
      const panel = el.dataset.panel;
      setState({ aiPanel: state.aiPanel === panel ? null : panel });
      return;
    }

    case 'ai-close':
      setState({ aiPanel: null });
      return;

    case 'tag': {
      const tag = el.dataset.tag;
      const next = state.activeTags.includes(tag)
        ? state.activeTags.filter((t) => t !== tag)
        : [...state.activeTags, tag];
      setState({ activeTags: next });
      return;
    }

    case 'clear-tags':
      setState({ activeTags: [] });
      return;

    case 'toggle-fav': {
      e.stopPropagation();
      const id = el.dataset.id;
      const isNowFav = store.toggleFavorite(id);
      toast(isNowFav ? '已加入我的日程' : '已从日程移除', isNowFav ? 'success' : 'info');
      // 先重渲染，再在更新后的 DOM 上播动画（旧节点已被替换）
      render();
      if (state.modal) renderModal();
      requestAnimationFrame(() => {
        const btns = document.querySelectorAll(`[data-action="toggle-fav"][data-id="${CSS.escape(String(id))}"]`);
        btns.forEach((b) => {
          pulse(b, { scale: 0.9 });
          if (isNowFav) flash(b, 'var(--brand)');
        });
      });
      return;
    }

    case 'open-detail': {
      // 卡片内的按钮 / 输入 / 标签链接优先处理，不触发打开详情
      if (e.target.closest('input,button,select,textarea,a')) {
        const nested = e.target.closest('[data-action]');
        if (nested && nested !== el) { handleAction(e, nested); }
        return;
      }
      // 只更新弹层，不整页重渲染，避免列表滚动位置跳动
      // 先拍下这张卡片的屏幕位置：弹层会从这里"长出来"，关闭时再缩回这里
      state.modalOriginRect = captureRect(el);
      /* ⚠ 这里不能再补一次 renderModal()。
         setState(..., { soft: true }) 内部已经会刷新弹层；再调用一次会重建弹层 DOM，
         而"从卡片长出来"的动画正打在第一次创建的那个面板节点上 ——
         节点一被替换，动画就随之被丢掉，用户看到的是"啪"地直接出现。
         （早期为了修"点了没反应"曾在调用处补过 renderModal()，
           后来 setState 里已经统一处理，这里的补调用就成了纯副作用。） */
      setState({ modal: { type: 'detail', id: el.dataset.id } }, { soft: true });
      return;
    }

    case 'open-publish': {
      state.modalOriginRect = captureRect(el);   // 从"发布"按钮/FAB 长出来
      // 同上：setState 非 soft 分支会自己刷新弹层，别重复渲染
      setState({ modal: { type: 'publish' } });
      requestAnimationFrame(updateLiveCheck);
      return;
    }

    case 'toggle-theme': {
      const next = cycleTheme();
      toast(`主题：${THEME_MODE_LABEL[next]}`, 'info');
      render();
      return;
    }

    case 'toggle-device': {
      const next = state.device === 'mobile' ? 'desktop' : 'mobile';
      store.setViewMode(next);
      setState({ viewMode: next, device: next });
      toast(`已切换到${next === 'mobile' ? '手机版' : '电脑版'}布局`, 'info');
      return;
    }

    case 'sort': {
      const key = el.dataset.key;
      const dir = state.sort.key === key && state.sort.dir === 'asc' ? 'desc' : 'asc';
      setState({ sort: { key, dir } });
      return;
    }

    case 'reset-filters':
      setState({ quick: 'all', board: 'all', activeTags: [], filters: { keyword: '' } });
      return;

    case 'add-comment': {
      const input = document.getElementById('comment-input');
      const text = (input?.value || '').trim();
      if (!text) {
        toast('请先输入内容', 'danger');
        if (input) { pulse(input, { scale: 0.98 }); input.focus(); }
        return;
      }
      // 按钮反馈：处理中 → 成功
      const restore = busy(el, '发送中');
      setTimeout(() => {
        restore();
        store.addComment(el.dataset.id, text);
        toast('留言已发布', 'success');
        renderModal();
        requestAnimationFrame(() => {
          const list = document.querySelectorAll('#modal-host .comment');
          const last = list[list.length - 1];
          if (last) { fadeInUp(last, { distance: 10 }); flash(last, 'var(--brand)'); }
          const box = document.getElementById('modal-host')?.querySelector('.modal');
          if (box) box.scrollTop = box.scrollHeight;
          // 恢复焦点，方便连续提问
          const next = document.getElementById('comment-input');
          if (next) next.focus();
        });
      }, 220);   // 极短延迟只为让"发送中"状态可见
      return;
    }

    case 'report': {
      const id = el.dataset.id;
      if (store.hasReported(id)) { toast('你已举报过这条信息', 'info'); return; }
      const restore = busy(el, '提交中');
      setTimeout(() => {
        restore();
        store.addReport(id, '用户标记为可疑信息');
        toast('已提交举报，平台会复核该信息', 'success');
        // 状态变化：按钮变为"已举报"且不可再点，形成真实逻辑闭环
        el.outerHTML = h`<button class="btn is-reported" disabled>${ICON.check} 已举报</button>`;
        flash(el.parentElement || document.body, 'var(--risk-warn)');
        render();
      }, 220);
      return;
    }

    case 'delete-mine': {
      // 先更新数据并整页重渲染，最后关闭弹层。
      // 顺序很关键：若先关弹层再渲染，renderModal() 会在数据已删除、
      // 但 state.modal 尚未清空时找不到条目，导致弹层被重新打开。
      state.modal = null;
      store.removeUserItem(el.dataset.id);
      toast('已删除', 'info');
      render();
      renderModal();
      return;
    }

    case 'submit-publish':
      submitPublish();
      return;

    default:
      return;
  }
}

/* 全局委托：一次绑定，永久生效 */
appEl.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !appEl.contains(el)) return;
  handleAction(e, el);
});

/* ============================================================
 * 弹层事件委托（独立绑定）
 *
 * ⚠ 必须单独绑定：弹层挂在 #modal-host（#app 的兄弟节点），
 *   点击事件不会冒泡到 #app，因此只绑 #app 会导致
 *   弹层内所有按钮失效（发布、关闭、留言、举报、删除全部点不动）。
 * ============================================================ */
const modalHost = document.getElementById('modal-host');

modalHost.addEventListener('click', (e) => {
  // 点击遮罩空白处 → 关闭（"点击空白处退出"）
  if (e.target === modalHost.querySelector('.modal-mask') || e.target === modalHost) {
    setState({ modal: null }, { soft: true });
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el || !modalHost.contains(el)) return;
  handleAction(e, el);
});

/* 搜索输入：只重渲染"结果区域"，不重建输入框本身。
   原因：整页重渲染会销毁并重建 <input>，导致光标丢失、中文输入法组词中断。 */
let searchTimer = null;
let composing = false;

appEl.addEventListener('compositionstart', (e) => {
  if (e.target.id === 'search-input') composing = true;
});
appEl.addEventListener('compositionend', (e) => {
  if (e.target.id === 'search-input') {
    composing = false;
    state.filters = { ...state.filters, keyword: e.target.value };
    store.setFilters(state.filters);
    refreshResults();
  }
});

appEl.addEventListener('input', (e) => {
  if (e.target.id === 'search-input') {
    state.filters = { ...state.filters, keyword: e.target.value };
    store.setFilters(state.filters);
    // 中文输入法组词过程中不刷新，避免打断输入
    if (composing) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refreshResults, 120);
    return;
  }
  if (e.target.id?.startsWith('p-')) updateLiveCheck();
});

/** 局部刷新：只替换结果区与统计条，保留顶栏 DOM 与输入焦点
 *
 *  动画：先让旧内容"上隐"（fadeOut），再替换并让新内容错落浮入。
 *  这样切换筛选/搜索时是连续的变化，而不是生硬闪烁。
 */
function refreshResults() {
  state.now = new Date();
  state.favorites = store.getFavorites();
  state.isWide = window.innerWidth >= WIDE_MIN;
  const dataset = computeDataset();

  const mainCol = appEl.querySelector('.main-col');
  if (!mainCol) return;

  const renderInto = () => {
    const parts = [];
    if (state.route === 'feed' && state.board !== BOARD.TIMELINE) {
      parts.push(statsBarHTML(dataset, state));
    }
    parts.push(feedSection(state, dataset));
    mainCol.innerHTML = parts.join('');
    animateFeed();
  };

  const anim = fadeOut(mainCol, { duration: 120 });
  if (anim && anim.finished) {
    anim.finished.then(renderInto).catch(renderInto);
  } else {
    renderInto();
  }
}

/* 侧栏复选框筛选 */
appEl.addEventListener('change', (e) => {
  const el = e.target.closest('[data-action="filter"]');
  if (!el) return;
  const group = el.dataset.group;
  const value = el.value;
  const cur = state.filters[group] || [];
  const next = el.checked ? [...cur, value] : cur.filter((v) => v !== value);
  const filters = { ...state.filters, [group]: next };
  if (!next.length) delete filters[group];
  setState({ filters });
});

/* 键盘：Esc 关闭弹层；/ 聚焦搜索 */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.modal) setState({ modal: null }, { soft: true });
  if (e.key === '/' && !state.modal && document.activeElement?.tagName !== 'INPUT') {
    e.preventDefault();
    const input = document.getElementById('search-input');
    if (input) input.focus();
  }
});

/* 发布提交 */
function submitPublish() {
  const get = (id) => (document.getElementById(id)?.value || '').trim();
  const title = get('p-title');
  const startAt = get('p-startAt');
  const errBox = document.getElementById('publish-error');

  const errors = [];
  if (!title) errors.push('标题');
  if (!startAt) errors.push('活动时间');

  if (errors.length) {
    if (errBox) errBox.innerHTML = h`<div class="form-error">请填写：${esc(errors.join('、'))}</div>`;
    toast(`请填写：${errors.join('、')}`, 'danger');
    // 定位到第一个缺失字段并高亮，让用户知道该改哪里
    const firstId = !title ? 'p-title' : 'p-startAt';
    const field = document.getElementById(firstId);
    if (field) {
      field.focus();
      field.classList.add('is-invalid');
      pulse(field, { scale: 0.995 });
      setTimeout(() => field.classList.remove('is-invalid'), 1400);
    }
    return;
  }

  const btn = document.querySelector('[data-action="submit-publish"]');
  const restore = busy(btn, '发布中');
  const capacity = get('p-capacity');
  const weeklyHours = get('p-weeklyHours');
  const place = get('p-place');

  setTimeout(() => {
    restore();
    const item = store.addUserItem({
      title,
      kind: get('p-kind') || KIND.MEETUP,
      source: SOURCE.STUDENT,
      org: '学生个人发布',
      raw: [
        '学生个人发布（由本产品用户提交）',
        get('p-audience') ? `面向${get('p-audience')}` : '',
        place ? `地点：${place}` : '地点未提供',
        capacity ? `人数：${capacity}` : '',
        get('p-cost') ? `费用：${get('p-cost')}` : '',
        get('p-notes') || '',
      ].filter(Boolean).join('；'),
      startAt: startAt.slice(0, 16),
      deadline: get('p-deadline') ? get('p-deadline').slice(0, 16) : null,
      place: place || null,
      placeStatus: place ? null : '未提供',
      audience: get('p-audience') || null,
      capacity: capacity ? Number(capacity) : null,
      cost: get('p-cost') || null,
      weeklyHours: weeklyHours ? Number(weeklyHours) : null,
      rolling: false,
      notes: get('p-notes') || '',
      tags: [get('p-kind') === KIND.MEETUP ? '组局' : '我发布的'],
    });

    state.modal = null;
    render();
    renderModal();
    toast('发布成功，已进入信息流', 'success');
    // 滚动定位到新发布的内容并高亮，形成"我发的东西真的进去了"的确认感
    requestAnimationFrame(() => scrollToItem(item.id, { highlight: true }));
  }, 300);
}

/* ============================================================
 * 窗口尺寸变化：断点切换（实时重渲染，无死区）
 * ============================================================ */

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const next = currentDeviceFromViewport();
    if (next !== state.device) {
      state.device = next;
      render();
    }
  }, 120);
});

/* ============================================================
 * 启动
 * ============================================================ */

/** 把错误直接显示在页面上 —— 避免"卡在加载界面"这类静默故障无法排查 */
function showFatal(err) {
  const msg = (err && (err.stack || err.message)) || String(err);
  const el = document.getElementById('app');
  if (!el) return;
  el.setAttribute('aria-busy', 'false');
  el.innerHTML = `
    <div style="max-width:820px;margin:48px auto;padding:24px;font-family:var(--font-sans)">
      <h2 style="color:var(--risk-danger);margin:0 0 12px">启动失败，已捕获到错误</h2>
      <p style="color:var(--text-secondary);margin:0 0 16px">
        请把下面这段信息发给开发者（或直接查看浏览器控制台 F12）。
      </p>
      <pre style="background:var(--bg-sunken);border:1px solid var(--border);border-radius:8px;
                  padding:14px;overflow:auto;font-size:12px;line-height:1.6;
                  color:var(--text-primary);white-space:pre-wrap">${
        String(msg).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      }</pre>
    </div>`;
}

window.addEventListener('error', (e) => {
  // 模块加载或运行期未捕获错误
  showFatal(e.error || e.message || '未知错误');
});
window.addEventListener('unhandledrejection', (e) => {
  showFatal(e.reason || '未处理的 Promise 拒绝');
});

function init() {
  try {
    initTheme();
    state.viewMode = store.getViewMode();
    state.device = currentDeviceFromViewport();
    // 恢复上次的筛选与界面偏好（主题、视图模式已在上面恢复）
    state.filters = { ...store.getFilters(), keyword: '' };
    const prefs = store.getUiPrefs();
    if (prefs.board) state.board = prefs.board;
    if (prefs.quick) state.quick = prefs.quick;
    if (Array.isArray(prefs.activeTags)) state.activeTags = prefs.activeTags;
    if (prefs.sort && prefs.sort.key) state.sort = prefs.sort;
    // 侧栏不再有"收起/展开"这个可持久化的用户偏好：它已改为鼠标移到左边缘自动滑出
    render();
  } catch (err) {
    showFatal(err);
    throw err;
  }
}

init();

/* 每分钟刷新一次倒计时，让"还有 X 小时"保持准确 */
setInterval(() => {
  if (state.modal) return;
  render();
}, 60 * 1000);
