/**
 * logic.js —— 信息处理逻辑层（纯函数，不碰 DOM）
 *
 * 这一层是本产品的核心价值所在：把 26 条来源不同、字段残缺、彼此存在更新关系的信息，
 * 转换为用户可以直接判断和行动的状态与提示。
 *
 * 两端（手机 / 电脑）共用本层，因此"可候补""快截止"等判定在两种形态下完全一致。
 */

import {
  ITEMS, SOURCE, KIND, SOURCE_LABEL, KIND_LABEL, DEMO_ITEMS,
  BOARD, BOARDS, BOARD_MAP, BOARD_KINDS, PIN_LEVEL, PIN_LABEL,
} from './data.js';

/**
 * 是否启用演示数据。
 *
 * 当前阶段：正式数据（ITEMS）为空，用演示数据验证架构与界面。
 * 正式数据填入 ITEMS 后，把此开关改为 false 即可（或直接删除演示数据段）。
 */
export const USE_DEMO_DATA = true;

/* ============================================================
 * 常量：状态与阈值
 * ============================================================ */

export const STATUS = {
  OPEN: 'open',           // 可报名 / 可参与
  CLOSING: 'closing',     // 即将截止（48 小时内）
  CLOSED: 'closed',       // 已截止
  STANDBY: 'standby',     // 已截止，但可候补入场
  RECURRING: 'recurring', // 长期 / 满员即止
  UPCOMING: 'upcoming',   // 已开始（无需报名）
  ENDED: 'ended',         // 已结束
  REPLAY: 'replay',       // 已结束，但预计有回放
};

export const STATUS_LABEL = {
  [STATUS.OPEN]: '可报名',
  [STATUS.CLOSING]: '即将截止',
  [STATUS.CLOSED]: '已截止',
  [STATUS.STANDBY]: '可候补',
  [STATUS.RECURRING]: '长期有效',
  [STATUS.UPCOMING]: '进行中',
  [STATUS.ENDED]: '已结束',
  [STATUS.REPLAY]: '待回放',
};

/** 状态优先级：数字越小越该被看到 */
const STATUS_RANK = {
  [STATUS.CLOSING]: 0,
  [STATUS.STANDBY]: 1,
  [STATUS.OPEN]: 2,
  [STATUS.RECURRING]: 3,
  [STATUS.REPLAY]: 4,
  [STATUS.UPCOMING]: 5,
  [STATUS.CLOSED]: 6,
  [STATUS.ENDED]: 7,
};

export const CLOSING_WINDOW_HOURS = 48;
export const HOUR = 3600 * 1000;
export const DAY = 24 * HOUR;

/* ============================================================
 * 时间工具
 * ============================================================ */

