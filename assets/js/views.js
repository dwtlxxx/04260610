/**
 * views.js —— 双端视图层
 *
 * 同一批数据（来自 logic.js 的派生结果），两种结构：
 *   renderMobile  圆形板块入口 + 工具宫格 + 置顶区 + 信息流 + 底部导航
 *   renderDesktop 板块侧栏 + 置顶面板 + 多列表格/时间线 + 右栏总览
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
} from './logic.js';
import {
  esc, h, ICON, statusBadge, statusClass, credibilityBadge, sourceTag, kindTag,
  completenessMeter, missingLine, riskList, fieldGrid, seriesNote, roleNote,
} from './ui.js';

/* ============================================================
 * 公共片段
 * ============================================================ */

function topbar(state, dataset) {
  const themeModeLabel = state.themeModeLabel || '跟随系统';
  const deviceLabel = state.device === 'mobile' ? '电脑版' : '手机版';
  return h`<header class="topbar">
    <div class="topbar-inner">
      <div class="brand">
        <span class="brand-logo" aria-hidden="true">机</span>
        <span class="brand-text">
          <span class="brand-name">校园机会雷达</span>
          <span class="brand-sub">珠科 · ${state.totalCount} 条信息已整理</span>
        </span>
      </div>
      <div class="topbar-spacer"></div>
      <div class="search-wrap">
        <span class="icon">${ICON.search}</span>
        <input class="search-input" type="search" id="search-input"
               placeholder="搜索活动、招募、地点、标签…"
               value="${esc(state.filters.keyword || '')}" aria-label="搜索" />
      </div>
      <button class="icon-btn with-label" data-action="toggle-theme"
              title="主题：${esc(themeModeLabel)}（点击切换）" aria-label="切换主题">
        ${ICON.theme}<span class="mode-label">${esc(themeModeLabel)}</span>
      </button>
      <button class="icon-btn" data-action="toggle-device"
              title="切换到${deviceLabel}" aria-label="切换到${deviceLabel}">${ICON.device}</button>
    </div>
  </header>`;
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

/** 手机端：圆形入口横排（参考所给界面的圆形分区入口） */
function boardCircles(state, dataset) {
  const counts = {};
  for (const b of BOARDS) {
    if (b.id === BOARD.TIMELINE) continue;
    counts[b.id] = b.id === BOARD.ALL ? dataset.length : itemsOfBoard(dataset, b.id).length;
  }
  return h`<nav class="board-circles" aria-label="板块导航">
    ${BOARDS.filter((b) => b.id !== BOARD.TIMELINE).map((b) => {
      const on = state.board === b.id;
      return h`<button class="board-circle ${on ? 'is-active' : ''} ${b.official ? 'is-official' : ''}"
          data-action="board" data-id="${esc(b.id)}" aria-current="${on}">
        <span class="board-circle-icon" aria-hidden="true">${esc(b.icon)}</span>
        <span class="board-circle-label">${esc(b.short)}</span>
        <span class="board-circle-count">${counts[b.id] ?? 0}</span>
      </button>`;
    }).join('')}
    <button class="board-circle is-timeline ${state.board === BOARD.TIMELINE ? 'is-active' : ''}"
        data-action="board" data-id="${BOARD.TIMELINE}">
      <span class="board-circle-icon" aria-hidden="true">时</span>
      <span class="board-circle-label">时间线</span>
      <span class="board-circle-count">${dataset.length}</span>
    </button>
  </nav>`;
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

/** 标签筛选条 */
function tagRow(state, dataset) {
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

/* ============================================================
 * 信息卡（区分官方 / 非官方）
 * ============================================================ */

function infoCard(item, state) {
  const fav = state.favorites.includes(item.id);
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

function emptyState(state, { filtered }) {
  return h`<div class="empty">
    <div class="empty-icon" aria-hidden="true">🔍</div>
    <div class="empty-title">${filtered ? '这个板块暂时没有符合条件的信息' : '还没有收藏任何信息'}</div>
    <div class="empty-desc">${filtered ? '试着切换板块、清除标签或放宽筛选条件。' : '在信息流里点「收藏」，就会出现在这里，并按截止时间排序。'}</div>
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
  const boardId = state.board || BOARD.ALL;
  const boardItems = itemsOfBoard(dataset, boardId);
  const isTimeline = boardId === BOARD.TIMELINE;

  let body;
  if (state.route === 'mine') {
    const favs = dataset.filter((i) => state.favorites.includes(i.id));
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
    body = h`
      ${featuredPanel(state, dataset, { compact: true })}
      ${boardPinZone(state, dataset, boardId)}
      ${boardHeader(boardId, boardItems.length)}
      ${isTimeline
        ? timelineView(state, boardItems)
        : (boardItems.length ? boardItems.map((i) => infoCard(i, state)).join('') : emptyState(state, { filtered: true }))}`;
  }

  return h`${topbar(state, dataset)}
    ${state.route === 'feed' ? boardCircles(state, dataset) : ''}
    ${state.route === 'feed' ? toolGrid(state) : ''}
    ${state.route === 'feed' ? tagRow(state, dataset) : ''}
    <div class="shell">
      <div class="main-col">
        ${state.route === 'feed' ? statsBar(s) : ''}
        ${body}
      </div>
    </div>
    ${state.route === 'feed' ? h`<button class="fab" data-action="open-publish" aria-label="发布">${ICON.plus}</button>` : ''}
    ${bottomNav(state)}`;
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

const COLUMNS = [
  { key: 'title', label: '信息', sortable: false },
  { key: 'source', label: '来源', sortable: true },
  { key: 'status', label: '状态', sortable: true },
  { key: 'deadline', label: '报名截止', sortable: true },
  { key: 'startAt', label: '活动时间', sortable: true },
  { key: 'place', label: '地点', sortable: false },
  { key: 'audience', label: '面向对象', sortable: false },
  { key: 'completeness', label: '完整度', sortable: true },
];

export function renderDesktop(state, dataset) {
  const s = state.summarize(dataset);
  const boardId = state.board || BOARD.ALL;
  const boardItems = itemsOfBoard(dataset, boardId);
  const isTimeline = boardId === BOARD.TIMELINE;

  const sidebar = h`<aside class="sidebar">
    ${boardNavPanel(state, dataset)}
    ${state.route === 'feed' ? filterPanel(state) : ''}
  </aside>`;

  const aside = h`<aside class="aside">
    ${urgentPanel(state, dataset)}
    ${myPanel(state, dataset)}
    ${riskPanel(state, dataset)}
  </aside>`;

  let main;
  if (state.route === 'mine') {
    const favs = dataset.filter((i) => state.favorites.includes(i.id));
    const mine = dataset.filter((i) => i.isUserPost);
    main = h`<div class="panel">
        <div class="panel-title">${ICON.star} 我的日程<span class="count">${favs.length} 条 · 按截止时间排序</span></div>
        ${favs.length ? h`<div class="table-wrap">${table(state, favs)}</div>` : emptyState(state, { filtered: false })}
      </div>
      <div class="panel">
        <div class="panel-title">${ICON.plus} 我发布的信息<span class="count">${mine.length} 条</span></div>
        ${mine.length ? h`<div class="table-wrap">${table(state, mine)}</div>`
          : h`<div class="empty"><div class="empty-desc">还没有发布过信息。点左上「＋ 发布信息」试试。</div></div>`}
      </div>`;
  } else if (state.route === 'about') {
    main = aboutPanel(state, dataset);
  } else {
    main = h`
      ${featuredPanel(state, dataset)}
      ${tagRow(state, dataset)}
      ${boardPinZone(state, dataset, boardId)}
      ${boardHeader(boardId, boardItems.length)}
      ${statsBar(s)}
      ${isTimeline
        ? timelineView(state, boardItems)
        : h`<div class="table-wrap">${table(state, boardItems)}</div>`}`;
  }

  return h`${topbar(state, dataset)}
    <div class="shell">
      ${sidebar}
      <div class="main-col">${main}</div>
      ${aside}
    </div>`;
}

function boardNavPanel(state, dataset) {
  const rows = BOARDS.map((b) => {
    const count = b.id === BOARD.ALL ? dataset.length
      : b.id === BOARD.TIMELINE ? dataset.length
      : itemsOfBoard(dataset, b.id).length;
    const on = state.route === 'feed' && state.board === b.id;
    return h`<button class="nav-link ${on ? 'is-active' : ''} ${b.official ? 'is-official' : ''}"
        data-action="board" data-id="${esc(b.id)}">
      <span class="nav-board-icon" aria-hidden="true">${esc(b.icon)}</span>
      <span>${esc(b.label)}</span>
      <span class="count">${count}</span>
    </button>`;
  }).join('');

  return h`<div class="panel">
    <div class="panel-title">板块</div>
    <div class="nav-list">
      ${rows}
      <button class="nav-link" data-action="nav" data-route="mine">
        ${ICON.star}<span>我的日程</span><span class="count">${state.favorites.length}</span>
      </button>
      <button class="nav-link" data-action="open-publish">${ICON.plus}<span>发布信息</span></button>
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

function table(state, list) {
  const sortKey = state.sort.key;
  const sortDir = state.sort.dir;
  const head = COLUMNS.map((c) => {
    const on = sortKey === c.key;
    return h`<th class="${c.sortable ? 'sortable' : ''} ${on ? 'is-sorted' : ''}"
        ${c.sortable ? h`data-action="sort" data-key="${esc(c.key)}"` : ''}>
      ${esc(c.label)}${on ? h`<span class="sort-ind">${sortDir === 'asc' ? '▲' : '▼'}</span>` : (c.sortable ? '<span class="sort-ind">⇅</span>' : '')}
    </th>`;
  }).join('');

  if (!list.length) {
    return h`<table class="dtable"><thead><tr><th class="col-check"></th>${head}<th></th></tr></thead>
      <tbody><tr><td colspan="${COLUMNS.length + 2}">${emptyState(state, { filtered: true })}</td></tr></tbody></table>`;
  }

  const rows = list.map((item) => {
    const fav = state.favorites.includes(item.id);
    const urgent = item.status === STATUS.CLOSING || item.status === STATUS.STANDBY;
    const off = isOfficial(item);
    const deadlineCell = item.deadlineText
      ? h`<div>${esc(item.deadlineText)}</div><div class="fld-extra">${esc(item.deadlineCountdown || '')}</div>`
      : '<span class="fld-none">未注明</span>';
    return h`<tr class="${fav ? 'is-fav' : ''} ${off ? 'is-official' : 'is-student'}"
        data-id="${esc(item.id)}" data-action="open-detail">
      <td class="col-check"><input type="checkbox" data-action="select" data-id="${esc(item.id)}" aria-label="选择" /></td>
      <td class="t-title">
        <span class="t-main">${esc(item.title)}</span>
        <span class="t-sub">
          ${officialMark(item)}${kindTag(item)}${credibilityBadge(item)}
          ${item.supplements && item.supplements.length ? h`<span class="src">已更新</span>` : ''}
        </span>
      </td>
      <td class="t-num">${esc(item.org || SOURCE_LABEL[item.source])}</td>
      <td>${statusBadge(item)}</td>
      <td class="t-num ${urgent ? 't-urgent' : ''}">${deadlineCell}</td>
      <td class="t-num">${item.startText ? esc(item.startText) + (item.recurring ? h`<div class="fld-extra">${esc(item.recurring)}</div>` : '') : '<span class="fld-none">未注明</span>'}</td>
      <td>${item.place ? esc(item.place) : (item.placeStatus ? h`<span class="t-caution">${esc(item.placeStatus)}</span>` : '<span class="t-none">未注明</span>')}</td>
      <td>${item.audience ? esc(item.audience) : '<span class="t-none">未注明</span>'}</td>
      <td>${completenessMeter(item)}</td>
      <td class="t-actions">
        <button class="btn btn-sm btn-fav ${fav ? 'is-on' : ''}" data-action="toggle-fav" data-id="${esc(item.id)}">
          ${fav ? '★ 已收藏' : '☆ 收藏'}</button>
      </td>
    </tr>`;
  }).join('');

  return h`<table class="dtable">
    <thead><tr><th class="col-check"></th>${head}<th></th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="${COLUMNS.length + 2}">
      当前显示 ${list.length} 条　·　点击表头可排序　·　左侧蓝色竖条为官方发布
    </td></tr></tfoot>
  </table>`;
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
  const favs = dataset.filter((i) => state.favorites.includes(i.id));
  return h`<div class="panel">
    <div class="panel-title">${ICON.star} 我的日程<span class="count">${favs.length} 条</span></div>
    ${favs.length ? favs.slice(0, 4).map((i) => h`
      <div class="aside-row" data-action="open-detail" data-id="${esc(i.id)}">
        <div class="aside-row-title">${esc(i.title)}</div>
        <div class="fld-extra">${esc(i.deadlineCountdown || i.startCountdown || i.statusLabel)}</div>
      </div>`).join('')
      : h`<div class="empty-desc">还没有收藏。点表格右侧「☆ 收藏」加入日程。</div>`}
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
