# dsh-header-dock · 规格（SPEC v1）

插件的唯一目标：
1. **顶栏收纳**：DSH Web 会话页头部的按钮（`conversation.session.header.actions` / `.utilities` / `.corner` 三个插槽）在窄屏下不再被容器裁掉，超出部分收进「»」溢出菜单，并且可以逐项管（常显 / 收进更多 / 隐藏 / 排序 / 重复提示）。
2. **侧栏收纳**：左侧「全局面板」列表里一长串不常用但有功能的面板行，能折叠成一个「更多面板 (n)」的抽屉行。

---

## 一、硬约束（违反即返工）

| # | 约束 | 原因 |
|---|---|---|
| C1 | 不改 DSH 源码（`D:\node24\node_modules\@deepseek-ai\dsh\**`），不改任何第三方插件源码（`C:\Users\Administrator\.dsh\profiles\web\node_modules\**`） | 用户既有约束；升级即丢 |
| C2 | **绝不搬动 React 渲染出来的 DOM 节点**：不 `appendChild`/`insertBefore`/`replaceChild` 把插槽里的按钮移到别处 | React 卸载时会对自己记录的容器调 `removeChild(node)`，节点已被搬走会抛 `NotFoundError: Failed to execute 'removeChild'`，整页白屏。只允许改 `style.display`、`style.order`、`classList`、`setAttribute`，以及在容器里插入**我们自己创建**的节点 |
| C3 | 状态完全可逆：把 localStorage 的键删掉 + 刷新页面，顶栏/侧栏必须回到原样 | 出问题要能一键回滚 |
| C4 | **不新增顶栏按钮**。管理入口放在会话头视图页签那一行的 ⋯ 菜单（插槽 `conversation.session.header.views.actions`）里，作为一行「顶栏管理」 | 否则收纳器自己又占一格顶栏宽度，自相矛盾 |
| C5 | 零构建步骤：`lib/client.js` 是浏览器直接可执行的纯 ESM/IIFE，按 `window.__ModuleLoader__.load({ id, factory })` 契约注册，`factory(require)` 里 `require('react')` | 与 `dsh-memory-guard/client.js` 同一套写法，装完硬刷即生效 |
| C6 | 文案中文；颜色只用宿主 CSS 变量（`--dsw-alias-*`、`--dsh-*`），不写死黑白 | 跟随明暗主题 |
| C7 | 不移除/不改动任何插件注册的插槽条目本身，只控制其可见性 | 关掉插件才该让按钮消失 |

## 二、身份 key（跨重渲染必须稳定）

每一项的 key 优先级：
1. 节点自身或其祖先上的 `data-*` 插槽元数据（如 `data-slot-entry-id`、`data-slot`，以 `dock-api` 的实测结论为准）；
2. `aria-label`（优先）→ `title` → `textContent` 归一化；
3. 兜底：`tagName#index`。

同一 key 在两次渲染之间必须落到同一个按钮上。若实测发现没有稳定属性，key 用「插槽名 + 归一化 label + 同 label 出现序号」。

## 三、功能

- **F1 自动收纳**：容器 `scrollWidth > clientWidth` 时，从尾部移除（=`display:none`）足够的项直到不再溢出，这些项进入「更多」。窗口 resize / 会话切换后重算。
- **F2 手动三态**：每项 `always`（常显，自动收纳不碰它）/ `more`（收进更多）/ `hidden`（彻底隐藏）。
- **F3 排序**：管理面板里拖动，落地为 `style.order = index`，不改 DOM 顺序。
- **F4 重复提示**：同一 label 出现 ≥2 次的项，在管理面板标「疑似重复」。
- **F5 侧栏面板折叠**：`.panelList` 类容器里第 N 行之后的行收进抽屉；抽屉行是我们自己插入的节点（满足 C2）。
- **F6 溢出菜单**：点击「更多/»」弹出浮层，列出被收纳项（图标 + label），点行 → 对原节点 `click()`，保留原插件的事件处理器。

## 四、存储

`localStorage['dsh-header-dock.v1']`：

```json
{
  "items":  { "<key>": { "state": "always|more|hidden", "order": 3 } },
  "sidebar": { "collapsed": true, "limit": 6 },
  "version": 1
}
```

按 profile 不需要区分：同一浏览器同一站点即同一 profile。

## 五、验收清单

1. 390px 宽（手机）下：MEM 胶囊不再被裁——要么常显要么在「更多」里能点到。
2. 桌面宽屏下顶栏外观与未装插件时**完全一致**（不溢出就不该收纳）。
3. 切换会话、发送消息、开合面板后，显隐与排序状态保持。
4. DevTools console 全程无 `removeChild` / React 警告。
5. 删掉 localStorage 键并刷新 → 完全恢复原样；禁用插件 → 完全恢复原样。
6. 侧栏折叠：开启后不常用面板行消失、出现「更多面板 (n)」，点开能展开。

## 六、文件职责（写入范围）

| 文件 | 负责 |
|---|---|
| `lib/client.js` | 全部浏览器侧逻辑（收纳引擎 + 管理面板 + 侧栏折叠），单文件 C5 契约 |
| `lib/index.js` | 宿主侧空壳（注册插件、提供 `/header-dock/version` 之类的健康检查端点即可） |
| `package.json` / `cordis.patch.yml` / `README.md` / `locale/*.json` | 打包与挂载元数据，照 `dsh-antigravity` 的形状写 |
| `docs/inventory.md` | `dock-map` 的实测盘点（只读研究产出） |
| `docs/api-notes.md` | `dock-api` 的插槽 API 契约与现成方案调研（只读研究产出） |
