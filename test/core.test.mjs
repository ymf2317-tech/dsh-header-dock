// dsh-header-dock · 纯函数核心单测（零依赖，node 直接跑）
//
// 只测 lib/client.js 里挂在 globalThis.__DSH_HEADER_DOCK_CORE__ 上的那批纯函数：
// 它们承载了「谁该被收起 / 身份 key / 排序 / 查重」这些真正容易出 bug 的判断。
// DOM 那一层（测量、写 style）需要真浏览器，见 docs/IMPLEMENTATION.md 的验证手段。
//
// 跑法：node test/core.test.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'lib', 'client.js')
const source = readFileSync(clientPath, 'utf8')

// 最小沙箱：只在 window.__ModuleLoader__.load 上打个空桩，factory 不会被调用，
// 所以不需要 React / DOM。模块顶层除了注册与暴露 CORE 之外不做任何事。
const sandbox = { console }
sandbox.window = { __ModuleLoader__: { load() {} } }
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'lib/client.js' })

const CORE = sandbox.__DSH_HEADER_DOCK_CORE__
assert.ok(CORE, 'lib/client.js 应当把纯函数核心挂到 globalThis.__DSH_HEADER_DOCK_CORE__')

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    console.error(`  FAIL ${name}`)
    console.error('       ' + (error && error.message ? error.message : String(error)))
    process.exitCode = 1
  }
}

/** vm 里造出来的对象是另一个 realm 的，deepEqual 会因原型不同失败 —— 先转成纯 JSON。 */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

console.log('CORE.normText / keyText / firstLine')

test('normText 折叠空白与截断', () => {
  assert.equal(CORE.normText('  a\n\n  b\tc  '), 'a b c')
  assert.equal(CORE.normText('abcdef', 3), 'abc')
  assert.equal(CORE.normText(null), '')
})

test('keyText 把数字归一成 #（跨刷新的 MEM 62% 落到同一个 key）', () => {
  assert.equal(CORE.keyText('MEM 62%'), 'mem #%')
  assert.equal(CORE.keyText('MEM  63 %'), 'mem # %')
  assert.equal(CORE.keyText('MEM 64%'), CORE.keyText('MEM 99%'))
})

test('firstLine 只取首行（memory-guard 的 title 是多行诊断信息）', () => {
  assert.equal(CORE.firstLine('Host heap: 1.2 GB\nRSS: 3 GB\nmore'), 'Host heap: 1.2 GB')
})

console.log('CORE.labelOf / buildKey / uniqueKeys')

test('labelOf 优先级：注册 label > aria-label > 短文案 > title 首行', () => {
  assert.equal(CORE.labelOf({ entryLabel: '注册名', ariaLabel: 'aria', textShort: '文本', title: 't' }), '注册名')
  assert.equal(CORE.labelOf({ ariaLabel: 'aria', textShort: '文本', title: 't' }), 'aria')
  assert.equal(CORE.labelOf({ textShort: '文本', title: '标题首行' }), '文本')
  assert.equal(CORE.labelOf({ title: '标题首行\n第二行' }), '标题首行')
  // 只有标签名时返回空串，由 UI 显示「未命名项」——绝不把 "span" 当标签
  assert.equal(CORE.labelOf({ tag: 'span' }), '')
})

test('buildKey 优先用注册 id：<slot>::<id>', () => {
  assert.equal(CORE.buildKey('actions', 'dsh-mneme:pipeline', {}), 'actions::dsh-mneme:pipeline')
  assert.equal(CORE.buildKey('utilities', 'memory-guard', { ariaLabel: '不应该用到我' }), 'utilities::memory-guard')
})

test('buildKey 没 id 时退到 DOM 特征（aria → title → text）', () => {
  assert.equal(CORE.buildKey('corner', '', { ariaLabel: '收起侧边栏' }), 'corner::dom:aria-收起侧边栏')
  assert.equal(CORE.buildKey('corner', '', { title: 'Close Panel' }), 'corner::dom:title-close panel')
  assert.equal(CORE.buildKey('corner', '', { text: 'MEM 62%' }), 'corner::dom:text-mem #%')
  assert.equal(CORE.buildKey('corner', '', { tag: 'SPAN' }), 'corner::dom:tag-span')
})

