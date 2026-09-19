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
  aiEnabled, aiEntriesOf, aiEntryOf, aiOverview, aiChangeSummaries,
  AI_KIND, AI_DISCLAIMER, AI_DISCLAIMER_LONG,
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

export const LAYOUT = {
  MOBILE_MAX: 767,
  DESKTOP_MIN: 1024,
  WIDE_MIN: 1280,   // 三栏真正放得下的宽度
};

export function isMobile(state) {
  return state.device === 'mobile';
}

/** 该形态下是否显示常驻 AI 侧栏（电脑端宽屏才常驻，手机端用底部抽屉） */
export function hasAiDock(state) {
  return !isMobile(state);
}

/** 表格列：窄屏隐藏次要列，保证核心信息不被挤压（title 为核心列，永不隐藏） */
export function visibleColumns(state) {
  const all = [
    { key: 'title', label: '信息', sortable: false },
    { key: 'source', label: '来源', sortable: true, wide: true },
    { key: 'status', label: '状态', sortable: true },
    { key: 'deadline', label: '报名截止', sortable: true },
    { key: 'startAt', label: '活动时间', sortable: true, wide: true },
    { key: 'place', label: '地点', sortable: false, wide: true },
    { key: 'audience', label: '面向对象', sortable: false, wide: true },
    { key: 'completeness', label: '完整度', sortable: true, wide: true },
  ];
  if (!state.isWide) return all.filter((c) => !c.wide);
  return all;
}

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
      结论来源：${entry.sources.map((sid) => h`<button class="ai-source-chip"
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

/** 帖子内部的 AI 区块（位于正文之后） */
function aiInDetail(item, state) {
  const entries = aiEntriesOf(item.id);
  if (!entries.length) return '';
  const open = state.aiPanel === 'detail';
  return h`<section class="ai-embed">
    <button class="ai-embed-head" data-action="ai-toggle" data-panel="detail" aria-expanded="${open}">
      <span class="ai-dock-icon" aria-hidden="true">✦</span>
      <span class="ai-embed-title">AI 整合与解读</span>
      <span class="ai-embed-count">${entries.length} 条</span>
      ${aiMark()}
      <span class="ai-dock-chevron" aria-hidden="true">${open ? '▾' : '▸'}</span>
    </button>
    ${open ? h`<div class="ai-embed-body">
      ${entries.map((e) => aiEntryBlock(e)).join('')}
      <div class="ai-footer-note">${esc(AI_DISCLAIMER_LONG)}</div>
    </div>` : h`<div class="ai-collapsed-hint">点击展开 AI 对这条信息的整合与质量解读。</div>`}
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
  const boardId = state.board || BOARD.ALL;
  const boardItems = itemsOfBoard(dataset, boardId);
  const isTimeline = boardId === BOARD.TIMELINE;
  const onFeed = state.route === 'feed';

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
      ${isTimeline ? '' : boardHeader(boardId, boardItems.length)}
      ${isTimeline
        ? (boardItems.length ? timelineView(state, boardItems)
          : emptyState(state, { filtered: true, hint: '当前时间线只显示官方信息，可切换为「全部来源」。' }))
        : (boardItems.length ? boardItems.map((i) => infoCard(i, state)).join('')
          : emptyState(state, { filtered: true }))}`;
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
    ${onFeed ? h`<button class="fab" data-action="open-publish" aria-label="发布">${ICON.plus}</button>` : ''}
    ${bottomNav(state)}
    ${aiSheet(state, dataset)}`;
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

  const aside = h`<div class="aside-scroll">
    ${urgentPanel(state, dataset)}
    ${myPanel(state, dataset)}
  </div>`;

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
      ${viewSwitcher(state)}
      ${featuredPanel(state, dataset)}
      ${tagRow(state, dataset)}
      ${boardPinZone(state, dataset, boardId)}
      ${isTimeline ? '' : boardHeader(boardId, boardItems.length)}
      ${statsBar(s)}
      ${isTimeline
        ? (boardItems.length ? timelineView(state, boardItems)
          : emptyState(state, { filtered: true, hint: '当前时间线只显示官方信息，可切换为「全部来源」。' }))
        : h`<div class="table-wrap">${table(state, boardItems)}</div>`}`;
  }

  return h`${topbar(state, dataset)}
    <div class="shell">
      ${sidebar}
      <div class="main-col">${main}</div>
      <div class="aside-col">
        <div class="aside-sticky">${aiDock(state, dataset)}</div>
        ${aside}
      </div>
    </div>`;
}

function boardNavPanel(state, dataset) {
  // 只列出真正的「板块」（时间线已提升为高层级视图切换，不在此处）
  const list = BOARDS.filter((b) => b.types === 'board');
  const rows = list.map((b) => {
    const count = b.id === BOARD.ALL ? dataset.length : itemsOfBoard(dataset, b.id).length;
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
      <button class="nav-link ${state.route === 'feed' && state.board === BOARD.TIMELINE ? 'is-active' : ''}"
          data-action="board" data-id="${BOARD.TIMELINE}">
        <span class="nav-board-icon" aria-hidden="true">时</span>
        <span>时间线</span><span class="count">${dataset.length}</span>
      </button>
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
  // 响应式：窄屏隐藏次要列（来源 / 活动时间 / 地点 / 面向对象 / 完整度），保证核心信息不被挤压
  const cols = visibleColumns(state);
  const labels = { title: '信息', source: '来源', status: '状态', deadline: '报名截止', startAt: '活动时间', place: '地点', audience: '面向对象', completeness: '完整度' };
  const show = (k) => cols.some((c) => c.key === k);

  const head = cols.map((c) => {
    const on = sortKey === c.key;
    return h`<th class="${c.sortable ? 'sortable' : ''} ${on ? 'is-sorted' : ''}"
        ${c.sortable ? h`data-action="sort" data-key="${esc(c.key)}"` : ''}>
      ${esc(c.label)}${on ? h`<span class="sort-ind">${sortDir === 'asc' ? '▲' : '▼'}</span>` : (c.sortable ? '<span class="sort-ind">⇅</span>' : '')}
    </th>`;
  }).join('');

  if (!list.length) {
    return h`<table class="dtable"><thead><tr><th class="col-check"></th>${head}<th></th></tr></thead>
      <tbody><tr><td colspan="${cols.length + 2}">${emptyState(state, { filtered: true })}</td></tr></tbody></table>`;
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
      ${show('title') ? h`<td class="t-title">
        <span class="t-main">${esc(item.title)}</span>
        <span class="t-sub">
          ${officialMark(item)}${kindTag(item)}${credibilityBadge(item)}
          ${item.supplements && item.supplements.length ? h`<span class="src">已更新</span>` : ''}
        </span>
      </td>` : ''}
      ${show('source') ? h`<td class="t-num">${esc(item.org || SOURCE_LABEL[item.source])}</td>` : ''}
      <td>${statusBadge(item)}</td>
      ${show('deadline') ? h`<td class="t-num ${urgent ? 't-urgent' : ''}">${deadlineCell}</td>` : ''}
      ${show('startAt') ? h`<td class="t-num">${item.startText ? esc(item.startText) + (item.recurring ? h`<div class="fld-extra">${esc(item.recurring)}</div>` : '') : '<span class="fld-none">未注明</span>'}</td>` : ''}
      ${show('place') ? h`<td>${item.place ? esc(item.place) : (item.placeStatus ? h`<span class="t-caution">${esc(item.placeStatus)}</span>` : '<span class="t-none">未注明</span>')}</td>` : ''}
      ${show('audience') ? h`<td>${item.audience ? esc(item.audience) : '<span class="t-none">未注明</span>'}</td>` : ''}
      ${show('completeness') ? h`<td>${completenessMeter(item)}</td>` : ''}
      <td class="t-actions">
        <button class="btn btn-sm btn-fav ${fav ? 'is-on' : ''}" data-action="toggle-fav" data-id="${esc(item.id)}">
          ${fav ? '★ 已收藏' : '☆ 收藏'}</button>
      </td>
    </tr>`;
  }).join('');

  return h`<table class="dtable">
    <thead><tr><th class="col-check"></th>${head}<th></th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="${cols.length + 2}">
      当前显示 ${list.length} 条　·　点击表头可排序　·　蓝色竖条为官方发布${state.isWide ? '' : '　·　当前窗口较窄，已自动隐藏部分次要列'}
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
