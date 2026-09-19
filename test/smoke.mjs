// Offline smoke test for the dsh-chat-rail browser half.
//
// It loads the real bundle through a stand-in `window.__ModuleLoader__`, then
// drives the parts that cannot be checked by reading the source: the snapshot
// reduction, the dash fitting/sampling math, the chat-frame measurement, the
// active-message resolution, the jump scroll, and a full React render of the
// registered component against a synthetic DOM.
//
// Run: node test/smoke.mjs
//
// The React runtime is taken from the installed harness so that the render uses
// the same version the browser does.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUNDLE = join(HERE, '..', 'dsh', 'client.js')
const DSH = 'D:/nodejs/npm_global/node_modules/@deepseek-ai/dsh/node_modules'

const reactModule = await import('file:///' + DSH + '/react/index.js')
const React = reactModule.default ?? reactModule
const serverModule = await import('file:///' + DSH + '/react-dom/server.js')
const renderToStaticMarkup = serverModule.renderToStaticMarkup ?? serverModule.default.renderToStaticMarkup

let failures = 0
function check(name, condition, detail) {
  if (condition) {
    console.log('  ok   ' + name)
    return
  }
  failures += 1
  console.error('  FAIL ' + name + (detail === undefined ? '' : ' — ' + detail))
}

// ---- synthetic DOM --------------------------------------------------------

function rect(left, top, right, bottom) {
  return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top }
}

function makeElement(options) {
  const settings = options ?? {}
  return {
    dataset: {},
    textContent: '',
    className: settings.className ?? '',
    style: {},
    getAttribute(name) {
      return settings.attributes?.[name] ?? null
    },
    getBoundingClientRect() {
      return settings.rect ?? rect(0, 0, 0, 0)
    },
    querySelector(selector) {
      return settings.children?.[selector] ?? null
    },
    querySelectorAll(selector) {
      return settings.lists?.[selector] ?? []
    },
    remove() {},
  }
}

// A 1440x900 frame: chat scrollport below a header, a 748px reading column
// centred inside it, and a 120px composer seat stuck to the bottom.
const LAYER_RECT = rect(0, 0, 1440, 900)
const BODY_RECT = rect(280, 120, 1440, 900)
const FLOW_RECT = rect(486, 136, 1234, 1200)
const COMPOSER_RECT = rect(486, 780, 1234, 900)

const layer = makeElement({ rect: LAYER_RECT })
const flow = makeElement({ rect: FLOW_RECT })
const composer = makeElement({ rect: COMPOSER_RECT })

function makeRow(key, top) {
  return makeElement({
    rect: rect(486, top, 1234, top + 80),
    attributes: { 'data-chat-anchor-key': key },
  })
}

const rows = [makeRow('n1', 40), makeRow('n3', 140), makeRow('n4', 500)]

const body = makeElement({
  rect: BODY_RECT,
  children: {
    '[data-chat-flow]': flow,
    '[data-composer-seat]': composer,
  },
  lists: { '[data-chat-anchor-key]': rows },
})
body.scrollTop = 300
body.scrollHeight = 1400
body.clientHeight = 780

const documentStub = {
  head: { appendChild() {} },
  body: makeElement({}),
  createElement: () => makeElement({}),
  querySelector(selector) {
    if (selector === '[data-shell-overlay]') return layer
    if (selector === '[data-conversation-scroll]') return body
    return null
  },
  addEventListener() {},
  removeEventListener() {},
}

// ---- load the real bundle through a stand-in module loader -----------------

let handoff = null
globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      handoff = value
    },
  },
  addEventListener() {},
  removeEventListener() {},
}
globalThis.document = documentStub

vm.runInThisContext(readFileSync(BUNDLE, 'utf8'), { filename: BUNDLE })

check('bundle registers itself as dsh-chat-rail', handoff !== null && handoff.id === 'dsh-chat-rail')

const bundle = handoff.factory((specifier) => {
  if (specifier === 'react') return React
  throw new Error('unexpected require: ' + specifier)
})

check('bundle exports a Cordis plugin', typeof bundle.apply === 'function' && Array.isArray(bundle.inject))
check('plugin declares no hard service dependency', bundle.inject.length === 0)

const internals = bundle.__internals

// ---- snapshot reduction ---------------------------------------------------

const contents = {
  n1: [{ type: 'text', text: '如何启用管理员权限' }],
  n2: [{ type: 'text', text: '（assistant，应被忽略）' }],
  n3: [{ type: 'text', text: '  import os\n   value=os.environ  ' }],
  n4: [{ type: 'image', attachment: 'a1' }],
  n5: [{ type: 'text', text: 'assistant tail' }],
}
const kinds = { n1: 'user', n2: 'assistant', n3: 'user', n4: 'steering', n5: 'assistant' }

