# 实现记录（dsh-header-dock v0.1.0）

本文记录**最终**实现选择：用到的选择器、身份 key 规则、算法、以及已知风险。DOM 事实的来源是 `docs/inventory.md`（dock-map 的运行时盘点，每条带 `文件:行号`）。

## 0. 一句话架构

一个零构建的浏览器端插件：`MutationObserver` 发现会话头 → 收集三个插槽里的条目 → 用 `getBoundingClientRect()` 与两条真实裁切边界比对 → 只写 `style.display` / `style.order` → 被收起的项进「»」抽屉（由我们注册的插槽按钮打开）。宿主侧只有一个内存态的 report 端点。

## 1. 容器定位（最终选择器）

会话头的真实结构（`wSkVaW_` 是 CSS Module 的 hash 前缀，会随构建变，**不能写死**）：

```
header[data-window-drag]
└ div[data-slot="conversation.session.header"]{display:contents}
  ├ div._titleRow
  │ ├ div._titleCluster{flex:1;min-width:0;overflow:clip;mask 20px}   ← actions 的裁切边界
  │ │ ├ nav._crumbs
  │ │ └ div._headerActions{flex:none} > div[data-slot="…header.actions"]
  │ └ div._headerUtilities{flex:none;margin-left:20px} > div[data-slot="…header.utilities"]
  ├ div._headerCorner[data-conversation-header-corner]                ← titleRow 的**兄弟**
  └ div._tabs
```

`findAnchor()` 的实际做法：

| 目的 | 首选 | 兜底 |
| --- | --- | --- |
| 判定「当前是会话页」 | `[data-conversation-header-corner]`（首页 hero 没有它） | — |
| 标题行 | `corner.closest('[class*="_titleRow"]')` | `corner.previousElementSibling`（类名含 `_titleRow`）→ 包含 actions 插槽的祖父节点 |
| actions 容器 | `titleRow.querySelector('[data-slot="conversation.session.header.actions"]')` | `[class*="_headerActions"]` |
| utilities 容器 | `titleRow.querySelector('[data-slot="…header.utilities"]')` | `[class*="_headerUtilities"]` |
| corner 容器 | `corner.querySelector('[data-slot="…header.corner"]')` | corner 自身 |
| 裁切边界 | `actions.closest('[class*="_titleCluster"]')` | `actions.parentElement` |

三条踩过的坑，别再犯：

1. **`corner.parentElement` 不是 titleRow**。它是 titleRow 的兄弟，父级是 `div[data-slot]{display:contents}`。用 `parentElement` 会拿到 display:contents 的容器（`getBoundingClientRect` 全 0）。
2. **类名子串必须在 `titleRow` 范围内查**。首页 hero 头也有 `_headerActions` / `_headerUtilities`，`document.querySelector` 会串页。
3. **`data-slot` 属性是渲染器写死的**（`dsh-client-ui-renderer/lib/client.js:1203-1221`），与构建 hash 无关，所以它是首选；类名只当旧版本兜底。

## 2. 条目身份 key

渲染器把条目**裸元素**直接塞进 `div[data-slot]{display:contents}`：没有 per-entry wrapper，没有 `data-slot-entry-id`（全树 grep 0 命中）。所以身份只能推：

```
key = 有注册 id  →  "<slot>::<id>"            // id 来自 ctx.slots.entriesOfSlot(slot) 的 options.id
      没注册 id  →  "<slot>::dom:<特征>"      // 特征优先级 data-* > aria-label > title > 归一化文案 > 标签名
      撞车       →  追加 "#2" "#3"（CORE.uniqueKeys）
```

- `entriesOfSlot` 与 DOM 的对齐由 `CORE.mapEntries` 负责：**数量一致才按下标对齐**，否则退化为 label 匹配；对不上的项留空 id，走 DOM 兜底 key（`entryMode` 字段会记录用的是哪种：`actions:index:5 | utilities:label:7 | corner:empty`）。
- 文案归一化 `CORE.keyText` 会把**数字统一成 `#`**：`MEM 62%` 与 `MEM 63%` 因此共享同一个 key —— MEM 胶囊每 5 秒轮询刷新不会导致状态丢失。
- 身份是**每帧重算**的，不做持久化映射表。代价：某个插件改了按钮文案，它之前的设置会失配（回到「自动」）。这是有意的取舍——没有稳定 id 时，猜映射比失配更糟。
- 「疑似重复」（F4）按**归一化 label** 归并（`CORE.duplicateLabels`），**不看 order**：`memory-guard` 与 `dsh-better-sidebar:context-diagnostics` 的 order 都是 20，稳定排序后相对位置取决于加载顺序。

