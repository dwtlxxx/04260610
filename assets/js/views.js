/**
 * views.js —— 双端视图层
 *
 * 同一批数据（来自 logic.js 的派生结果），两种结构：
 *   renderMobile  卡片流 + 底部 Tab     —— 成熟社交信息流形态，碎片化浏览
 *   renderDesktop 侧栏 + 多列表格 + 右栏 —— 信息密度高，支持排序与比较
 *
 * 两端共用 ui.js 的所有渲染件，因此状态徽章、风险提示、完整度条完全一致。
 */

import {
  STATUS, STATUS_LABEL, KIND_LABEL, SOURCE_LABEL, RISK_LEVEL,
} from './logic.js';
import {
  esc, h, ICON, statusBadge, statusClass, credibilityBadge, sourceTag, kindTag,
  completenessMeter, missingLine, riskList, fieldGrid, seriesNote, roleNote,
} from './ui.js';

/* ============================================================
 * 公共片段
 * ============================================================ */

function topbar(state, dataset) {
  const now = state.now;
  const res = typeof state.getResolvedTheme === 'function' ? state.getResolvedTheme() : 'light';
  const themeModeLabel = state.themeModeLabel || '跟随系统';
  const deviceLabel = state.device === 'mobile' ? '电脑版' : '手机版';

  return h`<header class="topbar">
    <div class="topbar-inner">
      <div class="brand">
        <span class="brand-logo" aria-hidden="true">机</span>
        <span class="brand-text">
          <span class="brand-name">校园机会雷达</span>
          <span class="brand-sub">珠科 · 26 条信息已整理</span>
        </span>
      </div>

      <div class="topbar-spacer"></div>

      <div class="search-wrap">
        <span class="icon">${ICON.search}</span>
        <input class="search-input" type="search" id="search-input"
               placeholder="搜索活动、招募、地点…"
               value="${esc(state.filters.keyword || '')}" aria-label="搜索" />
      </div>

      <button class="icon-btn with-label" data-action="toggle-theme"
              title="主题：${esc(themeModeLabel)}（点击切换 跟随系统 → 浅色 → 深色）"
              aria-label="切换主题，当前${esc(themeModeLabel)}">
        ${ICON.theme}<span class="mode-label">${esc(themeModeLabel)}</span>
      </button>

      <button class="icon-btn" data-action="toggle-device"
              title="切换到${deviceLabel}" aria-label="切换到${deviceLabel}">
        ${ICON.device}
      </button>
    </div>
  </header>`;
}

function statsBar(s) {
  return h`<div class="stats">
    <span class="stat">共 <b>${s.total}</b> 条</span>
    <span class="stat is-closing">即将截止 <b>${s.closing}</b></span>
    <span class="stat is-standby">可候补 <b>${s.standby}</b></span>
    <span class="stat">可报名 <b>${s.open}</b></span>
    <span class="stat">长期有效 <b>${s.recurring}</b></span>
    ${s.suspect ? h`<span class="stat is-risk">建议核实 <b>${s.suspect}</b></span>` : ''}
  </div>`;
}

/** 快捷筛选 chips —— 手机端与桌面端共用（桌面端额外有侧栏筛选器） */
const QUICK_CHIPS = [
  { id: 'all', label: '全部' },
  { id: 'urgent', label: '即将截止' },
  { id: 'standby', label: '可候补' },
  { id: 'newbie', label: '零基础 / 新生' },
  { id: 'today', label: '今天' },
  { id: 'student', label: '学生自发' },
  { id: 'rolling', label: '长期有效' },
  { id: 'risk', label: '需核实' },
];

function chipRow(state, dataset) {
  const s = state.summarize(dataset);
  const counts = {
    all: s.total,
    urgent: s.closing,
    standby: s.standby,
    risk: s.suspect,
  };
  const chips = QUICK_CHIPS.map((c) => {
    const on = state.quick === c.id;
    const n = counts[c.id];
    return h`<button class="chip ${on ? 'is-active' : ''}" data-action="quick" data-id="${esc(c.id)}">
      ${esc(c.label)}${n !== undefined ? h` <span class="chip-n">${n}</span>` : ''}
    </button>`;
  }).join('');
  return h`<div class="chip-row">${chips}</div>`;
}