test('buildKey 优先用 data-* 属性', () => {
  assert.equal(
    CORE.buildKey('actions', '', { data: { 'data-entry-id': 'Alpha' } }),
    'actions::dom:data-alpha',
  )
})

test('uniqueKeys 给重复 key 补序号', () => {
  assert.deepEqual(plain(CORE.uniqueKeys(['a', 'b', 'a', 'a'])), ['a', 'b', 'a#2', 'a#3'])
})

console.log('CORE.pickOverflow（收纳决策）')

test('完全放得下时什么都不收', () => {
  const items = [
    { key: 'a', left: 32, right: 62, limit: 242, state: 'auto' },
    { key: 'b', left: 70, right: 100, limit: 242, state: 'auto' },
    { key: 'c', left: 108, right: 138, limit: 242, state: 'auto' },
  ]
  assert.deepEqual(plain(CORE.pickOverflow({ items })), { index: -1, overflow: false })
})

test('越界时收最右边那一项', () => {
  const items = [
    { key: 'a', left: 32, right: 62, limit: 106, state: 'auto' },
    { key: 'b', left: 70, right: 100, limit: 106, state: 'auto' },
    { key: 'c', left: 108, right: 138, limit: 106, state: 'auto' },
  ]
  assert.deepEqual(plain(CORE.pickOverflow({ items })), { index: 2, overflow: true })
})

test('收掉最右项后前面的项不会右移，所以第二步就该收敛', () => {
  const before = [
    { key: 'a', left: 32, right: 62, limit: 106, state: 'auto' },
    { key: 'b', left: 70, right: 100, limit: 106, state: 'auto' },
    { key: 'c', left: 108, right: 138, limit: 106, state: 'auto' },
  ]
  const first = CORE.pickOverflow({ items: before })
  assert.equal(first.index, 2)
  // 模拟「隐藏 c」后重新测量：a/b 的位置不变
  const after = before.slice(0, 2)
  assert.deepEqual(plain(CORE.pickOverflow({ items: after })), { index: -1, overflow: false })
})

test('always（常显）与 protected（corner）不参与自动收纳，但仍报 overflow', () => {
  const items = [
    { key: 'corner-toggle', left: 280, right: 320, limit: 250, state: 'auto', protected: true },
    { key: 'pinned', left: 200, right: 240, limit: 250, state: 'always' },
  ]
  assert.deepEqual(plain(CORE.pickOverflow({ items })), { index: -1, overflow: true })
})

test('受保护项越界时继续往左找可收的项', () => {
  const items = [
    { key: 'plain', left: 200, right: 260, limit: 250, state: 'auto' },
    { key: 'corner-toggle', left: 280, right: 320, limit: 250, state: 'auto', protected: true },
  ]
  assert.deepEqual(plain(CORE.pickOverflow({ items })), { index: 0, overflow: true })
})

test('0.5px 容差：亚像素误差不算溢出', () => {
  const items = [{ key: 'a', left: 32, right: 250.3, limit: 250, state: 'auto' }]
  assert.deepEqual(plain(CORE.pickOverflow({ items })), { index: -1, overflow: false })
})

console.log('CORE.mapEntries（entriesOfSlot ↔ DOM 对齐）')

test('数量一致时按下标对齐', () => {
  const entries = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
  const mapped = CORE.mapEntries(entries, ['A', 'B'])
  assert.equal(mapped.mode, 'index')
  assert.deepEqual(plain(mapped.mapping.map((e) => e.id)), ['a', 'b'])
})

test('数量不一致（有被遮蔽条目/组件返回 null）时退化为 label 匹配', () => {
  const entries = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]
  const mapped = CORE.mapEntries(entries, ['c', 'A'])
  assert.equal(mapped.mode, 'label')
  assert.deepEqual(plain(mapped.mapping.map((e) => (e ? e.id : null))), ['c', 'a'])
})