/** 解析本地时间字符串（'2026-09-19T19:00'）。null 安全。 */
export function parseTime(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 两个时间点相差的小时数（正数表示 target 在未来） */
export function hoursUntil(target, now) {
  const t = parseTime(target);
  if (!t) return null;
  return (t.getTime() - now.getTime()) / HOUR;
}

/**
 * 人类可读的倒计时。例：'还有 3 天 4 小时'、'还有 50 分钟'、'已过 2 天'
 * 刻意不使用绝对日期，减少用户自己做减法的心智负担。
 */
export function humanizeDelta(target, now) {
  const h = hoursUntil(target, now);
  if (h === null) return null;
  const abs = Math.abs(h);
  const past = h < 0;
  let text;
  if (abs < 1) text = `${Math.max(1, Math.round(abs * 60))} 分钟`;
  else if (abs < 24) text = `${Math.floor(abs)} 小时`;
  else {
    const d = Math.floor(abs / 24);
    const restH = Math.floor(abs % 24);
    text = restH > 0 ? `${d} 天 ${restH} 小时` : `${d} 天`;
  }
  return past ? `已过 ${text}` : `还有 ${text}`;
}

/** 格式化为「9月19日 19:00」这种中文可读形式 */
export function formatTime(s, { withTime = true } = {}) {
  const d = parseTime(s);
  if (!d) return null;
  const base = `${d.getMonth() + 1}月${d.getDate()}日`;
  if (!withTime) return base;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${base} ${hh}:${mm}`;
}

/* ============================================================
 * 状态推导 —— 本产品的关键能力之一
 *
 * 题目里多条信息不能简单按"日期过了 = 没用"处理：
 *   04 直播结束但明确会传回放
 *   19 报名截止但明确现场可候补
 *   06/08/16/17 长期有效或满员即止，根本没有截止时间
 * ============================================================ */

export function deriveStatus(item, now) {
  const deadline = parseTime(item.deadline);
  const startAt = parseTime(item.startAt);
  const endAt = parseTime(item.endAt);

  // 1) 已结束 / 待回放的判断优先：活动本身过去了，再看回放
  const effectiveEnd = endAt || startAt;
  if (effectiveEnd && effectiveEnd.getTime() < now.getTime()) {
    if (item.replayExpectedAt) {
      const replayAt = parseTime(item.replayExpectedAt);
      if (replayAt && replayAt.getTime() > now.getTime()) return STATUS.REPLAY;
    }
    // 明确说明可候补入场的，即便报名截止也仍可参与
    if (item.allowStandby) return STATUS.STANDBY;
    return STATUS.ENDED;
  }

  // 2) 报名截止已过
  if (deadline && deadline.getTime() < now.getTime()) {
    if (item.allowStandby) return STATUS.STANDBY;   // 19：报名截止但现场可候补
    if (item.rolling) return STATUS.RECURRING;      // 长期招募，截止时间不适用
    return STATUS.CLOSED;
  }

  // 3) 截止时间临近
  if (deadline) {
    const h = hoursUntil(item.deadline, now);
    if (h !== null && h <= CLOSING_WINDOW_HOURS) return STATUS.CLOSING;
    return STATUS.OPEN;
  }

  // 4) 没有截止时间
  if (item.rolling) return STATUS.RECURRING;        // 长期 / 满员即止
  if (startAt && startAt.getTime() > now.getTime()) return STATUS.OPEN; // 有未来活动时间，视为可参与
  if (startAt) return STATUS.UPCOMING;
  return STATUS.OPEN;
}

export function statusRank(status) {
  return STATUS_RANK[status] ?? 99;
}

/* ============================================================
 * 字段完整度 —— 用可量化的方式帮用户判断"这条信息靠不靠谱"
 *
 * 权重经过取舍：能不能行动（截止时间）比细节（费用）重要得多。
 * 只统计题目中确实会出现的字段，且未提供时不给分 —— 不猜、不补。
 * ============================================================ */

const COMPLETENESS_FIELDS = [
  { key: 'startAt', weight: 25, label: '活动时间' },
  { key: 'deadline', weight: 25, label: '报名截止' },
  { key: 'place', weight: 20, label: '地点' },
  { key: 'audience', weight: 15, label: '面向对象' },
  { key: 'capacity', weight: 8, label: '人数限制' },
  { key: 'cost', weight: 7, label: '费用' },
];

export function completeness(item) {
  let score = 0;
  const missing = [];
  for (const f of COMPLETENESS_FIELDS) {
    const v = item[f.key];
    // 组局类没有"报名截止"概念，有活动时间即视为该项满足，避免不公平扣分
    const satisfied = v !== null && v !== undefined && v !== '';
    if (satisfied) score += f.weight;
    else missing.push(f.label);
  }
  // 长期招募 / 组局 / 资料类：报名截止天然不存在，按"不适用"处理，不扣分也不加分
  const noDeadlineByNature = [KIND.MEETUP, KIND.RESOURCE].includes(item.kind) || item.rolling;
  if (noDeadlineByNature && !item.deadline) {
    const idx = missing.indexOf('报名截止');
    if (idx >= 0) {
      missing.splice(idx, 1);
      score += 25;
    }
  }
  return { score: Math.min(100, score), missing };
}

/* ============================================================
 * 风险规则引擎 —— 本产品的核心创新点
 *
 * 原则：只输出【客观事实提示】，不替用户下"真假"结论。
 *       目标是降低用户的判断成本，而不是代行判断。
 * ============================================================ */

export const RISK_LEVEL = { INFO: 'info', WARN: 'warn', DANGER: 'danger' };

export function detectRisks(item) {
  const flags = [];

  // R1 要求跳转到平台外的私人联系方式
  if (item.requiresPrivateContact) {
    flags.push({
      level: RISK_LEVEL.DANGER,
      code: 'OFF_PLATFORM',
      title: '要求添加私人微信',
      detail: '需通过平台外的私人联系方式获取详情，一旦离开平台将无法追溯，请谨慎核实。',
    });
  }

  // R2 含推广 / 购买链接
  if (item.hasPromoLink) {
    flags.push({
      level: RISK_LEVEL.DANGER,
      code: 'PROMO',
      title: '含商家推广或购买链接',
      detail: '内容指向商家优惠与购买链接，与校园活动的关联性较弱。',
    });
  }

  // R3 标题与正文主题不符
  if (item.titleBodyMismatch) {
    flags.push({
      level: RISK_LEVEL.WARN,
      code: 'MISMATCH',
      title: '标题与正文内容不一致',
      detail: '标题为技术交流，正文主要内容为商家优惠，实际内容与标题不符。',
    });
  }

  // R4 关键信息缺失（对线下活动而言，地点缺失会直接影响能否到场）
  if (!item.place && [KIND.ACTIVITY, KIND.MEETUP, KIND.PROGRAM].includes(item.kind)) {
    flags.push({
      level: RISK_LEVEL.WARN,
      code: 'NO_PLACE',
      title: '未提供地点',
      detail: item.placeStatus
        ? `地点状态：${item.placeStatus}。建议出发前向发布者确认。`
        : '题目信息中未提供活动地点，参加前需自行确认。',
    });
  }

  // R5 无明确主办方（权威性无法判断）
  if (!item.org || item.org === '学生个人发布') {
    flags.push({
      level: RISK_LEVEL.INFO,
      code: 'NO_ORG',
      title: '学生个人发布，无机构背书',
      detail: '该信息由学生个人发布，未经学校或学院审核。',
    });
  }

  // R6 报名时间未注明（无法判断何时必须行动）
  if (!item.deadline && !item.rolling && ![KIND.MEETUP, KIND.RESOURCE].includes(item.kind)) {
    flags.push({
      level: RISK_LEVEL.WARN,
      code: 'NO_DEADLINE',
      title: '报名截止时间未注明',
      detail: '题目信息未提供报名截止时间，无法判断最晚何时行动。',
    });
  }

  // R7 费用未提供（涉及支出，属于对用户负责的提示）
  if (item.cost === null && item.kind === KIND.CONTEST) {
    flags.push({
      level: RISK_LEVEL.WARN,
      code: 'NO_COST',
      title: '费用信息未提供',
      detail: '题目信息未说明参赛费用，报名前建议确认。',
    });
  }

  // R8 资源链接有效期临近
  if (item.linkExpiresAt) {
    flags.push({
      level: RISK_LEVEL.WARN,
      code: 'LINK_EXPIRING',
      title: '提取信息有有效期',
      detail: `当前网盘提取信息有效至 ${formatTime(item.linkExpiresAt, { withTime: false })}，过期后需等待统一更新。`,
    });
  }

  return flags;
}

/**
 * 可信度分级 —— 用于列表页一眼分辨，不进入详情也能判断
 *   official 机构发布，字段完整
 *   verified 学生发布，字段较完整
 *   caution  存在需注意的缺失或信号
 *   suspect  存在明显异常信号（仍会展示，但强提示）
 */
export function credibility(item, risks) {
  const hasDanger = risks.some((r) => r.level === RISK_LEVEL.DANGER);
  if (hasDanger) return 'suspect';
  if (item.source === SOURCE.STUDENT) {
    const { score } = completeness(item);
    return score >= 60 ? 'verified' : 'caution';
  }
  // 机构发布但关键字段缺失，也应提示
  const { score } = completeness(item);
  return score >= 60 ? 'official' : 'caution';
}

export const CREDIBILITY_LABEL = {
  official: '机构发布',
  verified: '学生发布',
  caution: '信息待补',
  suspect: '建议核实',
};

/* ============================================================
 * 系列合并 —— 解决"两条信息讲同一件事"的致命问题
 *
 * 01「原计划 9/20 每周六」 + 09「首次训练改为 9/21，地点改至实验楼 A402」
 * 用户只看到 01 就会跑错时间、跑错地点。
 * ============================================================ */

/**
 * 构建展示列表：把补充通知合并进主条目
 * 返回的每条都带有：
 *   supplements  指向它的补充通知（原始条目，供详情页展示"变更了什么"）
 *   isSupplement 该条本身是否为补充通知（列表页可弱化或直接隐藏）
 */
/**
 * 构建展示列表
 *
 * 重要：本函数必须保持"不修改入参"的纯函数语义。
 * 早期版本在合并补充通知时直接改了原始条目对象，导致：
 *   ① 多次渲染后数据被反复覆盖
 *   ② 原始数据被污染，难以排查
 * 因此这里统一使用浅拷贝（{ ...item }）产出新对象。
 */
export function buildViewList(items) {
  const list = items.map((i) => ({ ...i }));
  return list.map((item) => {
    const supplements = list.filter((o) => o.supplementOf === item.id);
    let effective = item;
    if (supplements.length) {
      // 被补充通知覆盖的字段，以补充通知为准
      const patch = {};
      for (const s of supplements) {
        if (s.startAt) patch.startAt = s.startAt;
        if (s.place) patch.place = s.place;
        if (s.deadline) patch.deadline = s.deadline;
        if (s.notes) patch.notes = s.notes;
      }
      effective = { ...item, ...patch, supplementedBy: supplements.map((s) => s.id) };
    }
    return { ...effective, supplements, isSupplement: !!item.isSupplement };
  });
}

/** 列表页默认隐藏"纯补充通知"（其内容已并入主条目），避免同一件事出现两次 */
export function visibleItems(viewList) {
  return viewList.filter((i) => !i.isSupplement);
}

/* ============================================================
 * 排序与筛选
 * ============================================================ */

/** 智能排序：越紧急、越该行动的越靠前；同状态内按截止时间升序 */
export function smartSort(list, now) {
  return [...list].sort((a, b) => {
    const ra = statusRank(a.status);
    const rb = statusRank(b.status);
    if (ra !== rb) return ra - rb;
    const da = parseTime(a.deadline)?.getTime() ?? parseTime(a.startAt)?.getTime() ?? Infinity;
    const db = parseTime(b.deadline)?.getTime() ?? parseTime(b.startAt)?.getTime() ?? Infinity;
    return da - db;
  });
}

export const FILTER_GROUPS = {
  source: {
    label: '来源',
    options: [
      { value: SOURCE.SCHOOL, label: '校级发布' },
      { value: SOURCE.COLLEGE, label: '院级发布' },
      { value: SOURCE.STUDENT, label: '学生自发' },
    ],
  },
  kind: {
    label: '类型',
    options: Object.entries(KIND_LABEL).map(([v, l]) => ({ value: v, label: l })),
  },
  audience: {
    label: '适合谁',
    options: [
      { value: 'newbie', label: '零基础 / 新生友好' },
      { value: 'all', label: '全校可参加' },
      { value: 'senior', label: '高年级专属' },
      { value: 'team', label: '需要组队' },
    ],
  },
  time: {
    label: '时间',
    options: [
      { value: 'today', label: '今天' },
      { value: 'week', label: '7 天内' },
      { value: 'later', label: '更晚' },
      { value: 'rolling', label: '长期有效' },
    ],
  },
};

const NEWBIE_HINT = /零基础|新生|不限基础|无需|全校/;
const SENIOR_HINT = /大二|大三|大四|高年级/;
const TEAM_HINT = /组队|团队|2—4人|成员/;

export function matchesFilters(item, filters, now) {
  const { source = [], kind = [], audience = [], time = [], keyword = '' } = filters || {};

  if (source.length && !source.includes(item.source)) return false;
  if (kind.length && !kind.includes(item.kind)) return false;

  if (audience.length) {
    const text = `${item.audience || ''} ${item.notes || ''} ${item.title}`;
    const ok = audience.some((a) => {
      if (a === 'newbie') return NEWBIE_HINT.test(text);
      if (a === 'all') return /全校/.test(text);
      if (a === 'senior') return SENIOR_HINT.test(text);
      if (a === 'team') return TEAM_HINT.test(text);
      return true;
    });
    if (!ok) return false;
  }

  if (time.length) {
    const anchor = parseTime(item.startAt) || parseTime(item.deadline) || parseTime(item.linkExpiresAt);
    const ok = time.some((t) => {
      if (t === 'rolling') return item.rolling === true || item.kind === KIND.RESOURCE;
      if (!anchor) return false;
      const h = (anchor.getTime() - now.getTime()) / HOUR;
      if (t === 'today') return h >= 0 && h <= 24;
      if (t === 'week') return h >= 0 && h <= 24 * 7;
      if (t === 'later') return h > 24 * 7;
      return false;
    });
    if (!ok) return false;
  }

  if (keyword) {
    const k = keyword.trim().toLowerCase();
    const hay = `${item.title} ${item.raw} ${item.org || ''} ${item.place || ''} ${item.audience || ''} ${item.notes || ''}`.toLowerCase();
    if (!hay.includes(k)) return false;
  }

  return true;
}

/* ============================================================
 * 板块归属 —— 把官方信息独立出来
 *
 * 判定顺序：
 *   1. 条目可用 boards 字段手动指定（一条信息可同时属于多个板块，
 *      例如"校级发布的竞赛"同时进入【官方发布】与【竞赛训练营】）
 *   2. 未指定时按规则自动归板：
 *      · source 为校级 / 院级  → 官方发布
 *      · 其余按 kind 归入对应板块
 * ============================================================ */

export function boardsOf(item) {
  const set = new Set();
  if (Array.isArray(item.boards) && item.boards.length) {
    item.boards.forEach((b) => set.add(b));
  } else {
    if (item.source === SOURCE.SCHOOL || item.source === SOURCE.COLLEGE) set.add(BOARD.OFFICIAL);
    for (const [boardId, kinds] of Object.entries(BOARD_KINDS)) {
      if (!kinds) continue;
      if (kinds.includes(item.kind)) set.add(boardId);
    }
    if (item.source === SOURCE.STUDENT && item.kind === KIND.MEETUP) set.add(BOARD.STUDENT);
  }
  // 官方板块始终额外成立（保证"官方信息独立成板"这一要求不被手动 boards 破坏）
  if (item.source === SOURCE.SCHOOL || item.source === SOURCE.COLLEGE) set.add(BOARD.OFFICIAL);
  return [...set];
}

/** 是否为官方来源（校级 / 院级），界面上用于强区分 */
export function isOfficial(item) {
  return item.source === SOURCE.SCHOOL || item.source === SOURCE.COLLEGE;
}

export function itemsOfBoard(list, boardId) {
  if (boardId === BOARD.ALL) return list;
  if (boardId === BOARD.TIMELINE) return list;
  return list.filter((i) => (i.boardIds || boardsOf(i)).includes(boardId));
}

/* ============================================================
 * 置顶
 *
 * 置顶必须有理由（pin.reason 必填），且支持 until 到期自动失效。
 * 这样置顶是"防止用户做错事"的功能，而不是运营位。
 * ============================================================ */

export function isPinActive(item, now) {
  const pin = item.pin;
  if (!pin) return false;
  if (pin.until) {
    const until = parseTime(pin.until);
    if (until && until.getTime() < now.getTime()) return false;
  }
  return true;
}

/** 取出某一层级的置顶条目 */
export function pinsOf(list, level, now) {
  return list.filter((i) => isPinActive(i, now) && i.pin && (!level || i.pin.level === level));
}

/** 主区域置顶（featured + notice），按级别排序 */
export function featuredPins(list, now) {
  const order = { [PIN_LEVEL.FEATURED]: 0, [PIN_LEVEL.NOTICE]: 1, [PIN_LEVEL.BOARD]: 2 };
  return list
    .filter((i) => isPinActive(i, now) && i.pin)
    .sort((a, b) => (order[a.pin.level] ?? 9) - (order[b.pin.level] ?? 9));
}

/** 某板块内的置顶条目 */
export function boardPins(list, boardId, now) {
  return itemsOfBoard(list, boardId).filter((i) => isPinActive(i, now) && i.pin);
}

/* ============================================================
 * 时间线
 *
 * 与主列表（按紧迫度排序）不同，时间线按"事情什么时候发生"排列，
 * 用于回答"这周/今天有哪些事"这类问题。
 * ============================================================ */

function dateKeyOf(item) {
  const t = parseTime(item.startAt) || parseTime(item.deadline) || parseTime(item.linkExpiresAt);
  if (!t) return 'unscheduled';
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

function dateLabelOf(key, now) {
  if (key === 'unscheduled') return '时间未定';
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (key === todayKey) return '今天';
  const [y, m, d] = key.split('-').map(Number);
  const that = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((that.getTime() - today.getTime()) / (24 * HOUR));
  if (diffDays === 1) return '明天';
  if (diffDays === 2) return '后天';
  if (diffDays < 0) return `${m}月${d}日（已过）`;
  return `${m}月${d}日`;
}

/** 按日期分组，返回 [{ key, label, past, items }] */
export function buildTimeline(list, now) {
  const groups = new Map();
  for (const item of list) {
    const key = dateKeyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const rows = [...groups.entries()].map(([key, items]) => {
    let past = false;
    if (key !== 'unscheduled') {
      const [y, m, d] = key.split('-').map(Number);
      past = new Date(y, m - 1, d + 1).getTime() <= now.getTime();
    }
    return {
      key,
      label: dateLabelOf(key, now),
      past,
      items: items.sort((a, b) => {
        const ta = parseTime(a.startAt)?.getTime() ?? Infinity;
        const tb = parseTime(b.startAt)?.getTime() ?? Infinity;
        return ta - tb;
      }),
    };
  });
  // 时间未定放最后；其余按日期先后
  rows.sort((a, b) => {
    if (a.key === 'unscheduled') return 1;
    if (b.key === 'unscheduled') return -1;
    return a.key < b.key ? -1 : 1;
  });
  return rows;
}

/* ============================================================
 * 标签
 * ============================================================ */

/** 统计列表中出现过的标签及数量，用于标签筛选入口 */
export function tagCloud(list) {
  const map = new Map();
  for (const item of list) {
    for (const t of item.tags || []) map.set(t, (map.get(t) || 0) + 1);
  }
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh'));
}


export function summarize(list) {
  const s = {
    total: list.length, closing: 0, standby: 0, open: 0, recurring: 0,
    suspect: 0, needCheck: 0, official: 0, student: 0, pinned: 0,
  };
  for (const i of list) {
    if (i.status === STATUS.CLOSING) s.closing++;
    else if (i.status === STATUS.STANDBY) s.standby++;
    else if (i.status === STATUS.OPEN) s.open++;
    else if (i.status === STATUS.RECURRING) s.recurring++;
    if (i.credibility === 'suspect') s.suspect++;
    if (i.risks && i.risks.length) s.needCheck++;
    if (i.source === SOURCE.SCHOOL || i.source === SOURCE.COLLEGE) s.official++;
    else s.student++;
    if (i.pinActive) s.pinned++;
  }
  return s;
}

/* ============================================================
 * 统一加工入口：给原始条目补齐所有派生字段
 * 两端 UI 只消费本函数的结果，保证判定完全一致
 * ============================================================ */

export function decorate(item, now) {
  const status = deriveStatus(item, now);
  const risks = detectRisks(item);
  const { score, missing } = completeness(item);
  const cred = credibility(item, risks);
  const boardIds = boardsOf(item);
  const pinActive = isPinActive(item, now);
  return {
    ...item,
    status,
    statusLabel: STATUS_LABEL[status],
    risks,
    completeness: score,
    missingFields: missing,
    credibility: cred,
    credibilityLabel: CREDIBILITY_LABEL[cred],
    deadlineCountdown: humanizeDelta(item.deadline, now),
    startCountdown: humanizeDelta(item.startAt, now),
    deadlineText: formatTime(item.deadline),
    startText: formatTime(item.startAt),
    linkExpiresCountdown: humanizeDelta(item.linkExpiresAt, now),
    // 板块与置顶
    boardIds,
    boards: boardIds.map((id) => BOARD_MAP[id]).filter(Boolean),
    isOfficial: isOfficial(item),
    pinActive,
    pinLevel: pinActive && item.pin ? item.pin.level : null,
    pinLabel: pinActive && item.pin ? PIN_LABEL[item.pin.level] : null,
    pinReason: pinActive && item.pin ? item.pin.reason : null,
    // 标签
    tags: item.tags || [],
  };
}

/** 全量数据 → 加工后的展示列表 */
export function buildDataset(now, extraItems = []) {
  const base = USE_DEMO_DATA ? [...ITEMS, ...DEMO_ITEMS] : ITEMS;
  const all = [...base, ...extraItems];
  const view = buildViewList(all);
  return view.map((i) => decorate(i, now));
}

export { SOURCE, KIND, SOURCE_LABEL, KIND_LABEL };

/* 第四步：把板块 / 置顶相关的常量一并转发给视图层，
   使视图层只需 import 本模块，无需直接依赖 data.js（降低耦合） */
export { BOARD, BOARDS, BOARD_MAP, BOARD_KINDS, PIN_LEVEL, PIN_LABEL };