## 2.1 装饰节点与点击目标（v0.1.3 修正）

`nodeChildren()` **不做任何可点性过滤**：插槽的直接子节点全算条目。原因是一个反例——MEM 胶囊是 `dsh-memory-guard` 的 `<span>`，里面没有 `button`，早期版本按「是不是按钮」过滤会把它整个丢掉，于是它成了顶栏里唯一没人管的项：不参与收纳、收不进抽屉，只能顶着「»」和右上角开关往右挤。

所以每个条目拆成两个指针：

| 字段 | 是什么 | 用途 |
| --- | --- | --- |
| `item.el` = `node` | 插槽的**直接子节点** | 写 `display`/`order`、测量宽度；隐藏它才真的腾出宽度 |
| `item.target` | `isActionable(node) ? node : actionTargetOf(node)`，**可能为 null** | 只用于转发 `.click()` |

- `actionable = !!target`。`actionable:false` 的条目（Chip、空 span）在抽屉与面板里渲染成**不可点的信息行**（同样的图标 + label + 「仅显示」标签），点了不做任何事——比「看着像按钮但点不动」诚实。
- label 仍为空时用 `t('decorative')`（「占位元素」/「Spacer」），**不再**出现「未命名项」；占位元素不参与「疑似重复」判定。
- 上报 `items[]` 带 `actionable` 与 `decorative` 两个布尔，验收时一眼看出哪些只能看不能点。

## 3. 自动收纳（F1）

**不要用 `scrollWidth > clientWidth`**：`.headerActions` / `.headerUtilities` 是 `flex:none`，永远不会自己溢出，这个判断恒假；而 `overflow:clip` 下 `scrollWidth` 也不可信。

两条**互不相干**的裁切路径，分别定边界：

| 簇 | 边界 | 依据 |
| --- | --- | --- |
| `actions` | `cluster.right - 24` | 被 `.titleCluster{overflow:clip}` + 20px 渐隐遮罩裁，24 = 20 渐隐 + 4 呼吸 |
| `utilities` | `titleRow.right - 8 - 36` | 它会把 titleRow 顶破（MEM 胶囊「被削半截」就是这条），36 是给「»」按钮预留的横向余量 |
| `corner` | 不参与 | `kind:single`，只有一个占用者（侧栏展开键），标 `protected:true` |

「»」按钮**就住在 utilities 行里**（见 §4）。不预留 36px，它出现时会把自己挤出可视区；预留后，宁可早收一项也要让「»」有个落点。

`CORE.pickOverflow` 的语义：从右往左扫描，跳过 `always` 与 `protected`，返回**最靠右且 `right > limit + 0.5`** 的那一项（0.5px 容差吸收亚像素误差）。

**为什么是迭代式**（`computePlan`，最多 16 轮，正常 2~4 轮收敛）：藏掉 utilities 里的一项 → `.titleCluster`（`flex:1`）变宽 → **actions 的边界右移**。必须让浏览器重排后重新测量，不能一次算完。每轮 `measureItems(items, limits, keepHidden)` 会把本轮已判定收起的项保持 `display:none`（否则量出来是 0，结果逐次漂移），其余恢复 `display:''`。

触发器与自愈：

- `MutationObserver`（观察 `document.documentElement` 的 childList+subtree）。**只对 `.titleRow` 子树内的变化**、`nav` 里 `panelList` 的变化、以及新增/移除节点里含 `[data-conversation-header-corner]` 的情况反应（`interesting()`）；否则流式输出会把同步刷爆。
- `ResizeObserver`（titleRow / titleCluster / headerUtilities）+ window resize。
- 统一 `scheduleSync()` 防抖 120ms，rAF 级别太重、纯同步会抖。
- `verify()` 每 1500ms 兜底自愈：比对 `style.display` 与 `desiredDisplay`、`isConnected`、`data-dsh-dock-key` 是否还在（React 重渲染会重建节点、把我们的内联样式抹掉）。

## 4. 「»」溢出按钮 + 抽屉（F2/F6）

