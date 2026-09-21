/**
 * views.js —— 双端视图层
 *
 * 同一批数据（来自 logic.js 的派生结果），两种结构：
 *   renderMobile  圆形板块入口 + 工具宫格 + 置顶区 + 信息流 + 底部导航
 *   renderDesktop 板块侧栏 + 置顶面板 + 多列卡片/时间线 + 右栏总览
 *
 * 本版本新增（按需求）：
 *   1. 标签制 + 分板块，官方信息独立成板
 *   2. 主区域置顶栏目 + 各板块内置顶区域
 *   3. 时间线信息流
 *   4. 官方 / 非官方信息的强视觉区分
 */

import {
  STATUS, STATUS_LABEL, KIND_LABEL, SOURCE_LABEL, RISK_LEVEL,
  BOARD, BOARDS, BOARD_MAP, PIN_LEVEL,
  itemsOfBoard, featuredPins, boardPins, buildTimeline, isOfficial,
  aiEnabled, aiEntriesOf, aiEntryOf, aiOverview, aiChangeSummaries,
  AI_KIND, AI_DISCLAIMER, AI_DISCLAIMER_LONG,
  relationsOf, hasRelations, diffBetween, RELATION, RELATION_LABEL,
  risksToAiEntry, explainSearch, isFavored,
  matchInfo, MATCH_MODE_LABEL, highlightMatch,
} from './logic.js';
import {
  esc, h, ICON, statusBadge, statusClass, credibilityBadge, sourceTag, kindTag,
  completenessMeter, missingLine, riskList, fieldGrid, seriesNote, roleNote,
} from './ui.js';

/* ============================================================
 * 响应式排版底层模块
 *
 * 所有"按形态决定怎么排"的判断集中在这里，视图各处只调用这些函数，
 * 不再散落 `state.device === 'mobile'` 的判断，避免改一处漏一处。
 * ============================================================ */

export function isMobile(state) {
  return state.device === 'mobile';
}

/* ============================================================
 * 公共片段
 * ============================================================ */

function topbar(state, dataset) {
  const themeModeLabel = state.themeModeLabel || '跟随系统';
  const deviceLabel = state.device === 'mobile' ? '电脑版' : '手机版';
  const keyword = state.filters.keyword || '';
  // 布局说明：
  //   手机端（<768px）：品牌 + 搜索上下两行，三个操作按钮统一靠右。
  //   电脑端（≥768px）：品牌左、搜索中、按钮组靠右。
  // 按钮统一收在 .tb-actions 内并以 margin-left:auto 靠右。
  // ⚠ 不要再用 order 把按钮散进 flex 流：那样布局不稳定，
  //    窄屏下按钮会被挤到左侧，且"跟随系统"标签会折行撑高按钮。
  return h`<header class="topbar">
    <div class="topbar-inner">
      <div class="brand">
        <span class="brand-logo" aria-hidden="true">机</span>
        <span class="brand-text">
          <span class="brand-name">校园机会雷达</span>
          <span class="brand-sub">珠科 · ${state.totalCount} 条信息已整理</span>
        </span>
      </div>

      <div class="search-wrap">
        <span class="icon">${ICON.search}</span>
        <input class="search-input" type="search" id="search-input"
               placeholder="搜索活动、招募、地点；可用拼音或首字母（如 ymq）"
               value="${esc(keyword)}" aria-label="搜索" autocomplete="off" />
        ${keyword ? h`<button class="search-clear" data-action="clear-search"
            aria-label="清空搜索" title="清空搜索">${ICON.close}</button>` : ''}
      </div>

      <div class="tb-actions">
        <button class="icon-btn" data-action="toggle-theme"
                title="主题：${esc(themeModeLabel)}（点击切换）" aria-label="切换主题，当前${esc(themeModeLabel)}">
          ${ICON.theme}<span class="mode-label">${esc(themeModeLabel)}</span>
        </button>
        <button class="icon-btn" data-action="toggle-device"
                title="切换到${deviceLabel}" aria-label="切换到${deviceLabel}">${ICON.device}</button>
      </div>
    </div>
  </header>`;
}

/** 供局部刷新使用：统计条与结果区可单独渲染，不重建整个页面 */
export function statsBarHTML(dataset, state) {
  return statsBar(state.summarize(dataset));
}

/**
 * 电脑端信息流的排序栏。
 *
 * 说明：原先这里还有「双列卡片 / 表格」显示方式切换，表格已按反馈移除
 *      （列多、窄屏需横向滚动、信息冗余）。信息流统一为多列卡片，
 *      列数由容器宽度决定：≥768px 两列，≥1600px 三列。
 */
function viewModeBar(state, count) {
  const sorts = [
    { key: 'smart', label: '智能排序', hint: '最该行动的排在最前' },
    { key: 'deadline', label: '按截止', hint: '报名截止由近到远' },
    { key: 'startAt', label: '按活动时间', hint: '活动开始由近到远' },
    { key: 'completeness', label: '按完整度', hint: '信息最完整的靠前' },
  ];
  return h`<div class="viewmode-bar">
    <span class="viewmode-count">${count} 条 · 多列卡片</span>
    <div class="seg" role="group" aria-label="排序方式">
      ${sorts.map((s) => h`<button class="seg-btn ${state.sort.key === s.key ? 'is-active' : ''}"
          data-action="sort" data-key="${esc(s.key)}" title="${esc(s.hint)}">${esc(s.label)}</button>`).join('')}
    </div>
  </div>`;
}

/** 把一组条目渲染为多列卡片（电脑端）或单列（手机端）。多处复用。 */
function cardGrid(items, state) {
  if (state.device === 'mobile') return items.map((i) => infoCard(i, state)).join('');
  return h`<div class="feed-grid" data-feed-grid>${items.map((i) => infoCard(i, state)).join('')}</div>`;
}

/** 搜索理解方式的文案 */
const SEARCH_MODE_LABEL = {
  direct: '字面命中',
  pinyin: '拼音 / 首字母',
  synonym: '近义词扩展',
  fuzzy: '错字容错',
};

/**
 * 搜索理解条：告诉用户"这次搜索是怎么被理解的"。
 *
 * 用户输入 ymq 却看到「周末羽毛球约球」，如果没有任何说明，
 * 只会觉得搜索逻辑奇怪。这里把匹配方式显式写出来。
 * 没有结果时不显示本条，改由空状态给出"已尝试哪些方式"的说明。
 */
function searchHintBar(state, items) {
  const kw = (state.filters && state.filters.keyword || '').trim();
  if (!kw) return '';
  const info = explainSearch(kw, items);
  if (!info || !info.count) return '';

  const chips = info.modes.map((m) =>
    h`<span class="sh-chip">${esc(SEARCH_MODE_LABEL[m] || m)}</span>`).join('');
  const syn = info.synonyms.length
    ? h`<span class="sh-syn">近义词：${esc(info.synonyms.join('、'))}</span>`
    : '';

  /* 如果用户原本停在某个板块 / 快捷筛选 / 标签里，搜索会跨出那个范围，
     必须明确告诉他一件事：范围被我扩大了，否则他会以为"搜出来的东西跟板块不符"。 */
  const narrowed = (state.board && state.board !== BOARD.ALL)
    || (state.quick && state.quick !== 'all')
    || (state.activeTags && state.activeTags.length);
  const scope = narrowed
    ? h`<span class="sh-scope">已在全部板块中搜索（原先限制在板块 / 快捷筛选 / 标签内）</span>`
    : '';

  return h`<div class="search-hint">
    <span class="sh-lead">用「${esc(kw)}」找到 <b>${info.count}</b> 条</span>
    <span class="sh-modes">理解方式：${chips}</span>
    ${syn}
    ${scope}
  </div>`;
}

