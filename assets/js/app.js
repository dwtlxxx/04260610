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
  buildDataset, visibleItems, smartSort, matchesFilters, summarize,
  parseTime, formatTime, STATUS, STATUS_LABEL,
  itemsOfBoard, tagCloud, boardsOf,
} from './logic.js';
import * as store from './store.js';
import { initTheme, cycleTheme, getCurrentMode, resolveTheme, THEME_MODE_LABEL } from './theme.js';
import {
  esc, h, ICON, toast, statusBadge, sourceTag, kindTag, credibilityBadge,
  fieldGrid, riskList, seriesNote, roleNote, completenessMeter, missingLine,
} from './ui.js';
import { renderMobile, renderDesktop } from './views.js';

const MOBILE_MAX = 767;      // <= 767px 视为手机
const DESKTOP_MIN = 1024;    // >= 1024px 进入桌面布局
const WIDE_MIN = 1280;       // >= 1280px 三栏才真正放得下

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
  selected: [],
  now: new Date(),
  modal: null,                   // { type, id } | null
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
  if (key === 'smart') {
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
  appEl.innerHTML = html;
  appEl.setAttribute('aria-busy', 'false');
  window.scrollTo(0, scrollY);

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

/** 只重渲染弹层内容（避免整页重绘导致弹层滚动位置丢失） */
function renderModal() {
  const host = document.getElementById('modal-host');
  if (!state.modal) {
    host.hidden = true;
    host.innerHTML = '';
    document.body.style.overflow = '';
    return;
  }
  const dataset = computeDataset();
  const item = dataset.find((x) => String(x.id) === String(state.modal.id));
  if (!item) { state.modal = null; renderModal(); return; }

  const content = state.modal.type === 'publish' ? publishHTML() : detailHTML(item);
  host.hidden = false;
  host.innerHTML = h`<div class="modal-mask" data-action="close-modal">
    <div class="modal ${state.modal.type === 'publish' ? '' : 'modal-wide'}" role="dialog" aria-modal="true"
         data-action="none">${content}</div>
  </div>`;
  document.body.style.overflow = 'hidden';
}

/* ============================================================
 * 弹层内容
 * ============================================================ */

function detailHTML(item) {
  const fav = state.favorites.includes(item.id);
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
      ${seriesNote(item)}
      ${roleNote(item)}

      <!-- 信息质量提示：按要求移到标题下方、正文上方 -->
      ${item.risks.length ? h`<div class="section quality-section">
        <div class="section-title">${ICON.warn} 信息质量提示 <span class="rule"></span>
          ${item.risks.length} 项</div>
        ${riskList(item)}
        <div class="raw-hint">以上为基于题目信息的客观提示，不代表对发布者的判断，请自行核实后再决定。</div>
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

function setState(patch, { soft = false } = {}) {
  Object.assign(state, patch);
  persistUIState();
  if (soft) renderModal(); else render();
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
      render();
      if (state.modal) renderModal();
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
      setState({ modal: { type: 'detail', id: el.dataset.id } }, { soft: true });
      renderModal();
      return;
    }

    case 'open-publish': {
      setState({ modal: { type: 'publish' } });
      renderModal();
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

    case 'select': {
      e.stopPropagation();
      const id = el.dataset.id;
      const sel = state.selected.includes(id)
        ? state.selected.filter((x) => x !== id)
        : [...state.selected, id];
      setState({ selected: sel });
      return;
    }

    case 'reset-filters':
      setState({ quick: 'all', board: 'all', activeTags: [], filters: { keyword: '' }, selected: [] });
      return;

    case 'add-comment': {
      const input = document.getElementById('comment-input');
      const text = (input?.value || '').trim();
      if (!text) { toast('请输入内容', 'danger'); return; }
      store.addComment(el.dataset.id, text);
      toast('留言已发布', 'success');
      renderModal();
      return;
    }

    case 'report': {
      const id = el.dataset.id;
      if (store.hasReported(id)) { toast('你已举报过这条信息', 'info'); return; }
      store.addReport(id, '用户标记为可疑信息');
      toast('已提交举报，平台会复核该信息', 'success');
      return;
    }

    case 'delete-mine': {
      // 先更新数据并整页重渲染，最后关闭弹层。
      // 顺序很关键：若先关弹层再渲染，renderModal() 会在数据已删除、
      // 但 state.modal 尚未清空时找不到条目，导致弹层被重新打开。
      state.modal = null;
      store.removeUserItem(el.dataset.id);
      state.selected = state.selected.filter((x) => x !== el.dataset.id);
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

/* 搜索输入：软更新，保持焦点 */
appEl.addEventListener('input', (e) => {
  if (e.target.id === 'search-input') {
    state.filters = { ...state.filters, keyword: e.target.value };
    state.focusSearch = true;
    render();
  }
  if (e.target.id?.startsWith('p-')) updateLiveCheck();
});

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
  if (!title) errors.push('请填写标题');
  if (!startAt) errors.push('请填写活动时间');

  if (errors.length) {
    if (errBox) errBox.innerHTML = h`<div class="form-error">${esc(errors.join('；'))}</div>`;
    toast(errors[0], 'danger');
    return;
  }

  const capacity = get('p-capacity');
  const weeklyHours = get('p-weeklyHours');
  const place = get('p-place');

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
    // 转为题目数据同构的字段（日期统一为 2026-09-19 时间背景）
    startAt: startAt.length === 16 ? startAt : startAt.slice(0, 16),
    deadline: get('p-deadline') ? get('p-deadline').slice(0, 16) : null,
    place: place || null,
    placeStatus: place ? null : '未提供',
    audience: get('p-audience') || null,
    capacity: capacity ? Number(capacity) : null,
    cost: get('p-cost') || null,
    weeklyHours: weeklyHours ? Number(weeklyHours) : null,
    rolling: false,
    notes: get('p-notes') || '',
  });

  setState({ modal: null }, { soft: true });
  toast('发布成功，已进入信息流', 'success');
  render();
  state.selected = [];
  // 高亮到新发布的内容
  setTimeout(() => {
    const node = document.querySelector(`[data-id="${item.id}"]`);
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 120);
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
