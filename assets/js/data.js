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

/* ============================================================
 * 板块（Board）
 *
 * 设计要点：把【官方信息】独立成一个板块，而不是与所有内容混在一条流里。
 * 理由是题目要求「合理呈现学校、学院及学生自主发布等不同来源的内容」，
 * 而新生最需要的恰恰是"这条到底是不是学校办的"。
 *
 * official=true 的板块在界面上使用更强的视觉区分（蓝色标识 + 左边框 + 徽章）。
 * ============================================================ */

export const BOARD = {
  ALL: 'all',           // 全部（聚合视图，不属于任何具体板块）
  OFFICIAL: 'official', // 官方发布（校级 + 院级，独立成板）
  CONTEST: 'contest',   // 竞赛与训练营
  LEARN: 'learn',       // 学习资源
  RECRUIT: 'recruit',   // 招募与组队
  CAMPUS: 'campus',     // 校园活动
  STUDENT: 'student',   // 学生自发（组局 / 约人 / 个人分享）
  TIMELINE: 'timeline', // 时间线（按时间排列的聚合视图，不属于具体板块）
};

/**
 * 板块定义
 *   id       BOARD 常量
 *   label    显示名
 *   short    手机端圆形入口下的短标签
 *   icon     圆形入口内的符号（用文字符号，避免引入图标库）
 *   official 是否属于官方信息来源
 *   desc     该板块的说明（显示在板块头部）
 *   types    该板块包含的 VIEW 类型：'board' 普通板块 / 'aggregate' 聚合视图
 */
export const BOARDS = [
  {
    id: BOARD.ALL, label: '全部机会', short: '全部', icon: '◎',
    official: false, types: 'aggregate',
    desc: '所有来源的信息汇总，按"最该行动的排最前"排序。',
  },
  {
    id: BOARD.OFFICIAL, label: '官方发布', short: '官方', icon: '校',
    official: true, types: 'board',
    desc: '学校与各学院正式发布的通知与活动。信息有机构背书，可作为行动依据。',
  },
  {
    id: BOARD.CONTEST, label: '竞赛训练营', short: '竞赛', icon: '赛',
    official: false, types: 'board',
    desc: '各类竞赛、训练营与赛事报名。注意截止时间与组队要求。',
  },
  {
    id: BOARD.LEARN, label: '学习资源', short: '资源', icon: '学',
    official: false, types: 'board',
    desc: '公开课、工作坊、资料合集等可以直接学习的内容。',
  },
  {
    id: BOARD.RECRUIT, label: '招募组队', short: '招募', icon: '招',
    official: false, types: 'board',
    desc: '团队招募、科研助理、项目组队。注意每周投入要求与门槛限制。',
  },
  {
    id: BOARD.CAMPUS, label: '校园活动', short: '活动', icon: '活',
    official: false, types: 'board',
    desc: '讲座、分享会、志愿服务、语言角等校内活动。',
  },
  {
    id: BOARD.STUDENT, label: '学生自发', short: '自发', icon: '生',
    official: false, types: 'board',
    desc: '同学个人发布的组局与分享。未经机构审核，已标注信息完整度与风险提示，请自行核实。',
  },
  {
    id: BOARD.TIMELINE, label: '时间线', short: '时间线', icon: '时',
    official: false, types: 'aggregate',
    desc: '按时间顺序排列的信息流，用于查看"什么时候发生什么"。',
  },
];

export const BOARD_MAP = Object.fromEntries(BOARDS.map((b) => [b.id, b]));

/** 每个板块在列表中优先展示哪些 kind（用于自动归板；也允许条目用 boards 字段手动指定） */
export const BOARD_KINDS = {
  [BOARD.OFFICIAL]: null,   // 官方板块按 source 判定，不按 kind
  [BOARD.CONTEST]: [KIND.CONTEST, KIND.PROGRAM],
  [BOARD.LEARN]: [KIND.ACTIVITY, KIND.RESOURCE],
  [BOARD.RECRUIT]: [KIND.RECRUIT],
  [BOARD.CAMPUS]: [KIND.ACTIVITY],
  [BOARD.STUDENT]: [KIND.MEETUP],
};

