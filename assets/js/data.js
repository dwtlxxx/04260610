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
    id: BOARD.ALL, label: '全部内容', short: '全部', icon: '◎',
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
    itemId: 1,
    title: '训练营时间地点变更整合',
    effective: '首次训练已改为 9 月 21 日 19:30，地点改到实验楼 A402；报名截止时间不变，仍为 9 月 24 日 22:00。',
    changes: [
      { field: '首次训练时间', from: '9 月 20 日起每周六 19:00', to: '9 月 21 日 19:30', note: '因场地调整' },
      { field: '训练地点', from: '未注明', to: '实验楼 A402', note: '因场地调整' },
      { field: '报名截止', from: '9 月 24 日 22:00', to: '9 月 24 日 22:00', note: '未变更' },
    ],
    caveats: [
      '后续每周是否仍固定为周六，原信息未说明，建议向主办方确认',
      '「已报名同学无需重复提交」仅适用于此前已报名者',
    ],
    sources: ['1'],
    sourceIds: [1, 9],
    confidence: 'high',
  },
  {
    id: 'ai-int-2',
    kind: AI_KIND.INTEGRATION,
    itemId: 3,
    title: '创新创业团队的岗位名额整合',
    effective: '该团队开发方向名额已满，目前主要补充设计、材料方向成员；报名截止仍为 9 月 22 日 18:00。',
    changes: [
      { field: '开发方向名额', from: '招募中', to: '已满', note: '补充说明中明确' },
      { field: '补充方向', from: '开发 / 设计 / 材料', to: '设计 / 材料', note: '补充说明中明确' },
      { field: '报名截止', from: '9 月 22 日 18:00', to: '9 月 22 日 18:00', note: '未变更' },
    ],
    caveats: ['此前已投递者无需重复提交，请勿重复投递'],
    sources: ['3'],
    sourceIds: [3, 20],
    confidence: 'high',
  },
  {
    id: 'ai-int-3',
    kind: AI_KIND.INTEGRATION,
    itemId: 7,
    title: '意向登记与作品提交是两件事',
    effective: '校内意向登记截止 9 月 21 日 18:00；作品提交截止 10 月 20 日。登记只是意向，不等于完成参赛。',
    changes: [
      { field: '意向登记截止', from: '9 月 21 日 18:00', to: '9 月 21 日 18:00', note: '未变更，但时间紧迫' },
      { field: '作品提交截止', from: '10 月 20 日', to: '10 月 20 日', note: '两个阶段容易混淆' },
    ],
    caveats: ['题目材料未提供作品提交的具体时间点（仅给出日期）', '组队人数要求 2—4 人，需自行凑齐'],
    sources: ['7'],
    sourceIds: [7],
    confidence: 'medium',
  },
];

/**
 * 信息质量解读
 *
 * 由原「详情页内嵌的质量提示与原文对照」迁移而来。
 * 内容是对原始信息的解读与建议，因此按要求只出现在 AI 模块中，
 * 详情页顶部只保留对原文的客观陈述。
 */