/** 单张卡片主体（列表点击后进入详情） */
function infoCard(item, state) {
  const fav = state.favorites.includes(item.id);
  const urgent = item.status === STATUS.CLOSING || item.status === STATUS.STANDBY;
  return h`<article class="card ${statusClass(item.status)}" data-id="${esc(item.id)}" data-action="open-detail">
    <div class="card-top">
      <div class="card-tags">
        ${sourceTag(item)}${kindTag(item)}${credibilityBadge(item)}
      </div>
      ${statusBadge(item)}
    </div>

    <h3 class="card-title">${esc(item.title)}</h3>

    <div class="card-meta">
      ${item.startText ? h`<span class="meta-item ${item.startCountdown && item.startCountdown.includes('还有') && urgent ? 'is-urgent' : ''}">
        <span class="icon">${ICON.clock}</span>${esc(item.startText)}${item.recurring ? h`<span class="fld-extra">${esc(item.recurring)}</span>` : ''}</span>` : ''}
      ${item.deadlineText ? h`<span class="meta-item ${urgent ? 'is-urgent' : ''}">
        <span class="icon">${ICON.clock}</span>截止 ${esc(item.deadlineText)}${item.deadlineCountdown ? h` · ${esc(item.deadlineCountdown)}` : ''}</span>` : ''}
      ${item.place ? h`<span class="meta-item"><span class="icon">${ICON.pin}</span>${esc(item.place)}</span>`
        : (item.placeStatus ? h`<span class="meta-item"><span class="icon">${ICON.pin}</span>${esc(item.placeStatus)}</span>` : '')}
      ${item.audience ? h`<span class="meta-item">${esc(item.audience)}</span>` : ''}
      ${item.weeklyHours ? h`<span class="meta-item">每周约 ${item.weeklyHours} 小时</span>` : ''}
    </div>

    ${seriesNote(item)}
    ${roleNote(item)}
    ${missingLine(item)}
    ${riskList(item, { compact: true })}

    <div class="card-foot">
      ${completenessMeter(item)}
      <span class="grow"></span>
      <button class="btn-fav ${fav ? 'is-on' : ''}" data-action="toggle-fav" data-id="${esc(item.id)}"
              aria-pressed="${fav}" title="${fav ? '取消收藏' : '收藏到我的日程'}">
        ${fav ? ICON.starFill : ICON.star}<span>${fav ? '已收藏' : '收藏'}</span>
      </button>
    </div>
  </article>`;
}

function emptyState(state, { filtered }) {
  return h`<div class="empty">
    <div class="empty-icon" aria-hidden="true">🔍</div>
    <div class="empty-title">${filtered ? '没有符合条件的信息' : '还没有收藏任何信息'}</div>
    <div class="empty-desc">${filtered ? '试着放宽筛选条件，或清空搜索关键词。' : '在信息流里点「收藏」，就会出现在这里，并按截止时间排序。'}</div>
    ${filtered ? h`<button class="btn" data-action="reset-filters">清空筛选条件</button>`
      : h`<button class="btn btn-primary" data-action="nav" data-route="feed">去发现机会</button>`}
  </div>`;
}

/* ============================================================
 * 手机端
 * ============================================================ */

export function renderMobile(state, dataset) {
  const s = state.summarize(dataset);
  let body = '';

  if (state.route === 'feed') {
    body = h`${chipRow(state, dataset)}
      ${dataset.length ? dataset.map((i) => infoCard(i, state)).join('')
        : emptyState(state, { filtered: true })}`;
  } else if (state.route === 'mine') {
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
  }

  return h`${topbar(state, dataset)}
    <div class="shell">
      <div class="main-col">
        ${state.route === 'feed' ? statsBar(s) : ''}
        ${body}
      </div>
    </div>
    <button class="fab" data-action="open-publish" title="发布活动或招募" aria-label="发布">${ICON.plus}</button>
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
        data-action="nav" data-route="${esc(it.route)}" aria-current="${state.route === it.route}">
      <span class="icon">${it.icon}</span>${esc(it.label)}
    </button>`).join('')}
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
  const view = state.route;

  const sidebar = h`<aside class="sidebar">
    ${navPanel(state, s)}
    ${view === 'feed' ? filterPanel(state) : ''}
  </aside>`;

  const aside = h`<aside class="aside">
    ${urgentPanel(state, dataset)}
    ${myPanel(state, dataset)}
    ${riskPanel(state, dataset)}
  </aside>`;

  let main = '';
  if (view === 'feed') {
    main = h`${statsBar(s)}${tablePanel(state, dataset)}`;
  } else if (view === 'mine') {
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
  } else {
    main = aboutPanel(state, dataset);
  }

  return h`${topbar(state, dataset)}
    <div class="shell">
      ${sidebar}
      <div class="main-col">${main}</div>
      ${aside}
    </div>`;
}

