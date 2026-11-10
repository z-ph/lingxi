import type { Bounds, RawUiNode } from '../../src/ui-tree/types.js';

/**
 * Representative screen hierarchies for the five-app token-budget check.
 *
 * These are authored fixtures that model the structure of the real apps'
 * Android accessibility trees (nested ViewGroups, labels on child TextViews,
 * long static text, CJK copy). They are NOT captures from a physical phone:
 * CI has no Android device, so the real-device measurement remains unverified
 * and is documented in docs/mcp-tools.md and the PR.
 */
export interface AppFixture {
  /** Android package name. */
  readonly app: string;
  /** Short human label used in reports. */
  readonly name: string;
  readonly locale: string;
  readonly screen: { readonly width: number; readonly height: number };
  readonly tree: RawUiNode;
}

type NodeTraits = Pick<
  RawUiNode,
  'id' | 'text' | 'description' | 'clickable' | 'editable' | 'visible'
>;

function rect(left: number, top: number, right: number, bottom: number): Bounds {
  return { left, top, right, bottom };
}

function node(bounds: Bounds, traits: NodeTraits = {}, children: RawUiNode[] = []): RawUiNode {
  return { bounds, ...traits, children };
}

function textNode(bounds: Bounds, text: string): RawUiNode {
  return { bounds, text };
}

/** Wraps children in `levels` anonymous ViewGroups, like a real layout tree. */
function wrapped(bounds: Bounds, children: RawUiNode[], levels = 2): RawUiNode {
  let current = node(bounds, {}, children);
  for (let level = 0; level < levels; level += 1) {
    current = node(bounds, {}, [current]);
  }
  return current;
}

function statusBar(width: number, time: string, network: string, battery: string): RawUiNode {
  return node(rect(0, 0, width, 80), {}, [
    textNode(rect(24, 20, 220, 64), time),
    node(rect(width - 280, 20, width - 24, 64), {}, [
      textNode(rect(width - 280, 20, width - 170, 64), network),
      textNode(rect(width - 150, 20, width - 24, 64), battery),
    ]),
  ]);
}

function topBar(
  width: number,
  title: string,
  actions: RawUiNode[],
): RawUiNode {
  return node(rect(0, 80, width, 260), {}, [
    node(rect(0, 80, width, 260), {}, [
      textNode(rect(180, 128, 760, 216), title),
      ...actions,
    ]),
  ]);
}

function iconButton(bounds: Bounds, description: string, id?: string): RawUiNode {
  return node(bounds, id ? { description, clickable: true, id } : { description, clickable: true });
}