export const AI_QUALITY = [
  {
    id: 'ai-q-1',
    kind: AI_KIND.QUALITY,
    itemId: 24,
    title: '这条学生自发信息需要注意什么',
    summary: '该信息由学生个人发布，未提供主办方、地点与完整内容，并要求通过平台外的私人方式联系。',
    points: [
      { level: 'danger', text: '要求添加私人微信：一旦离开平台沟通，出现问题将无法追溯' },
      { level: 'warn', text: '未提供主办方与地点：无法核实由谁组织、在哪里发生' },
      { level: 'info', text: '「零门槛、日结」这类表述常见于兼职推广，建议先核实再接触' },
    ],
    advice: '建议暂不添加对方私人联系方式；确需了解时，请先向同学或辅导员核实。',
    sources: ['24'],
    confidence: 'medium',
  },
  {
    id: 'ai-q-2',
    kind: AI_KIND.QUALITY,
    itemId: 25,
    title: '标题与正文内容不一致',
    summary: '标题写「技术交流」，正文主要内容为商家优惠与购买链接。',
    points: [
      { level: 'warn', text: '标题与正文主题不符，实际内容以商家推广为主' },
      { level: 'warn', text: '正文含购买链接，与校园活动的关联性较弱' },
      { level: 'info', text: '未注明活动时间与地点，无法作为线下活动参加' },
    ],
    advice: '如目的是参加技术交流，建议忽略该条；如确需购买商品，请自行判断风险。',
    sources: ['25'],
    confidence: 'high',
  },
  {
    id: 'ai-q-3',
    kind: AI_KIND.QUALITY,
    itemId: 6,
    title: '满员即止、报名时间未注明',
    summary: '该学习小组限 30 人，原文未给出报名时间，仅说明满员即止。',
    points: [
      { level: 'warn', text: '没有固定截止时间，越晚联系越可能已满' },
      { level: 'info', text: '首次活动为 9 月 23 日 19:30，之后每周三共 6 周' },
    ],
    advice: '如有意向，建议尽早联系主办方确认是否还有名额。',
    sources: ['6', '9'],
    confidence: 'medium',
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
export const ITEMS = [
  {
    id: 1,
    title: '「蓝桥杯」程序设计校内训练营',
    kind: KIND.PROGRAM,
    source: SOURCE.SCHOOL,
    org: '校级',
    raw: '9月24日22:00报名截止；原计划9月20日起每周六19:00训练；面向全校学生；零基础可参加',
    deadline: '2026-09-24T22:00',
    startAt: null,          // 首次训练时间见 09 补充通知
    endAt: null,
    place: null,            // 已被 09 更新为 实验楼A402
    audience: '全校学生',
    capacity: null,
    cost: null,
    weeklyHours: null,
    recurring: '每周六 19:00 训练',
    rolling: false,
    notes: '零基础可参加',
    seriesId: 'lanqiao-training',
    supersededBy: 9,
    tags: ['程序设计', '零基础', '每周固定', '蓝桥杯'],
    boards: [BOARD.OFFICIAL, BOARD.CONTEST],
    pin: {
      level: PIN_LEVEL.FEATURED,
      reason: '首次训练时间与地点已被补充通知修改，按原通知前往会跑错场地',
    },
  },
  {
    id: 2,
    title: 'AI 应用入门公开课',
    kind: KIND.ACTIVITY,
    source: SOURCE.COLLEGE,
    org: '计算机学院',
    raw: '9月19日19:00；计算机学院教学楼；面向全校学生；无需报名；预计90分钟',
    deadline: null,
    startAt: '2026-09-19T19:00',
    endAt: null,
    place: '计算机学院教学楼',
    audience: '全校学生',
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '无需报名；预计 90 分钟',
    tags: ['AI', '公开课', '无需报名'],
    boards: [BOARD.OFFICIAL, BOARD.LEARN],
  },
  {
    id: 3,
    title: '大学生创新创业项目团队招募',
    kind: KIND.RECRUIT,
    source: SOURCE.SCHOOL,
    org: '校级',
    raw: '招募开发、设计、材料成员；每周需稳定投入4小时以上；9月22日18:00截止；需提交简短自我介绍',
    deadline: '2026-09-22T18:00',
    startAt: null,
    endAt: null,
    place: null,
    audience: null,
    capacity: null,
    cost: null,
    weeklyHours: 4,
    rolling: false,
    notes: '需提交简短自我介绍',
    seriesId: 'innovation-team',
    supersededBy: 20,
    tags: ['创新创业', '需要组队', '有投入要求'],
    boards: [BOARD.OFFICIAL, BOARD.RECRUIT],
  },
  {
    id: 4,
    title: '数学建模竞赛经验分享会',
    kind: KIND.ACTIVITY,
    source: SOURCE.SCHOOL,
    org: '校级',
    raw: '直播时间为9月18日19:30；不限专业；直播已结束，活动方预计9月20日上传回放',
    deadline: null,
    startAt: '2026-09-18T19:30',
    endAt: null,
    place: null,
    audience: '不限专业',
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '直播已结束，活动方预计 9 月 20 日上传回放',
    replayExpectedAt: '2026-09-20',
    tags: ['数学建模', '竞赛经验', '有回放'],
    boards: [BOARD.OFFICIAL, BOARD.CONTEST],
  },
  {
    id: 5,
    title: '校园公益志愿服务活动',
    kind: KIND.ACTIVITY,
    source: SOURCE.SCHOOL,
    org: '校级',
    raw: '活动时间9月27日8:30—17:00；9月20日12:00报名截止；预计服务8小时；需提前到场签到',
    deadline: '2026-09-20T12:00',
    startAt: '2026-09-27T08:30',
    endAt: '2026-09-27T17:00',
    place: null,
    audience: null,
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '需提前到场签到；预计服务 8 小时',
    tags: ['志愿服务', '公益', '有服务时长'],
    boards: [BOARD.OFFICIAL, BOARD.CAMPUS],
  },
  {
    id: 6,
    title: 'Web 开发零基础学习小组',
    kind: KIND.PROGRAM,
    source: SOURCE.SCHOOL,
    org: '校级',
    raw: '9月23日起每周三19:30开展，共6周；面向零基础学生；限30人；报名时间未注明，满员即止',
    deadline: null,
    startAt: '2026-09-23T19:30',
    endAt: null,
    place: null,
    audience: '零基础学生',
    capacity: 30,
    cost: null,
    weeklyHours: null,
    recurring: '每周三 19:30，共 6 周',
    rolling: true,
    notes: '报名时间未注明，满员即止',
    tags: ['Web开发', '零基础', '限人数', '每周固定'],
    boards: [BOARD.OFFICIAL, BOARD.LEARN],
    pin: {
      level: PIN_LEVEL.NOTICE,
      reason: '报名时间未注明、满员即止，需要尽早联系确认',
    },
  },
  {
    id: 7,
    title: 'AI 创新应用挑战赛',
    kind: KIND.CONTEST,
    source: SOURCE.SCHOOL,
    org: '校级',
    raw: '2—4人组队；9月21日18:00前完成校内意向登记；10月20日提交作品；意向登记不等同于最终作品提交',
    deadline: '2026-09-21T18:00',
    startAt: null,
    endAt: null,
    place: null,
    audience: null,
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '2—4 人组队；意向登记不等同于最终作品提交，作品提交截止 10 月 20 日',
    secondDeadline: '2026-10-20',
    tags: ['AI', '竞赛', '需要组队', '两阶段提交'],
    boards: [BOARD.OFFICIAL, BOARD.CONTEST],
    pin: {
      level: PIN_LEVEL.NOTICE,
      reason: '校内意向登记即将截止，且登记与作品提交是两个不同阶段',
    },
  },
  {
    id: 8,
    title: '校园软件项目组招募',
    kind: KIND.RECRUIT,
    source: SOURCE.SCHOOL,
    org: '校级',
    raw: '开发校园实用工具；面向大一、大二学生；希望成员了解Git基本操作；每周预计投入5小时；长期招募，满员即止',
    deadline: null,
    startAt: null,
    endAt: null,
    place: null,
    audience: '大一、大二学生',
    capacity: null,
    cost: null,
    weeklyHours: 5,
    rolling: true,
    notes: '希望成员了解 Git 基本操作',
    tags: ['校园工具', '需要Git', '长期招募'],
    boards: [BOARD.OFFICIAL, BOARD.RECRUIT],
  },
  {
    id: 9,
    title: '程序设计训练营补充通知',
    kind: KIND.PROGRAM,
    source: SOURCE.SCHOOL,
    org: '校级',
    raw: '因场地调整，首次训练改为9月21日19:30，地点改至实验楼A402；已报名同学无需重复提交；报名截止时间不变',
    deadline: null,
    startAt: '2026-09-21T19:30',
    endAt: null,
    place: '实验楼 A402',
    audience: null,
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '因场地调整；已报名同学无需重复提交；报名截止时间不变（仍为 9 月 24 日 22:00）',
    seriesId: 'lanqiao-training',
    isSupplement: true,
    supplementOf: 1,
    tags: ['程序设计', '补充通知', '地点变更'],
    boards: [BOARD.OFFICIAL, BOARD.CONTEST],
  },
  {
    id: 10,
    title: '前端开发经验交流会',
    kind: KIND.ACTIVITY,
    source: SOURCE.COLLEGE,
    org: '计算机学院',
    raw: '9月19日15:00—16:30；线下A201并同步线上直播；无需报名',
    deadline: null,
    startAt: '2026-09-19T15:00',
    endAt: '2026-09-19T16:30',
    place: 'A201（同步线上直播）',
    audience: null,
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '无需报名；线下 + 线上直播',
    tags: ['前端', '经验交流', '线上同步'],
    boards: [BOARD.OFFICIAL, BOARD.LEARN],
  },
  {
    id: 11,
    title: '大学生科研入门分享会',
    kind: KIND.ACTIVITY,
    source: SOURCE.SCHOOL,
    org: '校级',
    raw: '9月21日19:00—20:30；介绍论文检索、学生科研项目和导师联系方法；面向全校学生',
    deadline: null,
    startAt: '2026-09-21T19:00',
    endAt: '2026-09-21T20:30',
    place: null,
    audience: '全校学生',
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '内容：论文检索、学生科研项目、导师联系方法',
    tags: ['科研入门', '论文检索', '导师联系'],
    boards: [BOARD.OFFICIAL, BOARD.LEARN],
  },
  {
    id: 12,
    title: '全国高校计算机能力挑战赛',
    kind: KIND.CONTEST,
    source: SOURCE.SCHOOL,
    org: '校级',
    raw: '面向本科生；10月5日23:59报名截止；个人参赛；具体费用信息未提供',
    deadline: '2026-10-05T23:59',
    startAt: null,
    endAt: null,
    place: null,
    audience: '本科生',
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '个人参赛；具体费用信息未提供',
    tags: ['竞赛', '个人参赛', '费用未知'],
    boards: [BOARD.OFFICIAL, BOARD.CONTEST],
  },
  {
    id: 13,
    title: '科研助理招募',
    kind: KIND.RECRUIT,
    source: SOURCE.COLLEGE,
    org: '计算机学院',
    raw: '协助数据整理和实验工作；仅限大二及以上学生；每周预计投入6小时；9月21日截止报名',
    deadline: '2026-09-21T23:59',
    startAt: null,
    endAt: null,
    place: null,
    audience: '大二及以上学生',
    capacity: null,
    cost: null,
    weeklyHours: 6,
    rolling: false,
    notes: '仅限大二及以上；工作内容：数据整理与实验协助',
    deadlineNote: '题目仅给出日期「9 月 21 日截止」，未注明具体时刻',
    tags: ['科研', '有门槛', '时间投入高'],
    boards: [BOARD.OFFICIAL, BOARD.RECRUIT],
    pin: {
      level: PIN_LEVEL.NOTICE,
      reason: '报名截止临近，且仅限大二及以上，不符合条件者不必准备',
    },
  },
  {
    id: 14,
    title: 'Git 与 GitHub 零基础工作坊',
    kind: KIND.ACTIVITY,
    source: SOURCE.SCHOOL,
    org: '校级',
    raw: '9月21日19:00—20:30；主要面向大一新生；限40人；需提前预约，提交报名表不代表最终录取，以审核通知为准',
    deadline: null,
    startAt: '2026-09-21T19:00',
    endAt: '2026-09-21T20:30',
    place: null,
    audience: '主要面向大一新生',
    capacity: 40,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '需提前预约；提交报名表不代表最终录取，以审核通知为准',
    tags: ['Git', '零基础', '限人数', '需审核'],
    boards: [BOARD.OFFICIAL, BOARD.LEARN],
    pin: {
      level: PIN_LEVEL.NOTICE,
      reason: '需提前预约，且提交报名表不代表最终录取',
    },
  },
  {
    id: 15,
    title: 'AI 应用创意挑战',
    kind: KIND.CONTEST,
    source: SOURCE.SCHOOL,
    org: '校级',
    raw: '9月23日23:59前提交创意方案；9月30日前提交最终作品；允许个人或团队参加；进入展示环节后可再组队',
    deadline: '2026-09-23T23:59',
    startAt: null,
    endAt: null,
    place: null,
    audience: null,
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '允许个人或团队；进入展示环节后可再组队；最终作品提交截止 9 月 30 日',
    secondDeadline: '2026-09-30',
    tags: ['AI', '创意', '两阶段提交', '可组队'],
    boards: [BOARD.OFFICIAL, BOARD.CONTEST],
  },
  {
    id: 16,
    title: '校园摄影志愿者招募',
    kind: KIND.RECRUIT,
    source: SOURCE.STUDENT,
    org: '学生个人发布',
    raw: '长期招募；参与校内大型活动摄影；具体报名截止时间未注明；有摄影设备者优先但不作硬性要求',
    deadline: null,
    startAt: null,
    endAt: null,
    place: null,
    audience: null,
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: true,
    notes: '有摄影设备者优先，但不作硬性要求；具体报名截止时间未注明',
    tags: ['摄影', '志愿', '长期招募', '设备优先'],
    boards: [BOARD.STUDENT, BOARD.RECRUIT],
  },
  {
    id: 17,
    title: 'Python 程序设计学习资料合集',
    kind: KIND.RESOURCE,
    source: SOURCE.STUDENT,
    org: '学生个人发布',
    raw: '包含课程、练习和项目案例；资料长期开放；当前网盘提取信息有效至9月22日，后续将统一更新',
    deadline: null,
    startAt: null,
    endAt: null,
    place: null,
    audience: null,
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: true,
    notes: '资料长期开放；当前网盘提取信息有效至 9 月 22 日，后续将统一更新',
    linkExpiresAt: '2026-09-22T23:59',
    tags: ['Python', '自学资料', '提取有期限'],
    boards: [BOARD.STUDENT, BOARD.LEARN],
  },
  {
    id: 18,
    title: '网络安全兴趣交流小组',
    kind: KIND.PROGRAM,
    source: SOURCE.STUDENT,
    org: '学生个人发布',
    raw: '首次交流时间为9月19日19:30；之后每两周开展一次；面向CTF、Web安全等方向感兴趣的学生；不限基础',
    deadline: null,
    startAt: '2026-09-19T19:30',
    endAt: null,
    place: null,
    audience: '对 CTF、Web 安全感兴趣的学生',
    capacity: null,
    cost: null,
    weeklyHours: null,
    recurring: '每两周一次',
    rolling: true,
    notes: '不限基础',
    tags: ['网络安全', 'CTF', '不限基础', '每两周'],
    boards: [BOARD.STUDENT, BOARD.LEARN],
  },
  {
    id: 19,
    title: '学生创新项目路演观摩',
    kind: KIND.ACTIVITY,
    source: SOURCE.COLLEGE,
    org: '院级',
    raw: '活动时间9月20日14:30；原报名截止时间为9月18日22:00；活动方说明如现场仍有余位，可接受候补入场',
    deadline: '2026-09-18T22:00',
    startAt: '2026-09-20T14:30',
    endAt: null,
    place: null,
    audience: null,
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '原报名已于 9 月 18 日 22:00 截止；现场仍有余位时可接受候补入场',
    allowStandby: true,
    tags: ['项目路演', '可候补'],
    boards: [BOARD.OFFICIAL, BOARD.CAMPUS],
  },
  {
    id: 20,
    title: '创新创业项目团队补充说明',
    kind: KIND.RECRUIT,
    source: SOURCE.SCHOOL,
    org: '校级',
    raw: '开发方向名额已满，现主要补充设计与材料成员；9月22日18:00截止；此前已投递者无需重复提交',
    deadline: '2026-09-22T18:00',
    startAt: null,
    endAt: null,
    place: null,
    audience: null,
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '开发方向名额已满，现主要补充「设计」「材料」成员；此前已投递者无需重复提交',
    closedRoles: ['开发'],
    openRoles: ['设计', '材料'],
    seriesId: 'innovation-team',
    isSupplement: true,
    supplementOf: 3,
    tags: ['创新创业', '补充说明', '岗位已满'],
    boards: [BOARD.OFFICIAL, BOARD.RECRUIT],
    pin: {
      level: PIN_LEVEL.FEATURED,
      reason: '开发方向名额已满，仍在投递开发岗的同学需要及时调整',
    },
  },
  {
    id: 21,
    title: '计算机学院 AI 产品设计分享会',
    kind: KIND.ACTIVITY,
    source: SOURCE.COLLEGE,
    org: '计算机学院',
    raw: '计算机学院发布；9月20日19:00；明德楼B203；面向全校学生；无需报名，座位有限',
    deadline: null,
    startAt: '2026-09-20T19:00',
    endAt: null,
    place: '明德楼 B203',
    audience: '全校学生',
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '无需报名，座位有限',
    tags: ['AI', '产品设计', '无需报名'],
    boards: [BOARD.OFFICIAL, BOARD.CAMPUS],
  },
  {
    id: 22,
    title: '学生发起｜周末羽毛球约球',
    kind: KIND.MEETUP,
    source: SOURCE.STUDENT,
    org: '学生个人发布',
    raw: '学生个人发布；9月20日16:00；计划6—8人；费用AA；场地待最终确认',
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
    tags: ['体育运动', '费用AA', '场地待定'],
    boards: [BOARD.STUDENT, BOARD.CAMPUS],
  },
  {
    id: 23,
    title: '学生发起｜AI 工具交流搭子招募',
    kind: KIND.MEETUP,
    source: SOURCE.STUDENT,
    org: '学生个人发布',
    raw: '学生个人发布；拟于9月21日晚开展；欢迎零基础；报名后拉群；具体地点未确定',
    deadline: null,
    startAt: '2026-09-21T19:00',
    endAt: null,
    place: null,
    placeStatus: '未确定',
    audience: null,
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '欢迎零基础；报名后拉群；具体地点未确定',
    startAtApprox: true,   // 原文为「晚间」，具体时刻未注明
    tags: ['AI', '搭子', '零基础', '地点未定'],
    boards: [BOARD.STUDENT, BOARD.CAMPUS],
  },
  {
    id: 24,
    title: '学生发起｜「校园兼职福利分享」',
    kind: KIND.MEETUP,
    source: SOURCE.STUDENT,
    org: '学生个人发布',
    raw: '学生个人发布；称“零门槛、日结”，要求添加私人微信获取详情；未提供主办方、地点和完整内容',
    deadline: null,
    startAt: null,
    endAt: null,
    place: null,
    placeStatus: '未提供',
    audience: null,
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '未提供主办方、地点与完整内容',
    requiresPrivateContact: true,   // 触发风险规则：要求加私人微信
    contentSignals: ['零门槛', '日结', '添加私人微信'],
    tags: ['兼职', '需谨慎'],
    boards: [BOARD.STUDENT, BOARD.CAMPUS],
  },
  {
    id: 25,
    title: '学生发起｜数码新品体验交流',
    kind: KIND.MEETUP,
    source: SOURCE.STUDENT,
    org: '学生个人发布',
    raw: '学生个人发布；标题为技术交流，正文主要介绍某商家优惠及购买链接；活动时间、地点未注明',
    deadline: null,
    startAt: null,
    endAt: null,
    place: null,
    placeStatus: '未注明',
    audience: null,
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '标题为技术交流，正文主要介绍商家优惠及购买链接；时间、地点未注明',
    titleBodyMismatch: true,        // 触发风险规则：标题与正文不符
    hasPromoLink: true,             // 触发风险规则：含购买链接
    contentSignals: ['商家优惠', '购买链接'],
    tags: ['数码', '主题不符', '含推广'],
    boards: [BOARD.STUDENT, BOARD.CAMPUS],
  },
  {
    id: 26,
    title: '外国语学院校园语言角',
    kind: KIND.ACTIVITY,
    source: SOURCE.COLLEGE,
    org: '外国语学院',
    raw: '外国语学院发布；9月21日15:00；面向全校学生；自由交流；场地容量有限，无需提前报名',
    deadline: null,
    startAt: '2026-09-21T15:00',
    endAt: null,
    place: null,
    audience: '全校学生',
    capacity: null,
    cost: null,
    weeklyHours: null,
    rolling: false,
    notes: '自由交流；场地容量有限；无需提前报名',
    tags: ['语言角', '自由交流', '容量有限'],
    boards: [BOARD.OFFICIAL, BOARD.CAMPUS],
  },
];;

/** 数据源元信息，供界面显示 */
export const DATASET_META = {
  name: '2026 年秋季校园活动与机会（模拟数据）',
  referenceDate: TODAY,
  expectedCount: 26,
  loaded: ITEMS.length,
};

/**
 * 开发用示例数据（当前为空）。
 *
 * 说明：题目给定的 26 条信息已完整填入上方 ITEMS，因此不再需要演示数据。
 *       保留该导出是为了让 logic.js 的 getRawItems() 无需分支判断；
 *       若将来需要在"无正式数据"的情况下验证架构，可在此补回示例条目，
 *       并把 logic.js 的 USE_DEMO_DATA 改为 true。
 */
export const DEMO_ITEMS = [];