function navPanel(state, s) {
  const items = [
    { route: 'feed', label: '全部机会', icon: ICON.search, count: s.total, dot: '' },
    { route: 'mine', label: '我的日程', icon: ICON.star, count: state.favorites.length, dot: '' },
    { route: 'about', label: '产品说明', icon: ICON.warn, count: '', dot: '' },
  ];
  return h`<div class="panel">
    <div class="panel-title">导航</div>
    <div class="nav-list">
      ${items.map((it) => h`<button class="nav-link ${state.route === it.route ? 'is-active' : ''}"
          data-action="nav" data-route="${esc(it.route)}">
        ${it.icon}<span>${esc(it.label)}</span>${it.count !== '' ? h`<span class="count">${it.count}</span>` : ''}
      </button>`).join('')}
      <button class="nav-link" data-action="open-publish">${ICON.plus}<span>发布信息</span></button>
    </div>
  </div>`;
}

/** 桌面端筛选器：平铺展开，不用弹层（这是空间优势） */
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
                   value="${esc(o.value)}" ${on ? 'checked' : ''} />
            <span>${esc(o.label)}</span>
          </label>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');

  const activeCount = Object.entries(f)
    .filter(([k]) => k !== 'keyword')
    .reduce((n, [, v]) => n + (Array.isArray(v) ? v.length : 0), 0);

  return h`<div class="panel">
    <div class="panel-title">${ICON.filter} 筛选<span class="count">${activeCount ? activeCount + ' 项生效' : ''}</span></div>
    ${html}
    ${activeCount ? h`<button class="btn btn-sm btn-block" data-action="reset-filters" style="margin-top:12px">清空筛选</button>` : ''}
  </div>`;
}