/* ============================================================
 * 置顶（Pin）
 *
 * 题目材料里存在"必须让所有人先看到"的信息，例如：
 *   · 训练营改了时间与地点（会导致白跑）
 *   · 招募的开发岗已满（会导致白投）
 * 因此置顶不是"运营手段"，而是**防止用户做出错误行动**的功能。
 *
 * level: 'featured' 主区域大置顶（全站最重要，最多 2 条）
 *        'board'    板块内置顶（进入该板块时置顶显示）
 *        'notice'   通知条式置顶（一行摘要，用于更新提醒）
 * until:  可选，到此时间后自动取消置顶（避免过期信息长期占据顶部）
 * ============================================================ */

export const PIN_LEVEL = {
  FEATURED: 'featured',
  BOARD: 'board',
  NOTICE: 'notice',
};

export const PIN_LABEL = {
  [PIN_LEVEL.FEATURED]: '全站置顶',
  [PIN_LEVEL.BOARD]: '板块置顶',
  [PIN_LEVEL.NOTICE]: '更新提醒',
};

/* ============================================================
 * AI 整合模块的数据定义
 *
 * 考核要求明确"仅实现效果即可，不用真的接入 AI"。
 * 因此这里存放的是**预先写好的整合结果**，由界面按需展示。
 *
 * 三条铁律（写在代码里，避免后续忘记）：
 *   1. 所有 AI 输出必须显式标注「AI 生成」，且标注不可被 CSS 隐藏
 *   2. 非主动点击不触发 —— AI 面板默认折叠，必须用户点击才展开
 *   3. AI 只做「整理与提示」，不代替用户判断；结论必须能追溯到原始信息
 *
 * 覆盖两类内容：
 *   · integration  官方信息变更整合（把主条目与补充通知合成一条时间线）
 *   · quality      信息质量解读（原详情页的原文对照与质量提示移到这里）
 * ============================================================ */

export const AI_KIND = {
  INTEGRATION: 'integration', // 官方信息变更整合
  QUALITY: 'quality',         // 信息质量解读
  AGENDA: 'agenda',           // 个人日程建议
};

/**
 * 官方信息变更整合
 *
 * 结构说明：
 *   itemId    关联的条目 id
 *   changes   变更点数组 [{ field, from, to, note }]
 *   effective 整合后的结论（一句话说清"现在到底该怎么做"）
 *   sources   结论来源的原始条目 id（保证可追溯，避免 AI 编造）
 *   caveats   仍需用户自行确认的点
 */
export const AI_INTEGRATIONS = [
  {
    id: 'ai-int-1',
    kind: AI_KIND.INTEGRATION,
    itemId: 'demo-1',
    title: '训练营时间地点变更整合',
    effective: '首次训练已改为 9 月 21 日（周一）19:30，地点改到实验楼 A402；报名截止时间不变，仍为 9 月 24 日 22:00。',
    changes: [
      { field: '首次训练时间', from: '9 月 20 日起每周六 19:00', to: '9 月 21 日 19:30', note: '因场地调整' },
      { field: '训练地点', from: '未注明', to: '实验楼 A402', note: '因场地调整' },
      { field: '报名截止', from: '9 月 24 日 22:00', to: '9 月 24 日 22:00', note: '未变更' },
    ],
    caveats: ['后续每周是否固定为周一，原信息未说明，建议向主办方确认', '「已报名同学无需重复提交」仅适用于此前已报名者'],
    sources: ['demo-1'],
    confidence: 'high',
  },
  {
    id: 'ai-int-2',
    kind: AI_KIND.INTEGRATION,
    itemId: 'demo-3',
    title: '竞赛登记录入时间提醒',
    effective: '校内意向登记截止 9 月 21 日 18:00，不足 48 小时。注意：意向登记不等于提交作品，作品提交另有截止时间。',
    changes: [
      { field: '意向登记截止', from: '9 月 21 日 18:00', to: '9 月 21 日 18:00', note: '未变更，但时间紧迫' },
    ],
    caveats: ['题目材料未提供作品提交的具体截止时间', '组队人数要求 2—4 人，需自行凑齐'],
    sources: ['demo-3'],
    confidence: 'medium',
  },
];

/**
 * 信息质量解读
 *
 * 由原「详情页内嵌的质量提示与原文对照」迁移而来。
 * 内容全部是对原始信息的**客观摘录与提示**，不做真假判断。
 */