/** 搜索无结果时的说明文案（给 emptyState 用），没有搜索词时返回 undefined */
function searchEmptyHint(state) {
  const kw = (state.filters && state.filters.keyword || '').trim();
  if (!kw) return undefined;
  return `没有匹配「${kw}」的信息。已尝试：字面命中 · 拼音/首字母 · 近义词 · 错字容错；可换个说法，或只输一个关键词。`;
}

/**
 * 信息流内容：电脑端多列卡片（高低落差），手机端单列。
 * 供整页渲染与局部刷新（搜索）共用。
 * 列数由容器宽度决定：≥768px 两列，≥1600px 三列（见 CSS .feed-grid）。
 *
 * ⚠ 搜索理解条必须放在本函数内部：
 *   搜索时 app.js 走 refreshResults()，只替换 .main-col 里的"统计条 + 本函数结果"，
 *   放在 renderDesktop/renderMobile 里的话，打字时不会更新（等于没做）。
 */
/**
 * 信息流到底的分割线。
 *
 * 反馈："首页划到底部后加一个分割线"。列表滚到底时最后一张卡片直接贴到屏幕边缘，
 * 看不出"这里已经是全部了"还是"还在加载"。加一条收尾分割线 + 条数说明，
 * 让"到底了"这件事有明确视觉信号。
 */
function feedEndMark(state, items) {
  if (!items.length) return '';
  const kw = (state.filters && state.filters.keyword || '').trim();
  const scope = kw ? `「${kw}」的搜索结果` : '当前筛选';
  return h`<div class="feed-end" aria-hidden="true">
    <span class="feed-end-rule"></span>
    <span class="feed-end-text">已经到底了 · ${esc(scope)}共 ${items.length} 条</span>
    <span class="feed-end-rule"></span>
  </div>`;
}

export function feedSection(state, dataset) {
  const boardId = activeBoardId(state);
  const items = itemsOfBoard(dataset, boardId);
  const isTimeline = boardId === BOARD.TIMELINE;
  const hint = searchHintBar(state, items);

  if (isTimeline) {
    return hint + (items.length
      ? timelineView(state, items) + feedEndMark(state, items)
      : emptyState(state, {
        filtered: true,
        hint: searchEmptyHint(state) || '当前时间线只显示官方信息，可切换为「全部来源」。',
      }));
  }
  if (!items.length) return hint + emptyState(state, { filtered: true, hint: searchEmptyHint(state) });
  return hint + cardGrid(items, state) + feedEndMark(state, items);
}

function statsBar(s) {
  return h`<div class="stats">
    <span class="stat">共 <b>${s.total}</b> 条</span>
    <span class="stat stat-official">官方 <b>${s.official}</b></span>
    <span class="stat stat-student">学生自发 <b>${s.student}</b></span>
    <span class="stat is-closing">即将截止 <b>${s.closing}</b></span>
    <span class="stat is-standby">可候补 <b>${s.standby}</b></span>
    ${s.suspect ? h`<span class="stat is-risk">建议核实 <b>${s.suspect}</b></span>` : ''}
  </div>`;
}

/* ============================================================
 * 置顶区
 * ============================================================ */

/** 主区域置顶：featured 大卡 + notice 通知条 */
function featuredPanel(state, dataset, { compact = false } = {}) {
  const pins = featuredPins(dataset, state.now);
  if (!pins.length) return '';
  const featured = pins.filter((p) => p.pinLevel === PIN_LEVEL.FEATURED);
  const notices = pins.filter((p) => p.pinLevel === PIN_LEVEL.NOTICE);

  return h`<section class="pin-zone" aria-label="置顶信息">
    <div class="pin-zone-head">
      <span class="pin-icon" aria-hidden="true">▲</span>
      <span>置顶信息</span>
      <span class="pin-hint">置顶均有明确理由，用于防止错过或做错</span>
    </div>

    ${featured.map((item) => h`
      <div class="pin-card ${item.isOfficial ? 'is-official' : ''}" data-action="open-detail" data-id="${esc(item.id)}">
        <div class="pin-card-head">
          ${officialMark(item)}
          <span class="pin-tag">${esc(item.pinLabel)}</span>
          ${statusBadge(item)}
        </div>
        <h3 class="pin-title">${esc(item.title)}</h3>
        ${item.pinReason ? h`<div class="pin-reason">置顶理由：${esc(item.pinReason)}</div>` : ''}
        ${compact ? '' : h`<div class="card-meta">
          ${item.startText ? h`<span class="meta-item"><span class="icon">${ICON.clock}</span>${esc(item.startText)}</span>` : ''}
          ${item.place ? h`<span class="meta-item"><span class="icon">${ICON.pin}</span>${esc(item.place)}</span>` : ''}
          ${item.deadlineText ? h`<span class="meta-item"><span class="icon">${ICON.clock}</span>截止 ${esc(item.deadlineText)} ${esc(item.deadlineCountdown || '')}</span>` : ''}
        </div>`}
      </div>`).join('')}

    ${notices.length ? h`<div class="pin-notices">
      ${notices.map((item) => h`
        <div class="pin-notice" data-action="open-detail" data-id="${esc(item.id)}">
          <span class="pin-notice-badge">提醒</span>
          <span class="pin-notice-text">${esc(item.title)}</span>
          <span class="pin-notice-reason">${esc(item.pinReason || '')}</span>
          <span class="pin-notice-arrow" aria-hidden="true">›</span>
        </div>`).join('')}
    </div>` : ''}
  </section>`;
}

/** 板块内置顶：进入具体板块时显示 */
function boardPinZone(state, dataset, boardId) {
  const pins = boardPins(dataset, boardId, state.now);
  if (!pins.length) return '';
  return h`<section class="pin-zone pin-zone-board" aria-label="本板块置顶">
    <div class="pin-zone-head">
      <span class="pin-icon" aria-hidden="true">▲</span>
      <span>本板块置顶</span>
    </div>
    ${pins.map((item) => h`
      <div class="pin-notice" data-action="open-detail" data-id="${esc(item.id)}">
        <span class="pin-notice-badge">置顶</span>
        <span class="pin-notice-text">${esc(item.title)}</span>
        ${item.pinReason ? h`<span class="pin-notice-reason">${esc(item.pinReason)}</span>` : ''}
        <span class="pin-notice-arrow" aria-hidden="true">›</span>
      </div>`).join('')}
  </section>`;
}

/* ============================================================
 * 帖子关联系统 —— 渲染件
 *
 * 放在详情弹层顶部。解决的问题：
 *   题目材料里的补充通知（如"训练营改了时间地点"）此前被合并隐藏，
 *   用户在帖子里看不到"同一件事还有别的通知"，也无法互相跳转。
 *   本面板把关联帖子列出来，标注关系，并可点击直接跳转。
 * ============================================================ */