- 按钮**通过插槽注册**进 `conversation.session.header.utilities`（`ctx.slots.register({name, id:'header-dock-more', order:900})`），**不是** `appendChild` 到 DOM —— 由 React 创建与回收，天然绕开 C2（不搬 React 节点）的雷。`showMore` 为真时才渲染，宽屏零占位。
- 收纳引擎双向豁免它（`OWN_MORE_ID` + `data-dsh-dock-ui`），否则它会被自己收起来。
- 抽屉用官方原语 `Menu`，**必须 `portal:true`**（titleCluster 是 `overflow:clip`，非 portal 会被裁掉），锚点用 `getAnchorRect: () => ref.current.getBoundingClientRect()`。
- 每行用 `MenuItemButton`；行首图标是原节点 `cloneNode(true)` 后经 `sanitizeClone()`（去掉 id / aria / tabIndex，`pointer-events:none`）只作视觉；label 取 aria-label → title → 文案。
- 点某行 → 对**原节点**调 `node.click()`，原插件的事件处理器照常执行（我们不复制逻辑）。
- 关闭：点外部、`Esc`、`onDismiss`。≤640px 换成底部抽屉布局。

## 5. 状态优先级与排序

```
手动 more / hidden  →  永远收起（优先于一切自动判断）
手动 always         →  自动收纳不碰它
自动 auto           →  放得下就显示，放不下就进「更多」
```

改动只落在两处：

- `el.style.display = '' | 'none'`
- `el.style.order = String(rank)`（F3：**只在同簇内**按 order 排；跨簇搬 DOM 是不允许的）

等于原位置时不写 `order`（保持 DOM 顺序，避免制造无意义的样式差异）。`applyPlan` 还会打两个标记供 DevTools 看：`data-dsh-dock-key`、`data-dsh-dock-state`（`auto` / `auto-tucked` / `always` / `more` / `hidden`）。

## 6. 管理面板入口（0.2.0 起只有一个）

唯一入口：顶栏右上角「»」抽屉的**末行「管理顶栏…」**（`drawerFoot`，行在 `MoreButton` 里渲染，点击调 `openManager()`）。

- **0.2.0 移除**了原先向 `conversation.session.header.views.actions` 注册的一行「顶栏管理」，连同 `SLOT_VIEWS` 常量与 `ManageMenuRow` 组件一起删掉：两个入口会让行为分叉，用户只保留抽屉这一个。
- 仍然**不在顶栏加按钮**（C4）：「»」触发器只在真的发生收纳时才渲染，宽屏下连节点都不存在。
- 顶栏里唯一的注册项仍是 `conversation.session.header.utilities` 上的 `header-dock-more`（order 900）；`inject` 里的 `@deepseek-ai/dsh-client-ui-conversation` 要留着（会话头插槽属于它）。
- 面板是原生 DOM（零构建），按 slot 分组，点遮罩 / Esc 关闭，≤640px 变底部抽屉。

## 7. 左侧面板：逐行开关（0.1.5 起的最终形态）

早期版本做的是「前 N 行之后全藏 + 自建『更多面板 (n)』行」，与 `dsh-sidebar-entries` 的折叠/拖动互相打架，用户反馈「折叠毫无规律」。0.1.5 推倒重来，语义收到最小：

- 管理面板列出 `nav[class*="panelList"]` 里识别到的每一行（`panelRows()` 跳过 `data-dse-ui` / `dse-grip` / `aria-haspopup`），每行一个开关；
- 你关掉哪些行就只藏哪些行：`sidebar.hiddenLabels`（按**行标题文字**记，重渲染不错位，没标题才退回序号）；
- 写 `style.display='none'` 且带 `!important`——`dsh-sidebar-entries` 重渲染时会覆盖普通内联样式，只有 important 盖得住；`watchSidebarNav()` 用 MutationObserver 盯住 nav，发现被改回来就再盖一次；
- 不再插入任何自建行（旧残骸由 `removeOurSidebarRow()` 清掉），也不再按高度百分比裁切；
- `config.sidebarFold` / `sidebarLimit` 自此仅兼容保留，不参与行为决策。

## 8. 遥测（宿主只存内存）

`POST /header-dock/report`（body ≤256KB，同源校验失败 403）→ 宿主保存最后一份（不落盘）；`GET` 读回；`DELETE` 清空。

上报体（v1）包含：`viewport`、`sessionId`、`entryMode`、`limits{row,cluster}`、`containers[{slot,found,clientWidth,scrollWidth,visible,hidden,maxRight,limit,overflowPx}]`、`items[{key,slot,label,tag,state,order,width,dup,tucked,id,registrant}]`、`sidebar{found,detected,foreign,applied,force,rows,hidden,expanded}`、`errors[]`。