test('label 对不上时留空，交给 DOM 兜底 key', () => {
  const entries = [{ id: 'a', label: 'A' }]
  const mapped = CORE.mapEntries(entries, ['Z', 'A'])
  assert.equal(mapped.mode, 'label')
  assert.deepEqual(plain(mapped.mapping.map((e) => (e ? e.id : null))), [null, 'a'])
})

console.log('CORE.rankOrders（只在同簇内排序）')

test('同簇按 order 升序，无 order 的保持 DOM 顺序', () => {
  const ranks = CORE.rankOrders([
    { key: 'a1', slot: 'actions', index: 0, order: NaN },
    { key: 'a2', slot: 'actions', index: 1, order: 0.5 },
    { key: 'a3', slot: 'actions', index: 2, order: NaN },
  ])
  assert.deepEqual(plain(ranks), { a1: 1, a2: 0, a3: 2 })
})

test('不同簇各自从 0 开始排（跨簇搬 DOM 是不允许的）', () => {
  const ranks = CORE.rankOrders([
    { key: 'a', slot: 'actions', index: 0, order: 9 },
    { key: 'u', slot: 'utilities', index: 0, order: 9 },
    { key: 'c', slot: 'corner', index: 0, order: NaN },
  ])
  assert.deepEqual(plain(ranks), { a: 0, u: 0, c: 0 })
})

console.log('CORE.duplicateLabels（疑似重复）')

test('同归一 label 出现两次即计入', () => {
  const counts = CORE.duplicateLabels([
    { label: '多选' },
    { label: '多选 ' },
    { label: '设置' },
  ])
  assert.equal(counts['多选'], 2)
  assert.equal(counts['设置'], 1)
})

test('数字差异不算重复（MEM 62% 与 MEM 63% 视作同一项）', () => {
  const counts = CORE.duplicateLabels([{ label: 'MEM 62%' }, { label: 'MEM 63%' }])
  assert.equal(counts['mem #%'], 2)
})

console.log('locale 与内置文案表一致')

const DICT = sandbox.__DSH_HEADER_DOCK_DICT__
assert.ok(DICT, 'lib/client.js 应当把文案表挂到 globalThis.__DSH_HEADER_DOCK_DICT__')

function readLocale(name) {
  const raw = readFileSync(join(here, '..', 'locale', name), 'utf8')
  return JSON.parse(raw)
}

for (const [lang, file] of [
  ['zh', 'zh.json'],
  ['en', 'en.json'],
]) {
  test(`${file} 的 key 与 DICT.${lang} 完全对齐（缺失/多余都算错）`, () => {
    const dict = DICT[lang]
    const locale = readLocale(file)
    const dictKeys = Object.keys(dict).sort()
    const localeKeys = Object.keys(locale).sort()
    const missing = dictKeys.filter((key) => !localeKeys.includes(key))
    const extra = localeKeys.filter((key) => !dictKeys.includes(key))
    assert.deepEqual(missing, [], `${file} 缺少：${missing.join(', ')}`)
    assert.deepEqual(extra, [], `${file} 多出：${extra.join(', ')}`)
  })
}

test('DICT 每个 key 都是非空字符串（防手滑写成空串）', () => {
  for (const lang of ['zh', 'en']) {
    for (const [key, value] of Object.entries(DICT[lang])) {
      assert.equal(typeof value, 'string', `DICT.${lang}.${key} 不是字符串`)
      assert.ok(value.length > 0, `DICT.${lang}.${key} 是空字符串`)
    }
  }
})