/** 关系 → 视觉修饰 */
const REL_META = {
  [RELATION.SUPERSEDES]: { icon: '↻', cls: 'supersedes', hint: '生效版本以对方为准' },
  [RELATION.SUPPLEMENT]: { icon: '↳', cls: 'supplement', hint: '本条是对方的补充说明' },
  [RELATION.CROSS]: { icon: '⇄', cls: 'cross', hint: '两条通知互相引用' },
  [RELATION.SERIES]: { icon: '≡', cls: 'series', hint: '同一活动系列的相关通知' },
  [RELATION.MANUAL]: { icon: '↔', cls: 'manual', hint: '内容相关的信息' },
  [RELATION.REPOST]: { icon: '⟳', cls: 'repost', hint: '同一内容被再次发布，请以最新一条为准' },
};

/**
 * 关联帖子面板。
 *
 * 参数分工（此前混淆导致"空状态徽章"渲染错误）：
 *   item       当前条目（已加工，含 status / 格式化时间）
 *   decorated  全量**已加工**条目 —— 用于计算关系与渲染关联项，
 *              这样关联项才有状态徽章、可读时间等派生字段
 *   rawItems   全量**原始未合并**条目 —— 仅用于计算"变更对照"。
 *              主条目字段已被补充通知覆盖，必须回查原值才能算出真实变更。
 */
export function relationsPanel(item, decorated, rawItems, state) {
  if (!item) return '';
  const rels = relationsOf(item, decorated);
  if (!rels.length) return '';

  const rawById = new Map((rawItems || []).map((i) => [String(i.id), i]));
  const rawSelf = rawById.get(String(item.id)) || item;

  const rows = rels.map(({ item: other, relation }) => {
    const meta = REL_META[relation] || REL_META[RELATION.MANUAL];

    // 变更对照：仅"被更新 / 补充"两类关系需要，且必须基于原始条目
    let diff = [];
    if (relation === RELATION.SUPERSEDES || relation === RELATION.SUPPLEMENT) {
      const rawOther = rawById.get(String(other.id)) || other;
      diff = relation === RELATION.SUPERSEDES
        ? diffBetween(rawSelf, rawOther)      // 主条目原值 → 补充通知的值
        : diffBetween(rawOther, rawSelf);     // 对方原值 → 本条的值
    }

    return h`<div class="rel-item ${esc(meta.cls)}" data-action="open-detail" data-id="${esc(other.id)}"
        role="button" tabindex="0" title="点击查看这条信息">
      <div class="rel-head">
        <span class="rel-icon" aria-hidden="true">${meta.icon}</span>
        <span class="rel-badge">${esc(RELATION_LABEL[relation] || '相关内容')}</span>
        ${statusBadge(other)}
        <span class="rel-arrow" aria-hidden="true">›</span>
      </div>
      <div class="rel-title">${esc(other.title)}</div>
      <div class="rel-meta">
        ${other.startText ? h`<span>活动 ${esc(other.startText)}</span>` : ''}
        ${other.deadlineText ? h`<span>截止 ${esc(other.deadlineText)}</span>` : ''}
        ${other.place ? h`<span>${esc(other.place)}</span>` : ''}
      </div>
      ${diff.length ? h`<div class="rel-diff">
        ${diff.map((d) => h`<div class="rel-diff-row">
          <span class="rel-diff-field">${esc(d.label)}</span>
          <span class="rel-diff-from">${esc(d.from)}</span>
          <span class="rel-diff-arrow" aria-hidden="true">→</span>
          <span class="rel-diff-to">${esc(d.to)}</span>
        </div>`).join('')}
      </div>` : ''}
      <div class="rel-hint">${esc(meta.hint)}</div>
    </div>`;
  }).join('');

  return h`<section class="rel-panel" aria-label="关联信息">
    <div class="rel-panel-head">
      <span class="rel-panel-icon" aria-hidden="true">🔗</span>
      <span class="rel-panel-title">关联信息</span>
      <span class="rel-panel-count">${rels.length} 条</span>
    </div>
    <div class="rel-panel-desc">同一件事的多条通知已在此关联，点击可直接跳转。改动过的字段已标出。</div>
    ${rows}
  </section>`;
}

/* ============================================================
 * AI 整合模块 —— 渲染件
 *
 * 三条约束在代码中强制体现：
 *   1. 标注：每一处 AI 输出都渲染 ai-mark，样式上不可隐藏
 *   2. 非主动触发：面板默认折叠，必须点击 ai-fab / ai-toggle 才展开
 *   3. 可追溯：每条结论下方列出结论来源的原始条目，可点击跳转
 * ============================================================ */

/** AI 标注徽章（任何 AI 输出旁边都必须有） */
function aiMark({ long = false } = {}) {
  return h`<span class="ai-mark" title="以下内容由 AI 自动整理，可能存在偏差">
    <span class="ai-mark-spark" aria-hidden="true">✦</span>${esc(long ? 'AI 生成内容' : AI_DISCLAIMER)}
  </span>`;
}

