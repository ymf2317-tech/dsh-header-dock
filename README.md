# dsh-header-dock

**给 DeepSeek Harness Web 的会话顶栏做收纳：窄屏时把挤不下的按钮收进「»」抽屉，宽屏时什么都不做。**

DSH Web 的会话头里，`actions` / `utilities` / `corner` 三个插槽容器都是 `flex:none`——它们永远不会自己收缩，真正裁切它们的是 `.titleCluster{flex:1;overflow:clip}`（右侧还有 20px 渐隐遮罩）以及更外层的 pane。于是窄屏下按钮要么被切一半，要么整块消失，而且**没有任何入口能点到它们**。这个插件把放不下的项收进一个抽屉，并允许你逐项决定去留。

## 特性

- **自动收纳**：容器装不下时从右侧逐项收进「»」抽屉；宽屏下「»」按钮本身不渲染，零占位。
- **逐项四态**：每个条目可设「自动 / 常显 / 收起 / 隐藏」，手动态永远优先于自动判断。
- **可排序**：同组内 ▲▼ 调整顺序（`style.order`，不动 DOM）。
- **知道是谁插的**：面板里每项标出来源插件；同文案的项打「疑似重复」。
- **纯展示条目也能管**：MEM 胶囊这类没有按钮的节点照样参与收纳，标「仅显示」，点了不做动作。
- **左侧面板逐行开关**：不想看见哪一行就关掉，被别的插件重渲染后自动盖回去。

> 边界：本插件**只改可见性和 flex 顺序**（`style.display` / `style.order`），不搬动任何 React 渲染的 DOM 节点，也不改动任何第三方插件的代码。零构建、零运行时依赖。删掉存储键 + 刷新，界面立刻回到原样。

---

## 安装

`<profile>` 指你的某个 profile 目录，通常在 `~/.dsh/profiles/<name>`（Windows 上是 `%USERPROFILE%\.dsh\profiles\<name>`）。

### 方式 A：直接从 GitHub 装（推荐）

```bash
dsh plugin --profile <profile> add github:ymf2317-tech/dsh-header-dock
```

`dsh plugin` 只是把参数原样转发给该 profile 目录里的 pnpm，所以 `github:owner/repo`、`git+https://…`、本地 `.tgz` 都能直接用。

装完还要让 DSH 知道「启动时加载它」——在 profile 的 `package.json` 里把包名加进 `dsh.profile.bundles`（数组末尾追加即可）：

```jsonc
// <profile>/package.json
"dsh": {
  "profile": {
    "bundles": [ "……", "dsh-header-dock" ]
  }
}
```

本包的 `package.json` 已经声明了 `dsh.bundle.patch`（指向仓库里的 `cordis.patch.yml`），DSH 读 bundles 时会自动应用这段 patch，**不需要手改 profile 的 `cordis.patch.yml`**。

### 方式 B：本地 vendor（离线安装 / 自己改代码时）

把仓库内容放到 `<profile>/vendor/dsh-header-dock`，并声明成 `file:` 依赖，否则下次 `dsh plugin add` 时会被 pnpm prune 掉：

```jsonc
// <profile>/package.json
"dependencies": {
  "dsh-header-dock": "file:vendor/dsh-header-dock"
}
```

同样要进 `dsh.profile.bundles`。

**装完必须硬刷一次页面**（`Ctrl+Shift+R`；手机上把该站点关掉重进 / 清一次缓存）。`lib/client.js` 是静态资源，普通刷新可能仍用旧副本，于是你会以为「装了没反应」。

## 打开管理面板

**只有一个入口**：点顶栏右上角的 **「»」** 打开被收纳列表 → 点末行 **「管理顶栏…」**。

（0.2.0 起不再往视图页签的 ⋯ 菜单注册入口，只保留抽屉这一个，免得两处入口行为分叉。顶栏里唯一的注册项就是这个「»」触发器，而它只在真发生收纳时才渲染。）

面板里对每个顶栏按钮可以设置：

| 状态 | 含义 |
| --- | --- |
| 自动（默认） | 放得下就显示；被溢出挤出时自动收进「更多」 |
| 常显 | 自动收纳永远不碰它（放不下就放不下，你自己负责） |
| 收起 | 强制进「更多」，不管放不放得下 |
| 隐藏 | 彻底不显示（`display:none`），也不进「更多」 |