test('源码里 t(\'…\') 用到的每个 key 都在 DICT.zh 里', () => {
  const used = new Set()
  const re = /\bt\('([A-Za-z][A-Za-z0-9]*)'/g
  let hit = re.exec(source)
  while (hit) {
    used.add(hit[1])
    hit = re.exec(source)
  }
  const unknown = [...used].filter((key) => !(key in DICT.zh))
  assert.deepEqual(unknown, [], `源码用了不存在的文案 key：${unknown.join(', ')}`)
})

console.log('DOM 判定（假元素，不碰布局）')

const DOM = sandbox.__DSH_HEADER_DOCK_DOM__
assert.ok(DOM, 'lib/client.js 应当把 DOM 判定挂到 globalThis.__DSH_HEADER_DOCK_DOM__')

/** 极简假元素：只要 tagName / children / getAttribute / querySelectorAll 就够这些判定用。 */
function makeNode(tag, attrs = {}, kids = [], text = '') {
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    children: kids,
    textContent: text,
    getAttribute(name) {
      return name in attrs ? attrs[name] : null
    },
    hasAttribute(name) {
      return name in attrs
    },
  }
  node.querySelectorAll = (selector) => {
    const wanted = new Set()
    for (const part of String(selector).split(',')) {
      const tagName = part.trim().replace(/\[.*$/, '').trim().toUpperCase()
      if (tagName) wanted.add(tagName)
    }
    const out = []
    const walk = (list) => {
      for (const child of list) {
        if (wanted.has(child.tagName)) out.push(child)
        if (child.children && child.children.length > 0) walk(child.children)
      }
    }
    walk(node.children)
    return out
  }
  node.querySelector = (selector) => {
    const list = node.querySelectorAll(selector)
    return list.length > 0 ? list[0] : null
  }
  return node
}

test('空 span 判定为不可见（不进抽屉）', () => {
  const empty = makeNode('span')
  assert.equal(DOM.hasVisual(empty), false, '没文字没图标的空壳 = 看不见')
})

test('MEM 胶囊与纯图标按钮判定为可见', () => {
  const chip = makeNode('span', {}, [], 'MEM 32% · 55.6 MB')
  assert.equal(DOM.hasVisual(chip), true, '有文字就得留在抽屉里（上一轮误杀过的坑）')
  const icon = makeNode('button', { 'aria-label': '设置' }, [makeNode('svg')])
  assert.equal(DOM.hasVisual(icon), true, '只有 svg 也算看得见')
})

test('包装层能解析出里面的 button 作为点击目标', () => {
  const inner = makeNode('button', { 'aria-label': '共享' })
  const wrapper = makeNode('span', {}, [inner])
  assert.equal(DOM.isActionable(wrapper), false, 'span 自己不可点')
  assert.equal(DOM.resolveTargetOf(wrapper), inner, '应当解析到内层 button')
  assert.equal(DOM.resolveTargetOf(inner), inner, '本身就是按钮时就是自己')
})

test('无 target 的节点仍进清单，且 actionable 为 false', () => {
  const chip = makeNode('span') // MEM 胶囊那种纯展示节点
  const button = makeNode('button', { 'aria-label': '设置' })
  const host = makeNode('div', {}, [chip, button])

  const kids = DOM.nodeChildren(host)
  assert.equal(kids.length, 2, '装饰节点不许被过滤掉：它同样占宽度、也要能被收起')
  assert.equal(DOM.resolveTargetOf(kids[0]), null)
  assert.equal(!!DOM.resolveTargetOf(kids[0]), false, 'actionable 由 !!target 推导，应为 false')
  assert.equal(!!DOM.resolveTargetOf(kids[1]), true)
})

test('我们自建的节点（data-dsh-dock-ui）不进清单', () => {
  const ours = makeNode('button', { 'data-dsh-dock-ui': 'more' })
  const theirs = makeNode('button', { 'aria-label': '设置' })
  const kids = DOM.nodeChildren(makeNode('div', {}, [ours, theirs]))
  assert.equal(kids.length, 1)
  assert.equal(kids[0], theirs)
})

console.log('')
if (process.exitCode) {
  console.error(`失败：见上面的 FAIL 行`)
} else {
  console.log(`全部通过：${passed} 个用例`)
}
