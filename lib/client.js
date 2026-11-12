/*!
 * dsh-header-dock · 浏览器侧（单文件 / 零构建 / 直接可执行）
 *
 * 干什么：DSH Web 会话页顶栏的三个插槽簇（actions / utilities / corner）在窄屏下
 * 不收缩、不换行、没有溢出收容，按钮直接被 .titleCluster 的 overflow:clip 裁掉。
 * 本插件把装不下的按钮收进「»」抽屉，并允许逐项常显 / 收起 / 隐藏 / 排序 / 查重。
 *
 * 铁律（违反即白屏）：
 *   · 绝不搬动 React 渲染出来的节点。只允许 style.display / style.order /
 *     setAttribute / classList，以及往「容器」里插我们自己的节点。
 *   · 插槽条目是 div[data-slot]{display:contents} 的直接子节点，没有 per-entry 包装：
 *     搬走它，React 卸载时对锚点 removeChild 会抛 NotFoundError。
 *
 * 契约：window.__ModuleLoader__.load({ id, factory })，factory(require) 里取 React。
 * require 只允许平台模块表里的名字（白名单外的 require 会直接抛错）。
 */
;(function () {
  'use strict'

  /* ========================================================================
   * 0. 常量
   * ===================================================================== */

  var VERSION = '0.2.0'
  var LOADER_ID = 'dsh-header-dock'
  var NS = 'dsh-header-dock'
  var STORAGE_KEY = 'dsh-header-dock.v1'
  var CORE_KEY = '__DSH_HEADER_DOCK_CORE__'

  /** 我们自己创建的节点都带这个属性；侧栏其它插件（dsh-sidebar-entries）据此忽略我们。 */
  var UI_ATTR = 'data-dsh-dock-ui'
  /** 给 React 管的插槽节点打的幂等标记（只 setAttribute，不参与任何选择器依赖）。 */
  var KEY_ATTR = 'data-dsh-dock-key'
  /** 给 React 管的核心节点打的状态标记，便于 DevTools 里一眼看清。 */
  var STATE_ATTR = 'data-dsh-dock-state'

  var SLOT_ACTIONS = 'conversation.session.header.actions'
  var SLOT_UTILITIES = 'conversation.session.header.utilities'
  var SLOT_CORNER = 'conversation.session.header.corner'

  /** 我们自己的「»」按钮注册进 utilities 时用的 id —— 收纳引擎必须豁免它。 */
  var OWN_MORE_ID = 'header-dock-more'

  var DEFAULTS = {
    overflow: true,
    sidebarFold: false,
    sidebarLimit: 6,
    reportEnabled: true,
    debug: false,
    // 内部可调参数（不给用户暴露，也不写进 patch）
    fadeGap: 24,          // tileCluster 的 20px 渐隐 + 4px 呼吸
    gap: 8,               // 簇内 gap，与 conversation css 一致
    moreReserve: 36,      // 给「»」按钮留的横向余量（它就住 utilities 行里，不预留会把自己挤出去）
    syncDebounceMs: 120,
    verifyIntervalMs: 1500,
    reportDebounceMs: 500,
    narrowWidth: 640,
  }

  /* ========================================================================
   * 1. 文案
   * ===================================================================== */

  var DICT = {
    zh: {
      more: '更多',
      moreTitle: '被收纳的顶栏按钮',
      manage: '顶栏管理',
      manageHint: '自动=被溢出挤出时收起来 · 常显=自动收纳不碰它 · 收起=强制进「更多」 · 隐藏=彻底不显示',
      reset: '全部还原',
      resetDone: '已还原：存储键已删除并重算',
      close: '关闭',
      stateAuto: '自动',
      stateAlways: '常显',
      stateMore: '收起',
      stateHidden: '隐藏',
      stateOn: '已开启',
      stateOff: '已关闭',
      turnOn: '开启',
      turnOff: '关闭',
      dup: '疑似重复',
      up: '上移',
      down: '下移',
      slotActions: '标题行动作区',
      slotUtilities: '工具区',
      slotCorner: '右上角',
      emptyItems: '当前视图还没找到任何顶栏按钮（进一个会话试试）',
      decorative: '占位元素',
      viewOnly: '仅显示',
    emptyDrawer: '现在没有被收纳的按钮',
      sidebarMore: '更多面板',
      sidebarLess: '收起面板',
      sidebarTitle: '左侧面板（逐项显示）',
    sidebarRowsHint: '左栏被自动识别出的每一行都在下面：关掉哪个，它就不在左栏露出来；全开就是原样',
    sidebarMissing: '没找到左栏面板列表（nav.panelList）',
      sidebarDelegated:
        '侧栏折叠已由 dsh-sidebar-entries 提供（左栏多出来的那行「插件」就是它的折叠开关），顶栏收纳器默认不接管',
      sidebarForce: '仍要强制接管',
      sidebarForeign: '侧栏已被 dsh-sidebar-entries 接管（它有自己的面板管理器 + 30% 滚动），本插件默认让路',
      drawerFoot: '管理顶栏…',
      count: '共 {n} 项',
      tucked: '已收纳 {n} 项',
      source: '来自 {pkg}',
    },
    en: {
      more: 'More',
      moreTitle: 'Tucked header buttons',
      manage: 'Manage header',
      manageHint: 'Auto = tucked when it overflows · Always = never auto-tucked · Collapse = force into More · Hide = never shown',
      reset: 'Reset all',
      resetDone: 'Reset: storage key removed and layout recomputed',
      close: 'Close',
      stateAuto: 'Auto',
      stateAlways: 'Always',
      stateMore: 'Collapse',
      stateHidden: 'Hide',
      stateOn: 'On',
      stateOff: 'Off',
      turnOn: 'Turn on',
      turnOff: 'Turn off',
      dup: 'Duplicate?',
      up: 'Move up',
      down: 'Move down',
      slotActions: 'Title actions',
      slotUtilities: 'Utilities',
      slotCorner: 'Corner',
      emptyItems: 'No header buttons found in this view (open a session first)',
      decorative: 'Spacer',
      viewOnly: 'Display only',
    emptyDrawer: 'Nothing is tucked right now',
      sidebarMore: 'More panels',
      sidebarLess: 'Fewer panels',
      sidebarTitle: 'Left panel (per row)',
    sidebarRowsHint: 'Every row found in the left panel is listed below: turn one off and it stops showing up; all on = untouched',
    sidebarMissing: 'Left panel list (nav.panelList) not found',
      sidebarDelegated:
        'Sidebar folding is already provided by dsh-sidebar-entries (the extra "Plugins" row is its toggle); header-dock steps aside by default',
      sidebarForce: 'Take over anyway',
      sidebarForeign: 'The sidebar is managed by dsh-sidebar-entries (its own panel manager + 30% scroll); dock steps aside',
      drawerFoot: 'Manage header…',
      count: '{n} items',
      tucked: '{n} tucked',
      source: 'from {pkg}',
    },
  }

  var activeDict = DICT.zh

  function setDict(dict) {
    activeDict = dict && typeof dict === 'object' ? dict : DICT.zh
  }

  function t(key, vars) {
    var s = activeDict[key]
    if (typeof s !== 'string') s = DICT.zh[key]
    if (typeof s !== 'string') s = key
    if (vars) {
      for (var k in vars) {
        if (!Object.prototype.hasOwnProperty.call(vars, k)) continue
        s = s.split('{' + k + '}').join(String(vars[k]))
      }
    }
    return s
  }

  /* ========================================================================
   * 2. 纯函数核心（不碰 DOM，可被 node 直接单测）
   *
   *    凡是「判断 / 排序 / 映射」这类容易出 bug 的决策都放这里；
   *    DOM 那一层只负责测量与写 style。测试脚本见 test/core.test.mjs。
   * ===================================================================== */

  var CORE = {}

  CORE.DATA_KEY_ATTRS = [
    'data-slot-entry-id',
    'data-entry-id',
    'data-entry',
    'data-slot',
    'data-key',
    'data-testid',
    'data-id',
  ]

  /** 通用文本归一化：折叠空白、去控制字符、截断。 */
  CORE.normText = function (value, max) {
    var s = typeof value === 'string' ? value : value == null ? '' : String(value)
    s = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/[\s\u00a0]+/g, ' ').trim()
    if (typeof max === 'number' && max > 0 && s.length > max) s = s.slice(0, max)
    return s
  }

  /**
   * 做 key 用的文本：小写 + 数字串归一。
   * 把数字抹成 '#' 是为了让「MEM 62%」这类会变的文案跨刷新落到同一个 key 上。
   */
  CORE.keyText = function (value, max) {
    var s = CORE.normText(value, 0).toLowerCase().replace(/[0-9]+/g, '#')
    var cap = typeof max === 'number' && max > 0 ? max : 48
    return s.length > cap ? s.slice(0, cap) : s
  }

  /** title 常是多行长文案（例如 memory-guard 的诊断信息），取首行做标签。 */
  CORE.firstLine = function (value, max) {
    var s = typeof value === 'string' ? value : ''
    var i = s.indexOf('\n')
    return CORE.normText(i >= 0 ? s.slice(0, i) : s, max || 60)
  }

  /**
   * 内联下拉型按钮：点击在按钮原位展开一个菜单，而不是弹全局浮层/对话框。
   *
   * 这类条目一旦被收纳（display:none），抽屉行的远程 click() 只会在隐藏节点里
   * 展开菜单——用户看到的就是「点了就消失、没给选项」；而且菜单展开时它的
   * textContent 会把整个菜单内容带进来，抽屉 label 抓出来是一行乱码。
   *
   * 判定特征（按优先级）：
   *  1. aria-label/title 以「切换会话模式」开头（dsh-preset-switcher 的按钮文案）；
   *  2. 槽注册 label === '切换模式'（同插件的 register options）；
   *  3. 结构特征：根节点 position:relative，展开时内含 position:fixed inset:0 的
   *     全屏透明遮罩兄弟节点——「菜单锚在按钮原位展开」的通用 DOM 形态。
   */
  CORE.isInlineDropdownEntry = function (desc) {
    var t = (desc && (desc.ariaLabel || desc.title)) || ''
    if (typeof t === 'string' && t.indexOf('切换会话模式') === 0) return true
    if (desc && desc.entryLabel === '切换模式') return true
    var el = desc && desc.el
    if (el && typeof el.querySelector === 'function') {
      try {
        var st = el.style
        if (st && st.position === 'relative') {
          var kids = el.children
          for (var i = 0; i < kids.length; i++) {
            var ks = kids[i].style
            if (ks && ks.position === 'fixed' && ks.inset === '0px') return true
          }
        }
      } catch (error) { /* ignore */ }
    }
    return false
  }

  /**
   * 人类可读标签：注册 id 给的 label > aria-label > 短文案 > title 首行 > 文本 > 标签名。
   * 注意顺序：aria-label 是「作者写给人看的」，比可视化文案更可信。
   */
  CORE.labelOf = function (desc) {
    if (!desc) return ''
    if (desc.entryLabel) return CORE.normText(desc.entryLabel, 40)
    if (desc.ariaLabel) return CORE.normText(desc.ariaLabel, 40)
    // 内联下拉型条目：textContent 会把展开的菜单内容一起带进来（那行乱码的来源），
    // 它的 title 才是可靠标签 —— 此处优先于 textShort。
    if (desc.title && CORE.isInlineDropdownEntry(desc)) return CORE.firstLine(desc.title, 40)
    if (desc.textShort) return CORE.normText(desc.textShort, 36)
    if (desc.title) return CORE.firstLine(desc.title, 40) || CORE.normText(desc.title, 40)
    if (desc.text) return CORE.normText(desc.text, 36)
    // 绝不退回标签名（"span"/"div" 对用户毫无意义，抽屉里会变成两行同名垃圾）。
    return ''
  }

  /** DOM 兜底 key 的原料（拿不到注册 id 时才用）。 */
  CORE.domKeyBase = function (desc) {
    var data = (desc && desc.data) || {}
    var attrs = CORE.DATA_KEY_ATTRS
    for (var i = 0; i < attrs.length; i++) {
      var value = data[attrs[i]]
      if (value) return 'data-' + CORE.keyText(value, 48)
    }
    if (desc && desc.ariaLabel) return 'aria-' + CORE.keyText(desc.ariaLabel, 48)
    if (desc && desc.title) return 'title-' + CORE.keyText(CORE.firstLine(desc.title, 48), 48)
    if (desc && desc.text) return 'text-' + CORE.keyText(desc.text, 40)
    return 'tag-' + String((desc && desc.tag) || 'node').toLowerCase()
  }

  /**
   * 身份 key：<slot>::<注册 id>（首选），拿不到 id 时退到 <slot>::dom:<DOM 特征>。
   * api-notes §2.4：options.id 是注册方给的稳定 key，跨重渲染不变。
   */
  CORE.buildKey = function (slot, id, desc) {
    if (typeof id === 'string' && id.length > 0) return slot + '::' + id
    return slot + '::dom:' + CORE.domKeyBase(desc)
  }

  /** 同一批里出现重复 key 时（DOM 兜底才会发生）补 #2 / #3 消歧。 */
  CORE.uniqueKeys = function (keys) {
    var counts = Object.create(null)
    var out = []
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i]
      var seen = counts[key] || 0
      counts[key] = seen + 1
      out.push(seen === 0 ? key : key + '#' + (seen + 1))
    }
    return out
  }

  /**
   * 把 ctx.slots.entriesOfSlot() 的条目与 DOM 节点一一对齐。
   *
   * 为什么需要这层：entriesOfSlot 按 priority→order 排序，DOM 由 renderer 按 order 排序，
   * 两者**通常**一致但不保证；被遮蔽的条目还会在 DOM 里多渲染一个 data-slot-error 占位。
   * 所以：数量一致才信任下标；否则退化成 label 匹配；再不行由调用方走 DOM 兜底 key。
   *
   * @param {Array<{id?:string,label?:string}>} entries 已剔除本插件自己的条目
   * @param {Array<string>} nodeLabels 每个 DOM 节点的 labelOf 结果
   * @returns {{mode:'index'|'label', mapping:Array<object|undefined>}}
   */
  CORE.mapEntries = function (entries, nodeLabels) {
    var list = Array.isArray(entries) ? entries : []
    var labels = Array.isArray(nodeLabels) ? nodeLabels : []
    var mapping = new Array(labels.length)
    var i

    if (list.length === labels.length) {
      for (i = 0; i < labels.length; i++) mapping[i] = list[i]
      return { mode: 'index', mapping: mapping }
    }

    var pool = list.slice()
    for (i = 0; i < labels.length; i++) {
      var want = CORE.keyText(labels[i] || '', 60)
      var hit = -1
      if (want.length > 0) {
        for (var j = 0; j < pool.length; j++) {
          if (CORE.keyText(pool[j] && pool[j].label, 60) === want) {
            hit = j
            break
          }
        }
      }
      if (hit >= 0) {
        mapping[i] = pool[hit]
        pool.splice(hit, 1)
      } else {
        mapping[i] = undefined
      }
    }
    return { mode: 'label', mapping: mapping }
  }

  /**
   * 收纳决策：挑出「此刻最该被收起」的那一项（纯几何，不碰 DOM）。
   *
   * 为什么一次只挑一个、由调用方循环：
   *   · 簇内隐藏尾部项**不会**让前面的项右移（flex-start 布局），所以同簇里
   *     「右边界越界」是唯一判据，不需要把边界往左压；
   *   · 但隐藏 utilities 的项会让 .titleCluster（flex:1）变宽，从而让 actions 的
   *     裁切边界右移 —— 这一步只有浏览器重排后才知道。
   *   所以调用方藏一个、重新量一次、再挑下一个。
   *
   * @param {{items:Array<{key:string,right:number,state:string,limit:number,protected?:boolean}>}} input
   *        items 只包含「此刻在流里」的项，按视觉顺序从左到右。
   * @returns {{index:number, overflow:boolean}} index = -1 表示没有可收的项了
   */
  CORE.pickOverflow = function (input) {
    var items = (input && input.items) || []
    var overflow = false
    for (var i = items.length - 1; i >= 0; i--) {
      var item = items[i]
      var limit = typeof item.limit === 'number' && isFinite(item.limit) ? item.limit : Infinity
      if (!(item.right > limit + 0.5)) continue
      overflow = true
      // 常显项与受保护项（右上角 kind:single，通常是侧栏展开键）不参与自动收纳
      if (item.state === 'always' || item.protected === true) continue
      return { index: i, overflow: true }
    }
    return { index: -1, overflow: overflow }
  }

  /**
   * 算每项的 style.order：只在同一个插槽簇内部排序（跨簇移动 DOM 是不允许的，
   * 所以我们诚实地把它限制在「同一簇内」）。没有显式 order 的项保持 DOM 顺序。
   *
   * @param {Array<{key:string,slot:string,index:number,order:number}>} items
   * @returns {Object<string, number>} key → rank
   */
  CORE.rankOrders = function (items) {
    var list = Array.isArray(items) ? items : []
    var bySlot = Object.create(null)
    var i

    for (i = 0; i < list.length; i++) {
      var item = list[i]
      if (!bySlot[item.slot]) bySlot[item.slot] = []
      bySlot[item.slot].push(item)
    }

    var out = Object.create(null)
    for (var slot in bySlot) {
      if (!Object.prototype.hasOwnProperty.call(bySlot, slot)) continue
      var group = bySlot[slot].slice().sort(function (a, b) {
        var ao = isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER
        var bo = isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER
        if (ao !== bo) return ao - bo
        return a.index - b.index
      })
      for (i = 0; i < group.length; i++) out[group[i].key] = i
    }
    return out
  }

  /** 疑似重复：同一 slug（label 归一）出现 ≥2 次。返回 {slug: count}。 */
  CORE.duplicateLabels = function (items) {
    var counts = Object.create(null)
    var list = Array.isArray(items) ? items : []
    for (var i = 0; i < list.length; i++) {
      var slug = CORE.keyText(list[i] && list[i].label, 60)
      if (!slug) continue
      counts[slug] = (counts[slug] || 0) + 1
    }
    return counts
  }

  // 暴露给单测（浏览器里无副作用，只是挂在 globalThis 上）
  try {
    if (typeof globalThis === 'object' && globalThis) {
      globalThis[CORE_KEY] = CORE
      globalThis['__DSH_HEADER_DOCK_DICT__'] = DICT
      // DOM 相关的纯判定（不碰布局）：给单测用假元素喂进去就能验
      globalThis['__DSH_HEADER_DOCK_DOM__'] = {
        isActionable: isActionable,
    hasVisual: hasVisual,
        actionTargetOf: actionTargetOf,
        resolveTargetOf: resolveTargetOf,
        nodeChildren: nodeChildren,
      }
    }
  } catch (error) {
    /* 某些沙箱可能禁止写 globalThis，忽略 */
  }

  /* ========================================================================
   * 3. 存储
   *
   * localStorage['dsh-header-dock.v1'] = {
   *   items:  { "<slot>::<id>": { state: "auto|always|more|hidden", order?: number } },
   *   sidebar:{ expanded: bool, limit: number, force: bool },
   *   version: 1
   * }
   * 删掉这个键 + 刷新 = 彻底回到原样（C3）。
   * ===================================================================== */

  function emptyStore() {
    return { items: {}, sidebar: {}, version: 1 }
  }

  function readStore() {
    var fallback = emptyStore()
    var raw = null
    try {
      raw = window.localStorage.getItem(STORAGE_KEY)
    } catch (error) {
      return fallback
    }
    if (!raw) return fallback

    var parsed = null
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      return fallback
    }
    if (!parsed || typeof parsed !== 'object') return fallback

    var out = emptyStore()
    var items = parsed.items
    if (items && typeof items === 'object') {
      for (var key in items) {
        if (!Object.prototype.hasOwnProperty.call(items, key)) continue
        var rec = items[key]
        if (!rec || typeof rec !== 'object') continue
        var state = rec.state
        if (state !== 'always' && state !== 'more' && state !== 'hidden' && state !== 'auto') state = 'auto'
        var order = typeof rec.order === 'number' && isFinite(rec.order) ? rec.order : null
        var clean = { state: state }
        if (order !== null) clean.order = order
        out.items[key] = clean
      }
    }
    var sidebar = parsed.sidebar
    if (sidebar && typeof sidebar === 'object') {
      // 0.1.5 起只认「用户显式勾掉的左栏行」：labels 数组。
      // 旧的 limit / expanded / force 是「按高度百分比裁切」那一版留下的，
      // 正是用户说的「折叠毫无规律」的根源，这里直接丢弃不再读（迁移）。
      var labels = sidebar.hiddenLabels
      if (Array.isArray(labels)) {
        var kept = []
        for (var li = 0; li < labels.length && kept.length < 64; li++) {
          if (typeof labels[li] === 'string' && labels[li]) kept.push(labels[li])
        }
        out.sidebar.hiddenLabels = kept
      }
    }
    return out
  }

  function writeStore(store) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
      return true
    } catch (error) {
      return false
    }
  }

  function clearStore() {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
      return true
    } catch (error) {
      return false
    }
  }

  /* ========================================================================
   * 4. 样式（颜色一律走宿主 CSS 变量，跟随明暗主题）
   * ===================================================================== */

  var CSS = `
.dsh-dock-more{display:inline-flex;align-items:center;justify-content:center;gap:2px;height:28px;min-width:28px;padding:0 6px;border:none;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-secondary,#5a5a5a);cursor:pointer;font:inherit;font-size:15px;line-height:1;user-select:none}
.dsh-dock-more:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.dsh-dock-more:focus-visible{outline:2px solid var(--dsw-alias-label-link,#3b82f6);outline-offset:2px}
.dsh-dock-more__count{display:inline-block;min-width:9px;text-align:center;font-size:10px;line-height:1;font-variant-numeric:tabular-nums;opacity:.75}
.dsh-dock-drawer{display:flex;flex-direction:column;max-height:min(58vh,420px);overflow-y:auto;overscroll-behavior:contain}
.dsh-dock-drawer>*{flex:none}
.dsh-dock-glyph{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;overflow:hidden}
/* 文本型条目（如 MEM 胶囊）没有图标，克隆失败时别留一个空方块 */
.dsh-dock-glyph:empty{display:none}
.dsh-dock-glyph *{max-width:16px!important;max-height:16px!important;font-size:12px!important;line-height:1!important;margin:0!important;pointer-events:none!important}
.dsh-dock-glyph svg{width:16px!important;height:16px!important}

.dsh-dock-panel{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#111) 30%,transparent)}
.dsh-dock-panel__card{display:flex;flex-direction:column;width:min(600px,100%);max-height:min(82vh,760px);overflow:hidden;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:var(--dsw-radius-lg,14px);box-shadow:0 20px 48px color-mix(in srgb,var(--dsw-alias-label-primary,#111) 26%,transparent);font:13px/1.5 var(--dsw-font-family,system-ui,sans-serif)}
.dsh-dock-panel__head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.2))}
.dsh-dock-panel__title{flex:1;min-width:0;font-size:14px;font-weight:600}
.dsh-dock-panel__hint{padding:8px 14px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-caption,#777);border-bottom:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.2))}
.dsh-dock-panel__body{flex:1;min-height:0;overflow:auto;padding:6px 8px 10px}
.dsh-dock-panel__foot{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.2))}
.dsh-dock-panel__spacer{flex:1}
.dsh-dock-group{padding:8px 6px 2px;font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-caption,#777);text-transform:none}
.dsh-dock-row{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:var(--dsw-radius-md,8px)}
.dsh-dock-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsh-dock-row__main{flex:1;min-width:0}
.dsh-dock-row__label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-dock-row__meta{margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:var(--dsw-alias-label-caption,#888);font-family:var(--dsh-font-mono,ui-monospace,monospace)}
.dsh-dock-seg{display:inline-flex;flex:none;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:999px}
.dsh-dock-seg>button{padding:3px 8px;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#5a5a5a);cursor:pointer;font:inherit;font-size:11px;line-height:1.4}
.dsh-dock-seg>button+button{border-left:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.2))}
.dsh-dock-seg>button[data-on="1"]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));color:var(--dsw-alias-label-primary,#111);font-weight:600}
.dsh-dock-nudge{display:flex;flex-direction:column;flex:none;gap:1px}
.dsh-dock-nudge>button{width:20px;height:15px;padding:0;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary,#5a5a5a);cursor:pointer;font-size:9px;line-height:1}
.dsh-dock-nudge>button:disabled{opacity:.35;cursor:default}
.dsh-dock-badge{flex:none;padding:0 6px;border:1px solid var(--dsw-alias-state-warning-primary,#c98a00);border-radius:999px;color:var(--dsw-alias-state-warning-primary,#c98a00);font-size:10px;line-height:16px;white-space:nowrap}
.dsh-dock-badge--muted{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.4));color:var(--dsw-alias-label-caption,#888)}
/* 抽屉里「只能看不能点」的信息行（纯展示型条目，如 MEM 胶囊） */
.dsh-dock-info{display:flex;align-items:center;gap:8px;padding:7px 12px;color:var(--dsw-alias-label-secondary,#5a5a5a);font-size:13px;line-height:1.5;cursor:default;user-select:none}
.dsh-dock-info__label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-dock-info__tag{flex:none;padding:0 6px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));border-radius:999px;color:var(--dsw-alias-label-caption,#888);font-size:10px;line-height:16px}
.dsh-dock-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);cursor:pointer;font:inherit;font-size:12px;line-height:1.5}
.dsh-dock-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsh-dock-btn--pri{border-color:transparent;background:var(--dsw-alias-label-link,#3b82f6);color:var(--dsw-alias-bg-base,#fff)}
.dsh-dock-btn--pri:hover{background:var(--dsw-alias-label-link,#3b82f6);filter:brightness(1.06)}
.dsh-dock-empty{padding:18px 12px;text-align:center;color:var(--dsw-alias-label-caption,#888);font-size:12px}
.dsh-dock-note{padding:8px 14px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-caption,#777);border-top:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.2))}

.dsh-dock-sidebar-more{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;margin:2px 0 0;padding:5px 8px;border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.34));border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a8a);cursor:pointer;font:inherit;font-size:11px;line-height:1.5;text-align:left}
.dsh-dock-sidebar-more:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-secondary,#5a5a5a)}

@media (max-width:640px){
  .dsh-dock-panel{align-items:flex-end;padding:0}
  .dsh-dock-panel__card{width:100%;max-height:88vh;border-radius:16px 16px 0 0;border-bottom:none}
  .dsh-dock-row{flex-wrap:wrap}
  .dsh-dock-row__main{flex-basis:calc(100% - 120px)}
  .dsh-dock-panel__foot{padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))}
}
`

  /* ========================================================================
   * 5. 运行时状态（跨 section 共享）
   * ===================================================================== */

  var engine = {
    started: false,
    ctx: null,
    slots: null,
    cfg: DEFAULTS,
    anchor: null,
    items: [],              // [{ key, id, slot, label, el, state, order, width, dup, registrant }]
    entryMode: 'none',      // 'index' | 'label' | 'none'
    plan: { tuck: [], overflow: false },
    showMore: false,
    manualCount: 0,
    rows: [],               // 抽屉里要显示的项
    signature: '',
    reportReason: 'boot',
    reportTimer: null,
    syncTimer: null,
    verifyTimer: null,
    running: false,
    sidebar: { found: false, foreign: false, rows: 0, hidden: 0, expanded: false, applied: false, signature: '-' },
    /** 左栏每一行的快照（管理面板据此渲染逐项开关） */
    sidebarRows: [],
    errors: [],
    listeners: [],
    snapshot: null,
    pendingReason: 'boot',
    observer: null,
    resizeObserver: null,
    boundRow: null,
    panelEl: null,
    lastApplied: null,
  }

  function log() {
    if (!engine.cfg || engine.cfg.debug !== true) return
    var args = Array.prototype.slice.call(arguments)
    args.unshift('[header-dock]')
    try {
      console.log.apply(console, args)
    } catch (error) {
      /* ignore */
    }
  }

  /* ========================================================================
   * 5. DOM 引擎（只测量 + 只写 style，绝不搬节点）
   * ===================================================================== */

  var sidebarTouched = []

  function isElement(node) {
    return !!node && node.nodeType === 1
  }

  function normalizeState(state) {
    if (state === 'always' || state === 'more' || state === 'hidden') return state
    return 'auto'
  }

  /**
   * 会话页锚点。
   * [data-conversation-header-corner] 只在会话页的标题行里出现（首页 hero 没有），
   * 所以它既是「现在是会话页」的判据，也是标题行（titleRow）的定位点。
   */
  function findAnchor() {
    var corner = null
    try {
      corner = document.querySelector('[data-conversation-header-corner]')
    } catch (error) {
      return null
    }
    if (!corner) return null

    /*
     * 注意：corner 是标题行（._titleRow）的**兄弟**，不是子节点 —— 会话头结构是
     *   div[data-slot="conversation.session.header"]{display:contents}
     *     ├ header ._titleRow  (  ._titleCluster > [ ._crumbs, ._headerActions ] , ._headerUtilities )
     *     ├ div._headerCorner[data-conversation-header-corner]
     *     └ div._tabs
     * 所以 titleRow 只能靠类名子串或 previousElementSibling 找，不能用 parentElement。
     */
    var titleRow = null
    try {
      if (corner.closest) titleRow = corner.closest('[class*="_titleRow"]')
    } catch (error) {
      titleRow = null
    }
    if (!titleRow) {
      var prev = corner.previousElementSibling
      if (prev && typeof prev.className === 'string' && prev.className.indexOf('_titleRow') >= 0) titleRow = prev
    }
    if (!titleRow) {
      // 最后兜底：谁包含 actions 插槽谁就是标题行
      try {
        var probe = document.querySelector('[data-slot="' + SLOT_ACTIONS + '"]')
        if (probe) titleRow = probe.parentElement && probe.parentElement.parentElement
      } catch (error) {
        titleRow = null
      }
    }
    if (!titleRow) return null

    /*
     * 容器定位优先用渲染器写死的 data-slot 属性（`dsh-client-ui-renderer` 生成，与 CSS Module
     * 的 hash 前缀无关）；类名子串只作旧版本兜底。必须在 titleRow 范围内查 —— 首页 hero 头
     * 也有同名的 ._headerActions / ._headerUtilities，跨文档查会串页。
     */
    function pick(scope, slotName, classCandidates) {
      var found = null
      if (scope) {
        try {
          found = scope.querySelector('[data-slot="' + slotName + '"]')
        } catch (error) {
          found = null
        }
        for (var i = 0; i < classCandidates.length && !found; i++) {
          try {
            found = scope.querySelector(classCandidates[i])
          } catch (error) {
            found = null
          }
        }
      }
      return found
    }

    var actions = pick(titleRow, SLOT_ACTIONS, ['[class*="_headerActions"]'])
    var utilities = pick(titleRow, SLOT_UTILITIES, ['[class*="_headerUtilities"]'])
    // corner 在 titleRow 之外，只能从 corner 自身往下找它的插槽容器
    var cornerHost = null
    try {
      cornerHost = corner.querySelector('[data-slot="' + SLOT_CORNER + '"]')
    } catch (error) {
      cornerHost = null
    }

    // .titleCluster{flex:1;overflow:clip} 才是 actions 的真裁切边界
    var cluster = null
    try {
      if (actions && actions.closest) cluster = actions.closest('[class*="_titleCluster"]')
    } catch (error) {
      cluster = null
    }
    if (!cluster && actions && actions.parentElement) cluster = actions.parentElement

    return {
      corner: corner,
      cornerHost: cornerHost,
      titleRow: titleRow,
      cluster: cluster,
      actions: actions,
      utilities: utilities,
    }
  }

  /** 每个簇里真正装条目的是 div[data-slot]{display:contents}；兜底用容器本身。 */
  function slotAnchorOf(container) {
    if (!container) return null
    try {
      // 新版本里 findAnchor 直接返回的就是 data-slot 节点，它的子节点即为条目，不能再往里钻
      if (container.getAttribute && container.getAttribute('data-slot')) return container
      var inner = container.querySelector('div[data-slot],span[data-slot]')
      if (inner) return inner
    } catch (error) {
      /* ignore */
    }
    return container
  }

  /** 这个节点本身是不是一个「可点的东西」。 */
  function isActionable(el) {
    if (!el || el.nodeType !== 1) return false
    var tag = String(el.tagName || '').toLowerCase()
    if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'textarea') return true
    var role = ''
    try {
      role = String(el.getAttribute('role') || '').toLowerCase()
    } catch (error) {
      role = ''
    }
    return (
      role === 'button' ||
      role === 'menuitem' ||
      role === 'tab' ||
      role === 'switch' ||
      role === 'checkbox' ||
      role === 'radio'
    )
  }

  /**
   * 这个节点在屏幕上到底有没有「看得见的东西」。
   *
   * 为什么需要：插槽容器里常有几个纯布局用的空 `<span>`（无文字、无 svg/img、
   * 没有按钮），它们肉眼不可见却占 DOM 位置。把它们列进抽屉只会得到一行
   * 「占位元素」，对用户毫无意义 —— 所以抽屉里直接不渲染，但清单里要留着
   * （它们仍能通过 hidden 腾出宽度）。
   */
  function hasVisual(el) {
    if (!el || el.nodeType !== 1) return false
    try {
      if (typeof el.querySelector === 'function' && el.querySelector('svg,img')) return true
    } catch (error) {
      /* ignore */
    }
    var text = ''
    try {
      text = String(el.textContent || '').replace(/\s+/g, '')
    } catch (error) {
      text = ''
    }
    return text.length > 0
  }

  /**
   * 把插槽的直接子节点解析成「真正该点的那颗元素」。
   *
   * 为什么需要：插槽条目常常是 `<span>` 包着 `<button>` 的包装层。对包装层调
   * click() 只会让事件从 span 往外冒泡，里面那个 button 收不到 —— 表现就是
   * 「这一行怎么点都没反应」。找不到可点元素时返回 null（见 resolveTargetOf）。
   */
  function actionTargetOf(el) {
    if (!el) return null
    if (isActionable(el)) return el
    if (typeof el.querySelectorAll !== 'function') return null
    var list = null
    try {
      list = el.querySelectorAll(
        'button,a[href],[role=button],[role=menuitem],[role=tab],[role=switch],[role=checkbox],[role=radio]',
      )
    } catch (error) {
      list = null
    }
    if (!list || list.length === 0) return null
    // 有多个时优先取带可读标签的那个，避免抓到装饰性按钮
    for (var i = 0; i < list.length; i++) {
      var cand = list[i]
      var label = ''
      try {
        label = cand.getAttribute('aria-label') || cand.getAttribute('title') || ''
      } catch (error) {
        label = ''
      }
      if (label) return cand
    }
    return list[0]
  }

  /**
   * 条目的点击目标：自己可点就是自己；包装层就往下找第一个可点元素；
   * 纯展示型节点（MEM 胶囊那种 Chip、空 span）返回 null —— 它仍然是一个条目
   * （占宽度、能被收起），只是点不动，抽屉里渲染成不可点的信息行。
   */
  function resolveTargetOf(node) {
    if (!node) return null
    if (isActionable(node)) return node
    return actionTargetOf(node)
  }

  /**
   * 取插槽锚点的直接子节点。
   *
   * 这里**不做**任何「是不是按钮」的过滤：插槽的直接子节点就是顶栏里真实占位的那些
   * 东西，装饰性节点（空 span、Chip）一样占宽度、一样会被裁掉，把它排除在清单外
   * 就等于它成了唯一没人管的、无法收起的项 —— 线上 MEM 胶囊顶出去就是这么来的。
   * 能不能点另算（见 resolveTargetOf）。
   */
  function nodeChildren(host) {
    var out = []
    if (!host || !host.children) return out
    for (var i = 0; i < host.children.length; i++) {
      var child = host.children[i]
      if (!isElement(child)) continue
      var mark = null
      try {
        mark = child.getAttribute(UI_ATTR)
      } catch (error) {
        mark = null
      }
      if (mark) continue
      out.push(child)
    }
    return out
  }

  function readDescriptor(el, slot, index) {
    var data = {}
    for (var i = 0; i < CORE.DATA_KEY_ATTRS.length; i++) {
      var name = CORE.DATA_KEY_ATTRS[i]
      var value = null
      try {
        value = el.getAttribute(name)
      } catch (error) {
        value = null
      }
      if (value) data[name] = value
    }
    var ariaLabel = ''
    var title = ''
    try {
      ariaLabel = el.getAttribute('aria-label') || ''
      title = el.getAttribute('title') || ''
    } catch (error) {
      ariaLabel = ''
      title = ''
    }
    // 兜底：很多胶囊/按钮的可读文案挂在子节点上（如 Chip 内层 span 的 aria-label / title）。
    if ((!ariaLabel || !title) && typeof el.querySelector === 'function') {
      try {
        if (!ariaLabel) {
          var labelled = el.querySelector('[aria-label]')
          if (labelled) ariaLabel = labelled.getAttribute('aria-label') || ''
        }
        if (!title) {
          var titled = el.querySelector('[title]')
          if (titled) title = titled.getAttribute('title') || ''
        }
      } catch (error) {
        /* ignore */
      }
    }
    var text = ''
    try {
      text = (el.textContent || '').replace(/\s+/g, ' ').trim()
    } catch (error) {
      text = ''
    }
    return {
      slot: slot,
      index: index,
      el: el,
      tag: (el.tagName || 'div').toLowerCase(),
      data: data,
      ariaLabel: ariaLabel,
      title: title,
      text: text,
      // 长文案也截一段出来：以前 >32 字就整体丢弃，导致标签退化成 "span"。
      textShort: text.length > 0 ? text.slice(0, 32) : '',
      entryLabel: '',
    }
  }

  /**
   * ctx.slots.entriesOfSlot() 里的条目（剔除我们自己的「»」按钮）。
   * 拿不到 slots 服务时返回 null，调用方退回 DOM 兜底 key。
   */
  function entryListFor(slotName) {
    var slots = engine.slots
    if (!slots || typeof slots.entriesOfSlot !== 'function') return null
    var list
    try {
      list = slots.entriesOfSlot(slotName) || []
    } catch (error) {
      return null
    }
    var out = []
    for (var i = 0; i < list.length; i++) {
      var entry = list[i]
      if (!entry) continue
      var options = entry.options || {}
      var id = typeof options.id === 'string' ? options.id : ''
      if (id === OWN_MORE_ID) continue // 收纳引擎豁免自己的触发器
      var label = ''
      var raw = options.label
      try {
        label = typeof raw === 'function' ? String(raw() || '') : typeof raw === 'string' ? raw : ''
      } catch (error) {
        label = ''
      }
      out.push({
        id: id,
        label: label,
        order: typeof options.order === 'number' ? options.order : 0,
        registrant: typeof entry.registrant === 'string' ? entry.registrant : '',
      })
    }
    return out
  }

  function collectItems(anchor) {
    var groups = [
      { slot: 'actions', name: SLOT_ACTIONS, container: anchor.actions },
      { slot: 'utilities', name: SLOT_UTILITIES, container: anchor.utilities },
      { slot: 'corner', name: SLOT_CORNER, container: anchor.cornerHost || anchor.corner },
    ]
    var items = []
    var modes = []
    var counters = Object.create(null)

    for (var g = 0; g < groups.length; g++) {
      var group = groups[g]
      var host = slotAnchorOf(group.container)
      var nodes = nodeChildren(host)
      if (nodes.length === 0) {
        modes.push(group.slot + ':empty')
        continue
      }

      var descs = []
      for (var n = 0; n < nodes.length; n++) descs.push(readDescriptor(nodes[n], group.slot, n))

      var entries = entryListFor(group.name)
      var mapping = null
      var mode = 'dom'
      if (entries) {
        var labels = []
        for (var d = 0; d < descs.length; d++) labels.push(CORE.labelOf(descs[d]))
        var mapped = CORE.mapEntries(entries, labels)
        mapping = mapped.mapping
        mode = mapped.mode
        // 注册方给的 label 比 DOM 文本权威，优先拿它当显示名
        for (var m = 0; m < descs.length; m++) {
          var mappedEntry = mapping[m]
          if (mappedEntry && typeof mappedEntry.label === 'string' && mappedEntry.label) {
            descs[m].entryLabel = mappedEntry.label
          }
        }
      }
      modes.push(group.slot + ':' + mode + ':' + nodes.length)

      for (var k = 0; k < nodes.length; k++) {
        var entry = mapping ? mapping[k] : undefined
        var desc = descs[k]
        var id = entry && typeof entry.id === 'string' ? entry.id : ''
        // 点不动的是纯展示型条目（Chip / 空 span）：照样进清单、照样参与收纳，
        // 只是抽屉与面板里标「仅显示」并且点了不做任何事。
        var target = resolveTargetOf(nodes[k])
        var realLabel = CORE.labelOf(desc)
        counters[group.slot] = counters[group.slot] || 0
        items.push({
          // el 必须是插槽的**直接子节点**：我们对它写 display/order，隐藏它才真的腾出宽度
          el: nodes[k],
          // target 是点击目标，可能为 null
          target: target,
          actionable: !!target,
          decorative: !realLabel,
          // 看不见的空壳（无文字无图标）：抽屉里不渲染，但留在清单里可被隐藏
          invisible: !realLabel && !hasVisual(nodes[k]),
          slot: group.slot,
          slotName: group.name,
          index: counters[group.slot]++,
          id: id,
          key: CORE.buildKey(group.slot, id, desc),
          label: realLabel || t('decorative'),
          tag: desc.tag,
          inlineDropdown: CORE.isInlineDropdownEntry(desc),
          registrant: (entry && entry.registrant) || '',
          entryOrder: entry && typeof entry.order === 'number' ? entry.order : 0,
          state: 'auto',
          desiredDisplay: '',
          tucked: false,
          width: 0,
        })
      }
    }

    engine.entryMode = modes.join(' | ')

    // DOM 兜底 key 可能撞车：补 #2 / #3
    var rawKeys = []
    for (var q = 0; q < items.length; q++) rawKeys.push(items[q].key)
    var unique = CORE.uniqueKeys(rawKeys)
    for (var u = 0; u < items.length; u++) items[u].key = unique[u]

    // 疑似重复：同一归一 label 出现 ≥2 次（占位元素不参与，否则一堆「占位元素」会互相判重）
    var labelled = []
    for (var l = 0; l < items.length; l++) {
      if (!items[l].decorative) labelled.push(items[l])
    }
    var counts = CORE.duplicateLabels(labelled)
    for (var z = 0; z < items.length; z++) {
      var slug = CORE.keyText(items[z].label, 60)
      items[z].dup = !items[z].decorative && !!slug && counts[slug] >= 2
    }

    return items
  }

  function resolveStates(items, store) {
    for (var i = 0; i < items.length; i++) {
      var item = items[i]
      var rec = store.items[item.key]
      var state = normalizeState(rec ? rec.state : 'auto')
      // 内联下拉型条目（如 dsh-preset-switcher 的「切换会话模式」）：被收进抽屉后
      // 它的下拉在隐藏节点里展开，等于废掉。用户没有显式选过 always/more/hidden
      // 时（无记录，或仍是 auto），默认按「常显」保护，不参与自动收纳。
      if (item.inlineDropdown === true && (state === 'auto' || !rec)) state = 'always'
      item.state = state
    }
  }

  /**
   * 当前可用右边界。
   * - actions 项被 .titleCluster{overflow:clip} 裁 → 边界取 cluster 右缘减渐隐宽度；
   * - utilities 项会把 .titleRow 顶破（MEM 胶囊就是被更外层 pane 削掉的），边界取 titleRow 右缘；
   * - 「»」按钮本身住在 utilities 行里，所以这一行必须预留它的宽度，否则它会把自己挤出可视区。
   */
  function currentLimits(anchor) {
    var reserve = engine.cfg.overflow ? engine.cfg.moreReserve || 36 : 0
    var row = Infinity
    var cluster = Infinity
    try {
      row = anchor.titleRow.getBoundingClientRect().right - engine.cfg.gap - reserve
    } catch (error) {
      row = Infinity
    }
    try {
      if (anchor.cluster) cluster = anchor.cluster.getBoundingClientRect().right - engine.cfg.fadeGap
    } catch (error) {
      cluster = Infinity
    }
    return { row: row, cluster: cluster }
  }

  /**
   * 测量并把「该藏的项」藏起来。
   *
   * keepHidden 是「本轮已被判定要收起」的集合：这些项保持 display:none 不参与测量，
   * 其余项一律恢复 display —— 否则 display:none 的项量出来是 0，收纳结果会逐次漂移。
   */
  function measureItems(items, limits, keepHidden) {
    var hiddenMap = keepHidden || Object.create(null)
    var i

    for (i = 0; i < items.length; i++) {
      var item = items[i]
      var hide = item.state === 'hidden' || item.state === 'more' || hiddenMap[item.key] === true
      var want = hide ? 'none' : ''
      if ((item.el.style.display || '') !== want) item.el.style.display = want
    }

    var visible = []
    for (i = 0; i < items.length; i++) {
      var entry = items[i]
      if (entry.state === 'hidden' || entry.state === 'more' || hiddenMap[entry.key] === true) continue
      var rect
      try {
        rect = entry.el.getBoundingClientRect()
      } catch (error) {
        continue
      }
      entry.width = rect.width
      entry.left = rect.left
      entry.right = rect.right
      visible.push({
        key: entry.key,
        left: rect.left,
        right: rect.right,
        state: entry.state,
        limit: entry.slot === 'actions' ? limits.cluster : limits.row,
        // 右上角是 kind:single（只有一个占用者，通常是侧栏展开键），整体保护
        protected: entry.slot === 'corner',
      })
    }
    return visible
  }

  /**
   * 迭代式收纳：藏一个 → 浏览器重排 → 重新量 → 再挑下一个。
   * 上限 16 次是为了兜住异常布局，正常情况下 2~4 次就收敛。
   */
  function computePlan(anchor, items) {
    var tuck = []
    var hiddenMap = Object.create(null)
    var overflow = false
    var guard = 0

    while (guard++ < 16) {
      var visible = measureItems(items, currentLimits(anchor), hiddenMap)
      var pick = CORE.pickOverflow({ items: visible })
      overflow = pick.overflow
      if (pick.index < 0) break
      var target = visible[pick.index]
      tuck.push(target.key)
      hiddenMap[target.key] = true
      if (guard === 16) log('computePlan: 达到迭代上限，可能存在异常布局')
    }

    return { tuck: tuck, overflow: overflow }
  }

  function applyPlan(items, plan, store) {
    var tuckMap = Object.create(null)
    for (var i = 0; i < plan.tuck.length; i++) tuckMap[plan.tuck[i]] = true

    var orderInput = []
    for (var o = 0; o < items.length; o++) {
      var rec = store.items[items[o].key]
      orderInput.push({
        key: items[o].key,
        slot: items[o].slot,
        index: items[o].index,
        order: rec && typeof rec.order === 'number' ? rec.order : NaN,
      })
    }
    var ranks = CORE.rankOrders(orderInput)

    for (var j = 0; j < items.length; j++) {
      var item = items[j]
      var autoTucked = item.state !== 'always' && tuckMap[item.key] === true
      var hide = item.state === 'hidden' || item.state === 'more' || autoTucked
      item.tucked = autoTucked
      item.desiredDisplay = hide ? 'none' : ''
      var rank = ranks[item.key]
      item.rank = typeof rank === 'number' ? rank : item.index
      try {
        if (item.el.style.display !== item.desiredDisplay) item.el.style.display = item.desiredDisplay
        var nextOrder = typeof rank === 'number' ? String(rank) : ''
        if (item.el.style.order !== nextOrder) item.el.style.order = nextOrder
        item.el.setAttribute(KEY_ATTR, item.key)
        item.el.setAttribute(
          STATE_ATTR,
          item.state === 'auto' ? (autoTucked ? 'auto-tucked' : 'auto') : item.state,
        )
      } catch (error) {
        noteError(error, 'apply-plan')
      }
    }
  }

  function buildRows(items, plan) {
    var tuckMap = Object.create(null)
    for (var i = 0; i < plan.tuck.length; i++) tuckMap[plan.tuck[i]] = true
    var rows = []
    for (var j = 0; j < items.length; j++) {
      var item = items[j]
      // 看不见的空壳不进抽屉：一行「占位元素」给不了用户任何信息
      if (item.invisible === true) continue
      var autoTucked = item.state !== 'always' && tuckMap[item.key] === true
      // node = 插槽直接子节点（也是缩略图 clone 的来源）；target = 点击目标，可能为 null
      var row = {
        key: item.key,
        label: item.label,
        node: item.el,
        target: item.target,
        actionable: item.actionable === true,
        slot: item.slot,
      }
      if (item.state === 'more' || item.state === 'hidden') {
        row.state = item.state
        rows.push(row)
      } else if (autoTucked) {
        row.state = 'auto'
        rows.push(row)
      }
    }
    engine.rows = rows
  }

  /* ---- 侧栏面板折叠（F5，默认关闭）--------------------------------------- */

  function findPanelNav() {
    try {
      return document.querySelector('nav[class*="panelList"]')
    } catch (error) {
      return null
    }
  }

  /**
   * 真实面板行：排除官方「更多」锚点、以及别的插件插进来的占位行。
   *
   * 例外是底栏提升上来的行（data-dse-ui=lift）：它们是用户级入口（Remote、
   * 设置…），本来就该像宿主自己的面板行一样能逐个开关，所以不再一并排除。
   */
  function panelRows(nav) {
    var out = []
    var all
    try {
      all = nav.querySelectorAll('button[class*="panelRow"]')
    } catch (error) {
      return out
    }
    for (var i = 0; i < all.length; i++) {
      var row = all[i]
      var skip = false
      try {
        if (row.getAttribute(UI_ATTR)) skip = true
        var ownUi = row.getAttribute('data-dse-ui')
        if (ownUi && ownUi !== 'lift') skip = true
        if (row.getAttribute('aria-haspopup')) skip = true
      } catch (error) {
        skip = false
      }
      if (!skip) out.push(row)
    }
    return out
  }

  /**
   * 左栏一行的可读标题。
   *
   * 行的结构是 `button.panelRow > span.panelGlyph + span.panelTitle`，标题在
   * panelTitle 里；拿不到就退回整行文本。这个字符串同时也是 localStorage 里
   * 的稳定键 —— 用户勾选「隐藏某某」记的就是它，重渲染也不会错位。
   */
  function panelRowLabel(row) {
    var el = null
    try {
      el = row.querySelector('[class*="panelTitle"]') || row.querySelector('.dse-lift-title')
    } catch (error) {
      el = null
    }
    var text = ''
    try {
      text = String((el || row).textContent || '')
    } catch (error) {
      text = ''
    }
    return text.replace(/\s+/g, ' ').trim()
  }

  function sidebarForeign(nav) {
    try {
      return !!nav.querySelector('[data-dse-ui], .dse-grip, .dse-lift-row')
    } catch (error) {
      return false
    }
  }

  /**
   * 谁在管左栏。`dsh-sidebar-entries` 自己带了一键折叠（nav 首行 button[data-dse-ui="toggle"]，
   * 状态存 localStorage['dse.sidebar.collapsed.v1']），它已经能满足 F5，
   * 我们默认让路，只把它记进上报，不再重复实现一套折叠跟它抢。
   */
  function sidebarDetected(nav) {
    try {
      if (nav.querySelector('button[data-dse-ui="toggle"], [data-dse-open]')) return 'sidebar-entries'
      if (nav.querySelector('[data-dse-ui], .dse-grip, .dse-lift-row')) return 'other'
    } catch (error) {
      /* ignore */
    }
    return ''
  }

  function removeOurSidebarRow(nav) {
    var row = null
    try {
      row = nav.querySelector('[' + UI_ATTR + '="sidebar-more"]')
    } catch (error) {
      row = null
    }
    if (row && row.parentNode) {
      try {
        row.parentNode.removeChild(row)
      } catch (error) {
        /* ignore */
      }
    }
  }

  /** 把我们改过的行恢复原样（只恢复我们自己碰过的，绝不动别人的 display）。 */
  function releaseSidebarRows() {
    for (var i = 0; i < sidebarTouched.length; i++) {
      var row = sidebarTouched[i]
      if (!row || !row.style) continue
      try {
        if (row.style.display === 'none') row.style.display = ''
      } catch (error) {
        /* ignore */
      }
    }
    sidebarTouched = []
  }

  function ensureOurSidebarRow(nav, count, expanded) {
    var row = null
    try {
      row = nav.querySelector('[' + UI_ATTR + '="sidebar-more"]')
    } catch (error) {
      row = null
    }
    if (!row) {
      row = document.createElement('button')
      row.type = 'button'
      row.className = 'dsh-dock-sidebar-more'
      row.setAttribute(UI_ATTR, 'sidebar-more')
      row.addEventListener('click', function (event) {
        try {
          event.preventDefault()
          event.stopPropagation()
        } catch (error) {
          /* ignore */
        }
        var store = readStore()
        store.sidebar.expanded = store.sidebar.expanded === true ? false : true
        writeStore(store)
        scheduleSync('sidebar-toggle')
      })
    }
    row.textContent = expanded ? t('sidebarLess') : t('sidebarMore') + ' (' + count + ')'
    row.setAttribute('aria-expanded', expanded ? 'true' : 'false')
    // React 之后可能继续 append，导致我们被挤到中间；每次校正回末尾
    if (row.parentElement !== nav || nav.lastElementChild !== row) {
      try {
        nav.appendChild(row)
      } catch (error) {
        noteError(error, 'sidebar-append')
      }
    }
  }

  function renderSidebar(store) {
    var sb = engine.sidebar
    var nav = findPanelNav()
    if (!nav) {
      sb.found = false
      sb.rows = 0
      sb.hidden = 0
      sb.applied = false
      sb.detected = ''
      sb.signature = '-'
      return
    }

    sb.found = true
    var rows = panelRows(nav)
    sb.rows = rows.length
    sb.detected = sidebarDetected(nav)
    sb.foreign = sidebarForeign(nav)

    // 0.1.5：不再「按第几个之后全藏」，只藏用户自己在面板里勾掉的行。
    // 键用行标题文字（稳定、可读、重渲染不错位），没标题才退回序号。
    var hiddenLabels = store.sidebar.hiddenLabels || []
    var list = []
    var hidden = 0
    for (var i = 0; i < rows.length; i++) {
      var label = panelRowLabel(rows[i])
      var key = label || '#' + (i + 1)
      var isHidden = false
      for (var h = 0; h < hiddenLabels.length; h++) {
        if (hiddenLabels[h] === key) {
          isHidden = true
          break
        }
      }
      if (isHidden) hidden++
      applyRowVisibility(rows[i], isHidden)
      list.push({ label: label || '#' + (i + 1), key: key, hidden: isHidden })
    }

    engine.sidebarRows = list
    sb.hidden = hidden
    sb.expanded = true // 概念已废弃：「全部展开/全部收起」不再由我们提供
    sb.applied = hidden > 0
    sb.signature = rows.length + '|' + hidden + '|labels'

    // 我们以前会往 nav 尾部插一行「更多面板 (n)」，现在不插了，顺手清掉旧残骸
    removeOurSidebarRow(nav)
    // 左栏被 sidebar-entries 重渲染时，把用户的选择重新盖回去
    watchSidebarNav(nav)
  }

  /**
   * 把一行的显隐写进 DOM。
   *
   * 为什么要带 `!important`：dsh-sidebar-entries 自己会重渲染面板行，重渲染后
   * 它可能把行重新插回来（新节点没有我们的内联样式）；而它若用 `style.display=''`
   * 去还原，普通内联会被它覆盖。内联 + important 优先级最高，它改不动。
   */
  function applyRowVisibility(row, isHidden) {
    if (!row || !row.style) return
    try {
      if (isHidden) row.style.setProperty('display', 'none', 'important')
      else row.style.removeProperty('display')
      if (sidebarTouched.indexOf(row) < 0) sidebarTouched.push(row)
    } catch (error) {
      noteError(error, 'sidebar-apply')
    }
  }

  /**
   * 左栏被别的插件重渲染后，把「用户勾掉的行」重新藏回去。
   * 只在真的发现漂移时才动手，避免我们自己写 style 又触发自己的回调形成死循环。
   */
  function reapplySidebar() {
    var nav = findPanelNav()
    if (!nav) return
    var store = readStore()
    var hiddenLabels = store.sidebar.hiddenLabels || []
    if (hiddenLabels.length === 0) return
    var rows = panelRows(nav)
    var drift = false
    for (var i = 0; i < rows.length; i++) {
      var label = panelRowLabel(rows[i]) || '#' + (i + 1)
      var shouldHide = hiddenLabels.indexOf(label) >= 0
      var shown = true
      try {
        var cur = rows[i].style ? rows[i].style.display : ''
        var imp = ''
        try {
          imp = rows[i].style.getPropertyPriority('display')
        } catch (error) {
          imp = ''
        }
        shown = !(cur === 'none' && imp === 'important')
      } catch (error) {
        shown = true
      }
      if (shouldHide !== !shown) {
        drift = true
        applyRowVisibility(rows[i], shouldHide)
      }
    }
    if (drift) scheduleReport('sidebar-heal')
  }

  /** 盯住左栏容器：它重渲染一次，我们就把用户的选择重新盖回去。 */
  function watchSidebarNav(nav) {
    if (typeof MutationObserver !== 'function' || !nav) return
    if (engine.navObserver && engine.navRef === nav) return
    if (engine.navObserver) {
      try {
        engine.navObserver.disconnect()
      } catch (error) {
        /* ignore */
      }
      engine.navObserver = null
    }
    engine.navRef = nav
    try {
      engine.navObserver = new MutationObserver(function () {
        if (engine.navTimer) return
        engine.navTimer = setTimeout(function () {
          engine.navTimer = null
          try {
            reapplySidebar()
          } catch (error) {
            noteError(error, 'sidebar-heal')
          }
        }, 150)
      })
      engine.navObserver.observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
    } catch (error) {
      noteError(error, 'sidebar-watch')
    }
  }

  /** 用户点左栏某一行的开关：记进 localStorage，然后重新同步一次。 */
  function toggleSidebarRow(key) {
    if (!key) return
    var next = readStore()
    var list = next.sidebar.hiddenLabels || []
    var at = list.indexOf(key)
    if (at >= 0) list.splice(at, 1)
    else list.push(key)
    next.sidebar.hiddenLabels = list
    writeStore(next)
    // 立刻生效：不走 debounce，否则用户会以为「点一次没反应」
    try {
      syncNow('sidebar-row')
    } catch (error) {
      noteError(error, 'sidebar-row')
    }
    renderManager()
    scheduleReport('manual')
  }

  /* ---- 调度 / 观察 / 自愈 ------------------------------------------------- */

  function scheduleSync(reason) {
    engine.pendingReason = reason || 'unknown'
    if (engine.syncTimer) return
    engine.syncTimer = setTimeout(function () {
      engine.syncTimer = null
      syncNow(engine.pendingReason)
    }, engine.cfg.syncDebounceMs)
  }

  function bindResizeTargets() {
    var ro = engine.resizeObserver
    if (!ro) return
    var row = engine.anchor ? engine.anchor.titleRow : null
    if (engine.boundRow === row) return
    try {
      ro.disconnect()
    } catch (error) {
      /* ignore */
    }
    engine.boundRow = row || null
    if (!row) return
    try {
      ro.observe(row)
      if (engine.anchor.cluster) ro.observe(engine.anchor.cluster)
      if (engine.anchor.utilities) ro.observe(engine.anchor.utilities)
    } catch (error) {
      noteError(error, 'resize-observe')
    }
  }

  function containsAnchor(nodes) {
    if (!nodes) return false
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i]
      if (!isElement(node)) continue
      try {
        if (node.hasAttribute && node.hasAttribute('data-conversation-header-corner')) return true
        if (node.querySelector && (node.querySelector('[data-conversation-header-corner]') || node.querySelector('nav[class*="panelList"]'))) return true
      } catch (error) {
        /* ignore */
      }
    }
    return false
  }

  function isWithin(node, ancestor) {
    if (!node || !ancestor) return false
    if (node === ancestor) return true
    try {
      return typeof ancestor.contains === 'function' && ancestor.contains(node)
    } catch (error) {
      return false
    }
  }

  /**
   * 只对「我们关心的子树」的变化反应，避免聊天流式输出把同步刷爆。
   *
   * 注意 mutation 的 target 是真正被插删的父节点：插件条目挂在
   * div[data-slot]{display:contents} 里，那层在 .titleCluster / .headerUtilities 内部，
   * 所以判定必须用「在 titleRow 之内」而不是「等于某个容器」。corner 也是 titleRow 的子节点。
   */
  function interesting(records) {
    var anchor = engine.anchor
    for (var i = 0; i < records.length; i++) {
      var record = records[i]
      if (record.type !== 'childList') continue
      var target = record.target
      if (target && target.getAttribute && target.getAttribute(UI_ATTR)) continue
      if (anchor && isWithin(target, anchor.titleRow)) return true
      if (target && typeof target.className === 'string' && target.className.indexOf('panelList') >= 0) return true
      if (containsAnchor(record.addedNodes) || containsAnchor(record.removedNodes)) return true
    }
    return false
  }

  function observeDom() {
    if (typeof MutationObserver !== 'function') return
    // 观察 documentElement 而不是 body：客户端插件可能在 body 就绪前被 apply
    var root = document.documentElement || document.body
    if (!root) return
    engine.observer = new MutationObserver(function (records) {
      if (!interesting(records)) return
      // 关键一步：新会话挂载 / 切换会话时，React 一提交就把整排按钮画出来，
      // 我们再等 120ms 去量宽度，那一帧就已经被用户看见了（就是「闪一下」）。
      // MutationObserver 的回调跑在**绘制之前**，所以这里直接同步收一次，
      // 首帧画出来就是收好的状态。
      var anchorNow = null
      try {
        anchorNow = findAnchor()
      } catch (error) {
        anchorNow = null
      }
      if (anchorNow && (!engine.anchor || engine.anchor.titleRow !== anchorNow.titleRow)) {
        syncNow('mount')
        return
      }
      // React 重排会把节点换掉（新节点没有我们的内联 style）—— 同样抢在绘制前补回去
      var replaced = false
      for (var q = 0; q < engine.items.length; q++) {
        if (engine.items[q] && engine.items[q].el && engine.items[q].el.isConnected === false) {
          replaced = true
          break
        }
      }
      if (replaced) {
        syncNow('replaced')
        return
      }
      scheduleSync('mutation')
    })
    try {
      engine.observer.observe(root, { childList: true, subtree: true })
    } catch (error) {
      noteError(error, 'observe')
    }
  }

  function observeResize() {
    if (typeof ResizeObserver === 'function') {
      engine.resizeObserver = new ResizeObserver(function () {
        scheduleSync('resize-observer')
      })
    }
    try {
      window.addEventListener('resize', function () {
        scheduleSync('window-resize')
      })
    } catch (error) {
      /* ignore */
    }
  }

  /** 低频自愈：React 重渲染会重建节点（新节点没有我们的 style），这里兜住漏网的。 */
  function verify() {
    var anchor = findAnchor()
    if (!anchor) {
      if (engine.anchor) {
        engine.anchor = null
        engine.items = []
        if (engine.showMore) {
          engine.showMore = false
          emit()
        }
      }
      return
    }
    if (!engine.anchor || engine.anchor.titleRow !== anchor.titleRow) {
      scheduleSync('anchor-changed')
      return
    }
    for (var i = 0; i < engine.items.length; i++) {
      var item = engine.items[i]
      if (!item.el) continue
      if (item.el.isConnected === false) {
        scheduleSync('node-replaced')
        return
      }
      if ((item.el.style.display || '') !== (item.desiredDisplay || '')) {
        scheduleSync('drift-display')
        return
      }
      if (!item.el.getAttribute(KEY_ATTR)) {
        scheduleSync('drift-mark')
        return
      }
    }
    var nav = findPanelNav()
    var ourRow = null
    try {
      ourRow = nav ? nav.querySelector('[' + UI_ATTR + '="sidebar-more"]') : null
    } catch (error) {
      ourRow = null
    }
    if (nav && engine.sidebar.applied) {
      // 注意用「过滤后的真实面板行数」比较：raw querySelectorAll 会把 dsh-sidebar-entries
      // 自己插的 data-dse-ui 行也算进去，那样每次都会误判漂移、无限重排。
      var currentRows = panelRows(nav).length
      var currentHidden = 0
      for (var t = 0; t < sidebarTouched.length; t++) {
        if (sidebarTouched[t] && sidebarTouched[t].style && sidebarTouched[t].style.display === 'none') currentHidden++
      }
      if (currentRows !== engine.sidebar.rows || currentHidden !== engine.sidebar.hidden) {
        scheduleSync('sidebar-drift')
        return
      }
    }
    if (!engine.sidebar.applied && ourRow) scheduleSync('sidebar-stale')
  }

  function startVerify() {
    if (engine.verifyTimer) return
    engine.verifyTimer = setInterval(verify, engine.cfg.verifyIntervalMs)
    try {
      engine.verifyTimer.unref && engine.verifyTimer.unref()
    } catch (error) {
      /* ignore */
    }
  }

  /* ---- 一次完整同步 ------------------------------------------------------- */

  function syncNow(reason) {
    if (engine.running) return
    // 菜单打开期间不做重排：宿主的 popover 会让会话头重渲染一次，
    // 这时若重新量宽度，收纳集合可能抖动一下，表现就是 » 左右挪一下再回来。
    if (engine.menuOpen === true && reason !== 'mount' && reason !== 'sidebar-row') return
    engine.running = true
    try {
      var anchor = findAnchor()
      engine.anchor = anchor
      if (!anchor) {
        engine.items = []
        if (engine.showMore) {
          engine.showMore = false
          emit()
        }
        renderSidebar(readStore())
        return
      }

      var store = readStore()
      var items = collectItems(anchor)
      resolveStates(items, store)
      engine.items = items

      var plan =
        engine.cfg.overflow === false ? { tuck: [], overflow: false } : computePlan(anchor, items)
      engine.plan = plan

      var manualCount = 0
      for (var i = 0; i < items.length; i++) {
        if (items[i].state === 'hidden' || items[i].state === 'more') manualCount++
      }
      engine.manualCount = manualCount

      // 「»」按钮本身是 flex 流里的一项：先决定要不要它，再让 React 提交，
      // 下一帧用「按钮已在流里」的真实几何重算一次（比硬预留 36px 更准）。
      var needMore = plan.tuck.length > 0 || manualCount > 0
      if (needMore !== engine.showMore) {
        engine.showMore = needMore
        emit()
        scheduleSync('post-more')
      }

      applyPlan(items, plan, store)
      buildRows(items, plan)
      renderSidebar(store)
      bindResizeTargets()
      flushSignature()
      scheduleReport('sync')
      log(
        'sync(' +
          reason +
          ') items=' +
          items.length +
          ' tuck=' +
          plan.tuck.length +
          ' overflow=' +
          plan.overflow +
          ' showMore=' +
          engine.showMore +
          ' mode=' +
          engine.entryMode,
      )
    } catch (error) {
      noteError(error, 'sync')
    } finally {
      engine.running = false
    }
  }

  function flushSignature() {
    var parts = [engine.showMore ? 'm1' : 'm0', 't' + engine.rows.length]
    for (var i = 0; i < engine.rows.length; i++) parts.push(engine.rows[i].key + ':' + engine.rows[i].state)
    var sig = parts.join('|')
    if (sig !== engine.signature) {
      engine.signature = sig
      emit()
    }
  }

  /* ---- 供 React 侧订阅 ---------------------------------------------------- */

  function subscribe(listener) {
    if (typeof listener !== 'function') return function () {}
    engine.listeners.push(listener)
    return function () {
      var at = engine.listeners.indexOf(listener)
      if (at >= 0) engine.listeners.splice(at, 1)
    }
  }

  function rebuildSnapshot() {
    engine.snapshot = {
      showMore: engine.showMore,
      rows: engine.rows.slice(),
      count: engine.rows.length,
      manualCount: engine.manualCount,
    }
  }

  function getSnapshot() {
    if (!engine.snapshot) rebuildSnapshot()
    return engine.snapshot
  }

  function emit() {
    rebuildSnapshot()
    var list = engine.listeners.slice()
    for (var i = 0; i < list.length; i++) {
      try {
        list[i]()
      } catch (error) {
        noteError(error, 'listener')
      }
    }
  }

  /* ========================================================================
   * 6. 遥测回执（验收用：宿主只存内存最后一份）
   * ===================================================================== */

  function noteError(error, where) {
    var message = ''
    var stack = ''
    if (error && typeof error === 'object') {
      message = error.message ? String(error.message) : String(error)
      stack = error.stack ? String(error.stack) : ''
    } else {
      message = String(error)
    }
    if (where) message = '[' + where + '] ' + message
    engine.errors.unshift({
      message: message.slice(0, 300),
      stack: stack.slice(0, 600),
      at: Date.now(),
    })
    if (engine.errors.length > 8) engine.errors.length = 8
    log('error:', message)
    scheduleReport('error')
  }

  function bestEffortSessionId() {
    try {
      var el = document.querySelector('[data-session-id]')
      if (el) {
        var attr = el.getAttribute('data-session-id')
        if (attr) return attr
      }
      var search = (window.location && window.location.search) || ''
      var byQuery = /(?:^|[?&])session(?:Id)?=([^&]+)/.exec(search)
      if (byQuery) return decodeURIComponent(byQuery[1])
      var hash = (window.location && window.location.hash) || ''
      var byHash = /session\/([A-Za-z0-9-]+)/.exec(hash)
      if (byHash) return byHash[1]
    } catch (error) {
      /* 拿不到就算了，上报里留空 */
    }
    return ''
  }

  /**
   * 上报用的容器事实。
   * 插槽容器本身是 display:contents，clientWidth/scrollWidth 恒为 0，光看这两个数没法判断
   * "到底还溢出多少"，所以额外给 visible/maxRight/limit/overflowPx —— 验收时只看
   * overflowPx <= 0 就能确认这一簇没被裁。
   */
  function containerFacts(slot, el, slotItems, limit) {
    var clientWidth = 0
    var scrollWidth = 0
    if (el) {
      try {
        clientWidth = el.clientWidth || 0
        scrollWidth = el.scrollWidth || 0
      } catch (error) {
        clientWidth = 0
        scrollWidth = 0
      }
    }
    var list = slotItems || []
    var maxRight = 0
    var visible = 0
    var hidden = 0
    for (var i = 0; i < list.length; i++) {
      var item = list[i]
      if (item.desiredDisplay === 'none') {
        hidden++
        continue
      }
      visible++
      try {
        var right = item.el.getBoundingClientRect().right
        if (right > maxRight) maxRight = right
      } catch (error) {
        /* ignore */
      }
    }
    var overflowPx = 0
    if (typeof limit === 'number' && isFinite(limit) && maxRight > 0) overflowPx = Math.round(maxRight - limit)
    return {
      slot: slot,
      found: !!el,
      clientWidth: clientWidth,
      scrollWidth: scrollWidth,
      visible: visible,
      hidden: hidden,
      maxRight: Math.round(maxRight),
      limit: isFinite(limit) ? Math.round(limit) : null,
      overflowPx: overflowPx,
    }
  }

  function itemsOfSlot(slot) {
    var out = []
    for (var i = 0; i < engine.items.length; i++) {
      if (engine.items[i].slot === slot) out.push(engine.items[i])
    }
    return out
  }

  function buildReport() {
    var viewport = { w: 0, h: 0, dpr: 0 }
    try {
      viewport.w = window.innerWidth || 0
      viewport.h = window.innerHeight || 0
      viewport.dpr = window.devicePixelRatio || 1
    } catch (error) {
      /* ignore */
    }

    var anchor = engine.anchor
    var items = []
    for (var i = 0; i < engine.items.length; i++) {
      var item = engine.items[i]
      items.push({
        key: item.key,
        slot: item.slot,
        label: item.label,
        tag: item.tag,
        state: item.state, // auto | always | more | hidden
        order: typeof item.rank === 'number' ? item.rank : typeof item.index === 'number' ? item.index : 0,
        width: Math.round(item.width || 0),
        dup: item.dup === true,
        tucked: item.tucked === true,
        actionable: item.actionable === true,
        decorative: item.decorative === true,
        invisible: item.invisible === true,
        id: item.id || '',
        registrant: item.registrant || '',
      })
    }

    var limits = anchor ? currentLimits(anchor) : { row: Infinity, cluster: Infinity }
    var sb = engine.sidebar
    return {
      v: 1,
      at: Date.now(),
      viewport: viewport,
      sessionId: bestEffortSessionId(),
      entryMode: engine.entryMode,
      overflowEnabled: engine.cfg.overflow !== false,
      limits: { row: isFinite(limits.row) ? Math.round(limits.row) : null, cluster: isFinite(limits.cluster) ? Math.round(limits.cluster) : null },
      containers: [
        containerFacts('actions', anchor && anchor.actions, itemsOfSlot('actions'), limits.cluster),
        containerFacts('utilities', anchor && anchor.utilities, itemsOfSlot('utilities'), limits.row),
        containerFacts('corner', anchor && (anchor.cornerHost || anchor.corner), itemsOfSlot('corner'), limits.row),
      ],
      items: items,
      sidebar: {
        found: sb.found === true,
        detected: sb.detected || '',
        foreign: sb.foreign === true,
        applied: sb.applied === true,
        rows: sb.rows || 0,
        hidden: sb.hidden || 0,
        // 逐项开关：把用户勾掉的行名也报上来，便于宿主侧核对
        hiddenLabels: (function () {
          try {
            return (readStore().sidebar.hiddenLabels || []).slice(0, 32)
          } catch (error) {
            return []
          }
        })(),
        rows_detail: (engine.sidebarRows || []).slice(0, 32).map(function (row) {
          return row.label + (row.hidden ? ' [x]' : ' [ ]')
        }),
      },
      errors: engine.errors.slice(0, 5),
      // 诊断：最近一次点 » 前后它自己的水平位置（有位移才会写）
      triggerShift: engine.triggerShift || null,
    }
  }

  function scheduleReport(reason) {
    if (engine.cfg.reportEnabled === false) return
    engine.reportReason = reason || 'unknown'
    if (engine.reportTimer) return
    engine.reportTimer = setTimeout(function () {
      engine.reportTimer = null
      flushReport()
    }, engine.cfg.reportDebounceMs)
  }

  function flushReport() {
    var payload
    try {
      payload = buildReport()
    } catch (error) {
      return
    }
    try {
      fetch('/header-dock/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
        keepalive: true,
      }).catch(function () {
        /* 宿主没起 / 端点没挂：静默 */
      })
    } catch (error) {
      /* ignore */
    }
  }

  function installErrorHooks() {
    function isOurs(text) {
      var s = String(text || '')
      return s.indexOf('header-dock') >= 0 || s.indexOf('dsh-dock') >= 0 || s.indexOf('headerDock') >= 0
    }
    try {
      window.addEventListener('error', function (event) {
        var message = (event && event.message) || ''
        var stack = (event && event.error && event.error.stack) || (event && event.filename ? event.filename + ':' + event.lineno : '')
        if (!isOurs(message) && !isOurs(stack)) return
        noteError({ message: message || 'error', stack: stack }, 'window.error')
      })
      window.addEventListener('unhandledrejection', function (event) {
        var reason = event && event.reason
        var message = reason && reason.message ? reason.message : String(reason)
        var stack = reason && reason.stack ? reason.stack : ''
        if (!isOurs(message) && !isOurs(stack)) return
        noteError({ message: message, stack: stack }, 'unhandledrejection')
      })
    } catch (error) {
      /* ignore */
    }
  }

  function loadConfig() {
    function apply(value) {
      if (!value || typeof value !== 'object') return
      var cfg = value.config && typeof value.config === 'object' ? value.config : value
      if (typeof cfg.overflow === 'boolean') engine.cfg.overflow = cfg.overflow
      if (typeof cfg.sidebarFold === 'boolean') engine.cfg.sidebarFold = cfg.sidebarFold
      if (typeof cfg.sidebarLimit === 'number' && isFinite(cfg.sidebarLimit)) {
        engine.cfg.sidebarLimit = Math.max(1, Math.round(cfg.sidebarLimit))
      }
      if (typeof cfg.debug === 'boolean') engine.cfg.debug = cfg.debug
      if (typeof cfg.reportEnabled === 'boolean') engine.cfg.reportEnabled = cfg.reportEnabled
      scheduleSync('config')
    }
    try {
      if (typeof fetch !== 'function') return
      fetch('/header-dock/config', { cache: 'no-store' })
        .then(function (response) {
          return response && response.ok ? response.json() : null
        })
        .then(apply)
        .catch(function () {
          /* 宿主端点缺失时按默认值工作 */
        })
    } catch (error) {
      /* ignore */
    }
  }

  /* ========================================================================
   * 7. 管理面板（原生 DOM，避免依赖未知的原语 props）
   * ===================================================================== */

  function node(tag, props, kids) {
    var out = document.createElement(tag)
    if (props) {
      for (var key in props) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) continue
        var value = props[key]
        if (value === undefined || value === null || value === false) continue
        if (key === 'text') {
          out.textContent = String(value)
          continue
        }
        if (key === 'className') {
          out.className = String(value)
          continue
        }
        if (key === 'style' && typeof value === 'object') {
          for (var prop in value) out.style[prop] = value[prop]
          continue
        }
        if (key.length > 2 && key.slice(0, 2) === 'on' && typeof value === 'function') {
          out.addEventListener(key.slice(2).toLowerCase(), value)
          continue
        }
        out.setAttribute(key, String(value))
      }
    }
    if (kids) {
      for (var i = 0; i < kids.length; i++) if (kids[i]) out.appendChild(kids[i])
    }
    return out
  }

  function setItemState(key, state) {
    var store = readStore()
    var rec = store.items[key] || {}
    var next = normalizeState(state)
    if (next === 'auto') delete rec.state
    else rec.state = next
    if (!rec.state && rec.order === undefined) delete store.items[key]
    else store.items[key] = rec
    writeStore(store)
    scheduleSync('panel-state')
    renderManager()
    scheduleReport('manual')
  }

  function moveItem(key, delta) {
    var store = readStore()
    var target = null
    var i
    for (i = 0; i < engine.items.length; i++) if (engine.items[i].key === key) target = engine.items[i]
    if (!target) return

    var group = []
    for (i = 0; i < engine.items.length; i++) {
      if (engine.items[i].slot === target.slot) group.push(engine.items[i])
    }
    var orderInput = []
    for (i = 0; i < group.length; i++) {
      var rec = store.items[group[i].key]
      orderInput.push({
        key: group[i].key,
        slot: group[i].slot,
        index: group[i].index,
        order: rec && typeof rec.order === 'number' ? rec.order : NaN,
      })
    }
    var ranks = CORE.rankOrders(orderInput)
    var sorted = group.slice().sort(function (a, b) {
      return ranks[a.key] - ranks[b.key]
    })
    var at = -1
    for (i = 0; i < sorted.length; i++) if (sorted[i].key === key) at = i
    var to = at + delta
    if (at < 0 || to < 0 || to >= sorted.length) return

    var a = sorted[at]
    var b = sorted[to]
    var aRec = store.items[a.key] || {}
    var bRec = store.items[b.key] || {}
    var aOrder = typeof aRec.order === 'number' ? aRec.order : ranks[a.key]
    var bOrder = typeof bRec.order === 'number' ? bRec.order : ranks[b.key]

    aRec.order = bOrder
    if (!aRec.state) aRec.state = 'auto'
    bRec.order = aOrder
    if (!bRec.state) bRec.state = 'auto'
    store.items[a.key] = aRec
    store.items[b.key] = bRec
    writeStore(store)
    scheduleSync('panel-move')
    renderManager()
    scheduleReport('manual')
  }

  function resetAll() {
    clearStore()
    scheduleSync('panel-reset')
    renderManager()
    scheduleReport('manual')
    showToastInPanel(t('resetDone'))
  }

  function showToastInPanel(message) {
    var overlay = engine.panelEl
    if (!overlay) return
    var card = overlay.querySelector('.dsh-dock-panel__card') || overlay
    var note = card.querySelector('.dsh-dock-note')
    if (!note) {
      note = node('div', { className: 'dsh-dock-note' })
      card.appendChild(note)
    }
    note.textContent = message
    setTimeout(function () {
      if (note && note.textContent === message) note.textContent = ''
    }, 2600)
  }

  var STATE_ORDER = ['auto', 'always', 'more', 'hidden']
  var STATE_LABEL_KEY = { auto: 'stateAuto', always: 'stateAlways', more: 'stateMore', hidden: 'stateHidden' }
  var SLOT_LABEL_KEY = { actions: 'slotActions', utilities: 'slotUtilities', corner: 'slotCorner' }

  function renderManager() {
    var root = engine.panelEl
    if (!root) return
    var store = readStore()
    var body = root.querySelector('.dsh-dock-panel__body')
    if (!body) return
    // 记住滚动位置：面板是整块重建的，不还原的话每点一下都会跳回最顶上
    var keepScroll = body.scrollTop
    while (body.firstChild) body.removeChild(body.firstChild)

    if (engine.items.length === 0) {
      body.appendChild(node('div', { className: 'dsh-dock-empty', text: t('emptyItems') }))
    }

    var slots = ['actions', 'utilities', 'corner']
    for (var s = 0; s < slots.length; s++) {
      var slot = slots[s]
      var group = []
      for (var i = 0; i < engine.items.length; i++) {
        if (engine.items[i].slot === slot) group.push(engine.items[i])
      }
      if (group.length === 0) continue

      body.appendChild(node('div', { className: 'dsh-dock-group', text: t(SLOT_LABEL_KEY[slot] || slot) }))

      for (var g = 0; g < group.length; g++) {
        var item = group[g]
        var rec = store.items[item.key] || {}
        var current = normalizeState(item.state)

        var seg = node('div', { className: 'dsh-dock-seg' })
        for (var k = 0; k < STATE_ORDER.length; k++) {
          var option = STATE_ORDER[k]
          seg.appendChild(
            node('button', {
              type: 'button',
              text: t(STATE_LABEL_KEY[option]),
              'data-on': current === option ? '1' : '0',
              title: t('manageHint'),
              onClick: (function (key, next) {
                return function (event) {
                  try {
                    event.stopPropagation()
                  } catch (error) {
                    /* ignore */
                  }
                  setItemState(key, next)
                }
              })(item.key, option),
            }),
          )
        }

        var metaParts = [item.key]
        if (item.registrant) metaParts.push(t('source', { pkg: item.registrant }))

        var upDisabled = g === 0
        var downDisabled = g === group.length - 1
        var nudge = node('div', { className: 'dsh-dock-nudge' }, [
          node('button', {
            type: 'button',
            text: '▲',
            title: t('up'),
            disabled: upDisabled ? 'disabled' : null,
            // 用 IIFE 把 key 固定住：var 声明的 item 在循环里是同一个变量，
            // 直接引用会让所有按钮都指向最后一项。
            onClick: (function (key) {
              return function (event) {
                try {
                  event.stopPropagation()
                } catch (error) {
                  /* ignore */
                }
                moveItem(key, -1)
              }
            })(item.key),
          }),
          node('button', {
            type: 'button',
            text: '▼',
            title: t('down'),
            disabled: downDisabled ? 'disabled' : null,
            onClick: (function (key) {
              return function (event) {
                try {
                  event.stopPropagation()
                } catch (error) {
                  /* ignore */
                }
                moveItem(key, 1)
              }
            })(item.key),
          }),
        ])

        var main = node('div', { className: 'dsh-dock-row__main' }, [
          node('div', { className: 'dsh-dock-row__label', text: item.label }),
          node('div', { className: 'dsh-dock-row__meta', text: metaParts.join(' · ') }),
        ])

        body.appendChild(
          node('div', { className: 'dsh-dock-row' }, [
            main,
            item.dup ? node('span', { className: 'dsh-dock-badge', text: t('dup') }) : null,
            item.actionable !== true
              ? node('span', { className: 'dsh-dock-badge dsh-dock-badge--muted', text: t('viewOnly') })
              : null,
            seg,
            nudge,
          ]),
        )
      }
    }

    /* ---- 左栏：逐项显示 / 隐藏 ---- */
    var sb = engine.sidebar
    var rowList = engine.sidebarRows || []

    body.appendChild(node('div', { className: 'dsh-dock-group', text: t('sidebarTitle') }))
    body.appendChild(node('div', { className: 'dsh-dock-panel__hint', text: t('sidebarRowsHint') }))

    if (!sb.found) {
      body.appendChild(
        node('div', { className: 'dsh-dock-row' }, [
          node('div', { className: 'dsh-dock-row__main' }, [
            node('div', { className: 'dsh-dock-row__label', text: '-' }),
            node('div', { className: 'dsh-dock-row__meta', text: t('sidebarMissing') }),
          ]),
        ]),
      )
    }

    for (var ri = 0; ri < rowList.length; ri++) {
      var srow = rowList[ri]
      body.appendChild(
        node('div', { className: 'dsh-dock-row' }, [
          node('div', { className: 'dsh-dock-row__main' }, [
            node('div', { className: 'dsh-dock-row__label', text: srow.label }),
            node('div', {
              className: 'dsh-dock-row__meta',
              text: srow.hidden ? t('stateOff') : t('stateOn'),
            }),
          ]),
          node('button', {
            type: 'button',
            className: srow.hidden ? 'dsh-dock-btn' : 'dsh-dock-btn dsh-dock-btn--pri',
            text: srow.hidden ? t('turnOn') : t('turnOff'),
            // 同上：IIFE 固定 key，否则循环变量会把所有开关都指向最后一行
            onClick: (function (key) {
              return function (event) {
                try {
                  event.stopPropagation()
                } catch (error) {
                  /* ignore */
                }
                toggleSidebarRow(key)
              }
            })(srow.key),
          }),
        ]),
      )
    }

    var foot = root.querySelector('.dsh-dock-panel__foot')
    if (foot) {
      var countLabel = foot.querySelector('[data-dsh-dock-count]')
      if (countLabel) countLabel.textContent = t('count', { n: engine.items.length })
    }
    try {
      body.scrollTop = keepScroll
    } catch (error) {
      /* ignore */
    }
  }

  function openManager() {
    if (engine.panelEl) {
      renderManager()
      return
    }
    var head = node('div', { className: 'dsh-dock-panel__head' }, [
      node('div', { className: 'dsh-dock-panel__title', text: t('manage') }),
      node('button', {
        type: 'button',
        className: 'dsh-dock-btn',
        text: t('close'),
        onClick: function () {
          closeManager()
        },
      }),
    ])
    var hint = node('div', { className: 'dsh-dock-panel__hint', text: t('manageHint') })
    var body = node('div', { className: 'dsh-dock-panel__body' })
    var foot = node('div', { className: 'dsh-dock-panel__foot' }, [
      node('button', {
        type: 'button',
        className: 'dsh-dock-btn',
        text: t('reset'),
        onClick: function () {
          resetAll()
        },
      }),
      node('span', { className: 'dsh-dock-panel__spacer' }),
      node('span', { className: 'dsh-dock-row__meta', 'data-dsh-dock-count': '' }),
    ])
    var card = node('div', { className: 'dsh-dock-panel__card' }, [head, hint, body, foot])
    var overlay = node('div', { className: 'dsh-dock-panel', 'data-dsh-dock-ui': 'panel' }, [card])
    overlay.addEventListener('mousedown', function (event) {
      if (event.target === overlay) closeManager()
    })
    overlay.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeManager()
      }
    })
    document.body.appendChild(overlay)
    engine.panelEl = overlay
    // 面板里的按钮可能没拿到焦点，Esc 得挂在 document 上才可靠
    engine.panelKey = function (event) {
      if (event.key === 'Escape') closeManager()
    }
    try {
      document.addEventListener('keydown', engine.panelKey, true)
    } catch (error) {
      /* ignore */
    }
    try {
      var firstButton = card.querySelector('button')
      if (firstButton) firstButton.focus()
    } catch (error) {
      /* ignore */
    }
    renderManager()
    scheduleReport('panel-open')
  }

  function closeManager() {
    if (!engine.panelEl) return
    try {
      if (engine.panelKey) document.removeEventListener('keydown', engine.panelKey, true)
    } catch (error) {
      /* ignore */
    }
    engine.panelKey = null
    try {
      engine.panelEl.parentNode.removeChild(engine.panelEl)
    } catch (error) {
      /* ignore */
    }
    engine.panelEl = null
  }

  /* ========================================================================
   * 8. 启动
   * ===================================================================== */

  function injectStyles() {
    if (!document.head) return
    if (document.querySelector('style[data-dsh-dock]')) return
    var style = document.createElement('style')
    style.setAttribute('data-dsh-dock', '')
    style.textContent = CSS
    try {
      document.head.appendChild(style)
    } catch (error) {
      noteError(error, 'styles')
    }
  }

  function start(ctx) {
    if (engine.started) return
    engine.started = true
    engine.ctx = ctx || null
    try {
      engine.slots = ctx && ctx.slots ? ctx.slots : null
    } catch (error) {
      engine.slots = null
    }
    injectStyles()
    installErrorHooks()
    loadConfig()
    observeDom()
    observeResize()
    startVerify()
    scheduleSync('boot')

    // 卸载时把定时器/观察器收干净：客户端热更新会重新 apply 一次
    try {
      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(function () {
          return function () {
            try {
              if (engine.verifyTimer) clearInterval(engine.verifyTimer)
            } catch (error) {
              /* ignore */
            }
            engine.verifyTimer = null
            try {
              if (engine.syncTimer) clearTimeout(engine.syncTimer)
            } catch (error) {
              /* ignore */
            }
            engine.syncTimer = null
            try {
              if (engine.observer) engine.observer.disconnect()
            } catch (error) {
              /* ignore */
            }
            try {
              closeManager()
            } catch (error) {
              /* ignore */
            }
            engine.started = false
          }
        }, 'dsh-header-dock: timers')
      }
    } catch (error) {
      /* 拿不到 ctx.effect 就让它挂着，不影响功能 */
    }
  }

  /* ========================================================================
   * 9. React 侧：触发器（注册进 header.utilities）+ ⋯ 菜单里的管理行
   *
   *    触发器走插槽注册而不是 appendChild —— 由 React 创建、由 React 回收，
   *    从根上绕开 C2 的 removeChild 风险。
   * ===================================================================== */

  /** 克隆一份原节点只作视觉：去掉身份属性、禁掉指针与 tab，避免假控件被点到/选中。 */
  function sanitizeClone(clone) {
    if (!clone || !clone.querySelectorAll) return
    try {
      clone.removeAttribute(KEY_ATTR)
      clone.removeAttribute(STATE_ATTR)
      clone.removeAttribute(UI_ATTR)
      clone.removeAttribute('id')
      clone.setAttribute('aria-hidden', 'true')
      clone.setAttribute('tabindex', '-1')
      if (clone.style) {
        clone.style.display = ''
        clone.style.pointerEvents = 'none'
      }
      var all = clone.querySelectorAll('*')
      for (var i = 0; i < all.length; i++) {
        var child = all[i]
        try {
          child.removeAttribute('id')
          child.setAttribute('tabindex', '-1')
          if (child.style) child.style.pointerEvents = 'none'
        } catch (error) {
          /* ignore */
        }
      }
    } catch (error) {
      /* 克隆失败就只显示文字标签 */
    }
  }

  function makeComponents(require) {
    var React = null
    try {
      React = require('react')
    } catch (error) {
      React = null
    }
    if (!React && typeof globalThis === 'object' && globalThis) React = globalThis.React
    if (!React) throw new Error('dsh-header-dock: React runtime unavailable')

    var h = React.createElement
    var Fragment = React.Fragment

    // 原语按包名 require（平台模块表里白名单内）；拿不到就退回原生元素
    var primitives = null
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch (error) {
      primitives = null
    }
    var Menu = primitives && typeof primitives.Menu === 'function' ? primitives.Menu : null
    var MenuItemButton = primitives && typeof primitives.MenuItemButton === 'function' ? primitives.MenuItemButton : null

    function useDockState() {
      if (typeof React.useSyncExternalStore === 'function') {
        return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
      }
      var pair = React.useState(getSnapshot())
      React.useEffect(function () {
        return subscribe(function () {
          pair[1](getSnapshot())
        })
      }, [])
      return pair[0]
    }

    /**
     * 从一个原节点里挑出「真正的图标」：优先面积最大的那个 svg，其次 img。
     *
     * 只取图标本体、绝不克隆整颗按钮 —— 以前 cloneNode(true) 会把按钮里的文字
     * （"分享"、"MEM 38%"…）一起搬进来，塞进 16px 的图标盒后被裁成半个字，
     * 看上去就像每个行首都重影了。
     */
    function pickIcon(node) {
      if (!node) return null
      var tag = String(node.tagName || '').toLowerCase()
      var candidates = []
      if (tag === 'svg') candidates.push(node)
      if (typeof node.querySelectorAll === 'function') {
        var svgs = node.querySelectorAll('svg')
        for (var i = 0; i < svgs.length; i++) candidates.push(svgs[i])
      }
      if (candidates.length === 0 && typeof node.querySelectorAll === 'function') {
        var imgs = node.querySelectorAll('img')
        for (var j = 0; j < imgs.length; j++) candidates.push(imgs[j])
      }
      if (candidates.length === 0) return null
      var best = candidates[0]
      var bestArea = -1
      for (var k = 0; k < candidates.length; k++) {
        var rect = null
        try {
          rect = candidates[k].getBoundingClientRect()
        } catch (error) {
          rect = null
        }
        var area = rect ? (rect.width || 0) * (rect.height || 0) : 0
        if (area > bestArea) {
          bestArea = area
          best = candidates[k]
        }
      }
      var clone = null
      try {
        clone = best.cloneNode(true)
      } catch (error) {
        return null
      }
      if (!clone) return null
      try {
        clone.setAttribute('aria-hidden', 'true')
        clone.setAttribute('focusable', 'false')
        clone.style.width = '16px'
        clone.style.height = '16px'
        clone.style.flex = 'none'
        clone.style.pointerEvents = 'none'
      } catch (error) {
        /* ignore */
      }
      return clone
    }

    /** 把一个原节点的图标塞进行首（只作视觉，绝不带文字）。 */
    function Glyph(props) {
      var holder = React.useRef(null)
      React.useEffect(
        function () {
          var host = holder.current
          if (!host || !props.node) return
          while (host.firstChild) host.removeChild(host.firstChild)
          try {
            var icon = pickIcon(props.node)
            if (icon) host.appendChild(icon)
          } catch (error) {
            /* ignore */
          }
        },
        [props.node],
      )
      return h('span', { className: 'dsh-dock-glyph', 'aria-hidden': 'true', ref: holder })
    }

    /**
     * 「»」触发器。不需要时返回 null —— 此时它在 DOM 里不存在，也就完全不占宽度，
     * 所以宽屏下顶栏与未装插件时完全一致（验收第 2 条）。
     */
    function MoreButton() {
      var state = useDockState()
      var openPair = React.useState(false)
      var open = openPair[0]
      var setOpen = openPair[1]
      var ref = React.useRef(null)
      // 宿主 Menu 是「点外面就关」：点触发器本身也算外面，于是 onClose(false) 先把它关掉，
      // 紧接着我们的 onClick 又把 false 翻成 true —— 表现就是「点开后再点还是点开」「抖一下」。
      // 这里给触发器按下打个标记，让那一次 onClose 让路，由 onClick 独占切换权。
      var triggerPressed = React.useRef(false)

      React.useEffect(
        function () {
          if (!state.showMore && open) setOpen(false)
        },
        [state.showMore, open],
      )

      if (!state.showMore) {
        engine.menuOpen = false
        return null
      }
      // 让 syncNow 知道「浮层正开着」，别在这个窗口期重排
      engine.menuOpen = open === true

      var trigger = h(
        'button',
        {
          type: 'button',
          ref: ref,
          className: 'dsh-dock-more',
          'data-dsh-dock-ui': 'more',
          'aria-label': t('moreTitle'),
          'aria-haspopup': 'menu',
          'aria-expanded': open ? 'true' : 'false',
          title: t('moreTitle'),
          onPointerDown: function (event) {
            triggerPressed.current = true
            try {
              if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
            } catch (error) {
              /* ignore */
            }
            try {
              setTimeout(function () {
                triggerPressed.current = false
              }, 500)
            } catch (error) {
              /* ignore */
            }
          },
          onMouseDown: function (event) {
            triggerPressed.current = true
            try {
              if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
            } catch (error) {
              /* ignore */
            }
            try {
              setTimeout(function () {
                triggerPressed.current = false
              }, 500)
            } catch (error) {
              /* ignore */
            }
          },
          onClick: function (event) {
            try {
              if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
            } catch (error) {
              /* ignore */
            }
            // 诊断：记录点击前后触发器自身的水平位置，用来确认「点一下往左挪一下」的来源
            var beforeLeft = 0
            try {
              beforeLeft = ref.current ? ref.current.getBoundingClientRect().left : 0
            } catch (error) {
              beforeLeft = 0
            }
            setOpen(function (value) {
              return !value
            })
            // 注意：这里**不要**再强制 syncNow。打开菜单时人为重排一次，
            // 恰恰会让 » 在那一帧左右挪一下（就是用户看到的「点一下往左挪再回来」）。
            try {
              setTimeout(function () {
                try {
                  if (!ref.current) return
                  var afterLeft = ref.current.getBoundingClientRect().left
                  if (beforeLeft && Math.abs(afterLeft - beforeLeft) > 0.5) {
                    engine.triggerShift = {
                      before: Math.round(beforeLeft),
                      after: Math.round(afterLeft),
                      at: Date.now(),
                    }
                  }
                } catch (error) {
                  /* ignore */
                }
              }, 300)
            } catch (error) {
              /* ignore */
            }
          },
        },
        '»',
        state.count > 0 ? h('span', { className: 'dsh-dock-more__count' }, String(state.count)) : null,
      )

      var menu = null
      if (open && Menu && MenuItemButton) {
        var rows = state.rows.map(function (row) {
          var text = row.label || t('decorative')
          var icon = h(Glyph, { node: row.node })
          // 纯展示型条目（没有可点按钮，如 MEM 胶囊）：渲染成不可点的信息行。
          // 点了没反应比「看着像按钮但点不动」更让人困惑，所以这里直接不给交互。
          if (row.actionable !== true || !row.target) {
            return h(
              'div',
              { key: row.key, className: 'dsh-dock-info', 'aria-disabled': 'true' },
              icon,
              h('span', { className: 'dsh-dock-info__label' }, text),
              h('span', { className: 'dsh-dock-info__tag' }, t('viewOnly')),
            )
          }
          return h(
            MenuItemButton,
            {
              key: row.key,
              icon: icon,
              onSelect: function () {
                setOpen(false)
                // 先关自己的浮层、下一帧再点原节点：
                // 否则我们菜单的「点外面就关」可能把原插件刚弹出来的浮层一起关掉，
                // 用户就会觉得「点了没反应」。
                var node = row.target
                var fire = function () {
                  try {
                    if (node && typeof node.click === 'function') node.click()
                  } catch (error) {
                    noteError(error, 'drawer-click')
                  }
                }
                try {
                  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fire)
                  else setTimeout(fire, 0)
                } catch (error) {
                  fire()
                }
              },
            },
            text,
          )
        })
        if (rows.length === 0) {
          rows.push(h('div', { key: 'dsh-dock-empty', className: 'dsh-dock-empty' }, t('emptyDrawer')))
        }
        rows.push(
          h(
            MenuItemButton,
            {
              key: 'dsh-dock-manage',
              separatorBefore: true,
              onSelect: function () {
                setOpen(false)
                openManager()
              },
            },
            t('drawerFoot'),
          ),
        )
        menu = h(Menu, {
          open: open,
          onClose: function () {
            // 这次关闭是「点了触发器自己」引起的，切换权归 onClick，别在这里抢
            if (triggerPressed.current) return
            setOpen(false)
          },
          portal: true, // titleCluster 是 overflow:clip，浮层必须 portal 出去
          autoFocus: true,
          getAnchorRect: function () {
            try {
              return ref.current ? ref.current.getBoundingClientRect() : null
            } catch (error) {
              return null
            }
          },
          // 手机上项多时列表会顶出屏幕，套一层可滚动容器（只是布局，不搬任何原节点）。
          children: h('div', { className: 'dsh-dock-drawer', key: 'dsh-dock-drawer' }, rows),
        })
      }

      return h(Fragment, null, trigger, menu)
    }

    /**
     * 注意：0.2.0 起**不再**往会话头视图页签那一行的 ⋯ 菜单注册任何东西。
     * 管理面板的唯一入口是 » 抽屉末行的「管理顶栏…」（见 drawers 里的 drawerFoot 行）。
     */

    return {
      inject: ['slots', 'locale'],
      apply: function (ctx) {
        // 文案：注册进宿主 locale（便于统一管理），实际取值用内置字典按页面语言挑
        try {
          if (ctx && ctx.locale && typeof ctx.locale.register === 'function') {
            ctx.effect(function () {
              return ctx.locale.register(NS, DICT)
            }, 'dsh-header-dock: dictionaries')
          }
        } catch (error) {
          noteError(error, 'locale')
        }

        try {
          var lang = document && document.documentElement ? document.documentElement.lang : ''
          setDict(lang === 'en' ? DICT.en : DICT.zh)
        } catch (error) {
          setDict(DICT.zh)
        }

        try {
          start(ctx)
        } catch (error) {
          noteError(error, 'start')
        }

        try {
          if (ctx && ctx.slots) {
            // 顶栏里只注册「»」触发器；管理面板从抽屉里进（0.2.0 起不再往 ⋯ 菜单塞入口）。
            ctx.slots.inject(SLOT_UTILITIES, function () {
              return ctx.slots.register({ name: SLOT_UTILITIES, id: OWN_MORE_ID, order: 900 }, MoreButton)
            })
          }
        } catch (error) {
          noteError(error, 'slots')
        }
      },
    }
  }

  try {
    if (typeof window !== 'undefined' && window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === 'function') {
      window.__ModuleLoader__.load({
        id: LOADER_ID,
        factory: function (require) {
          var module = { exports: {} }
          var built = makeComponents(require)
          module.exports.apply = built.apply
          module.exports.inject = built.inject
          return module.exports
        },
      })
    }
  } catch (error) {
    var loadMessage = String((error && error.message) || error)
    if (!/duplicate factory registration/.test(loadMessage)) throw error
  }
})()
