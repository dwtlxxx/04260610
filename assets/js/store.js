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
 */

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

export function getFavorites() {
  return read(KEY_FAVORITES, []);
}

export function isFavorite(id) {
  return getFavorites().includes(id);
}

/** 返回切换后的状态（true = 现已收藏） */
export function toggleFavorite(id) {
  const list = getFavorites();
  const i = list.indexOf(id);
  if (i >= 0) {
    list.splice(i, 1);
    write(KEY_FAVORITES, list);
    return false;
  }
  list.push(id);
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
  const list = getUserItems();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch };
  write(KEY_USER_ITEMS, list);
  return list[i];
}

export function removeUserItem(id) {
  write(KEY_USER_ITEMS, getUserItems().filter((x) => x.id !== id));
}

/* ============================================================
 * 举报 —— 对应「平台使用秩序」的处理闭环
 * ============================================================ */

const KEY_REPORTS = 'reports';

export function getReports() {
  return read(KEY_REPORTS, []);
}

export function hasReported(id) {
  return getReports().some((r) => r.itemId === id);
}

export function addReport(itemId, reason) {
  const list = getReports();
  if (list.some((r) => r.itemId === itemId)) return false;
  list.push({ itemId, reason, at: new Date().toISOString() });
  write(KEY_REPORTS, list);
  // 累计到用户发布条目上，便于发布者看到反馈
  const userItems = getUserItems();
  const target = userItems.find((x) => x.id === itemId);
  if (target) updateUserItem(itemId, { reportCount: (target.reportCount || 0) + 1 });
  return true;
}

/* ============================================================
 * 留言 / 提问 —— 替代私信 IM 的轻量沟通（对应题 23「报名后拉群」这类需求）
 * ============================================================ */

const KEY_COMMENTS = 'comments';

export function getComments(itemId) {
  const all = read(KEY_COMMENTS, {});
  return all[itemId] || [];
}

export function addComment(itemId, text) {
  const all = read(KEY_COMMENTS, {});
  const list = all[itemId] || [];
  list.push({ text, at: new Date().toISOString() });
  all[itemId] = list;
  write(KEY_COMMENTS, all);
  return list;
}

/* ============================================================
 * 界面偏好
 * ============================================================ */

const KEY_THEME = 'theme';       // 'auto' | 'light' | 'dark'
const KEY_VIEWMODE = 'viewmode'; // 'auto' | 'mobile' | 'desktop'
const KEY_FILTERS = 'filters';

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
