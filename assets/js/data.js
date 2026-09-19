/**
 * data.js —— 数据定义层（当前为【空数据集】）
 *
 * 当前阶段目标：只验证基础架构，不填充题目信息。
 * 架构验证通过后，把 26 条信息按同样的结构填入 ITEMS 即可，UI 与逻辑层无需改动。
 *
 * 设计原则（对应题目「没有提供的信息请不要擅自编造」）：
 *   1. 题目未提供的字段一律为 null，UI 层负责显示「未注明」，绝不填充猜测值
 *   2. raw 保留题目原文，详情页可对照，便于核查理解是否偏差
 *   3. 被补充通知更新的条目，字段写【生效后】的值，并记录 supersededBy / supplementOf
 *
 * 时间背景：题目要求以 2026-09-19 为考核当日
 */

export const TODAY = '2026-09-19';

/* 来源类型 */
export const SOURCE = {
  SCHOOL: 'school',   // 校级发布
  COLLEGE: 'college', // 院级发布
  STUDENT: 'student', // 学生个人发布
};

/* 内容形态 */
export const KIND = {
  ACTIVITY: 'activity',   // 讲座、分享会、工作坊等有确定时间的活动
  PROGRAM: 'program',     // 训练营、学习小组等周期性活动
  RECRUIT: 'recruit',     // 团队 / 科研助理等招募
  CONTEST: 'contest',     // 竞赛
  RESOURCE: 'resource',   // 资料合集
  MEETUP: 'meetup',       // 学生自发的组局 / 约人
};

export const KIND_LABEL = {
  [KIND.ACTIVITY]: '活动',
  [KIND.PROGRAM]: '训练营',
  [KIND.RECRUIT]: '招募',
  [KIND.CONTEST]: '竞赛',
  [KIND.RESOURCE]: '资料',
  [KIND.MEETUP]: '组局',
};

export const SOURCE_LABEL = {
  [SOURCE.SCHOOL]: '校级',
  [SOURCE.COLLEGE]: '院级',
  [SOURCE.STUDENT]: '学生自发',
};

/**
 * 字段结构说明（ заполнение 时严格按此结构）
 *   id          数字，题目编号
 *   title       标题
 *   kind        KIND 之一
 *   source      SOURCE 之一
 *   org         发布方名称（校级 / 计算机学院 / 学生个人发布…）
 *   raw         题目原文（详情页对照用）
 *   deadline    报名/提交截止时间 'YYYY-MM-DDTHH:mm'，null = 未注明
 *   startAt     活动开始时间，null = 未注明
 *   endAt       活动结束时间，null = 未注明
 *   place       地点；null = 未注明；'待定' 类情况放在 placeStatus
 *   placeStatus 地点状态描述（如「待最终确认」）
 *   audience    面向对象，null = 未注明
 *   capacity    人数上限，null = 未注明
 *   capacityMin 人数下限（如「6—8 人」）
 *   cost        费用，null = 未注明（如 'AA'）
 *   weeklyHours 每周投入小时数，null = 未注明
 *   recurring   周期性描述（自然语言）
 *   rolling     true = 长期招募 / 满员即止，无固定截止
 *   notes       需要特别注意的条件
 *   seriesId    同属一个系列的标识（用于合并补充通知）
 *   supplementOf 本条的补充对象 id
 *   isSupplement 本条是否为纯补充通知
 *   supersededBy 本条被哪条补充通知更新
 *   closedRoles / openRoles  招募岗位状态
 *   allowStandby 截止后仍可候补
 *   replayExpectedAt 预计上传回放的日期
 *   linkExpiresAt    资源链接有效期
 *   deadlineNote     截止时间的补充说明（如原文只给日期未给时刻）
 *   startAtApprox    开始时间仅为约数（如原文只写「晚间」）
 *   requiresPrivateContact / hasPromoLink / titleBodyMismatch / contentSignals
 *                    风险信号字段，供规则引擎识别
 */

/** 题目提供的校园信息（当前为空，待架构验证通过后填入） */
export const ITEMS = [];

/** 数据源元信息，供界面显示 */
export const DATASET_META = {
  name: '2026 年秋季校园活动与机会（模拟数据）',
  referenceDate: TODAY,
  expectedCount: 26,
  loaded: ITEMS.length,
};

/**
 * 开发用示例数据：仅用于验证"有数据时界面是否正常工作"。
 * 不影响正式数据，正式数据填入 ITEMS 后可删除本段。
 */
export const DEMO_ITEMS = [
  {
    id: 'demo-1',
    title: '【示例】零基础编程训练营',
    kind: KIND.PROGRAM,
    source: SOURCE.SCHOOL,
    org: '校级',
    raw: '这是一条用于验证界面渲染的示例数据，正式数据填入 ITEMS 后即可移除。',
    deadline: '2026-09-24T22:00',
    startAt: '2026-09-21T19:30',
    endAt: null,
    place: '实验楼 A402',
    audience: '全校学生',
    capacity: null,
    cost: null,
    weeklyHours: null,
    recurring: '每周六 19:00',
    rolling: false,
    notes: '零基础可参加',
  },
  {
    id: 'demo-2',
    title: '【示例】学生自发约球（用于验证学生发布与风险提示）',
    kind: KIND.MEETUP,
    source: SOURCE.STUDENT,
    org: '学生个人发布',
    raw: '示例数据：地点与费用未提供，用于验证缺失字段与提示是否正常展示。',
    deadline: null,
    startAt: '2026-09-20T16:00',
    endAt: null,
    place: null,
    placeStatus: '待最终确认',
    audience: null,
    capacity: 8,
    capacityMin: 6,
    cost: 'AA',
    weeklyHours: null,
    rolling: false,
    notes: '场地待最终确认',
    requiresPrivateContact: true,
    contentSignals: ['示例信号'],
  },
];
