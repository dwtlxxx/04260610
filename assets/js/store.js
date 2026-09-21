/**
 * store.js —— 本地持久化层
 *
 * 对应题目要求 6：「重要的用户操作结果在刷新或重新打开后应能够合理保留」
 *
 * 设计要点：
 *   1. 全部读写包 try/catch —— 隐私模式或存储被禁用时不崩，降级为内存存储
 *   2. 单一命名空间前缀，避免与其他页面冲突
 *   3. 对外暴露语义化方法，UI 层不直接碰 localStorage
 *   4. 用户发布的内容与题目数据使用不同 id 段（u 前缀），避免主键冲突
 *   5. 所有以 id 为键/元素的存储一律按【字符串】归一 —— 见下面的 sid()
 *
 * 依赖方向：logic.js 不依赖本模块，因此这里引用它是安全的（无循环依赖）。
 */

import { normalizeIdList } from './logic.js';

const NS = 'zhku-opportunity:';

/* 内存降级存储：localStorage 不可用时使用，保证功能不中断 */
const memory = new Map();

function available() {
  try {
    const k = NS + '__probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

const canUseLS = available();

function read(key, fallback) {
  try {
    const raw = canUseLS ? localStorage.getItem(NS + key) : memory.get(NS + key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch {
    // 数据损坏时返回默认值，而不是抛错导致整页白屏
    return fallback;
  }
}

function write(key, value) {
  try {
    const raw = JSON.stringify(value);
    if (canUseLS) localStorage.setItem(NS + key, raw);
    else memory.set(NS + key, raw);
    return true;
  } catch {
    return false;
  }
}

function remove(key) {
  try {
    if (canUseLS) localStorage.removeItem(NS + key);
    else memory.delete(NS + key);
  } catch {
    /* 忽略 */
  }
}

export const storage = { read, write, remove, canUseLS };

/* ============================================================
 * 收藏
 * ============================================================ */

const KEY_FAVORITES = 'favorites';

/**
 * 统一 id 形态：一律按字符串存取。
 *
 * 为什么：条目 id 在数据里是数字（1、2、3…），而 dataset.id 读出来是字符串（"1"），
 * 用户发布条目又是 'u' 前缀字符串。只要有一处按数字写入、另一处按字符串比较，
 * 收藏就会"写进去了但显示不出来"。这里把归一化收口在存储层，
 * 任何调用方传数字或字符串都能正确命中，并且能读回历史遗留的混合数据。
 */
const sid = (id) => String(id);

export function getFavorites() {
  return normalizeIdList(read(KEY_FAVORITES, []));
}

export function isFavorite(id) {
  return getFavorites().includes(sid(id));
}

/** 返回切换后的状态（true = 现已收藏） */
export function toggleFavorite(id) {
  const key = sid(id);
  const list = getFavorites();
  const i = list.indexOf(key);
  if (i >= 0) {
    list.splice(i, 1);
    write(KEY_FAVORITES, list);
    return false;
  }
  list.push(key);
  write(KEY_FAVORITES, list);
  return true;
}

/* ============================================================
 * 用户发布的活动 / 招募
 * 对应题目要求 5：「支持学生自主发布活动或招募信息，使发布内容能够进入产品的正常使用流程」
 * ============================================================ */

const KEY_USER_ITEMS = 'user-items';

/** 用户发布的条目与题目数据同构，额外带 isUserPost 标记 */
export function getUserItems() {
  return read(KEY_USER_ITEMS, []);
}

export function addUserItem(partial) {
  const list = getUserItems();
  // 用户 id 使用 u 前缀 + 时间戳，避免与题目数据的数字 id 冲突
  const id = 'u' + Date.now().toString(36);
  const item = {
    id,
    isUserPost: true,
    createdAt: new Date().toISOString(),
    reportCount: 0,
    ...partial,
  };
  list.unshift(item);
  write(KEY_USER_ITEMS, list);
  return item;
}

export function updateUserItem(id, patch) {
  const key = sid(id);
  const list = getUserItems();
  const i = list.findIndex((x) => sid(x.id) === key);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch };
  write(KEY_USER_ITEMS, list);
  return list[i];
}

export function removeUserItem(id) {
  const key = sid(id);
  write(KEY_USER_ITEMS, getUserItems().filter((x) => sid(x.id) !== key));
}

/* ============================================================
 * 举报 —— 对应「平台使用秩序」的处理闭环
 * ============================================================ */

const KEY_REPORTS = 'reports';

export function getReports() {
  return read(KEY_REPORTS, []);
}

export function hasReported(id) {
  const key = sid(id);
  return getReports().some((r) => sid(r.itemId) === key);
}

export function addReport(itemId, reason) {
  const key = sid(itemId);
  const list = getReports();
  if (list.some((r) => sid(r.itemId) === key)) return false;
  list.push({ itemId: key, reason, at: new Date().toISOString() });
  write(KEY_REPORTS, list);
  // 累计到用户发布条目上，便于发布者看到反馈
  const userItems = getUserItems();
  const target = userItems.find((x) => sid(x.id) === key);
  if (target) updateUserItem(target.id, { reportCount: (target.reportCount || 0) + 1 });
  return true;
}

/* ============================================================
 * 留言 / 提问 —— 替代私信 IM 的轻量沟通（对应题 23「报名后拉群」这类需求）
 * ============================================================ */

const KEY_COMMENTS = 'comments';

export function getComments(itemId) {
  const all = read(KEY_COMMENTS, {});
  return all[sid(itemId)] || [];
}

export function addComment(itemId, text) {
  const key = sid(itemId);
  const all = read(KEY_COMMENTS, {});
  const list = all[key] || [];
  list.push({ text, at: new Date().toISOString() });
  all[key] = list;
  write(KEY_COMMENTS, all);
  return list;
}

/* ============================================================
 * 界面偏好
 * ============================================================ */

const KEY_THEME = 'theme';       // 'auto' | 'light' | 'dark'
const KEY_VIEWMODE = 'viewmode'; // 'auto' | 'mobile' | 'desktop'
const KEY_FILTERS = 'filters';
const KEY_UI_PREFS = 'ui-prefs'; // 板块 / 快捷筛选 / 标签 / 排序

export function getTheme() {
  return read(KEY_THEME, 'auto');
}
export function setTheme(v) {
  write(KEY_THEME, v);
}

export function getViewMode() {
  return read(KEY_VIEWMODE, 'auto');
}
export function setViewMode(v) {
  write(KEY_VIEWMODE, v);
}

export function getFilters() {
  return read(KEY_FILTERS, {});
}
export function setFilters(f) {
  write(KEY_FILTERS, f);
}

/** 界面偏好（当前板块、快捷筛选、激活标签、排序方式） */
export function getUiPrefs() {
  return read(KEY_UI_PREFS, {});
}
export function setUiPrefs(p) {
  write(KEY_UI_PREFS, p);
}

/* ============================================================
 * 调试与维护
 * ============================================================ */

export function exportAll() {
  return {
    favorites: getFavorites(),
    userItems: getUserItems(),
    reports: getReports(),
    theme: getTheme(),
    viewMode: getViewMode(),
    filters: getFilters(),
  };
}

export function clearAll() {
  [KEY_FAVORITES, KEY_USER_ITEMS, KEY_REPORTS, KEY_COMMENTS].forEach(remove);
}