/** 变更点渲染：显示 从 → 到 */
function aiChanges(changes) {
  return h`<div class="ai-changes">
    ${changes.map((c) => {
      const changed = c.from !== c.to;
      return h`<div class="ai-change ${changed ? 'is-changed' : ''}">
        <span class="ai-change-field">${esc(c.field)}</span>
        <span class="ai-change-flow">
          <span class="ai-from">${esc(c.from || '未注明')}</span>
          <span class="ai-arrow" aria-hidden="true">→</span>
          <span class="ai-to">${esc(c.to || '未注明')}</span>
        </span>
        ${c.note ? h`<span class="ai-change-note">${esc(c.note)}</span>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

/** 单条 AI 条目 */
function aiEntryBlock(entry, { compact = false } = {}) {
  const kindLabel = entry.kind === AI_KIND.INTEGRATION ? '变更整合' : '质量解读';
  return h`<article class="ai-entry">
    <header class="ai-entry-head">
      <span class="ai-entry-kind">${esc(kindLabel)}</span>
      <h4 class="ai-entry-title">${esc(entry.title)}</h4>
    </header>

    ${entry.effective ? h`<div class="ai-effective">
      <span class="ai-effective-label">整合结论</span>
      <p>${esc(entry.effective)}</p>
    </div>` : ''}

    ${entry.summary && !entry.effective ? h`<p class="ai-summary">${esc(entry.summary)}</p>` : ''}

    ${entry.changes && entry.changes.length && !compact ? aiChanges(entry.changes) : ''}

    ${entry.points && entry.points.length ? h`<ul class="ai-points">
      ${entry.points.map((p) => h`<li class="ai-point ai-point-${esc(p.level)}">
        <span class="ai-point-dot" aria-hidden="true"></span>${esc(p.text)}</li>`).join('')}
    </ul>` : ''}

    ${entry.advice ? h`<div class="ai-advice"><b>建议</b>${esc(entry.advice)}</div>` : ''}

    ${entry.caveats && entry.caveats.length && !compact ? h`<div class="ai-caveats">
      <div class="ai-caveats-title">仍需你自行确认</div>
      <ul>${entry.caveats.map((c) => h`<li>${esc(c)}</li>`).join('')}</ul>
    </div>` : ''}

    ${entry.sources && entry.sources.length ? h`<div class="ai-sources">
      ${entry.sources.map((sid) => h`<button class="ai-source-chip"
        data-action="open-detail" data-id="${esc(sid)}">#${esc(sid)}</button>`).join('')}
    </div>` : ''}

    <footer class="ai-entry-foot">${aiMark()}</footer>
  </article>`;
}

/** 电脑端常驻 AI 侧栏（固定，始终可操作） */
function aiDock(state, dataset) {
  const ov = aiOverview(dataset, state.now);
  if (!ov.total) return '';
  const open = state.aiPanel === 'dock';

  return h`<div class="ai-dock ${open ? 'is-open' : ''}" data-ai-dock>
    <button class="ai-dock-head" data-action="ai-toggle" data-panel="dock" aria-expanded="${open}">
      <span class="ai-dock-icon" aria-hidden="true">✦</span>
      <span class="ai-dock-text">
        <span class="ai-dock-title">AI 整合助手</span>
        <span class="ai-dock-sub">${ov.total} 条整合与解读${ov.changedItems ? h` · ${ov.changedItems} 条含变更` : ''}</span>
      </span>
      ${aiMark()}
      <span class="ai-dock-chevron" aria-hidden="true">${open ? '▾' : '▸'}</span>
    </button>

    <div class="ai-dock-body">
      ${!open ? h`<div class="ai-collapsed-hint">
        点击上方标题展开。AI 不会自动弹出，需要你主动查看。
      </div>` : h`
        ${ov.groups.map((g) => h`<section class="ai-group">
          <div class="ai-group-head">
            <span class="ai-group-label">${esc(g.label)}</span>
            <span class="ai-group-count">${g.entries.length}</span>
          </div>
          <p class="ai-group-desc">${esc(g.desc)}</p>
          ${g.entries.map((e) => aiEntryBlock(e, { compact: true })).join('')}
        </section>`).join('')}
        <div class="ai-footer-note">${esc(AI_DISCLAIMER_LONG)}</div>`}
    </div>
  </div>`;
}

/** 手机端 AI 悬浮按钮 + 底部抽屉 */
function aiSheet(state, dataset) {
  const ov = aiOverview(dataset, state.now);
  if (!ov.total) return '';
  const open = state.aiPanel === 'sheet';

  // ⚠ 悬浮按钮必须**始终**渲染，否则折叠状态下按钮不存在 → 永远无法展开
  return h`
    <button class="ai-fab ${open ? 'is-open' : ''}" data-action="ai-toggle" data-panel="sheet"
            aria-label="AI 整合助手" aria-expanded="${open}">
      <span class="ai-fab-icon" aria-hidden="true">✦</span>
      <span class="ai-fab-label">AI</span>
      ${ov.changedItems ? h`<span class="ai-fab-badge">${ov.changedItems}</span>` : ''}
    </button>
    ${open ? h`<div class="ai-sheet-mask" data-action="ai-close"></div>
      <div class="ai-sheet" role="dialog" aria-label="AI 整合助手">
        <div class="ai-sheet-head">
          <span class="ai-sheet-title">✦ AI 整合助手</span>
          ${aiMark()}
          <button class="icon-btn" data-action="ai-close" aria-label="收起">${ICON.close}</button>
        </div>
        <div class="ai-sheet-body">
          ${ov.groups.map((g) => h`<section class="ai-group">
            <div class="ai-group-head">
              <span class="ai-group-label">${esc(g.label)}</span>
              <span class="ai-group-count">${g.entries.length}</span>
            </div>
            <p class="ai-group-desc">${esc(g.desc)}</p>
            ${g.entries.map((e) => aiEntryBlock(e, { compact: true })).join('')}
          </section>`).join('')}
          <div class="ai-footer-note">${esc(AI_DISCLAIMER_LONG)}</div>
        </div>
      </div>` : ''}`;
}

/**
 * 帖子内部的 AI 区块（位于正文之后）。
 *
 * 内容来源有两部分：
 *   ① 数据中手写的 AI 条目（AI_ENTRIES）
 *   ② 由风险规则**自动生成**的质量解读（risksToAiEntry）
 * 第 ② 项的存在意义：把"建议 / 需谨慎 / 建议确认"这类解读性内容
 * 从详情页顶部收敛到本模块，使顶部只保留对原文的忠实陈述。
 *
 * 导出原因：详情弹层在 app.js 中渲染，需要跨模块调用本函数。
 */
export function aiInDetail(item, state) {
  const written = aiEntriesOf(item.id);
  const auto = risksToAiEntry(item);
  // 已有手写质量解读时不重复生成，避免同一件事出现两遍
  const hasWrittenQuality = written.some((e) => e.kind === AI_KIND.QUALITY);
  const entries = auto && !hasWrittenQuality ? [...written, auto] : written;
  if (!entries.length) return '';
  const open = state.aiPanel === 'detail';
  const autoCount = entries.filter((e) => String(e.id).startsWith('ai-auto-')).length;
  /* ⚠ 展开/收起【不靠重新渲染弹层】，而是就地切换 .is-open。
     原因：以前点击这里会走 setState → renderModal() → 整个弹层 innerHTML 被重建，
     节点被换掉的那一瞬间整块内容闪一下（用户反馈的"AI 模块点击时闪烁"）。
     所以正文始终渲染在 DOM 里，收起用 CSS 把高度压到 0；
     点击只改类名与 aria，不重建任何节点。 */
  return h`<section class="ai-embed ${open ? 'is-open' : ''}">
    <button class="ai-embed-head" data-action="ai-toggle" data-panel="detail" aria-expanded="${open}">
      <span class="ai-dock-icon" aria-hidden="true">✦</span>
      <span class="ai-embed-title">AI 整合与解读</span>
      <span class="ai-embed-count">${entries.length} 条${autoCount ? '（含自动生成）' : ''}</span>
      ${aiMark()}
      <span class="ai-dock-chevron" aria-hidden="true">${open ? '▾' : '▸'}</span>
    </button>
    <div class="ai-embed-body-wrap">
      <div class="ai-embed-body">
        ${entries.map((e) => aiEntryBlock(e)).join('')}
        <div class="ai-footer-note">${esc(AI_DISCLAIMER_LONG)}</div>
      </div>
    </div>
  </section>`;
}


/* ============================================================
 * 官方标识（强区分）
 * ============================================================ */

/** 官方信息使用醒目的机构标识，非官方使用中性标识 */
export function officialMark(item) {
  if (isOfficial(item)) {
    return h`<span class="off-mark is-official" title="学校或学院正式发布，有机构背书">
      <span class="off-mark-icon" aria-hidden="true">✓</span>官方
    </span>`;
  }
  return h`<span class="off-mark is-student" title="学生个人发布，未经机构审核">
    <span class="off-mark-icon" aria-hidden="true">人</span>学生自发
  </span>`;
}

/* ============================================================
 * 板块导航
 * ============================================================ */

/** 手机端：圆形板块入口（时间线已移到上方的高层级视图切换，不在此处） */
function boardCircles(state, dataset) {
  const list = BOARDS.filter((b) => b.types === 'board');
  const counts = {};
  for (const b of list) {
    counts[b.id] = b.id === BOARD.ALL ? dataset.length : itemsOfBoard(dataset, b.id).length;
  }
  return h`<nav class="board-circles" aria-label="板块导航">
    ${list.map((b) => {
      const on = state.board === b.id;
      return h`<button class="board-circle ${on ? 'is-active' : ''} ${b.official ? 'is-official' : ''}"
          data-action="board" data-id="${esc(b.id)}" aria-current="${on}">
        <span class="board-circle-icon" aria-hidden="true">${esc(b.icon)}</span>
        <span class="board-circle-label">${esc(b.short)}</span>
        <span class="board-circle-count">${counts[b.id] ?? 0}</span>
      </button>`;
    }).join('')}
  </nav>`;
}

/* ============================================================
 * 高层级视图切换：机会列表 / 时间线
 *
 * 时间线原本是"板块"之一，但它的性质与板块不同——
 * 板块是内容分类，时间线是**同一批内容的另一种排列方式**。
 * 因此提升为与"板块"同级的视图切换，放在最上方。
 * ============================================================ */

const TIMELINE_SCOPES = [
  { id: 'official', label: '仅官方', hint: '默认：只看有机构背书的信息' },
  { id: 'all', label: '全部来源', hint: '官方 + 学生自发' },
  { id: 'student', label: '仅学生自发', hint: '只看同学个人发布' },
];

function viewSwitcher(state) {
  const isTl = state.board === BOARD.TIMELINE;
  return h`<div class="view-switch">
    <div class="view-switch-tabs" role="tablist">
      <button class="vs-tab ${!isTl ? 'is-active' : ''}" role="tab"
          aria-selected="${!isTl}" data-action="board" data-id="${BOARD.ALL}">
        <span aria-hidden="true">◎</span>机会列表
        <span class="vs-tab-n">${state.boardCounts?.all ?? ''}</span>
      </button>
      <button class="vs-tab ${isTl ? 'is-active' : ''}" role="tab"
          aria-selected="${isTl}" data-action="board" data-id="${BOARD.TIMELINE}">
        <span aria-hidden="true">时</span>时间线
      </button>
    </div>
    ${isTl ? h`<div class="scope-row">
      <span class="scope-label">显示范围</span>
      ${TIMELINE_SCOPES.map((s) => h`<button class="scope-btn ${state.timelineScope === s.id ? 'is-active' : ''}"
          data-action="timeline-scope" data-id="${esc(s.id)}" title="${esc(s.hint)}">${esc(s.label)}</button>`).join('')}
      <span class="scope-hint">${esc((TIMELINE_SCOPES.find((s) => s.id === state.timelineScope) || {}).hint || '')}</span>
    </div>` : ''}
  </div>`;
}


/** 工具入口宫格（参考所给界面的五宫格） */
const TOOL_ENTRIES = [
  { id: 'urgent', label: '即将截止', icon: '⏰', hint: '48 小时内' },
  { id: 'newbie', label: '新生友好', icon: '🌱', hint: '零基础' },
  { id: 'standby', label: '可候补', icon: '🎫', hint: '仍可参与' },
  { id: 'today', label: '今天', icon: '📅', hint: '当天发生' },
  { id: 'risk', label: '需核实', icon: '⚠', hint: '信息存疑' },
];

function toolGrid(state) {
  return h`<nav class="tool-grid" aria-label="快捷入口">
    ${TOOL_ENTRIES.map((t) => h`<button class="tool-item ${state.quick === t.id ? 'is-active' : ''}"
        data-action="quick" data-id="${esc(t.id)}">
      <span class="tool-icon" aria-hidden="true">${t.icon}</span>
      <span class="tool-label">${esc(t.label)}</span>
      <span class="tool-hint">${esc(t.hint)}</span>
    </button>`).join('')}
  </nav>`;
}

/** 标签筛选条（仅在「发现」页显示；我的 / 说明 页不出现，避免误导） */
function tagRow(state, dataset) {
  if (state.route !== 'feed') return '';
  const tags = state.tagCloud || [];
  if (!tags.length) return '';
  const top = tags.slice(0, 10);
  return h`<div class="tag-row">
    <span class="tag-row-label">标签</span>
    ${top.map(({ tag, count }) => {
      const on = state.activeTags.includes(tag);
      return h`<button class="tag ${on ? 'is-active' : ''}" data-action="tag" data-tag="${esc(tag)}">
        ${esc(tag)}<span class="tag-n">${count}</span>
      </button>`;
    }).join('')}
    ${state.activeTags.length ? h`<button class="tag tag-clear" data-action="clear-tags">清除标签</button>` : ''}
  </div>`;
}

/** 当前生效的板块 id。
    ⚠ 有关键词时一律按"全部板块"取数：搜索必须跨板块，
    否则用户停在某个板块里搜别的东西会一条都搜不到，而他还不知道原因。
    这与 app.js 的 computeDataset 保持一致（那边搜索时同样忽略板块/快捷/标签）。 */
function activeBoardId(state) {
  const kw = (state.filters && state.filters.keyword || '').trim();
  if (kw) return BOARD.ALL;
  return state.board || BOARD.ALL;
}

/* ============================================================
 * 信息卡（区分官方 / 非官方）
 * ============================================================ */

/**
 * 搜索命中提示：告诉用户"这条为什么被搜出来"。
 *
 * 起因：搜 ymq 出现「周末羽毛球约球」这类结果时，标题里没有 ymq，
 * 用户只会觉得"搜索很奇怪"。所以：
 *   · 字面命中 → 直接标出命中的那段文字（<mark>）
 *   · 非字面命中（拼音/首字母/近义词/错字）→ 写明命中方式 + 命中在哪个字段
 * 只在与当前关键词相关时渲染，平时不占位。
 */
function matchHint(item, state) {
  const kw = (state.filters && state.filters.keyword || '').trim();
  if (!kw) return '';
  const info = matchInfo(item, kw);
  if (!info) return '';
  const mode = MATCH_MODE_LABEL[info.mode] || info.mode;
  const lit = highlightMatch(info);
  const where = lit
    ? h`命中「${esc(lit.before)}<mark class="hit">${esc(lit.hit)}</mark>${esc(lit.after)}」`
    : h`${esc(mode)} 命中「${esc(info.field)}」`;
  return h`<div class="match-hint">
    <span class="mh-tag">${esc(mode)}</span>
    <span class="mh-text">${where}</span>
    ${info.synFrom ? h`<span class="mh-syn">由「${esc(info.synFrom)}」扩展</span>` : ''}
  </div>`;
}

function infoCard(item, state) {
  const fav = isFavored(state, item);
  const urgent = item.status === STATUS.CLOSING || item.status === STATUS.STANDBY;
  const off = isOfficial(item);
  return h`<article class="card ${statusClass(item.status)} ${off ? 'is-official' : 'is-student'}"
      data-id="${esc(item.id)}" data-action="open-detail">
    <div class="card-top">
      ${officialMark(item)}
      <div class="card-tags">
        ${sourceTag(item)}${kindTag(item)}${credibilityBadge(item)}
      </div>
      ${statusBadge(item)}
    </div>

    <h3 class="card-title">${esc(item.title)}</h3>

    ${matchHint(item, state)}

    <div class="card-meta">
      ${item.startText ? h`<span class="meta-item"><span class="icon">${ICON.clock}</span>${esc(item.startText)}${item.recurring ? h`<span class="fld-extra">${esc(item.recurring)}</span>` : ''}</span>` : ''}
      ${item.deadlineText ? h`<span class="meta-item ${urgent ? 'is-urgent' : ''}"><span class="icon">${ICON.clock}</span>截止 ${esc(item.deadlineText)}${item.deadlineCountdown ? h` · ${esc(item.deadlineCountdown)}` : ''}</span>` : ''}
      ${item.place ? h`<span class="meta-item"><span class="icon">${ICON.pin}</span>${esc(item.place)}</span>`
        : (item.placeStatus ? h`<span class="meta-item"><span class="icon">${ICON.pin}</span>${esc(item.placeStatus)}</span>` : '')}
      ${item.audience ? h`<span class="meta-item">${esc(item.audience)}</span>` : ''}
      ${item.weeklyHours ? h`<span class="meta-item">每周约 ${item.weeklyHours} 小时</span>` : ''}
    </div>

    ${item.tags && item.tags.length ? h`<div class="card-taglist">
      ${item.tags.map((t) => h`<button class="tag tag-sm" data-action="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>` : ''}

    ${seriesNote(item)}
    ${roleNote(item)}
    ${missingLine(item)}
    ${riskList(item, { compact: true })}

    <div class="card-foot">
      ${completenessMeter(item)}
      <span class="grow"></span>
      <button class="btn-fav ${fav ? 'is-on' : ''}" data-action="toggle-fav" data-id="${esc(item.id)}"
              aria-pressed="${fav}">${fav ? ICON.starFill : ICON.star}<span>${fav ? '已收藏' : '收藏'}</span></button>
    </div>
  </article>`;
}

function emptyState(state, { filtered, hint }) {
  return h`<div class="empty">
    <div class="empty-icon" aria-hidden="true">🔍</div>
    <div class="empty-title">${filtered ? '这个板块暂时没有符合条件的信息' : '还没有收藏任何信息'}</div>
    <div class="empty-desc">${
      hint ? esc(hint)
        : filtered ? '试着切换板块、清除标签或放宽筛选条件。'
        : '在信息流里点「收藏」，就会出现在这里，并按截止时间排序。'
    }</div>
    ${filtered ? h`<button class="btn" data-action="reset-filters">清空全部筛选</button>` : ''}
  </div>`;
}

/** 板块头部说明 */
function boardHeader(boardId, count) {
  const b = BOARD_MAP[boardId];
  if (!b) return '';
  return h`<div class="board-header ${b.official ? 'is-official' : ''}">
    <div class="board-header-main">
      <span class="board-header-icon" aria-hidden="true">${esc(b.icon)}</span>
      <div>
        <h2 class="board-header-title">${esc(b.label)}
          <span class="board-header-count">${count} 条</span>
          ${b.official ? h`<span class="off-mark is-official"><span class="off-mark-icon">✓</span>仅官方来源</span>` : ''}
        </h2>
        <p class="board-header-desc">${esc(b.desc)}</p>
      </div>
    </div>
  </div>`;
}

/* ============================================================
 * 时间线视图
 * ============================================================ */

function timelineView(state, dataset) {
  const groups = buildTimeline(dataset, state.now);
  if (!groups.length) return emptyState(state, { filtered: true });
  return h`<div class="timeline">
    ${groups.map((g) => h`<section class="tl-group ${g.past ? 'is-past' : ''}">
      <div class="tl-date">
        <span class="tl-date-label">${esc(g.label)}</span>
        <span class="tl-date-sub">${esc(g.key === 'unscheduled' ? '原文未给出明确时间' : g.key)}</span>
        <span class="tl-date-count">${g.items.length} 条</span>
      </div>
      <div class="tl-items">
        ${g.items.map((item) => h`<div class="tl-item ${isOfficial(item) ? 'is-official' : 'is-student'} ${statusClass(item.status)}"
            data-action="open-detail" data-id="${esc(item.id)}">
          <div class="tl-dot" aria-hidden="true"></div>
          <div class="tl-body">
            <div class="tl-top">
              ${officialMark(item)}
              ${kindTag(item)}
              ${statusBadge(item)}
            </div>
            <div class="tl-title">${esc(item.title)}</div>
            <div class="tl-meta">
              ${item.startText ? h`<span>${esc(item.startText)}</span>` : ''}
              ${item.place ? h`<span>${esc(item.place)}</span>` : (item.placeStatus ? h`<span>${esc(item.placeStatus)}</span>` : '')}
              ${item.deadlineText ? h`<span>截止 ${esc(item.deadlineText)}</span>` : ''}
            </div>
          </div>
        </div>`).join('')}
      </div>
    </section>`).join('')}
  </div>`;
}

/* ============================================================
 * 手机端
 * ============================================================ */

export function renderMobile(state, dataset) {
  const s = state.summarize(dataset);
  const boardId = activeBoardId(state);
  const boardItems = itemsOfBoard(dataset, boardId);
  const isTimeline = boardId === BOARD.TIMELINE;
  const onFeed = state.route === 'feed';

  let body;
  if (state.route === 'mine') {
    const favs = dataset.filter((i) => isFavored(state, i));
    const mine = dataset.filter((i) => i.isUserPost);
    body = h`<div class="section">
        <div class="section-title">我的日程 <span class="rule"></span>${favs.length} 条</div>
        ${favs.length ? favs.map((i) => infoCard(i, state)).join('') : emptyState(state, { filtered: false })}
      </div>
      <div class="section">
        <div class="section-title">我发布的信息 <span class="rule"></span>${mine.length} 条</div>
        ${mine.length ? mine.map((i) => infoCard(i, state)).join('')
          : h`<div class="empty"><div class="empty-desc">还没有发布过信息。点右下角 ＋ 试试。</div></div>`}
      </div>`;
  } else if (state.route === 'about') {
    body = aboutPanel(state, dataset);
  } else {
    /* 手机端信息流与电脑端共用 feedSection：cardGrid 会按 state.device 分成
       单列/多列，空状态与时间线文案也只有一处，避免两端逻辑漂移。 */
    body = h`
      ${featuredPanel(state, dataset, { compact: true })}
      ${boardPinZone(state, dataset, boardId)}
      ${isTimeline ? '' : boardHeader(boardId, boardItems.length)}
      ${feedSection(state, dataset)}`;
  }

  return h`${topbar(state, dataset)}
    ${onFeed ? viewSwitcher(state) : ''}
    ${onFeed && !isTimeline ? boardCircles(state, dataset) : ''}
    ${onFeed ? toolGrid(state) : ''}
    ${onFeed && !isTimeline ? tagRow(state, dataset) : ''}
    <div class="shell">
      <div class="main-col">
        ${onFeed ? statsBar(s) : ''}
        ${body}
      </div>
    </div>
    ${onFeed ? h`<button class="fab" data-action="open-publish" aria-label="发布" title="发布信息">${ICON.plus}</button>` : ''}
    ${onFeed ? toTopButton() : ''}
    ${bottomNav(state)}
    ${aiSheet(state, dataset)}`;
}

/**
 * 回到顶部按钮（两端共用，位置固定在右下角的按钮栈里）。
 *
 * 默认 `is-visible` 不置位（CSS 里是透明 + 不吃事件），
 * 由 app.js 的滚动监听按 scrollY 切换 —— 因此这里不带任何滚动状态，
 * 渲染函数保持"纯 state → HTML"。
 */
export function toTopButton() {
  return h`<button class="to-top" data-action="to-top" aria-label="回到顶部" title="回到顶部">
    ${ICON.arrowUp}
  </button>`;
}

function bottomNav(state) {
  const items = [
    { route: 'feed', label: '发现', icon: ICON.search },
    { route: 'mine', label: '我的', icon: ICON.star },
    { route: 'about', label: '说明', icon: ICON.warn },
  ];
  return h`<nav class="bottomnav" role="navigation">
    ${items.map((it) => h`<button class="nav-item ${state.route === it.route ? 'is-active' : ''}"
        data-action="nav" data-route="${esc(it.route)}">${it.icon}${esc(it.label)}</button>`).join('')}
  </nav>`;
}

/* ============================================================
 * 桌面端
 * ============================================================ */

export function renderDesktop(state, dataset) {
  const s = state.summarize(dataset);
  const boardId = activeBoardId(state);
  const boardItems = itemsOfBoard(dataset, boardId);
  const isTimeline = boardId === BOARD.TIMELINE;

  /* 左侧栏在电脑端是"图标轨道 + 悬停展开"：收起时仍保留板块图标，鼠标移到轨道上即展开。
     早先的实现是"完全隐藏 + 屏幕左边缘 16px 隐形热区"，两个问题：
       ① 收起后什么都看不见，用户不知道那里有东西；
       ② 隐形热区在【窗口化（非全屏）】时几乎点不到 —— 全屏时指针会被屏幕边缘"挡住"
          从而碰巧命中，窗口化时没有这个边界，很容易差十几像素而毫无反应。
     现在轨道本身就是可见、够大的悬停目标，两个问题一起消失，也不需要热区元素了。 */
  const sidebar = h`<aside class="sidebar" aria-label="板块与筛选">
    ${boardNavPanel(state, dataset)}
    ${state.route === 'feed' ? filterPanel(state) : ''}
  </aside>`;

  // 右栏顺序：紧急提醒 → 我的日程 → AI 整合助手
  // AI 助手放在最下方（此前在最上方且 sticky 常驻，视觉上抢占了主要内容区）。
  // 详情弹层内另有 AI 区块，因此右栏下移不影响"帖子内也能用 AI"。
  const aside = h`<div class="aside-scroll">
    ${urgentPanel(state, dataset)}
    ${myPanel(state, dataset)}
    ${aiDock(state, dataset)}
  </div>`;

  let main;
  if (state.route === 'mine') {
    const favs = dataset.filter((i) => isFavored(state, i));
    const mine = dataset.filter((i) => i.isUserPost);
    main = h`<div class="panel">
        <div class="panel-title">${ICON.star} 我的日程<span class="count">${favs.length} 条 · 按截止时间排序</span></div>
        ${favs.length ? cardGrid(favs, state) : emptyState(state, { filtered: false })}
      </div>
      <div class="panel">
        <div class="panel-title">${ICON.plus} 我发布的信息<span class="count">${mine.length} 条</span></div>
        ${mine.length ? cardGrid(mine, state)
          : h`<div class="empty"><div class="empty-desc">还没有发布过信息。点左上「＋ 发布信息」试试。</div></div>`}
      </div>`;
  } else if (state.route === 'about') {
    main = aboutPanel(state, dataset);
  } else {
    main = h`
      ${viewSwitcher(state)}
      ${featuredPanel(state, dataset)}
      ${tagRow(state, dataset)}
      ${boardPinZone(state, dataset, boardId)}
      ${isTimeline ? '' : boardHeader(boardId, boardItems.length)}
      ${statsBar(s)}
      ${!isTimeline ? viewModeBar(state, boardItems.length) : ''}
      ${feedSection(state, dataset)}`;
  }

  /* 电脑端右下角也需要发布入口：
     反馈"电脑端右下角锁定位置放一个加号按钮用于发布内容"。
     手机端本来就有 .fab，这里把它一并渲染到电脑端（CSS 负责两端的定位与大小），
     并与"回到顶部"组成右下角的按钮栈（见 CSS 的 --dock-* 变量）。 */
  return h`${topbar(state, dataset)}
    <div class="shell">
      ${sidebar}
      <div class="main-col">${main}</div>
      <div class="aside-col">
        ${aside}
      </div>
    </div>
    <button class="fab" data-action="open-publish" aria-label="发布信息" title="发布信息">${ICON.plus}</button>
    ${toTopButton()}`;
}

function boardNavPanel(state, dataset) {
  // 只列出真正的「板块」（时间线已提升为高层级视图切换，不在此处）
  const list = BOARDS.filter((b) => b.types === 'board');
  /* 板块图标：轨道态只显示图标，所以图标必须能独立表意。
     材料给的汉字简称（校/赛/学/招/活/生）在窄轨道里既不像图标也难区分，
     这里换成统一风格的线性 SVG；未知板块仍回落到原字符，不会出现空白。 */
  const iconOf = (id, fallback) => ({
    [BOARD.ALL]: ICON.boardAll,
    [BOARD.OFFICIAL]: ICON.boardOfficial,
    [BOARD.CONTEST]: ICON.boardContest,
    [BOARD.LEARN]: ICON.boardLearn,
    [BOARD.RECRUIT]: ICON.boardRecruit,
    [BOARD.CAMPUS]: ICON.boardCampus,
    [BOARD.STUDENT]: ICON.boardStudent,
    [BOARD.TIMELINE]: ICON.boardTimeline,
  }[id] || esc(fallback));

  const navRow = (b, { count, on }) => h`<button class="nav-link ${on ? 'is-active' : ''} ${b.official ? 'is-official' : ''}"
      data-action="board" data-id="${esc(b.id)}" title="${esc(b.label)}"
      aria-label="${esc(b.label)}">
    <span class="nav-board-icon" aria-hidden="true">${iconOf(b.id, b.icon)}</span>
    <span class="nav-label">${esc(b.label)}</span>
    <span class="count">${count}</span>
  </button>`;

  const allBoard = BOARD_MAP[BOARD.ALL];
  const rows = list.map((b) => navRow(b, {
    count: itemsOfBoard(dataset, b.id).length,
    on: state.route === 'feed' && state.board === b.id,
  })).join('');

  /* 「全部内容」单独放在最上面一块：
     它是"聚合视图"（BOARD.ALL 的 types 是 aggregate），本来就不属于任何板块，
     而桌面端侧栏此前只有板块列表，没有回到"看全部"的入口 —— 只能靠顶栏品牌或重载页面。
     单独成块后既补上了这个入口，也不会和板块混在一起（避免"全部也算一个板块"的误解）。 */
  return h`<div class="panel nav-all-panel">
    <div class="panel-title">内容</div>
    <div class="nav-list">
      ${navRow(allBoard, { count: dataset.length, on: state.route === 'feed' && state.board === BOARD.ALL })}
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">板块</div>
    <div class="nav-list">
      ${rows}
      ${navRow(BOARD_MAP[BOARD.TIMELINE], {
        count: dataset.length,
        on: state.route === 'feed' && state.board === BOARD.TIMELINE,
      })}
      <button class="nav-link" data-action="nav" data-route="mine"
              title="我的日程" aria-label="我的日程">
        <span class="nav-board-icon" aria-hidden="true">${ICON.star}</span>
        <span class="nav-label">我的日程</span><span class="count">${state.favorites.length}</span>
      </button>
      <button class="nav-link" data-action="open-publish" title="发布信息" aria-label="发布信息">
        <span class="nav-board-icon" aria-hidden="true">${ICON.plus}</span>
        <span class="nav-label">发布信息</span>
      </button>
    </div>
  </div>`;
}

const QUICK_CHIPS = [
  { id: 'urgent', label: '即将截止' },
  { id: 'standby', label: '可候补' },
  { id: 'newbie', label: '零基础 / 新生' },
  { id: 'today', label: '今天' },
  { id: 'rolling', label: '长期有效' },
  { id: 'risk', label: '需核实' },
];

function chipRow(state, dataset) {
  const s = state.summarize(dataset);
  const counts = { urgent: s.closing, standby: s.standby, risk: s.suspect };
  const chips = QUICK_CHIPS.map((c) => {
    const on = state.quick === c.id;
    const n = counts[c.id];
    return h`<button class="chip ${on ? 'is-active' : ''}" data-action="quick" data-id="${esc(c.id)}">
      ${esc(c.label)}${n !== undefined ? h` <span class="chip-n">${n}</span>` : ''}
    </button>`;
  }).join('');
  return h`<div class="chip-row">${chips}</div>`;
}

function filterPanel(state) {
  const f = state.filters;
  const groups = [
    { key: 'source', label: '来源', options: [
      { value: 'school', label: '校级发布' },
      { value: 'college', label: '院级发布' },
      { value: 'student', label: '学生自发' },
    ] },
    { key: 'kind', label: '类型', options: Object.entries(KIND_LABEL).map(([v, l]) => ({ value: v, label: l })) },
    { key: 'audience', label: '适合谁', options: [
      { value: 'newbie', label: '零基础 / 新生友好' },
      { value: 'all', label: '全校可参加' },
      { value: 'senior', label: '高年级专属' },
      { value: 'team', label: '需要组队' },
    ] },
    { key: 'time', label: '时间', options: [
      { value: 'today', label: '今天' },
      { value: 'week', label: '7 天内' },
      { value: 'later', label: '更晚' },
      { value: 'rolling', label: '长期有效' },
    ] },
  ];
  const html = groups.map((g) => {
    const selected = f[g.key] || [];
    return h`<div class="filter-group">
      <div class="filter-group-title">${esc(g.label)}</div>
      <div class="check-list">
        ${g.options.map((o) => {
          const on = selected.includes(o.value);
          return h`<label class="check ${on ? 'is-on' : ''}">
            <input type="checkbox" data-action="filter" data-group="${esc(g.key)}"
                   value="${esc(o.value)}" ${on ? 'checked' : ''} /><span>${esc(o.label)}</span>
          </label>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
  const activeCount = Object.entries(f).filter(([k]) => k !== 'keyword')
    .reduce((n, [, v]) => n + (Array.isArray(v) ? v.length : 0), 0);
  return h`<div class="panel">
    <div class="panel-title">${ICON.filter} 筛选<span class="count">${activeCount ? activeCount + ' 项生效' : ''}</span></div>
    ${html}
    ${activeCount ? h`<button class="btn btn-sm btn-block" data-action="reset-filters" style="margin-top:12px">清空筛选</button>` : ''}
  </div>`;
}

function urgentPanel(state, dataset) {
  const urgent = itemsOfBoard(dataset, BOARD.ALL)
    .filter((i) => i.status === STATUS.CLOSING || i.status === STATUS.STANDBY);
  return h`<div class="panel">
    <div class="panel-title">${ICON.clock} 紧急提醒<span class="count">${urgent.length} 项</span></div>
    ${urgent.length ? urgent.slice(0, 5).map((i) => h`
      <div class="aside-row" data-action="open-detail" data-id="${esc(i.id)}">
        <div class="aside-row-title">${esc(i.title)}</div>
        ${statusBadge(i)}
      </div>`).join('')
      : h`<div class="empty-desc">暂无 48 小时内截止或可候补的信息。</div>`}
  </div>`;
}

function myPanel(state, dataset) {
  const favs = dataset.filter((i) => isFavored(state, i));
  return h`<div class="panel">
    <div class="panel-title">${ICON.star} 我的日程<span class="count">${favs.length} 条</span></div>
    ${favs.length ? favs.slice(0, 4).map((i) => h`
      <div class="aside-row" data-action="open-detail" data-id="${esc(i.id)}">
        <div class="aside-row-title">${esc(i.title)}</div>
        <div class="fld-extra">${esc(i.deadlineCountdown || i.startCountdown || i.statusLabel)}</div>
      </div>`).join('')
      : h`<div class="empty-desc">还没有收藏。在卡片上点「收藏」即可加入日程。</div>`}
  </div>`;
}

function riskPanel(state, dataset) {
  const risky = itemsOfBoard(dataset, BOARD.ALL).filter((i) => i.risks.length);
  const suspect = risky.filter((i) => i.credibility === 'suspect');
  return h`<div class="panel">
    <div class="panel-title">${ICON.warn} 信息质量提示<span class="count">${risky.length} 条</span></div>
    <div class="empty-desc" style="margin-bottom:8px">
      其中 <b style="color:var(--risk-danger)">${suspect.length}</b> 条存在明显异常信号。
      这些信息<b>仍会展示</b>（保证开放发布），但已标注问题。
    </div>
    ${suspect.map((i) => h`<div class="aside-row" data-action="open-detail" data-id="${esc(i.id)}">
      <div class="aside-row-title">${esc(i.title)}</div>
      ${riskList(i, { compact: true })}
    </div>`).join('')}
    <button class="btn btn-sm btn-block" data-action="quick" data-id="risk" style="margin-top:10px">只看需核实的信息</button>
  </div>`;
}

function aboutPanel(state, dataset) {
  const s = state.summarize(dataset);
  return h`<div class="panel">
    <div class="panel-title">这个产品解决什么问题</div>
    <p style="margin:0 0 14px;line-height:var(--lh-loose)">
      题目给出的信息存在四类真实麻烦：<b>来源不同</b>（校级 / 院级 / 学生自发）、
      <b>字段残缺</b>（报名时间未注明、费用未提供、地点待定）、<b>状态特殊</b>
      （已结束但会传回放、已截止但可候补、长期招募无截止）、<b>质量参差</b>
      （个别内容夹杂推广，甚至要求加私人微信）。
      本产品不做"信息展示"，而是把这些信息整理成<b>能直接判断和行动</b>的决策面板。
    </p>
    <div class="panel-title">组织方式</div>
    <p style="margin:0 0 14px;line-height:var(--lh-loose);font-size:var(--fs-sm);color:var(--text-secondary)">
      采用<b>标签制 + 分板块</b>：<b>官方发布独立成板</b>，与竞赛 / 学习资源 / 招募 / 校园活动 / 学生自发并列；
      每条信息同时携带主题标签，可跨板块按标签筛选。另设<b>时间线</b>视图，按事情发生的时间排列。
      官方信息在界面上有统一且更强的视觉标识（蓝色竖条 + 「官方」徽章），学生自发使用中性标识。
    </p>
    <div class="panel-title">置顶机制</div>
    <p style="margin:0 0 14px;line-height:var(--lh-loose);font-size:var(--fs-sm);color:var(--text-secondary)">
      主区域与各板块均设置顶栏目。<b>置顶必须填写理由</b>，且支持到期自动失效——
      它是"防止错过或做错"的功能，不是运营位。
    </p>
    <div class="panel-title">当前数据概览</div>
    <div class="stats" style="padding:0">
      <span class="stat">共 <b>${s.total}</b> 条</span>
      <span class="stat stat-official">官方 <b>${s.official}</b></span>
      <span class="stat stat-student">学生自发 <b>${s.student}</b></span>
      <span class="stat is-risk">建议核实 <b>${s.suspect}</b></span>
    </div>
  </div>`;
}