const face = {
  getSnapshot() {
    return {
      chat: {
        order: ['n1', 'n2', 'n3', 'n4', 'n5', 'missing'],
        nodes: {
          get(key) {
            if (key === 'missing') return undefined
            return { key, kind: kinds[key], anchorSeq: 1, data: { content: contents[key] } }
          },
        },
      },
    }
  },
  subscribe() {
    return () => {}
  },
}

const reduced = internals.readItems(face)
check('reduction keeps only human messages, in flow order',
  reduced.items.map((item) => item.key).join(',') === 'n1,n3,n4',
  JSON.stringify(reduced.items.map((item) => item.key)))
check('reduction collapses whitespace in message text',
  reduced.items[1].text === 'import os value=os.environ',
  JSON.stringify(reduced.items[1].text))
check('reduction falls back to a placeholder for image-only messages',
  reduced.items[2].text === '[图片]',
  JSON.stringify(reduced.items[2].text))
check('reduction yields a stable signature',
  reduced.signature === internals.readItems(face).signature)

check('unreadable snapshot reduces to nothing',
  internals.readItems({ getSnapshot: () => { throw new Error('nope') } }).items.length === 0)

// ---- dash fitting and sampling -------------------------------------------

const roomy = internals.dashLayout(5, 660)
check('a short conversation uses the widest gap',
  roomy.gap === 9 && roomy.shown === 5 && roomy.height === 56,
  JSON.stringify(roomy))

const crowded = internals.dashLayout(200, 660)
check('a crowded rail shrinks its gap and samples down to what fits',
  crowded.gap === 3 && crowded.shown === 91 && crowded.height <= 660,
  JSON.stringify(crowded))

check('an empty conversation draws nothing', internals.dashLayout(0, 660).shown === 0)

const identity = internals.dashMapping(5, 5)
check('an unsampled rail maps dashes one-to-one',
  identity.join(',') === '0,1,2,3,4', identity.join(','))

const sampled = internals.dashMapping(10, 4)
check('a sampled rail spreads evenly and keeps both endpoints',
  sampled.join(',') === '0,3,6,9', sampled.join(','))
check('a single surviving dash points at the newest message',
  internals.dashMapping(10, 1).join(',') === '9')

let monotonic = true
for (let i = 1; i < sampled.length; i += 1) if (sampled[i] <= sampled[i - 1]) monotonic = false
check('sampled mapping is strictly ascending', monotonic)
check('a dash resolves to the message it stands for', internals.dashIndexOf(sampled, 5) === 1)

// ---- frame measurement ----------------------------------------------------

const measured = internals.measure()
check('measurement anchors on the reading column',
  measured !== null && measured.right === 166 && measured.top === 120 && measured.height === 660,
  JSON.stringify(measured !== null ? { top: measured.top, height: measured.height, right: measured.right } : null))

check('measurement resolves the message currently in view',
  internals.computeActive(body, reduced.items) === 1,
  String(internals.computeActive(body, reduced.items)))

body.scrollTop = 620
check('at the floor the newest message is current',
  internals.computeActive(body, reduced.items) === 2)
body.scrollTop = 300

check('jumping scrolls the target row to the scrollport top',
  internals.scrollToAnchor(body, 'n3') === true && body.scrollTop === 304,
  String(body.scrollTop))
check('jumping to an unrendered message is a no-op',
  internals.scrollToAnchor(body, 'no-such-key') === false)

// ---- the registered component, rendered ----------------------------------

const registrations = []
const slots = {
  register(options, component) {
    registrations.push({ options, component })
    return () => {}
  },
  inject(key, factory) {
    const produced = factory()
    if (produced !== undefined && typeof produced.next === 'function') produced.next()
  },
}

let styleTag = null
documentStub.createElement = () => {
  styleTag = makeElement({})
  return styleTag
}

const effects = []
const scope = { slots }
bundle.apply({
  effect(factory, label) {
    effects.push({ label, dispose: factory() })
  },
  inject(services, callback) {
    callback(scope)
  },
  get(key) {
    if (key !== 'sessions') return undefined
    return {
      binding: () => ({ sessionId: 's1', session: face }),
      list: { getSnapshot: () => ({}), subscribe: () => () => {} },
    }
  },
})

check('apply injects its stylesheet once', styleTag !== null && styleTag.textContent.includes('translateY(-50%)'))
check('apply owns its stylesheet through ctx.effect', effects.length === 1)
check('apply registers exactly one shell.overlay entry', registrations.length === 1)
check('the entry lands in shell.overlay with its own id',
  registrations.length === 1 && registrations[0].options.name === 'shell.overlay' &&
  registrations[0].options.id === 'dsh-chat-rail')