export const AI_QUALITY = [
  {
    id: 'ai-q-1',
    kind: AI_KIND.QUALITY,
    itemId: 'demo-2',
    title: '这条学生自发信息需要注意什么',
    summary: '该信息由学生个人发布，缺少地点与面向对象，且要求通过平台外的私人方式联系。',
    points: [
      { level: 'danger', text: '要求添加私人微信：一旦离开平台沟通，出现问题将无法追溯' },
      { level: 'warn', text: '未提供地点：线下活动无地点，出发前必须确认' },
      { level: 'info', text: '费用标注为 AA，但未说明具体金额，建议提前问清' },
    ],
    advice: '建议先在留言区提问确认地点与费用，再决定是否参加。',
    sources: ['demo-2'],
    confidence: 'high',
  },
  {
    id: 'ai-q-2',
    kind: AI_KIND.QUALITY,
    itemId: 'demo-4',
    title: '资料有效期的处理建议',
    summary: '该资料长期开放，但当前网盘提取信息有明确有效期。',
    points: [
      { level: 'warn', text: '提取信息有效至 9 月 22 日，过期后需等待统一更新' },
      { level: 'info', text: '建议在有效期内先保存到自己的网盘，避免失效后等待' },
    ],
    advice: '建议今天就先转存，不要等到截止前一天。',
    sources: ['demo-4'],
    confidence: 'high',
  },
];

/** AI 整合与解读的统一入口（界面按条目 id 取用） */
export const AI_ENTRIES = [...AI_INTEGRATIONS, ...AI_QUALITY];

/** AI 模块是否启用（正式数据接入后可按需关闭） */
export const USE_AI_MODULE = true;

/** AI 标注文案：集中定义，保证任何位置都带标注 */
export const AI_DISCLAIMER = 'AI 生成 · 仅供参考';
export const AI_DISCLAIMER_LONG = '以下内容由 AI 依据题目材料自动整理生成，可能存在偏差，请以原始信息为准。';

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
 *   —— 以下为「标签制 + 分板块 + 置顶」新增字段 ——
 *   tags       主题标签数组，如 ['程序设计','零基础','每周固定']，用于标签筛选与展示
 *   boards     手动指定所属板块数组；不填则依据 source / kind 自动归板
 *   pin        { level, reason, until } 置顶信息；level 见 PIN_LEVEL
 *              reason 必填：说明"为什么置顶"（置顶必须有理由，不做运营性置顶）
 *              until  可选：过期时间，到期自动取消置顶
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
 *
 * 覆盖以下场景，确保架构每个分支都被验证到：
 *   ① 官方发布 + 全站置顶 + 更新提醒（模拟"改时间改地点"）
 *   ② 学生自发 + 风险信号 + 板块置顶
 *   ③ 不同板块分布（竞赛 / 资源 / 招募 / 活动 / 学生自发）
 */