function labelledButton(bounds: Bounds, label: string, id?: string): RawUiNode {
  return node(bounds, id ? { clickable: true, id } : { clickable: true }, [
    node(rect(bounds.left + 16, bounds.top + 8, bounds.right - 16, bounds.bottom - 8), {}, [
      textNode(rect(bounds.left + 16, bounds.top + 8, bounds.right - 16, bounds.bottom - 8), label),
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* com.android.settings                                                        */
/* -------------------------------------------------------------------------- */

function settingsFixture(): AppFixture {
  const width = 1080;
  const height = 2400;
  const rows: RawUiNode[] = [];
  let y = 280;

  const heading = (label: string): void => {
    rows.push(node(rect(0, y, width, y + 96), {}, [
      node(rect(48, y + 24, 900, y + 76), {}, [textNode(rect(48, y + 24, 900, y + 76), label)]),
    ]));
    y += 96;
  };

  const settingRow = (
    label: string,
    summary: string,
    extra: { id?: string; toggle?: boolean } = {},
  ): void => {
    const top = y;
    const children: RawUiNode[] = [
      node(rect(24, top + 24, width - 24, top + 128), {}, [
        node(rect(48, top + 24, 840, top + 88), {}, [
          textNode(rect(48, top + 28, 840, top + 76), label),
          textNode(rect(48, top + 80, 840, top + 124), summary),
        ]),
      ]),
    ];
    if (extra.toggle !== undefined) {
      children.push(
        node(
          rect(880, top + 48, 1000, top + 112),
          extra.toggle ? { clickable: true, description: '已开启' } : { clickable: true, description: '已关闭' },
        ),
      );
    }
    const traits: NodeTraits = extra.id
      ? { clickable: true, id: extra.id }
      : { clickable: true };
    rows.push(node(rect(0, top, width, top + 152), traits, children));
    y += 152;
  };

  heading('网络和互联网');
  settingRow('WLAN', '已连接到 Office-5G', { id: 'settings:wifi', toggle: true });
  settingRow('蓝牙', '已开启', { id: 'settings:bluetooth', toggle: true });
  settingRow('移动网络', '5G · 中国移动', { id: 'settings:mobile' });

  heading('已连接的设备');
  settingRow('投屏', '未连接', { id: 'settings:cast' });
  settingRow('飞行模式', '已关闭', { toggle: false });

  heading('应用');
  settingRow('应用', '42 个应用', { id: 'settings:apps' });
  settingRow('通知', '已允许 38 个应用', { id: 'settings:notifications' });
  settingRow('声音和振动', '铃声：默认', { id: 'settings:sound' });
  settingRow('显示', '浅色主题', { id: 'settings:display' });
  settingRow('电池', '82% · 约 6 小时 12 分', { id: 'settings:battery' });
  settingRow('存储', '已用 96 GB / 128 GB', { id: 'settings:storage' });

  heading('安全与隐私');
  settingRow('安全', '屏幕锁定：图案', { id: 'settings:security' });
  settingRow('隐私', '权限管理器', { id: 'settings:privacy' });
  settingRow('位置信息', '已开启', { id: 'settings:location', toggle: true });

  heading('系统');
  settingRow('账号', 'zhang@example.com', { id: 'settings:accounts' });
  settingRow('系统', 'Android 16', { id: 'settings:system' });
  settingRow('关于手机', 'Pixel 6a', { id: 'settings:about' });

  // The scroll container is a real node; its children are the rows above.
  const scroll = node(rect(0, 260, width, height), {}, rows);
  const tree = node(rect(0, 0, width, height), { visible: true }, [
    statusBar(width, '18:20', '5G', '82%'),
    topBar(width, '设置', [
      iconButton(rect(24, 120, 120, 216), '返回'),
      iconButton(rect(936, 120, 1056, 216), '搜索设置'),
    ]),
    scroll,
  ]);

  return {
    app: 'com.android.settings',
    name: 'Android 设置',
    locale: 'zh-CN',
    screen: { width, height },
    tree,
  };
}

/* -------------------------------------------------------------------------- */
/* com.android.chrome                                                          */
/* -------------------------------------------------------------------------- */

function chromeFixture(): AppFixture {
  const width = 1080;
  const height = 2400;

  const toolbar = node(rect(0, 80, width, 260), {}, [
    iconButton(rect(24, 120, 112, 216), '返回'),
    iconButton(rect(112, 120, 200, 216), '前进'),
    iconButton(rect(200, 120, 288, 216), '重新加载'),
    node(rect(300, 104, 860, 236), { editable: true, text: 'https://example.com/android/testing' }),
    iconButton(rect(864, 120, 952, 216), '标签页：3'),
    iconButton(rect(952, 120, 1056, 216), '更多选项'),
  ]);

  const paragraph =
    'Android accessibility exposes a hierarchy of windows, view groups and widgets. ' +
    'Every node carries bounds, flags such as clickable and editable, and optional text. ' +
    'The daemon prunes this hierarchy before it ever reaches the model, because raw dumps ' +
    'can easily exceed a hundred thousand tokens on a content-heavy screen.';

  const article: RawUiNode[] = [
    node(rect(48, 300, width - 48, 360), {}, [textNode(rect(48, 300, width - 48, 360), 'Android 上的界面自动化')]),
    node(rect(48, 384, width - 48, 560), {}, [textNode(rect(48, 384, width - 48, 560), paragraph)]),
    textNode(rect(48, 584, width - 48, 640), '更新于 2026-11-10 · 8 分钟阅读'),
    node(rect(48, 672, width - 48, 736), {}, [
      labelledButton(rect(48, 672, 280, 736), '分享'),
      labelledButton(rect(300, 672, 532, 736), '收藏'),
      labelledButton(rect(552, 672, 804, 736), '在页面中查找'),
    ]),
    node(rect(48, 768, width - 48, 820), {}, [textNode(rect(48, 768, width - 48, 820), '评论（6）')]),
  ];

  for (let index = 0; index < 6; index += 1) {
    const top = 840 + index * 190;
    article.push(
      node(rect(0, top, width, top + 170), {}, [
        node(rect(48, top + 8, 180, top + 92), {}, [
          textNode(rect(48, top + 8, 180, top + 92), `用户 ${index + 1}`),
        ]),
        node(rect(200, top + 8, width - 48, top + 104), {}, [
          textNode(
            rect(200, top + 8, width - 48, top + 104),
            index === 1 ? paragraph.slice(0, 220) : '这个裁剪思路很实用，尤其是把标签合并到可点击行上。',
          ),
        ]),
        node(rect(200, top + 112, width - 48, top + 160), {}, [
          node(rect(200, top + 120, 360, top + 160), { clickable: true }, [
            textNode(rect(208, top + 126, 352, top + 156), '回复'),
          ]),
          node(rect(380, top + 120, 540, top + 160), { clickable: true }, [
            textNode(rect(388, top + 126, 532, top + 156), '赞 12'),
          ]),
        ]),
      ]),
    );
  }

  article.push(
    node(rect(48, 1980, width - 48, 2050), {}, [
      node(rect(48, 1980, 420, 2050), { clickable: true }, [
        textNode(rect(56, 1988, 412, 2044), '加载更多评论'),
      ]),
    ]),
    node(rect(48, 2080, width - 48, 2140), {}, [
      textNode(rect(48, 2080, width - 48, 2140), '相关阅读：UIAutomator、无障碍服务、MCP 协议'),
    ]),
  );

  const tree = node(rect(0, 0, width, height), {}, [
    statusBar(width, '18:21', 'Wi-Fi', '81%'),
    toolbar,
    node(rect(0, 260, width, 2300), {}, [wrapped(rect(24, 280, width - 24, 1900), article, 2)]),
    node(rect(0, 2300, width, height), {}, [
      iconButton(rect(60, 2320, 160, 2400), '返回'),
      iconButton(rect(460, 2320, 560, 2400), '主屏幕'),
      iconButton(rect(900, 2320, 1000, 2400), '最近任务'),
    ]),
  ]);

  return {
    app: 'com.android.chrome',
    name: 'Chrome',
    locale: 'zh-CN',
    screen: { width, height },
    tree,
  };
}

/* -------------------------------------------------------------------------- */
/* com.tencent.mm (WeChat)                                                     */
/* -------------------------------------------------------------------------- */

function weChatFixture(): AppFixture {
  const width = 1080;
  const height = 2400;

  const chats: Array<{ name: string; preview: string; time: string; unread?: number; muted?: boolean }> = [
    { name: '产品讨论组', preview: '张鹏：M1 的 ui_tree 预算压到 3k token 以内了，默认只回可交互节点。', time: '18:20', unread: 3 },
    { name: '李文', preview: '好的，我下午把真机截图发你。', time: '18:12' },
    { name: '家人群', preview: '妈妈：晚饭回不回来吃？', time: '17:58', unread: 12 },
    { name: '王敏', preview: '文件已经发到邮箱了，注意查收。', time: '17:40' },
    { name: '羽毛球俱乐部', preview: '周六下午三点，老地方，报名接龙：1. 张鹏 2. 李雷 3. 韩梅梅 4. 王强 5. 陈晨 6. 刘洋', time: '17:02', unread: 48, muted: true },
    { name: '设计评审', preview: '新的设置页布局已经上传，有空看看。', time: '16:31' },
    { name: '快递员', preview: '您的包裹已放在丰巢柜，取件码 8821。', time: '15:44' },
    { name: '张三', preview: '[图片]', time: '14:20' },
    { name: '读书会', preview: '本周分享：《Designing Data-Intensive Applications》第九章。', time: '昨天', muted: true },
    { name: '物业通知', preview: '本周六上午停水检修，请提前储水。', time: '昨天' },
    { name: '陈晨', preview: '收到，谢谢！', time: '昨天' },
    { name: '公众号', preview: 'Android 16 开发者预览版发布，重点关注隐私沙盒与无障碍接口变化。', time: '周一' },
  ];

  const list: RawUiNode[] = [];
  chats.forEach((chat, index) => {
    const top = 280 + index * 200;
    const children: RawUiNode[] = [
      node(rect(24, top + 24, 176, top + 176), { description: chat.name }, [
        textNode(rect(60, top + 72, 140, top + 136), chat.name.slice(0, 1)),
      ]),
      node(rect(200, top + 28, 850, top + 92), {}, [textNode(rect(200, top + 28, 850, top + 92), chat.name)]),
      node(rect(200, top + 100, 880, top + 168), {}, [textNode(rect(200, top + 100, 880, top + 168), chat.preview)]),
      node(rect(900, top + 28, 1056, top + 80), {}, [textNode(rect(900, top + 28, 1056, top + 80), chat.time)]),
    ];
    if (chat.unread) {
      children.push(
        node(rect(970, top + 100, 1040, top + 164), {}, [textNode(rect(978, top + 108, 1032, top + 156), String(chat.unread))]),
      );
    }
    if (chat.muted) {
      children.push(node(rect(900, top + 100, 952, top + 156), { description: '消息免打扰' }));
    }
    list.push(node(rect(0, top, width, top + 200), { clickable: true }, children));
  });

  const tabs = node(rect(0, 2200, width, height), {}, [
    labelledButton(rect(0, 2200, 270, 2380), '微信'),
    labelledButton(rect(270, 2200, 540, 2380), '通讯录'),
    labelledButton(rect(540, 2200, 810, 2380), '发现'),
    labelledButton(rect(810, 2200, 1080, 2380), '我'),
  ]);

  const tree = node(rect(0, 0, width, height), {}, [
    statusBar(width, '18:22', '5G', '80%'),
    topBar(width, '微信', [
      iconButton(rect(840, 120, 936, 216), '搜索'),
      iconButton(rect(960, 120, 1056, 216), '更多'),
    ]),
    node(rect(0, 260, width, 2200), {}, [wrapped(rect(0, 260, width, 2200), list, 2)]),
    tabs,
  ]);

  return {
    app: 'com.tencent.mm',
    name: '微信',
    locale: 'zh-CN',
    screen: { width, height },
    tree,
  };
}

/* -------------------------------------------------------------------------- */
/* com.xingin.xhs (Xiaohongshu)                                                */
/* -------------------------------------------------------------------------- */

function xiaohongshuFixture(): AppFixture {
  const width = 1080;
  const height = 2400;

  const cards: Array<{ title: string; author: string; likes: string }> = [
    { title: '5 个让 Android 自动化更稳的小技巧', author: '自动化笔记', likes: '1.2万' },
    { title: '周末去了趟杭州，西湖边的人比想象中少', author: '旅行日记', likes: '8623' },
    { title: '一面墙的书架改造，成本不到 300 元', author: '住在木头上', likes: '4201' },
    { title: 'MCP 协议入门：把手机变成 Agent 的工具', author: '折腾小分队', likes: '2890' },
    { title: '一个人住，也要好好吃饭', author: '小厨房', likes: '1.8万' },
    { title: 'Pixel 6a 用了两年，拍照还够用吗？', author: '数码随手拍', likes: '976' },
    { title: '给爸妈装了这个 App 之后……', author: '慢慢来', likes: '5432' },
    { title: '雨天在家做手冲咖啡', author: '咖啡因过敏', likes: '733' },
    { title: '从零开始学做饭第 30 天', author: '新手厨房', likes: '1520' },
    { title: '北京秋天的 8 个散步路线', author: '城市漫游者', likes: '2.3万' },
  ];

  const feed: RawUiNode[] = [];
  cards.forEach((card, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const left = 24 + column * 528;
    const top = 300 + row * 380;
    const cardChildren: RawUiNode[] = [
      node(rect(left + 8, top + 8, left + 518, top + 240), {}, []),
      node(rect(left + 16, top + 248, left + 512, top + 304), {}, [
        textNode(rect(left + 16, top + 248, left + 512, top + 304), card.title),
      ]),
      node(rect(left + 16, top + 310, left + 400, top + 336), {}, [
        textNode(rect(left + 16, top + 310, left + 400, top + 336), card.author),
      ]),
      node(rect(left + 16, top + 340, left + 240, top + 360), {}, [
        node(rect(left + 16, top + 338, left + 80, top + 358), { clickable: true, description: `赞 ${card.likes}` }, [
          textNode(rect(left + 24, top + 338, left + 76, top + 358), '赞'),
        ]),
        textNode(rect(left + 88, top + 338, left + 240, top + 358), card.likes),
      ]),
    ];
    feed.push(node(rect(left, top, left + 520, top + 360), { clickable: true }, cardChildren));
  });

  const tree = node(rect(0, 0, width, height), {}, [
    statusBar(width, '18:23', 'Wi-Fi', '79%'),
    node(rect(0, 80, width, 260), {}, [
      node(rect(0, 80, width, 260), {}, [
        labelledButton(rect(48, 136, 200, 208), '关注'),
        labelledButton(rect(220, 136, 372, 208), '发现'),
        labelledButton(rect(392, 136, 544, 208), '附近'),
        iconButton(rect(936, 120, 1056, 216), '搜索'),
        iconButton(rect(816, 120, 936, 216), '消息'),
      ]),
    ]),
    node(rect(0, 260, width, 2200), {}, [wrapped(rect(0, 260, width, 2200), feed, 3)]),
    node(rect(0, 2200, width, height), {}, [
      labelledButton(rect(0, 2200, 216, 2400), '首页'),
      labelledButton(rect(216, 2200, 432, 2400), '购物'),
      labelledButton(rect(432, 2200, 648, 2400), '发布'),
      labelledButton(rect(648, 2200, 864, 2400), '消息'),
      labelledButton(rect(864, 2200, width, 2400), '我'),
    ]),
  ]);

  return {
    app: 'com.xingin.xhs',
    name: '小红书',
    locale: 'zh-CN',
    screen: { width, height },
    tree,
  };
}

/* -------------------------------------------------------------------------- */
/* com.eg.android.AlipayGphone                                                 */
/* -------------------------------------------------------------------------- */

function alipayFixture(): AppFixture {
  const width = 1080;
  const height = 2400;

  const quickActions = ['扫一扫', '收付款', '出行', '卡包'];
  const services = [
    '余额宝', '花呗', '借呗', '网商银行', '信用卡还款', '充值中心',
    '生活缴费', '医疗健康', '市民中心', '蚂蚁森林', '蚂蚁庄园', '芭芭农场',
    '快递查询', '火车票机票', '酒店', '电影演出',
  ];
  const recommendations = [
    '秋冬进补，这 5 家老字号值得去',
    '双十一预售清单：数码好物推荐',
    '从记账开始，理清每个月的开销',
    '周末去这 3 个城市，人少景美',
  ];

  const quick: RawUiNode[] = quickActions.map((label, index) =>
    node(rect(24 + index * 258, 300, 24 + index * 258 + 234, 460), { clickable: true }, [
      node(rect(24 + index * 258 + 49, 312, 24 + index * 258 + 185, 408), {}, []),
      textNode(rect(24 + index * 258 + 24, 416, 24 + index * 258 + 210, 460), label),
    ]),
  );

  const grid: RawUiNode[] = services.map((label, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const left = 24 + column * 258;
    const top = 880 + row * 180;
    return node(rect(left, top, left + 234, top + 160), { clickable: true }, [
      node(rect(left + 45, top + 8, left + 189, top + 96), {}, []),
      textNode(rect(left + 12, top + 104, left + 222, top + 152), label),
    ]);
  });

  const banners: RawUiNode[] = [0, 1, 2].map((index) => {
    const left = 24 + index * 352;
    return node(rect(left, 480, left + 328, 680), { clickable: true, description: `活动 ${index + 1}：双十一主会场` });
  });

  const cards: RawUiNode[] = [
    ['余额宝', '昨日收益 +0.82 元'],
    ['花呗', '本月待还 1,286.00 元'],
    ['账单', '10 月支出 4,210.50 元'],
  ].map(([title, detail], index) => {
    const top = 1640 + index * 170;
    return node(rect(24, top, width - 24, top + 150), { clickable: true }, [
      node(rect(48, top + 24, 500, top + 76), {}, [textNode(rect(48, top + 24, 500, top + 76), title ?? '')]),
      node(rect(48, top + 80, 800, top + 126), {}, [textNode(rect(48, top + 80, 800, top + 126), detail ?? '')]),
    ]);
  });

  const recommendationNodes: RawUiNode[] = recommendations.map((title, index) => {
    const left = 24 + index * 258;
    return node(rect(left, 2190, left + 234, 2330), { clickable: true }, [
      node(rect(left, 2190, left + 234, 2270), {}, []),
      textNode(rect(left + 8, 2276, left + 226, 2326), title),
    ]);
  });

  const tree = node(rect(0, 0, width, height), {}, [
    statusBar(width, '18:24', '5G', '78%'),
    node(rect(0, 80, width, 300), {}, [
      node(rect(0, 80, width, 220), {}, [
        textNode(rect(24, 96, 240, 144), '上海'),
        iconButton(rect(852, 104, 936, 188), '扫一扫'),
        iconButton(rect(952, 104, 1036, 188), '添加'),
      ]),
      node(rect(24, 196, width - 24, 292), { clickable: true, editable: true, text: '搜索' }, [
        node(rect(48, 208, width - 72, 280), {}, [textNode(rect(48, 208, width - 72, 280), '搜索：地铁乘车码')]),
      ]),
    ]),
    node(rect(0, 300, width, 2360), {}, [
      wrapped(rect(0, 300, width, 460), quick, 1),
      wrapped(rect(0, 480, width, 680), banners, 2),
      wrapped(rect(0, 880, width, 1600), grid, 2),
      node(rect(0, 1600, width, 2400), {}, [
        node(rect(24, 1600, width - 24, 1640), {}, [textNode(rect(24, 1600, width - 24, 1640), '我的资产')]),
        ...cards,
        node(rect(24, 2140, width - 24, 2400), {}, [
          node(rect(24, 2140, width - 24, 2180), {}, [textNode(rect(24, 2140, width - 24, 2180), '为你推荐')]),
          ...recommendationNodes,
        ]),
      ]),
    ]),
    node(rect(0, 2340, width, height), {}, [
      labelledButton(rect(0, 2340, 270, 2400), '首页'),
      labelledButton(rect(270, 2340, 540, 2400), '理财'),
      labelledButton(rect(540, 2340, 810, 2400), '生活'),
      labelledButton(rect(810, 2340, width, 2400), '我的'),
    ]),
  ]);

  return {
    app: 'com.eg.android.AlipayGphone',
    name: '支付宝',
    locale: 'zh-CN',
    screen: { width, height },
    tree,
  };
}

export const APP_FIXTURES: readonly AppFixture[] = [
  settingsFixture(),
  chromeFixture(),
  weChatFixture(),
  xiaohongshuFixture(),
  alipayFixture(),
];