const listState = { ids: ['s1'], byId: { s1: { id: 's1' } }, current: 's1' }
const markup = renderToStaticMarkup(React.createElement(registrations[0].component, {
  useSessions: (selector) => selector(listState),
}))

const dashMatches = markup.match(/class="dshr-dash[^"]*"/g) ?? []
check('render draws one dash per human message', dashMatches.length === 3, String(dashMatches.length))
check('render highlights exactly the current message',
  dashMatches.filter((value) => value.includes('is-active')).length === 1 &&
  dashMatches[1].includes('is-active'),
  JSON.stringify(dashMatches))
check('render places the rail inside the frame overlay layer',
  markup.includes('top:450px') && markup.includes('right:166px'),
  markup.slice(0, 220))
check('render carries the rail gap', markup.includes('gap:9px'))
check('render labels each dash with its message text', markup.includes('title="如何启用管理员权限"'))
check('render keeps the panel closed until hover', !markup.includes('dshr-panel'))
check('render names the rail for assistive tech', markup.includes('aria-label="对话导航"'))
check('render reports its dash count for the probe', markup.includes('data-dsh-dashes="3"'))

// A long turn can push every human message out of the loaded window; the rail
// must stay reachable so older history can be pulled back in.
const windowWithoutUsers = {
  getSnapshot() {
    return {
      hasMore: true,
      loadingOlder: false,
      chat: {
        order: ['t1', 't2'],
        nodes: {
          get(key) {
            return { key, kind: 'assistant-step', anchorSeq: 1, data: {} }
          },
        },
      },
    }
  },
  subscribe() {
    return () => {}
  },
}

const starvation = internals.readItems(windowWithoutUsers)
check('a window with no human message still reports older history',
  starvation.items.length === 0 && starvation.more === true && starvation.loading === false,
  JSON.stringify({ items: starvation.items.length, more: starvation.more }))
check('the older-history flag participates in the signature',
  internals.readItems(windowWithoutUsers).signature !==
    internals.readItems({ getSnapshot: () => ({ chat: { order: [], nodes: { get: () => undefined } } }) }).signature)

// Mount a second instance against that starved window and confirm the rail
// still paints something hoverable.
//
// A fresh apply() pairs exactly one registration with one panel handle (the
// handle seam always names the most recent apply), so each mount below is
// self-contained.
function mount(sessionFace) {
  const mounted = []
  bundle.apply({
    effect() {},
    inject(services, callback) {
      callback({
        slots: {
          register(options, component) {
            mounted.push({ options, component })
            return () => {}
          },
          inject(key, factory) {
            const produced = factory()
            if (produced !== undefined && typeof produced.next === 'function') produced.next()
          },
        },
      })
    },
    get(key) {
      if (key !== 'sessions') return undefined
      return {
        binding: () => ({ sessionId: 's1', session: sessionFace }),
        list: { getSnapshot: () => ({}), subscribe: () => () => {} },
      }
    },
  })
  return {
    component: mounted[0].component,
    panel: internals.panel(),
    render() {
      return renderToStaticMarkup(React.createElement(mounted[0].component, {
        useSessions: (selector) => selector(listState),
      }))
    },
  }
}

const starved = mount(windowWithoutUsers)
check('an empty window with older history still paints a reachable rail',
  starved.render().includes('class="dshr-dash is-empty"') &&
  starved.render().includes('data-dsh-dashes="1"'),
  starved.render().slice(0, 200))

// ---- the open panel -------------------------------------------------------
//
// Hover cannot be simulated here, so the panel state is seeded directly: the
// open panel's markup is where the older-history action and the pinned marker
// live, and neither is reachable from the closed state.

const opened = mount(face)
opened.panel.open = true

const openMarkup = opened.render()
check('the open panel renders', openMarkup.includes('class="dshr-panel"'), openMarkup.slice(0, 160))
check('the open panel lists one row per message',
  (openMarkup.match(/class="dshr-item[^"]*"/g) ?? []).length === 3,
  String((openMarkup.match(/class="dshr-item[^"]*"/g) ?? []).length))
check('a rail with no older history offers no load action', !openMarkup.includes('dshr-more'))

opened.panel.pinned = true
check('a pinned panel advertises the pin', opened.render().includes('data-dsh-pinned="1"'))

starved.panel.open = true
const starvedOpen = starved.render()
check('a starved window offers the load-earlier action',
  starvedOpen.includes('class="dshr-more"') && starvedOpen.includes('载入更早的消息'),
  starvedOpen.slice(0, 200))

console.log('')
if (failures === 0) console.log('smoke: all checks passed')
else console.error('smoke: ' + String(failures) + ' check(s) failed')
process.exitCode = failures === 0 ? 0 : 1