export const DEMO_ITEMS = [
  {
    // 主条目：保存**变更前**的原值（原计划 9/20 起每周六、地点未注明）。
    // 生效值由补充通知 demo-1b 覆盖 —— 这样关联面板才能展示"改了什么"。
    id: 'demo-1',
    title: '【示例】零基础编程训练营',
    kind: KIND.PROGRAM,
    source: SOURCE.SCHOOL,
    org: '校级',
    raw: '示例数据（原始通知）：9 月 24 日 22:00 报名截止；原计划 9 月 20 日起每周六 19:00 训练；面向全校学生；零基础可参加。',
    deadline: '2026-09-24T22:00',
    startAt: '2026-09-20T19:00',
    endAt: null,
    place: null,
    audience: '全校学生',
    capacity: null,
    cost: null,
    weeklyHours: null,
    recurring: '每周六 19:00',
    rolling: false,
    notes: '零基础可参加',
    tags: ['程序设计', '零基础', '每周固定'],
    boards: [BOARD.OFFICIAL, BOARD.CONTEST],
    seriesId: 'demo-lanqiao',
    pin: {
      level: PIN_LEVEL.FEATURED,
      reason: '首次训练时间与地点已变更，按原通知前往会跑错场地',
    },
  },
  {
    id: 'demo-2',
    title: '【示例】学生自发周末约球（用于验证风险提示）',
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
    tags: ['体育运动', '费用AA', '场地待定'],
    boards: [BOARD.STUDENT],
    pin: {
      level: PIN_LEVEL.BOARD,
      reason: '该板块当前唯一信息，且场地尚未确认，需要同学注意',
    },
  },
  {
    id: 'demo-3',
    title: '【示例】学科竞赛校内选拔（用于验证竞赛板块）',
    kind: KIND.CONTEST,
    source: SOURCE.SCHOOL,
    org: '校级',
    raw: '示例数据：2—4 人组队，9 月 21 日 18:00 前完成校内意向登记。',
    deadline: '2026-09-21T18:00',
    startAt: null,
    endAt: null,
    place: null,
    audience: null,
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '2—4 人组队；意向登记不等同于最终作品提交',
    tags: ['竞赛', '需要组队', '即将截止'],
    boards: [BOARD.OFFICIAL, BOARD.CONTEST],
    pin: {
      level: PIN_LEVEL.NOTICE,
      reason: '报名截止不足 48 小时',
    },
  },
  {
    id: 'demo-4',
    title: '【示例】Python 学习资料合集（用于验证资源板块与有效期提示）',
    kind: KIND.RESOURCE,
    source: SOURCE.STUDENT,
    org: '学生个人发布',
    raw: '示例数据：资料长期开放，当前网盘提取信息有效至 9 月 22 日。',
    deadline: null,
    startAt: null,
    endAt: null,
    place: null,
    audience: null,
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: true,
    notes: '长期开放；提取信息有有效期',
    linkExpiresAt: '2026-09-22T23:59',
    tags: ['编程', '自学资料', '长期有效'],
    boards: [BOARD.LEARN],
  },
  {
    id: 'demo-5',
    title: '【示例】科研助理招募（用于验证招募板块与每周投入）',
    kind: KIND.RECRUIT,
    source: SOURCE.COLLEGE,
    org: '计算机学院',
    raw: '示例数据：协助数据整理与实验工作，仅限大二及以上，每周预计投入 6 小时。',
    deadline: '2026-09-21T23:59',
    startAt: null,
    endAt: null,
    place: null,
    audience: '大二及以上学生',
    capacity: null,
    cost: null,
    weeklyHours: 6,
    rolling: false,
    notes: '仅限大二及以上',
    tags: ['科研', '有门槛', '时间投入高'],
    boards: [BOARD.OFFICIAL, BOARD.RECRUIT],
  },

  /* ---- 以下两条用于验证「帖子关联系统」---- */

  {
    // 补充通知：与 demo-1 同属一个系列，并更新了它的时间与地点
    id: 'demo-1b',
    title: '【示例】零基础编程训练营 补充通知',
    kind: KIND.PROGRAM,
    source: SOURCE.SCHOOL,
    org: '校级',
    raw: '示例数据：因场地调整，首次训练改为 9 月 21 日 19:30，地点改至实验楼 A402；已报名同学无需重复提交；报名截止时间不变。',
    deadline: null,
    startAt: '2026-09-21T19:30',
    endAt: null,
    place: '实验楼 A402',
    audience: null,
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '因场地调整；已报名同学无需重复提交；报名截止时间不变',
    tags: ['程序设计', '补充通知'],
    boards: [BOARD.OFFICIAL, BOARD.CONTEST],
    seriesId: 'demo-lanqiao',
    isSupplement: true,
    supplementOf: 'demo-1',
  },

  {
    // 重发版：标题与 demo-3 等价（去掉括号备注后相同），正文已变更
    id: 'demo-3b',
    title: '【示例】学科竞赛校内选拔（最新）',
    kind: KIND.CONTEST,
    source: SOURCE.SCHOOL,
    org: '校级',
    raw: '示例数据（更新版）：报名截止延长至 9 月 23 日 18:00，组队人数调整为 3—5 人，其余不变。',
    deadline: '2026-09-23T18:00',
    startAt: null,
    endAt: null,
    place: null,
    audience: null,
    capacity: 5,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '报名截止延长至 9 月 23 日 18:00；组队人数调整为 3—5 人',
    tags: ['竞赛', '需要组队'],
    boards: [BOARD.OFFICIAL, BOARD.CONTEST],
    repostOf: 'demo-3',
  },
];
