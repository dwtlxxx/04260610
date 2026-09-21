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
  AI_ENTRIES, AI_KIND, USE_AI_MODULE, AI_DISCLAIMER, AI_DISCLAIMER_LONG,
} from './data.js';
import { CHAR_PINYIN, CHAR_INITIAL } from './pinyin.js';
import { termsIn } from './lexicon.js';

/**
 * 是否启用演示数据。
 *
 * 当前阶段：已恢复题目提供的 26 条数据，演示数据关闭。
 * 若需回到"仅演示数据"的架构验证状态，把此开关改回 true 即可。
 */
export const USE_DEMO_DATA = false;

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
 * 关键设计（两层分离）：
 *   fact   —— 客观事实陈述，**只陈述"原文写了什么 / 原文没写什么"**，
 *             不含任何建议、劝告、判断。用于详情页顶部，忠实呈现原文。
 *   detail —— 解读与建议（"建议出发前确认""请谨慎核实"…）。
 *             这类内容属于**分析产物**，因此只在 AI 模块中出现。
 *
 * 为什么必须分开：详情页顶部应当忠实显示原文；
 * 一旦混入"建议…""请谨慎…"，用户就分不清哪句来自原文、哪句是产品推断。
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
      fact: '原文要求通过私人微信获取详情，未提供其他联系方式。',
      detail: '需通过平台外的私人联系方式获取详情，一旦离开平台将无法追溯。',
    });
  }

  // R2 含推广 / 购买链接
  if (item.hasPromoLink) {
    flags.push({
      level: RISK_LEVEL.DANGER,
      code: 'PROMO',
      title: '含商家推广或购买链接',
      fact: '原文正文包含商家优惠介绍与购买链接。',
      detail: '内容指向商家优惠与购买链接，与校园活动的关联性较弱。',
    });
  }

  // R3 标题与正文主题不符
  if (item.titleBodyMismatch) {
    flags.push({
      level: RISK_LEVEL.WARN,
      code: 'MISMATCH',
      title: '标题与正文内容不一致',
      fact: '标题为技术交流，正文主要内容为商家优惠。',
      detail: '标题所写主题与正文主要内容不一致，实际内容与标题不符。',
    });
  }

  // R4 关键信息缺失（线下活动缺地点会直接影响能否到场）
  if (!item.place && [KIND.ACTIVITY, KIND.MEETUP, KIND.PROGRAM].includes(item.kind)) {
    flags.push({
      level: RISK_LEVEL.WARN,
      code: 'NO_PLACE',
      title: '未提供地点',
      fact: item.placeStatus
        ? `原文未给出具体地点，仅说明地点状态为「${item.placeStatus}」。`
        : '原文未提供活动地点。',
      detail: item.placeStatus
        ? `地点尚未确定（${item.placeStatus}），建议出发前向发布者确认。`
        : '题目信息中未提供活动地点，参加前需自行确认。',
    });
  }

  // R5 无明确主办方（权威性无法判断）
  if (!item.org || item.org === '学生个人发布') {
    flags.push({
      level: RISK_LEVEL.INFO,
      code: 'NO_ORG',
      title: '学生个人发布，无机构背书',
      fact: '原文标注发布方为「学生个人发布」，未提及学校或学院。',
      detail: '该信息由学生个人发布，未经学校或学院审核。',
    });
  }

  // R6 报名时间未注明（无法判断何时必须行动）
  if (!item.deadline && !item.rolling && ![KIND.MEETUP, KIND.RESOURCE].includes(item.kind)) {
    flags.push({
      level: RISK_LEVEL.WARN,
      code: 'NO_DEADLINE',
      title: '报名截止时间未注明',
      fact: '原文未给出报名截止时间。',
      detail: '题目信息未提供报名截止时间，无法判断最晚何时行动。',
    });
  }

  // R7 费用未提供（涉及支出）
  if (item.cost === null && item.kind === KIND.CONTEST) {
    flags.push({
      level: RISK_LEVEL.WARN,
      code: 'NO_COST',
      title: '费用信息未提供',
      fact: '原文未说明参赛费用。',
      detail: '题目信息未说明参赛费用，报名前建议确认。',
    });
  }

  // R8 资源链接有效期临近
  if (item.linkExpiresAt) {
    flags.push({
      level: RISK_LEVEL.WARN,
      code: 'LINK_EXPIRING',
      title: '提取信息有有效期',
      fact: `原文说明网盘提取信息有效至 ${formatTime(item.linkExpiresAt, { withTime: false })}。`,
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
    // ⚠ id 比较必须做字符串归一化：
    //   题目数据的 id 是数字（1,2,3…），而用户发布内容的 id 是字符串（u…），
    //   `o.supplementOf === item.id` 在两侧类型不一致时会静默失配。
    //   本文件其他 id 比较（relationsOf 等）已统一用 String()，此处保持一致。
    const supplements = list.filter(
      (o) => o.supplementOf != null && String(o.supplementOf) === String(item.id),
    );
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

  // 关键词过滤：使用模糊匹配而非简单子串。
  // 注意先 trim —— 只有空白的输入应视为"未输入"，不能把所有条目都过滤掉，
  // 否则用户误敲一个空格就会看到空列表。
  if (keyword && String(keyword).trim()) {
    if (itemFuzzyScore(item, keyword) <= 0) return false;
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

/**
 * 主区域置顶：只包含「全站置顶(featured)」与「更新提醒(notice)」。
 *
 * 注意：板块置顶(board) 不属于主区域——它只在对应板块内显示。
 * 早期版本未做过滤，导致板块置顶的信息错误地出现在主区域置顶栏。
 */
export function featuredPins(list, now) {
  const order = { [PIN_LEVEL.FEATURED]: 0, [PIN_LEVEL.NOTICE]: 1 };
  return list
    .filter((i) => isPinActive(i, now) && i.pin
      && (i.pin.level === PIN_LEVEL.FEATURED || i.pin.level === PIN_LEVEL.NOTICE))
    .sort((a, b) => (order[a.pin.level] ?? 9) - (order[b.pin.level] ?? 9));
}

/**
 * 某板块的置顶条目。
 *
 * 只返回「板块置顶(board)」层级：全站置顶(featured) 与 更新提醒(notice)
 * 已经在主区域置顶栏展示过，若再进入板块置顶区会造成同一条信息重复出现。
 */
export function boardPins(list, boardId, now) {
  return itemsOfBoard(list, boardId).filter((i) => isPinActive(i, now)
    && i.pin
    && i.pin.level === PIN_LEVEL.BOARD);
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
 * 帖子关联系统
 *
 * 题目材料里的关联关系有两类，此前的处理方式是"合并后隐藏补充通知"，
 * 但那样用户看不到"同一件事还有哪些通知"，也无法追溯。
 * 本模块把它们变成帖子顶部可点击的关联面板。
 *
 * 关系类型：
 *   supplement  本条是对方的补充通知（"本条是对 #N 的补充说明"）
 *   supersedes  对方是本条的补充通知（"本条已被 #N 补充/更新"）
 *   cross       双向：对方也有指向本条的关联（互相引用）
 *   series      同属一个活动系列（如同一训练营的多条通知）
 *   manual      数据中通过 relatedIds 手动指定的关联
 *   repost      同一内容被重新发布（标题与来源相同，内容已变更）
 * ============================================================ */

export const RELATION = {
  SUPPLEMENT: 'supplement',
  SUPERSEDES: 'supersedes',
  CROSS: 'cross',
  SERIES: 'series',
  MANUAL: 'manual',
  REPOST: 'repost',
};

export const RELATION_LABEL = {
  [RELATION.SUPPLEMENT]: '本条是对它的补充',
  [RELATION.SUPERSEDES]: '本条已被它更新',
  [RELATION.CROSS]: '互相引用',
  [RELATION.SERIES]: '同一活动系列',
  [RELATION.MANUAL]: '相关内容',
  [RELATION.REPOST]: '同一内容的再次发布',
};

/** 该条信息在数据中是否存在关联 */
export function hasRelations(item) {
  return !!(item.seriesId || item.supplementOf || item.relatedIds?.length
    || item.repostOf || item.isSupplement);
}

/**
 * 规范化标题：用于识别"同一件事的重发"。
 * 需处理三类修饰，否则会漏判：
 *   ① 空白与各类括号（中英混用）
 *   ② 结尾的"补充通知 / 更新 / 最新"等词
 *   ③ 括号内的时效性备注，如"（首次训练时间地点已变更）""（最新）"
 */
function normalizeTitle(t) {
  return String(t || '')
    // 去掉成对括号及其内容（用于剔除"（最新）"这类备注）
    .replace(/[（(【\[「『][^）)】\]」』]*[）)】\]」』]/g, '')
    .replace(/[\s【】\[\]（）()「」""'']/g, '')
    .replace(/(补充通知|补充说明|补充|通知|说明|更新|最新|修订版?)/g, '')
    .trim();
}

/** 判断两条信息是否为"同一内容的再次发布"（标题等价但内容不同） */
function isRepostOf(a, b) {
  if (String(a.id) === String(b.id)) return false;
  const ta = normalizeTitle(a.title);
  const tb = normalizeTitle(b.title);
  if (!ta || ta !== tb) return false;
  // 标题相同但正文不同 → 视为重发；正文也相同则交给 series 处理
  return (a.raw || '') !== (b.raw || '');
}

/**
 * 计算与某条信息相关的所有帖子。
 * 返回 [{ item, relation, direction }]，已去重、已排序。
 */
export function relationsOf(item, allItems) {
  const out = new Map();   // id -> { item, relation }
  const add = (other, relation) => {
    if (!other || String(other.id) === String(item.id)) return;
    const k = String(other.id);
    // 优先级：supplement/supersedes > cross > series > manual > repost
    const rank = {
      [RELATION.SUPERSEDES]: 0, [RELATION.SUPPLEMENT]: 0,
      [RELATION.CROSS]: 1, [RELATION.SERIES]: 2,
      [RELATION.MANUAL]: 3, [RELATION.REPOST]: 4,
    };
    const prev = out.get(k);
    if (!prev || rank[relation] < rank[prev.relation]) out.set(k, { item: other, relation });
  };

  const byId = new Map(allItems.map((i) => [String(i.id), i]));

  // ① 本条是对方的补充通知
  if (item.supplementOf != null) {
    const main = byId.get(String(item.supplementOf));
    if (main) add(main, RELATION.SUPPLEMENT);
  }

  // ② 对方是本条被更新后的主条目（本条被补充通知更新）
  if (item.supersededBy != null) {
    const sup = byId.get(String(item.supersededBy));
    if (sup) add(sup, RELATION.SUPERSEDES);
  }
  // 也支持"本条被某条补充"但数据只写在对方身上
  for (const other of allItems) {
    if (other.supplementOf != null && String(other.supplementOf) === String(item.id)) {
      add(other, RELATION.SUPERSEDES);
    }
  }

  // ③ 同系列
  if (item.seriesId) {
    for (const other of allItems) {
      if (other.seriesId === item.seriesId) add(other, RELATION.SERIES);
    }
  }

  // ④ 手动指定
  if (Array.isArray(item.relatedIds)) {
    for (const id of item.relatedIds) {
      const other = byId.get(String(id));
      if (other) add(other, RELATION.MANUAL);
    }
  }

  // ⑤ 同一内容的再次发布（标题归一化后相同、正文不同）
  for (const other of allItems) {
    if (isRepostOf(item, other)) add(other, RELATION.REPOST);
  }

  // ⑥ 互相引用 → 升级为 cross
  for (const [k, v] of out) {
    const other = v.item;
    const backRefs = (other.supplementOf != null && String(other.supplementOf) === String(item.id))
      || (item.supplementOf != null && String(item.supplementOf) === String(other.id))
      || (other.seriesId && other.seriesId === item.seriesId);
    if (backRefs && v.relation === RELATION.SERIES) out.set(k, { item: other, relation: RELATION.CROSS });
  }

  const rank = {
    [RELATION.SUPERSEDES]: 0, [RELATION.SUPPLEMENT]: 1, [RELATION.CROSS]: 2,
    [RELATION.SERIES]: 3, [RELATION.MANUAL]: 4, [RELATION.REPOST]: 5,
  };
  return [...out.values()].sort((a, b) => (rank[a.relation] ?? 9) - (rank[b.relation] ?? 9));
}

/**
 * 比较两条信息，列出**有效变更**。
 *
 * 两条重要规则（否则会产出误导性结果）：
 *   ① 只列出"旧值 → 有值的新值"。若新值为空，说明补充通知只是没有重述
 *      该字段，并不代表信息被取消，展示成"→ 未注明"会让用户误判。
 *   ② 参数必须是**未合并的原始条目**（来自 getRawItems()）。
 *      若传合并后的条目（其字段已被补充通知覆盖），对比等于和自己比，
 *      真正被改掉的字段反而显示不出来。
 */
export function diffBetween(a, b) {
  if (!a || !b) return [];
  const FIELDS = [
    ['startAt', '活动时间', true],
    ['deadline', '报名截止', true],
    ['place', '地点', false],
    ['audience', '面向对象', false],
    ['capacity', '人数限制', false],
    ['cost', '费用', false],
    ['weeklyHours', '每周投入', false],
  ];
  const rows = [];
  for (const [key, label, isTime] of FIELDS) {
    const av = a[key] ?? null;
    const bv = b[key] ?? null;
    if (av === bv) continue;
    // 规则①：新值为空视为"对方未重述"，不作为变更展示
    if (bv === null || bv === undefined || bv === '') continue;
    const fmt = (v) => {
      if (v === null || v === undefined || v === '') return '未注明';
      if (isTime) return formatTime(v) || String(v);
      if (key === 'weeklyHours') return `${v} 小时`;
      if (key === 'capacity') return `${v} 人`;
      return String(v);
    };
    rows.push({ label, from: fmt(av), to: fmt(bv) });
  }
  return rows;
}

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

/**
 * 由风险规则结果生成 AI 质量解读条目。
 *
 * 用途：题目数据只为少数条目手写了 AI 质量解读；
 * 其余条目若有风险提示，则在此自动生成一条。
 * 这样"建议与判断"总能汇聚到 AI 模块，而不是留在详情页顶部。
 *
 * 位置说明：本函数是纯数据变换、不碰 DOM，因此放在 logic 层。
 *          若放在 ui.js 会造成 logic ← ui 的循环依赖。
 */
export function risksToAiEntry(item) {
  if (!item || !item.risks || !item.risks.length) return null;
  const hasDanger = item.risks.some((r) => r.level === RISK_LEVEL.DANGER);
  const hasWarn = item.risks.some((r) => r.level === RISK_LEVEL.WARN);
  const points = item.risks.map((r) => ({
    level: r.level === RISK_LEVEL.DANGER ? 'danger' : r.level === RISK_LEVEL.WARN ? 'warn' : 'info',
    text: r.detail || r.fact || r.title,
  }));
  const advice = hasDanger
    ? '建议先在留言区向发布者确认关键信息（地点、主办方、费用），再决定是否参加。'
    : (hasWarn ? '建议出发或报名前确认上述缺失信息，避免白跑或错过。' : '');
  return {
    id: `ai-auto-q-${item.id}`,
    kind: 'quality',
    itemId: item.id,
    title: '这条信息需要注意什么',
    summary: `共 ${item.risks.length} 项客观提示，其中 ${item.risks.filter((r) => r.level === RISK_LEVEL.DANGER).length} 项为高风险信号。`,
    points,
    advice,
    sources: [String(item.id)],
  };
}

/* ============================================================
 * AI 整合模块
 *
 * 定位：高层级辅助模块，主页与帖子详情内都可调用。
 * 约束（务必保持）：
 *   1. 输出必须带 AI 标注（由视图层统一渲染，数据层提供文案）
 *   2. 默认折叠，用户点击才展开
 *   3. 结论必须能追溯到原始条目（entries 里的 sources 字段）
 * ============================================================ */

/** 是否启用 AI 模块 */
export function aiEnabled() {
  return USE_AI_MODULE === true;
}

/** 取某条信息的 AI 条目（可能同时有整合与质量解读） */
export function aiEntriesOf(itemId) {
  if (!aiEnabled()) return [];
  return AI_ENTRIES.filter((e) => String(e.itemId) === String(itemId));
}

/** 取某条信息中指定类型的 AI 条目 */
export function aiEntryOf(itemId, kind) {
  return aiEntriesOf(itemId).find((e) => e.kind === kind) || null;
}

/** 是否存在"发生过变更"的整合（用于主页 AI 面板的数量提示） */
export function aiChangeSummaries(now) {
  if (!aiEnabled()) return [];
  return AI_ENTRIES
    .filter((e) => e.kind === AI_KIND.INTEGRATION)
    .map((e) => {
      const changed = (e.changes || []).filter((c) => c.from !== c.to);
      return { entry: e, changedCount: changed.length, changed };
    })
    .filter((x) => x.changedCount > 0);
}

/** AI 模块总览：主页面板用
 *
 *  质量解读条目有两个来源：
 *    ① 数据中手写的（AI_QUALITY）
 *    ② 由风险规则自动生成的 —— 这样"建议与判断"总能汇总到 AI 面板，
 *       而不是散落在详情页顶部。
 */
export function aiOverview(list, now) {
  if (!aiEnabled()) return { groups: [], total: 0, changedItems: 0, itemsById: {} };
  const itemsById = new Map(list.map((i) => [String(i.id), i]));

  // 自动生成的质量解读：仅针对"有风险提示、但没有手写质量解读"的条目，
  // 避免同一条信息出现两份解读。
  const writtenQualityIds = new Set(
    AI_ENTRIES.filter((e) => e.kind === AI_KIND.QUALITY).map((e) => String(e.itemId)),
  );
  const autoQuality = list
    .filter((i) => i.risks && i.risks.length && !writtenQualityIds.has(String(i.id)))
    .map((i) => risksToAiEntry(i))
    .filter(Boolean);

  const groups = [
    {
      kind: AI_KIND.INTEGRATION,
      label: '官方信息变更整合',
      desc: '把主通知与补充通知合成一条结论，避免按旧时间行动',
      entries: AI_ENTRIES.filter((e) => e.kind === AI_KIND.INTEGRATION)
        .filter((e) => itemsById.has(String(e.itemId))),
    },
    {
      kind: AI_KIND.QUALITY,
      label: '信息质量解读',
      desc: '说明这条信息需要注意什么、还缺什么',
      entries: [
        ...AI_ENTRIES.filter((e) => e.kind === AI_KIND.QUALITY)
          .filter((e) => itemsById.has(String(e.itemId))),
        ...autoQuality,
      ],
    },
  ].filter((g) => g.entries.length);

  const total = groups.reduce((n, g) => n + g.entries.length, 0);
  const changedItems = aiChangeSummaries(now).length;
  return { groups, total, changedItems, itemsById };
}

export { AI_KIND, AI_DISCLAIMER, AI_DISCLAIMER_LONG };

/* ============================================================
 * 近义词 / 概念词典
 *
 *  把用户的口语化说法映射到材料中的正式表述。例如用户想找运动类
 *  活动时会搜「运动」，而材料里写的是「周末羽毛球约球」。
 *
 *  权重说明见 itemFuzzyScore：近义词命中按 0.72 折算，
 *  保证"直接命中"永远排在"近义命中"之前。
 * ============================================================ */
export const SYNONYMS = {
  运动: ['羽毛球', '约球', '体育'],
  体育: ['羽毛球', '约球', '运动'],
  约球: ['羽毛球', '运动', '组局'],
  组局: ['约球', '搭子', '组队'],
  搭子: ['约球', '组局', '交流'],
  讲座: ['分享会', '公开课', '交流会'],
  分享会: ['讲座', '交流会', '经验分享'],
  公开课: ['讲座', '课程', '入门'],
  比赛: ['竞赛', '挑战赛', '选拔'],
  竞赛: ['比赛', '挑战赛', '选拔'],
  培训: ['训练营', '工作坊', '学习小组'],
  训练: ['训练营', '培训'],
  工作坊: ['培训', '实操'],
  招人: ['招募', '招聘', '组队'],
  招募: ['招人', '招聘', '组队'],
  招聘: ['招募', '招人'],
  兼职: ['福利', '日结'],
  志愿: ['志愿服务', '公益'],
  公益: ['志愿服务', '志愿'],
  科研: ['科研助理', '科研入门', '论文'],
  论文: ['科研', '检索'],
  导师: ['科研', '导师联系'],
  资料: ['学习资料', '资料合集', '课程'],
  课程: ['公开课', '学习资料'],
  团队: ['组队', '成员', '招募'],
  组队: ['团队', '招募', '成员'],
  编程: ['程序', '开发'],
  程序: ['程序设计', '编程'],
  开发: ['程序', '前端'],
  前端: ['开发', 'Web'],
  安全: ['网络安全', 'CTF'],
  英语: ['语言角', '外国语'],
  语言: ['语言角', '外国语'],
  摄影: ['摄影志愿者', '拍照'],
  学习: ['学习小组', '自学', '资料'],
  线上: ['直播', '线上同步'],
  /* —— 按反馈扩充（"拼音/缩写/近义词仍有很多搜不到"）——
     原则：收"学生真会打的日常说法"，映射到材料里的正式表述。
     每条都双向或就近覆盖，避免"搜 A 有、搜 A 的同义说法没有"的不对称。 */
  回放: ['直播回放', '已结束', '录播'],
  录播: ['回放', '直播回放'],
  直播: ['线上', '回放'],
  报名: ['登记', '意向登记'],
  登记: ['报名', '意向登记'],
  截止: ['截止时间', '报名截止'],
  地点: ['场地', '位置'],
  场地: ['地点', '场地待定'],
  免费: ['无需报名'],
  组会: ['组队', '搭子', '约'],
  找队友: ['组队', '招募', '搭子'],
  缺人: ['还缺', '招募'],
  面试: ['选拔', '招新'],
  招新: ['招募', '纳新', '招人'],
  纳新: ['招新', '招募'],
  社团: ['协会', '学生组织'],
  协会: ['社团', '学会'],
  学生会: ['学生组织', '学生会'],
  干事: ['招募', '学生组织'],
  奖学: ['奖学金'],
  奖学金: ['奖学', '助学金'],
  助学金: ['奖学金', '资助'],
  交换: ['交流', '访学'],
  留学: ['交换', '出国'],
  考研: ['考研自习', '备考'],
  保研: ['推免', '考研'],
  四六级: ['英语', '等级考试'],
  实习: ['就业', '岗位'],
  就业: ['求职', '实习'],
  求职: ['就业', '简历'],
  简历: ['求职', '就业'],
  篮球: ['体育运动', '球类'],
  足球: ['体育运动', '球类'],
  羽毛球: ['体育运动', '约球'],
  乒乓球: ['体育运动', '球类'],
  跑步: ['体育运动', '健身'],
  健身: ['体育运动', '跑步'],
  志愿者: ['志愿', '志愿服务'],
  志愿服务: ['志愿', '公益'],
  讲座会: ['讲座', '分享会'],
  沙龙: ['讲座', '交流会'],
  工作: ['实习', '就业'],
  作品: ['参赛作品'],
  提交: ['报名', '上传'],
  材料: ['材料清单'],
  设计: ['产品设计', '视觉'],
  产品: ['产品设计', 'AI'],
  人工智能: ['AI', '智能'],
  ai: ['人工智能', 'AI'],
  挑战: ['挑战赛', '竞赛'],
  省赛: ['竞赛', '挑战赛'],
  国赛: ['竞赛', '挑战赛'],
  校赛: ['竞赛', '校内'],
  零基础: ['不限基础', '新手'],
  新手: ['零基础', '新生'],
  新生: ['零基础', '大一'],
  大一: ['新生'],
  时间: ['活动时间'],
  投入: ['时间投入'],
  每周: ['每周固定'],
};

/* ============================================================
 * 智能搜索
 *
 *  相比早期的"子串 + 子序列"，这里补齐用户真实会用的三类输入：
 *   ① 拼音与首字母     lqb / lanqiao / lanqiaobei  → 蓝桥杯
 *                      ymq                          → 羽毛球
 *   ② 错字容忍         「兰桥杯」→ 蓝桥杯（同音字）
 *                      「羽毛球赛」→ 羽毛球（多字）
 *   ③ 近义词           「运动」→ 羽毛球 / 约球
 *                      「讲座」→ 分享会 / 公开课
 *
 *  ── 设计要点：为什么不再使用"子序列匹配" ──
 *  早期实现用子序列（字符按序出现即可）来提高召回，但实测它是无关命中的
 *  主要来源：
 *    · 「zzz」命中「2—4 人组队…10 月 20 日」——数字被当成拉丁字符逐个对上
 *    · 「xxx」命中「开发零基础学习小组」
 *    · 「aa」 命中「费用AA」「AI 应用入门」
 *  根因是**跨书写体系比较**没有隔离。因此本版改为：
 *    第一步判定查询是"拉丁"还是"中文"；
 *    第二步只使用对该类型有效的策略，且逐字段做体系隔离。
 *  这样从结构上消除误命中，而不是靠调阈值打补丁。
 *
 *  打分：
 *    120 完全相同   100 子串（越靠前越高）   90 前缀
 *     88 拼音/首字母全等   86 片段级拼音/首字母全等
 *     84 拼音/首字母前缀   80 词边界前缀
 *     62 编辑距离 ≤1（错字/多字/漏字）
 * ============================================================ */

/** 查询/文本的书写体系判定 */
const RE_LATIN = /^[a-z0-9]+$/;          // 纯拉丁字母或数字
const RE_HAN = /[\u4e00-\u9fff]/;        // 含汉字
const RE_SPLIT = /[\s·,，。、；;:：/|｜\\()（）\[\]【】「」『』“”"'']+/;

/** 按标点/空白切分为片段 */
function splitSegments(text) {
  return String(text).split(RE_SPLIT).filter(Boolean);
}

/** 取片段中的纯汉字部分（拼音比较只对这部分进行，避免中英混合片段噪声） */
function hanPart(seg) {
  return String(seg).replace(/[^\u4e00-\u9fff]/g, '');
}

/**
 * Levenshtein 编辑距离，带早停。
 * @returns {number} 超过 limit 时返回 limit+1
 */
function editDistance(a, b, limit = 1) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > limit) return limit + 1;
  let prev = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[lb];
}

/** 生成与关键词等长及长 1 的滑动窗口，用于漏字/多字的编辑距离比较 */
function windowsOf(text, len, max = 12) {
  const s = String(text);
  const out = new Set();
  if (len < 2 || s.length < len) return out;
  for (const w of [len, len + 1]) {
    if (w > s.length || w > max) continue;
    for (let i = 0; i + w <= s.length; i++) out.add(s.slice(i, i + w));
  }
  return out;
}

/** 文本 → 拼音串 */
export function toPinyin(text) {
  let out = '';
  for (const ch of String(text)) out += CHAR_PINYIN.get(ch) || ch;
  return out;
}

/** 文本 → 拼音首字母串 */
export function toInitials(text) {
  let out = '';
  for (const ch of String(text)) out += CHAR_INITIAL.get(ch) || ch;
  return out;
}

/**
 * 单个词对单段文本打分。
 * @returns {number} 0 表示不匹配
 */
export function fuzzyScore(keyword, text) {
  if (!keyword || !text) return 0;
  const k = String(keyword).toLowerCase().trim();
  const t = String(text).toLowerCase();
  if (!k) return 0;

  /* ── 第一步：直接文本匹配（两种查询类型都适用）── */
  if (t === k) return 120;
  if (t.startsWith(k)) return 90;
  if (t.includes(k)) return 100 - Math.min(20, t.indexOf(k));
  const segs = splitSegments(t);
  for (const seg of segs) {
    if (seg === k) return 118;
    if (seg.startsWith(k)) return 80;
  }

  /* ── 第二步：按查询类型选用兼容策略 ── */
  const kIsLatin = RE_LATIN.test(k);

  if (kIsLatin) {
    /* 拉丁查询（拼音 / 首字母）的匹配策略。
       规则全部来自实测踩坑，改动前请先读 `tools/check-search.mjs` 的 ⑥⑦ 两节。

       ① 只比"纯汉字部分"：「费用AA」的纯汉字部分是「费用」，
          不会被拼音逻辑当成 aa（字面命中在第一步已经处理）。

       ② 按"词单元"比，而不是按任意窗口比。
          词单元 = 整段汉字 + 词库切出来的词（lexicon.js）。
          之前按 2~3 字滑动窗口比首字母，会把「最终作」当成 zzz、
          「学习小」当成 xxx、「组招」当成 zz —— 长句里任意三连字
          都可能凑出用户的乱码，噪声无法收敛。切词后这两个例子
          都不再是"词"，噪声消失，而「羽毛球」仍是词，ymq 照样能搜到。

       ③ 首字母等值要求长度完全一致，前缀要求 ≥4 个字母。
          2~3 个字母的任意前缀（如「zz」「xxx」）歧义太大；
          而 lqb / ymq / wlaq / sxjm 这类真缩写要么正好是整词
          的首字母，要么是整段前缀且长度 ≥4。

       ④ 全拼只做等值 / 前缀，不做子串；另允许 2~4 字的全拼窗口，
          用来覆盖"整段里的某个词"（如「招募」的 zhaomu）。
          中文每字一个音节，音节串的中间子串对用户没有意义。
    */
    const unitsOf = (seg) => {
      const han = hanPart(seg);
      if (han.length < 2) return [];
      return [han, ...termsIn(han)];
    };

    for (const seg of segs) {
      for (const u of unitsOf(seg)) {
        const py = toPinyin(u);
        const ini = toInitials(u);
        // 全拼：等值 / 前缀
        if (k.length >= 2 && k.length <= py.length) {
          if (py === k) return 88;
          if (py.startsWith(k)) return 84;
        }
        // 首字母：等值（长度必须一致，避免短词吃长词）
        if (k.length >= 3 && k.length === u.length && ini === k) return 86;
        // 首字母：前缀（≥4 个字母才有足够区分度）
        if (k.length >= 4 && k.length <= ini.length && ini.startsWith(k)) return 82;
        // 错字容忍（仅长查询启用，短串会噪声）
        if (k.length >= 5 && py.length >= 3 && editDistance(k, py, 1) <= 1) return 70;
        if (k.length >= 5 && ini.length >= 5 && editDistance(k, ini, 1) <= 1) return 68;
      }
    }

    // 全拼滑动窗口：覆盖整段中间某个词的全拼（首字母不做窗口匹配）
    for (const seg of segs) {
      const han = hanPart(seg);
      if (han.length < 3 || k.length < 2) continue;
      for (let w = 2; w <= 4; w++) {
        if (w >= han.length) continue;
        for (let i = 0; i + w <= han.length; i++) {
          const py = toPinyin(han.slice(i, i + w));
          if (k.length > py.length) continue;
          if (py === k) return 80;
          if (py.startsWith(k)) return 78;
        }
      }
    }

    // 整串纯拼音（适用于英文标题、网址等纯拉丁字段）
    if (!RE_HAN.test(t)) {
      if (editDistance(k, t, 1) <= 1) return 62;
      if (k.length >= 4 && t.includes(k)) return 60;
    }
  } else {
    /* 中文查询：只在"含汉字"的片段上做编辑距离，
       避免与纯数字/拉丁片段（如 A402、2—4 人）产生无关匹配。

       ⚠ 这里要求查询长度 ≥ 3，是实测出来的精度修复：
       中文两个字的信息量太低，"容忍 1 个错字"会命中一大片 —
       搜「大一」时「大学生」只差一个字，于是 26 条里有 21 条被命中，
       搜索看起来就"什么都搜得到、等于什么都没搜"。
       两个字的中文查询交给上面的字面匹配（精确包含），够了。 */
    if (k.length >= 3) {
      const cands = new Set([...segs, ...windowsOf(t, k.length)]);
      for (const cand of cands) {
        if (cand.length < 2) continue;
        if (!RE_HAN.test(cand)) continue;        // 必须含汉字
        if (editDistance(k, cand, 1) <= 1) return 62;
      }
    }
  }

  return 0;
}

/** 查询扩展：把用户输入拆成词，并为每个词补充近义词 */
function expandTokens(keyword) {
  const raw = String(keyword).toLowerCase().trim().split(/\s+/).filter(Boolean);
  return raw.map((tok) => {
    const syns = SYNONYMS[tok] || [];
    return { main: tok, all: [tok, ...syns.map((s) => s.toLowerCase())] };
  });
}

/**
 * 对一条信息做智能搜索，返回最佳分数。
 *
 * 支持多词：各词可命中不同字段，全部命中才算匹配，取平均分。
 * 近义词按 0.72 折算，保证"直接命中"永远优先于"近义命中"。
 * 字段权重：标题 > 标签 > 主办方/地点 > 面向对象 > 备注 > 原文。
 */
export function itemFuzzyScore(item, keyword) {
  if (!keyword) return 0;
  const tokens = expandTokens(keyword);
  if (!tokens.length) return 0;

  const fields = [
    [item.title, 1.0],
    [(item.tags || []).join(' '), 0.95],
    [item.org, 0.85],
    [item.place, 0.85],
    [item.audience, 0.8],
    [item.notes, 0.7],
    [item.raw, 0.6],
  ];

  let sum = 0;
  for (const token of tokens) {
    let best = 0;
    for (const [val, weight] of fields) {
      if (!val) continue;
      const s = fuzzyScore(token.main, val) * weight;
      if (s > best) best = s;
      for (const syn of token.all.slice(1)) {
        const ss = fuzzyScore(syn, val) * weight * 0.72;
        if (ss > best) best = ss;
      }
    }
    if (best <= 0) return 0;          // 任一词未命中即整体不匹配
    sum += best;
  }
  return Math.round(sum / tokens.length);
}

/** searchExplain 用到的可搜索字段（与 itemFuzzyScore 保持一致） */
function searchableTexts(item) {
  return [item.title, (item.tags || []).join(' '), item.org, item.place,
    item.audience, item.notes, item.raw]
    .filter(Boolean).map((v) => String(v).toLowerCase());
}

/**
 * 搜索可解释性：说明"这次搜索是怎么被理解的"。
 *
 * 为什么需要它：拼音 / 首字母 / 近义词 / 错字容错都会让"搜到的结果"
 * 看起来跟输入对不上（输入 ymq，结果里没有 ymq 这三个字母）。
 * 不解释，用户只会觉得"搜索实现很奇怪"。
 *
 * @param {string} keyword 用户输入
 * @param {Array} items 本次命中的条目
 * @returns {{keyword:string,count:number,modes:string[],synonyms:string[]}|null}
 *          modes 取值：direct（字面命中）/ pinyin（拼音·首字母）/
 *          synonym（近义词）/ fuzzy（错字容错）
 */
export function explainSearch(keyword, items) {
  const kw = String(keyword || '').trim();
  if (!kw) return null;
  const list = items || [];
  const texts = list.flatMap(searchableTexts);
  const modes = new Set();
  const synonyms = new Set();

  for (const tok of expandTokens(kw)) {
    if (texts.some((t) => t.includes(tok.main))) { modes.add('direct'); continue; }
    const used = tok.all.slice(1).filter((s) => texts.some((t) => t.includes(s)));
    if (used.length) { modes.add('synonym'); synonyms.add(`${tok.main}→${used[0]}`); continue; }
    modes.add(RE_LATIN.test(tok.main) ? 'pinyin' : 'fuzzy');
  }

  return { keyword: kw, count: list.length, modes: [...modes], synonyms: [...synonyms] };
}


/* ============================================================
 * id 归一化与用户态归属判断
 *
 * ⚠ 这里集中处理一个真实发生过的 bug：
 *   条目数据里的 id 是【数字】（1、2、3…），而 DOM 的 dataset.id 读出来永远是
 *   【字符串】（"1"），学生自己发布的条目 id 又是 'u' 前缀的字符串。
 *   两边直接 includes() / === 比较，就会出现：
 *     点收藏 → 提示"已加入我的日程" → localStorage 里也确实写进去了，
 *     但星标不亮、"我的日程"永远是 0 条 —— 用户看到的就是"加入我的日程没反应"。
 *   根因是类型不一致，所以统一在这里按字符串比较，调用方传数字或字符串都对。
 * ============================================================ */

/** id 是否相同（数字 / 字符串均视为同一 id） */
export function sameId(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

/** 该条目是否已加入「我的日程」（即已收藏） */
export function isFavored(state, item) {
  const list = (state && state.favorites) || [];
  const id = item && item.id;
  return list.some((f) => sameId(f, id));
}

/** 兼容旧数据：把 localStorage 里可能混着数字的 id 列表统一成字符串 */
export function normalizeIdList(list) {
  return Array.isArray(list) ? list.map((x) => String(x)) : [];
}

/* ============================================================
 * 搜索可解释性：这条结果【为什么】命中
 *
 * 只说"共 N 条"解释不了用户看到的东西：搜「ymq」出现「周末羽毛球约球」，
 * 标题里根本没有 ymq；搜「运动」出现一条羽毛球约球，也对不上字面。
 * 所以逐条给出"命中在哪个字段 + 以什么方式命中 + 命中的原文片段"。
 * ============================================================ */
const MATCH_FIELDS = (item) => [
  ['标题', item.title, 1.0],
  ['标签', (item.tags || []).join(' '), 0.95],
  ['主办方', item.org, 0.85],
  ['地点', item.place, 0.85],
  ['面向对象', item.audience, 0.8],
  ['备注', item.notes, 0.7],
  ['题目原文', item.raw, 0.6],
];

/** 逐条命中说明：字段名 + 命中方式（字面/拼音/近义/容错）+ 命中片段 */
export function matchInfo(item, keyword) {
  const kw = String(keyword || '').trim();
  if (!kw || !item) return null;
  const tokens = expandTokens(kw);
  let best = null;
  const consider = (info) => { if (!best || info.score > best.score) best = info; };

  for (const tok of tokens) {
    // 主词与近义词都试；近义词按 0.72 折算，与打分口径一致
    const cands = [{ word: tok.main, isSyn: false }]
      .concat(tok.all.slice(1).map((s) => ({ word: s, isSyn: true })));
    for (const { word, isSyn } of cands) {
      for (const [label, val, weight] of MATCH_FIELDS(item)) {
        if (!val) continue;
        const text = String(val);
        const at = text.toLowerCase().indexOf(String(word).toLowerCase());
        if (at >= 0) {
          consider({
            score: 100 * weight * (isSyn ? 0.72 : 1),
            field: label, mode: isSyn ? 'synonym' : 'literal',
            term: word, synFrom: isSyn ? tok.main : '',
            start: at, length: String(word).length, text,
          });
          continue;
        }
        const fuzzy = fuzzyScore(word, text);
        if (fuzzy > 0) {
          consider({
            score: fuzzy * weight * (isSyn ? 0.72 : 1),
            field: label,
            mode: /^[a-z]+$/.test(word) ? 'pinyin' : 'fuzzy',
            term: word, synFrom: isSyn ? tok.main : '',
            start: -1, length: 0, text,
          });
        }
      }
    }
  }
  return best;
}

/** 命中方式的短标签（展示在卡片上） */
export const MATCH_MODE_LABEL = {
  literal: '字面命中',
  pinyin: '拼音 / 首字母',
  synonym: '近义词',
  fuzzy: '错字容错',
};

/** 命中片段（纯数据，不含 HTML）：交给视图层去转义与拼接，保持逻辑层不产出标记 */
export function highlightMatch(info) {
  if (!info || info.start < 0) return null;
  const cut = (s, n, tail) => (s.length > n ? s.slice(0, n) + (tail ? '…' : '') : s);
  return {
    before: cut(info.text.slice(0, info.start), 16, true),
    hit: info.text.slice(info.start, info.start + info.length),
    after: cut(info.text.slice(info.start + info.length), 20, true),
  };
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

/**
 * 全量数据 → 加工后的展示列表
 *
 * 注意 buildViewList 内部使用浅拷贝，不会污染 data.js 中的原始对象，
 * 因此 getRawItems() 可以在任意时刻拿到未被合并覆盖的原始条目。
 */
export function buildDataset(now, extraItems = []) {
  const all = getRawItems(extraItems);
  const view = buildViewList(all);
  return view.map((i) => decorate(i, now));
}

/**
 * 取原始条目（未合并、未加工）。
 * 关联面板的"变更对照"依赖它：主条目的字段会被补充通知覆盖，
 * 必须拿到覆盖前的原值才能算出真实变更。
 */
export function getRawItems(extraItems = []) {
  const base = USE_DEMO_DATA ? [...ITEMS, ...DEMO_ITEMS] : ITEMS;
  return [...base, ...extraItems];
}

export { SOURCE, KIND, SOURCE_LABEL, KIND_LABEL };

/* 第四步：把板块 / 置顶相关的常量一并转发给视图层，
   使视图层只需 import 本模块，无需直接依赖 data.js（降低耦合） */
export { BOARD, BOARDS, BOARD_MAP, BOARD_KINDS, PIN_LEVEL, PIN_LABEL };
/* RELATION / RELATION_LABEL 已在上方以 export const 定义，无需重复导出 */