另外可以 ▲▼ 调整同组内顺序，底部有 **「全部还原」**。

顶栏被收纳的项点 **「»」** 查看（浮层里点某项 = 点原按钮，原插件的事件处理器照常工作）。面板下半部分是 **「左侧面板（逐项显示）」**：每行一个开关，关掉的行就不在左栏露出。

## 状态存在哪 / 怎么一键还原

- 存储键：`localStorage['dsh-header-dock.v1']`
- 一键还原：管理面板底部「全部还原」；或控制台执行
  ```js
  localStorage.removeItem('dsh-header-dock.v1'); location.reload()
  ```
- 结构（手工改也行；`order` 可省略，`state` 缺省视为 `auto`）：
  ```jsonc
  {
    "version": 1,
    "items": {
      "utilities::dsh-memory-guard": { "state": "always", "order": 0 },
      "actions::dsh-mneme:pipeline": { "state": "hidden" }
    },
    "sidebar": {
      "hiddenLabels": ["插件", "任务"]
    }
  }
  ```

`items` 的键是条目的稳定身份（见文末「已知限制」）；`sidebar.hiddenLabels` 存的是**被关掉的左侧面板行标题**——按文字记，重渲染不错位。

## 配置项（`cordis.patch.yml` 的 `config`）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `overflow` | `true` | 自动收纳总开关。关掉后只剩手动态（常显/收起/隐藏）生效 |
| `reportEnabled` | `true` | 是否把布局快照上报给宿主（只存内存，见下） |
| `debug` | `false` | 控制台打点（`[header-dock]` 前缀） |
| `sidebarFold` | `false` | **已废弃，仅兼容**：0.1.5 起侧栏改为「逐行开关」，此键不再有任何行为 |
| `sidebarLimit` | `6` | **已废弃，仅兼容**：同上，不再按「前 N 行之后全藏」裁切 |

侧栏现在的语义只有一条：管理面板里你关掉的行才藏起来（带 `display:none !important` 覆盖别人的重渲染），全开 = 原样。所以早期版本的「折叠毫无规律」问题不复存在。

## 上报（可选）

`lib/client.js` 会在首次套用布局、每次自动收纳重算、面板改动、以及抓到本插件相关异常时，把一份布局快照 `POST /header-dock/report`。宿主只把它留在内存里（不落盘），用于排查「某个按钮为什么被收了」：

```bash
curl -s http://127.0.0.1:<port>/header-dock/report | jq
curl -s -X DELETE http://127.0.0.1:<port>/header-dock/report
```

关掉它：`reportEnabled: false`。

## 关于左栏那两行同名的「插件」

左栏会出现**两行都叫「插件」**，这不是重复面板，也不是本插件造成的：

- **第 1 行**是 `dsh-sidebar-entries` 的**折叠开关**——它故意克隆了一行、沿用原标题「插件」（带 `data-dse-ui="toggle"`），点一下就能折叠/展开下方多余的面板。状态存在 `localStorage['dse.sidebar.collapsed.v1']`。
- **第 3 行**才是真正的插件面板。

## 已知限制

- 顶栏条目**没有稳定的 DOM 身份**（渲染器不给 wrapper、也没有 entry id），身份只能靠「插槽名 + 注册 id（拿得到的话）+ aria-label/title/文案」推断；同一文案的多个条目靠出现序号区分。**插件改了按钮文案 → 身份变了 → 你之前对它的设置会回到「自动」**。
- 「隐藏」是 `display:none`：那个按钮真的没了，包括它自己的浮层入口。
- 纯展示型条目（如 MEM 流量胶囊）**能收纳、不能点**：抽屉与面板里会标「仅显示」，因为那个节点里本来就没有可点的按钮。
- 右上角那一格（`corner`，侧栏展开键）不参与自动收纳，永远常显。
- `overflow:clip` 下 `scrollWidth` 不可靠，所有判定都用 `getBoundingClientRect()` 实测。
- 只对 DeepSeek Harness Web 端有效（`dsh.client.platform = web`），不涉及宿主/TUI。

实现细节见 [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md)（最终选择器、身份 key 规则、算法与风险）与 [`docs/SPEC.md`](docs/SPEC.md)（硬约束 C1–C7）。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