容器的 `clientWidth/scrollWidth` 恒为 0（容器是 `display:contents`），所以额外给了 `maxRight` / `limit` / `overflowPx`：**验收时只看 `overflowPx <= 0`** 就能确认该簇没被裁。

时机：首次套用布局后、每次自动收纳重算后、面板每次改动后、`window.onerror` / `unhandledrejection` 抓到与本插件相关的异常时。防抖 500ms，失败静默。

## 9. 已知风险

| 风险 | 现状 | 说明 / 兜底 |
| --- | --- | --- |
| **React 重渲染让自动收纳抖动** | 中 | React 重建条目节点会丢掉我们的内联 `display`/`order`；`MutationObserver` + 120ms 防抖会重算，`verify()` 每 1.5s 补一次。若某插件高频重渲染，理论上有短暂「闪一下」；`computePlan` 的输入是实测几何而非历史状态，所以不会累积漂移。 |
| **点 `.click()` 与原浮层锚点冲突** | 中 | 抽屉是 portal，`stopPropagation` + 点外部关闭；若原按钮自己开浮层，两层的关闭时机可能抢一次 —— 表现为复用原按钮首次打开后需要再点一次。已知、可接受。 |
| **`display:none` 触发 ResizeObserver 回环** | 低 | 我们观察的是 titleRow/cluster/utilities，隐藏条目会让它们变窄 → 又一次 sync，但 120ms 防抖 + 迭代收敛（16 轮上限）会终止；`engine.running` 防重入。 |
| **order 撞号** | 低 | 只在有手动 order 时才写；rank 由 `rankOrders` 在簇内重排，不会产生相同 rank。 |
| **身份靠文案推断** | 中 | 插件改文案 = 换 key = 设置失配。管理面板每一项都显示 key，便于核对。 |
| **`always` 项在极窄屏仍被裁** | 已知设计 | 用户显式选择「常显」，我们不再收它；要救就把状态改回「自动」。 |
| **侧栏强制接管与 dsh-sidebar-entries 打架** | 中 | 默认让路 + 只在显式 force 时接管；接管时不动它的子节点，只用 `display`。两个 MutationObserver 可能互相触发，但双方都收敛（我们只在 `display` 不符时写）。 |
| **`corner` 网格归属未验证** | 低 | inventory §8 承认没实测它落在 header 网格哪一格；因为它 `protected`，不参与收纳，所以不影响正确性。 |

## 10. 一键还原

1. 管理面板底部「全部还原」；或
2. `localStorage.removeItem('dsh-header-dock.v1')` + 刷新；或
3. 拔掉插件行 + 刷新（残留的 `style.display` / `style.order` 会随 React 重渲染自然消失）。

三种都只影响可见性，不改任何人的代码。

## 11. 验证手段

```bash
node --check lib/client.js        # 语法
node --check lib/index.js
node test/core.test.mjs           # 25 个用例：纯函数 + locale 与文案表一致性
```

浏览器里（会话页 DevTools console）：

- 三簇现状：`document.querySelectorAll('[data-slot^="conversation.session.header."]').length`
- 边界实测：比较每个条目 `getBoundingClientRect().right` 与 `.titleCluster` / `.titleRow` 的 `right`
- 我们的标记：`[data-dsh-dock-key]`、`[data-dsh-dock-state]`
- 上报：`GET /header-dock/report`（`overflowPx` 是关键判据）

## 12. 文件地图

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | 宿主侧壳：`webServer.register({kind:'prefix', path:'/header-dock'})`，三个端点，不碰 DOM |
| `lib/client.js` | 全部前端逻辑：§0 常量 / §1 文案 / §2 纯函数核心 / §3 存储 / §4 CSS / §5 DOM 引擎 / §6 遥测 / §7 管理面板 / §8 启动 / §9 React |
| `test/core.test.mjs` | vm 沙箱里加载 client.js，只测纯函数（不依赖浏览器） |
| `cordis.patch.yml` | `insert` 片段 + 默认 config |
| `locale/*.json` | 文案（与 `lib/client.js` 的 DICT 逐 key 对齐，单测保证） |
| `docs/SPEC.md` | 硬约束 C1–C7 |
| `docs/inventory.md` | 顶栏/侧栏真实 DOM 盘点（外部事实来源） |
| `docs/api-notes.md` | 插槽 API 契约与现成方案 |