/** 桌面端多列表格：一屏可见 12-15 条，这是"更全面的信息流"的核心 */
function tablePanel(state, dataset) {
  return h`<div class="table-wrap">
    ${table(state, dataset)}
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
    const sel = state.selected.includes(item.id);
    const urgent = item.status === STATUS.CLOSING || item.status === STATUS.STANDBY;
    const deadlineCell = item.deadlineText
      ? h`<div>${esc(item.deadlineText)}</div><div class="fld-extra">${esc(item.deadlineCountdown || '')}</div>`
      : '<span class="fld-none">未注明</span>';

    return h`<tr class="${fav ? 'is-fav' : ''}" data-id="${esc(item.id)}" data-action="open-detail">
      <td class="col-check" data-action="none">
        <input type="checkbox" data-action="select" data-id="${esc(item.id)}" ${sel ? 'checked' : ''}
               aria-label="选择以便对比" />
      </td>
      <td class="t-title">
        <span class="t-main">${esc(item.title)}</span>
        <span class="t-sub">
          ${kindTag(item)}${credibilityBadge(item)}
          ${item.supplements && item.supplements.length ? h`<span class="src">已更新</span>` : ''}
          ${item.isUserPost ? h`<span class="src student">我发布的</span>` : ''}
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
        <button class="btn btn-sm btn-fav ${fav ? 'is-on' : ''}" data-action="toggle-fav" data-id="${esc(item.id)}"
                title="${fav ? '取消收藏' : '收藏'}">${fav ? '★ 已收藏' : '☆ 收藏'}</button>
      </td>
    </tr>`;
  }).join('');

  const foot = h`<tfoot><tr><td colspan="${COLUMNS.length + 2}">
    当前显示 ${list.length} 条　·　点击「来源 / 状态 / 报名截止 / 活动时间 / 完整度」表头可排序
    ${state.selected.length ? h`　·　已勾选 ${state.selected.length} 条` : ''}
  </td></tr></tfoot>`;

  return h`<table class="dtable">
    <thead><tr><th class="col-check"></th>${head}<th></th></tr></thead>
    <tbody>${rows}</tbody>
    ${foot}
  </table>`;
}

/** 右栏：紧急提醒 */
function urgentPanel(state, dataset) {
  const urgent = dataset
    .filter((i) => i.status === STATUS.CLOSING || i.status === STATUS.STANDBY)
    .sort((a, b) => (a.status === STATUS.CLOSING ? -1 : 1) - (b.status === STATUS.CLOSING ? -1 : 1));
  return h`<div class="panel">
    <div class="panel-title">${ICON.clock} 紧急提醒<span class="count">${urgent.length} 项</span></div>
    ${urgent.length ? urgent.slice(0, 5).map((i) => h`
      <div style="padding:8px 0;border-bottom:1px solid var(--divider);cursor:pointer"
           data-action="open-detail" data-id="${esc(i.id)}">
        <div style="font-size:var(--fs-sm);font-weight:var(--fw-medium);margin-bottom:3px">${esc(i.title)}</div>
        ${statusBadge(i)}
      </div>`).join('')
      : h`<div class="empty-desc">暂无 48 小时内截止或可候补的信息。</div>`}
  </div>`;
}

/** 右栏：我的日程 */
function myPanel(state, dataset) {
  const favs = dataset.filter((i) => state.favorites.includes(i.id));
  return h`<div class="panel">
    <div class="panel-title">${ICON.star} 我的日程<span class="count">${favs.length} 条</span></div>
    ${favs.length ? favs.slice(0, 4).map((i) => h`
      <div style="padding:7px 0;border-bottom:1px solid var(--divider);cursor:pointer"
           data-action="open-detail" data-id="${esc(i.id)}">
        <div style="font-size:var(--fs-sm);margin-bottom:2px">${esc(i.title)}</div>
        <div class="fld-extra">${esc(i.deadlineCountdown || i.startCountdown || i.statusLabel)}</div>
      </div>`).join('')
      : h`<div class="empty-desc">还没有收藏。点表格右侧「☆ 收藏」加入日程。</div>`}
  </div>`;
}

/** 右栏：待核实信息 —— 这是本产品区别于普通信息流的地方 */
function riskPanel(state, dataset) {
  const risky = dataset.filter((i) => i.risks.length);
  const suspect = risky.filter((i) => i.credibility === 'suspect');
  return h`<div class="panel">
    <div class="panel-title">${ICON.warn} 信息质量提示<span class="count">${risky.length} 条</span></div>
    <div class="empty-desc" style="margin-bottom:8px">
      其中 <b style="color:var(--risk-danger)">${suspect.length}</b> 条存在明显异常信号。这些信息<b>仍会展示</b>（保证开放发布），
      但已标注问题，请自行核实后再决定。
    </div>
    ${suspect.map((i) => h`<div style="padding:7px 0;border-bottom:1px solid var(--divider);cursor:pointer"
        data-action="open-detail" data-id="${esc(i.id)}">
      <div style="font-size:var(--fs-sm);margin-bottom:3px">${esc(i.title)}</div>
      <div class="risk-list">${riskList(i, { compact: true })}</div>
    </div>`).join('')}
    <button class="btn btn-sm btn-block" data-action="quick" data-id="risk" style="margin-top:10px">
      只看需核实的信息
    </button>
  </div>`;
}

/* ============================================================
 * 产品说明（两端共用）
 * ============================================================ */

function aboutPanel(state, dataset) {
  const s = state.summarize(dataset);
  return h`<div class="panel">
    <div class="panel-title">这个产品解决什么问题</div>
    <p style="margin:0 0 14px;line-height:var(--lh-loose)">
      题目给出的 26 条校园信息，存在四类真实麻烦：<b>来源不同</b>（校级 / 院级 / 学生自发）、
      <b>字段残缺</b>（报名时间未注明、费用未提供、地点待定）、<b>状态特殊</b>
      （已结束但会传回放、已截止但可候补、长期招募无截止）、
      <b>质量参差</b>（个别内容夹杂推广，甚至要求加私人微信）。
      本产品不做"信息展示"，而是把这些信息整理成<b>能直接判断和行动</b>的决策面板。
    </p>

    <div class="panel-title">本产品的核心能力</div>
    <div class="field-grid" style="margin-bottom:14px">
      <div class="fld"><div class="fld-k">状态推导</div><div class="fld-v">不按"日期过了 = 没用"处理，自动区分「可候补」「待回放」「长期有效」</div></div>
      <div class="fld"><div class="fld-k">系列合并</div><div class="fld-v">01+09、03+20 自动合并，只显示生效后的时间地点，避免跑错</div></div>
      <div class="fld"><div class="fld-k">风险提示</div><div class="fld-v">识别"加私人微信""购买链接""标题与正文不符"等信号，给提示不下判决</div></div>
      <div class="fld"><div class="fld-k">完整度</div><div class="fld-v">量化每条信息的字段完整度，缺什么直接列出，不编造不掩盖</div></div>
    </div>

    <div class="panel-title">当前数据概览</div>
    <div class="stats" style="padding:0">
      <span class="stat">共 <b>${s.total}</b> 条</span>
      <span class="stat is-closing">即将截止 <b>${s.closing}</b></span>
      <span class="stat is-standby">可候补 <b>${s.standby}</b></span>
      <span class="stat is-risk">建议核实 <b>${s.suspect}</b></span>
      <span class="stat">含提示 <b>${s.needCheck}</b></span>
    </div>

    <div class="panel-title" style="margin-top:18px">双端与主题</div>
    <p style="margin:0;line-height:var(--lh-loose);color:var(--text-secondary);font-size:var(--fs-sm)">
      手机端采用卡片流 + 底部导航，适合碎片化浏览；
      电脑端采用侧栏 + 多列表格 + 右栏总览，一屏可见 10 条以上并支持排序，信息密度更高。
      两端共用同一套数据与判定逻辑，收藏与发布内容完全同步。
      主题默认跟随系统，可手动切换 跟随系统 / 浅色 / 深色。
    </p>
  </div>`;
}
