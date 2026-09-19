// dsh-chat-rail - Browser half.
//
// Hand-written lazy-CJS bundle (window.__ModuleLoader__.load), no build step,
// same protocol as the built-in client plugins and dsh-imggen.
//
// WHAT IT IS
// A DeepSeek-web-style conversation rail pinned to the right edge of the chat
// column. Idle it is a column of short dashes — one per human message — with
// the message currently in view painted brand blue. Hovering (or focusing)
// expands a rounded panel listing those messages with the current one
// highlighted; clicking a dash or a row scrolls that message back into view.
//
// WHERE THE DATA COMES FROM
// Everything is public client contract:
//   * `props.useSessions` (the root-scope standard kit of `shell.overlay`)
//     supplies the current session id;
//   * `ctx.get('sessions').binding(id).session` is the session face — an
//     ObservableSnapshot<ConversationSnapshot> — which the rail subscribes to
//     and reduces to the leaf fields it needs (a node key plus its text).
//     No Host round trip, no copied snapshot, no serialized live data.
//
// HOW IT FINDS THE SCROLLPORT
// The chat view publishes three structural data attributes it already uses for
// its own scroll-restore math: `[data-conversation-scroll]` (the scrolling
// body), `[data-chat-flow]` (the centered reading column) and
// `[data-chat-anchor-key]` (one rendered message row, keyed by its node key).
// The rail measures those boxes and positions itself inside the frame-wide
// `[data-shell-overlay]` layer, so it follows the column through sidebar,
// details-panel and composer reflows without hard-coding any layout class.

window.__ModuleLoader__.load({
  id: 'dsh-chat-rail',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    // ---- tuning -----------------------------------------------------------
    var DASH_HEIGHT = 4
    var DASH_WIDTH = 20
    var DASH_GAP_MAX = 9
    var DASH_GAP_MIN = 3
    /** Distance from the reading column's right edge to the rail's right edge. */
    var RAIL_CLEARANCE = 40
    /** Minimum inset from the scrollport's own right edge. */
    var RAIL_EDGE_INSET = 10
    /** Rows whose top sits within this many px of the scrollport top count as current. */
    var ACTIVE_THRESHOLD = 32
    /** Breathing room kept above a message the user jumped to. */
    var JUMP_OFFSET = 16
    /** Grace period a stale frame survives a transient measurement miss. */
    var GEOMETRY_GRACE_MS = 1500
    /** Grace period so travelling between the panel and the rail never flickers. */
    var CLOSE_DELAY_MS = 160
    var MIN_AREA_HEIGHT = 80

    // ---- structural anchors (published by the chat view) -------------------
    var ATTR_SCROLL = 'data-conversation-scroll'
    var ATTR_FLOW = 'data-chat-flow'
    var ATTR_ANCHOR = 'data-chat-anchor-key'
    var ATTR_COMPOSER = 'data-composer-seat'
    var ATTR_OVERLAY = 'data-shell-overlay'

    var EMPTY_ITEMS = []
    var EMPTY_STATE = { signature: '', items: EMPTY_ITEMS, more: false, loading: false }

    /** Live panel handle for the test seam (`__internals.panel`). */
    var panelHandle = null

    /**
     * Temporary probe switch. While true, the first render outcome of a page
     * load is reported once into the current session (and logged), so a rail
     * that cannot paint explains itself instead of showing an empty right edge.
     */
    var DIAGNOSTIC = true
    /** Report deadline after mount when nothing else reported first. */
    var DIAGNOSTIC_DELAY_MS = 3000

    var CSS = [
      '.dshr-root{--dshr-accent:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6);--dshr-dash:var(--dsw-alias-label-secondary,#61666b);position:absolute;z-index:1;display:flex;align-items:center;gap:10px;pointer-events:none;transform:translateY(-50%)}',
      // A faint pill keeps the rail readable as a control even when a short
      // history window leaves it holding a single dash.
      '.dshr-rail{display:flex;flex-direction:column;align-items:center;gap:8px;padding:9px 10px;border-radius:999px;pointer-events:auto;background:rgba(127,127,127,.07);background:color-mix(in srgb,var(--dshr-dash) 9%,transparent);transition:background-color .14s ease}',
      '.dshr-rail:hover{background:rgba(127,127,127,.14);background:color-mix(in srgb,var(--dshr-dash) 20%,transparent)}',
      '.dshr-dash{appearance:none;-webkit-appearance:none;display:block;flex:none;width:' + DASH_WIDTH + 'px;min-width:' + DASH_WIDTH + 'px;padding:0;margin:0;border:none;border-radius:2px;background:var(--dshr-dash);opacity:.55;cursor:pointer;transition:opacity .12s ease,background-color .12s ease,transform .12s ease}',
      '.dshr-dash:hover,.dshr-dash.is-hover{opacity:.9;transform:scaleX(1.08)}',
      '.dshr-dash.is-active{background:var(--dshr-accent);opacity:1}',
      '.dshr-dash.is-empty{opacity:.3;cursor:default}',
      '.dshr-panel{pointer-events:auto;display:flex;flex-direction:column;width:min(320px,42vw);padding:6px;overflow:hidden;background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.14),0 2px 8px rgba(0,0,0,.07)}',
      '.dshr-panel-list{display:flex;flex-direction:column;gap:2px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}',
      '.dshr-item{appearance:none;-webkit-appearance:none;flex:none;background:transparent;border:none;text-align:left;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#1b1b1f);padding:5px 10px;border-radius:8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshr-item:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1))}',
      '.dshr-item.is-active{color:var(--dshr-accent)}',
      '.dshr-more{appearance:none;-webkit-appearance:none;flex:none;background:transparent;border:none;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));text-align:left;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#61666b);padding:6px 10px;margin-bottom:4px;border-radius:8px;cursor:pointer}',
      '.dshr-more:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1));color:var(--dsw-alias-label-primary,#1b1b1f)}',
      '.dshr-more:disabled{cursor:default;opacity:.6}',
      '.dshr-diag{position:absolute;z-index:2;max-width:320px;padding:8px 10px;border-radius:10px;border:1px solid var(--dsw-alias-state-error-primary,#d33);background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-state-error-primary,#d33);font:12px/18px var(--ds-font-family-code,monospace);word-break:break-word;pointer-events:auto}',
      '@media (prefers-reduced-motion:reduce){.dshr-dash{transition:none}}',
    ].join('')

    // ---- pure helpers ------------------------------------------------------

    /** Flatten one message's content blocks into a single display line. */
    function textOfContent(content) {
      if (!Array.isArray(content)) return ''
      var parts = []
      var hasImage = false
      for (var i = 0; i < content.length; i++) {
        var block = content[i]
        if (block === null || typeof block !== 'object') continue
        if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
        else if (block.type === 'image') hasImage = true
      }
      var text = parts.join(' ').replace(/\s+/g, ' ').trim()
      if (text === '' && hasImage) return '[图片]'
      return text
    }

    function textOfNode(node) {
      var data = node.data
      if (data === null || data === undefined || typeof data !== 'object') return ''
      return textOfContent(data.content)
    }

    /**
     * Reduce the session snapshot to the rail's own plain data: one entry per
     * human message, in flow order, plus whether older history is still
     * unloaded. Only leaf scalars cross into React state.
     *
     * The client holds a WINDOW of the log, so the rail can only offer what is
     * loaded; `more` is what lets the panel fetch the rest a page at a time.
     * @param face - the session face (ObservableSnapshot<ConversationSnapshot>).
     * @returns the current signature, items, and the older-history flags.
     */
    function readItems(face) {
      var snapshot
      try {
        snapshot = face.getSnapshot()
      } catch (error) {
        return EMPTY_STATE
      }
      if (snapshot === null || typeof snapshot !== 'object') return EMPTY_STATE
      var more = snapshot.hasMore === true
      var loading = snapshot.loadingOlder === true
      var chat = snapshot.chat
      if (chat === null || chat === undefined) return { signature: '', items: EMPTY_ITEMS, more: more, loading: loading }
      var order = chat.order
      var nodes = chat.nodes
      if (!Array.isArray(order) || nodes === null || nodes === undefined || typeof nodes.get !== 'function') {
        return { signature: '', items: EMPTY_ITEMS, more: more, loading: loading }
      }
      var items = []
      for (var i = 0; i < order.length; i++) {
        var node = nodes.get(order[i])
        if (node === null || node === undefined) continue
        var kind = node.kind
        if (kind !== 'user' && kind !== 'steering') continue
        items.push({
          key: typeof node.key === 'string' && node.key !== '' ? node.key : String(order[i]),
          text: textOfNode(node),
        })
      }
      var signature = (more ? '1' : '0') + (loading ? '1' : '0') + ':' + signatureOf(items)
      return { signature: signature, items: items.length === 0 ? EMPTY_ITEMS : items, more: more, loading: loading }
    }

    /** Cheap change detector: same signature means the same rendered rail. */
    function signatureOf(items) {
      var parts = []
      for (var i = 0; i < items.length; i++) parts.push(items[i].key + '\u0002' + items[i].text)
      return parts.join('\u0001')
    }

    /**
     * Fit the rail into the available height. The dash gap shrinks first; a
     * conversation too long even at the minimum step is sampled down to the
     * dashes that actually fit, so the rail never overflows its column.
     * @param count - number of human messages.
     * @param height - available height in px.
     * @returns the gap, the drawn count, and the rail's own height.
     */
    function dashLayout(count, height) {
      if (count <= 0) return { gap: DASH_GAP_MAX, shown: 0, height: 0 }
      var room = Math.max(60, height - 24)
      var gap = DASH_GAP_MAX
      if (count * (DASH_HEIGHT + gap) - gap > room) {
        var step = Math.max(DASH_HEIGHT + DASH_GAP_MIN, Math.floor((room + DASH_GAP_MIN) / count))
        gap = Math.max(DASH_GAP_MIN, step - DASH_HEIGHT)
      }
      var capacity = Math.floor((room + gap) / (DASH_HEIGHT + gap))
      var shown = Math.min(count, Math.max(1, capacity))
      return { gap: gap, shown: shown, height: shown * (DASH_HEIGHT + gap) - gap }
    }

    /**
     * Map each drawn dash onto the item it stands for. An unsampled rail is the
     * identity; a sampled one spreads evenly and always keeps both endpoints.
     * @param count - number of human messages.
     * @param shown - number of dashes to draw.
     * @returns ascending item indexes, one per dash.
     */
    function dashMapping(count, shown) {
      var mapping = []
      if (shown >= count) {
        for (var i = 0; i < count; i++) mapping.push(i)
        return mapping
      }
      if (shown <= 1) return [count - 1]
      for (var s = 0; s < shown; s++) mapping.push(Math.round(s * (count - 1) / (shown - 1)))
      return mapping
    }

    /** The dash standing for one item: the last dash whose item is not newer. */
    function dashIndexOf(mapping, itemIndex) {
      var found = 0
      for (var s = 0; s < mapping.length; s++) {
        if (mapping[s] <= itemIndex) found = s
        else break
      }
      return found
    }

    function sameGeometry(left, right) {
      if (left === null || right === null) return left === right
      return left.top === right.top && left.height === right.height && left.right === right.right &&
        left.gap === right.gap && left.shown === right.shown && left.active === right.active
    }

    /**
     * Measure the live chat frame, in coordinates of the frame-wide overlay
     * layer the rail renders into.
     * @returns the body element plus its box, or null when no chat view is up.
     */
    function measure() {
      if (typeof document === 'undefined') return null
      var body = document.querySelector('[' + ATTR_SCROLL + ']')
      if (body === null) return null
      var bodyRect = body.getBoundingClientRect()
      if (bodyRect.height < MIN_AREA_HEIGHT) return null
      // The reading column is a nicety (it keeps the rail just outside the
      // text); its absence must not cost the rail its seat.
      var flow = body.querySelector('[' + ATTR_FLOW + ']')
      var flowRect = flow === null ? null : flow.getBoundingClientRect()
      var top = bodyRect.top
      var bottom = bodyRect.bottom
      var composer = body.querySelector('[' + ATTR_COMPOSER + ']')
      var composerRect = composer === null ? null : composer.getBoundingClientRect()
      if (composerRect !== null && composerRect.top > top + 40 && composerRect.top < bottom) bottom = composerRect.top
      var railRight = flowRect === null || flowRect.width < 1
        ? bodyRect.right - RAIL_EDGE_INSET
        : Math.min(flowRect.right + RAIL_CLEARANCE, bodyRect.right - RAIL_EDGE_INSET)
      // Anchor on the layer the rail renders into; documentElement is only a
      // stand-in for the frame between the two (the rail is inside the layer).
      var layer = document.querySelector('[' + ATTR_OVERLAY + ']')
      var frame = layer === null ? document.documentElement : layer
      var frameRect = frame === null ? bodyRect : frame.getBoundingClientRect()
      return {
        body: body,
        top: top - frameRect.top,
        height: Math.max(0, bottom - top),
        right: Math.max(0, frameRect.right - railRight),
      }
    }

    /**
     * First-paint geometry: the same measurement the observer effect keeps
     * fresh, taken once so the rail appears painted and already pointed at the
     * current message instead of flashing a bare frame.
     * @param items - the seed items, in flow order.
     * @returns the initial view state, or null when no chat view is up.
     */
    function initialGeometry(items) {
      var measured = measure()
      if (measured === null) return null
      var layout = dashLayout(items.length, measured.height)
      return {
        top: measured.top,
        height: measured.height,
        right: measured.right,
        gap: layout.gap,
        shown: layout.shown,
        active: items.length > 0 ? computeActive(measured.body, items) : -1,
      }
    }

    /**
     * Index of the human message the reader is looking at: the last one whose
     * row has reached the top of the scrollport (the newest when at the floor).
     * @param body - the chat scrollport.
     * @param items - the rail's items, in flow order.
     * @returns the item index, or -1 when there is nothing to point at.
     */
    function computeActive(body, items) {
      if (items.length === 0) return -1
      if (body.scrollHeight - body.scrollTop - body.clientHeight <= 4) return items.length - 1
      var index = Object.create(null)
      for (var i = 0; i < items.length; i++) index[items[i].key] = i
      var rows = body.querySelectorAll('[' + ATTR_ANCHOR + ']')
      var threshold = body.getBoundingClientRect().top + ACTIVE_THRESHOLD
      var active = -1
      var firstRendered = -1
      for (var j = 0; j < rows.length; j++) {
        var key = rows[j].getAttribute(ATTR_ANCHOR)
        var position = key === null ? undefined : index[key]
        if (position === undefined) continue
        if (firstRendered === -1) firstRendered = position
        if (rows[j].getBoundingClientRect().top <= threshold) active = position
        else break
      }
      if (active !== -1) return active
      return firstRendered === -1 ? items.length - 1 : firstRendered
    }

    /**
     * Bring one rendered message row to the top of the scrollport.
     * @param body - the chat scrollport.
     * @param key - the row's `data-chat-anchor-key`.
     * @returns whether a rendered row matched.
     */
    function scrollToAnchor(body, key) {
      var rows = body.querySelectorAll('[' + ATTR_ANCHOR + ']')
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].getAttribute(ATTR_ANCHOR) !== key) continue
        var delta = rows[i].getBoundingClientRect().top - body.getBoundingClientRect().top
        var floor = Math.max(0, body.scrollHeight - body.clientHeight)
        body.scrollTop = Math.max(0, Math.min(floor, body.scrollTop + delta - JUMP_OFFSET))
        return true
      }
      return false
    }

    // ---- the browser half --------------------------------------------------

    /**
     * Register the rail and mount its only slot entry.
     * @param ctx - Client Cordis context.
     */
    function apply(ctx) {
      var React
      try {
        React = require('react')
      } catch (error) {
        console.error('[dsh-chat-rail] react unavailable: ' + error)
        return
      }
      var h = React.createElement

      var tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-chat-rail'
      tag.textContent = CSS
      document.head.appendChild(tag)
      if (typeof ctx.effect === 'function') {
        ctx.effect(function () {
          return function () { tag.remove() }
        }, 'dsh-chat-rail: styles')
      }
      if (typeof ctx.inject !== 'function') return

      /** Resolve the sessions service lazily: it is a sibling plugin's service. */
      function sessionsOf() {
        try {
          return ctx.get('sessions')
        } catch (error) {
          return undefined
        }
      }

      function scrollBody() {
        if (typeof document === 'undefined') return null
        return document.querySelector('[' + ATTR_SCROLL + ']')
      }

      // ---- self-diagnostic (DIAGNOSTIC switch) -----------------------------
      //
      // A slot entry that cannot paint shows up as an empty seat and nothing
      // else: the slot's error boundary swallows a throw, and returning null is
      // silent by design. While the switch is on, the first outcome of a page
      // load is reported once — into this conversation, so the failure explains
      // itself without a console — and a caught error also paints a box.

      /** Facts captured on every render; the report fills in the rest. */
      var diag = {
        session: null, listed: null, service: null, hook: null,
        items: -1, geom: null, stage: null, error: null, stack: null,
        dom: null, rail: null, nodes: null, kinds: null, more: null,
      }
      var reported = false

      /**
       * Panel interaction state, held outside the component so no re-render or
       * remount can drop a panel the user is reading or loading in.
       * `pinned` is set by an in-panel click (it survives the pointer leaving)
       * and cleared by Escape, an outside click, or a jump.
       */
      var panel = { open: false, pinned: false }
      panelHandle = panel

      /** Cheap DOM presence probe: which anchors this page actually publishes. */
      function domProbe() {
        var probe = { layer: false, body: false, flow: false, composer: false, rail: false, slotError: false, rows: 0 }
        if (typeof document === 'undefined') return probe
        probe.layer = document.querySelector('[' + ATTR_OVERLAY + ']') !== null
        probe.rail = document.querySelector('[data-dsh-rail]') !== null
        probe.slotError = document.querySelector('[data-slot-error]') !== null
        var body = document.querySelector('[' + ATTR_SCROLL + ']')
        probe.body = body !== null
        if (body === null) return probe
        probe.flow = body.querySelector('[' + ATTR_FLOW + ']') !== null
        probe.composer = body.querySelector('[' + ATTR_COMPOSER + ']') !== null
        probe.rows = body.querySelectorAll('[' + ATTR_ANCHOR + ']').length
        return probe
      }

      /**
       * Why the painted rail would be invisible, or null when it looks fine.
       * Measured from the live DOM, so it catches geometry and computed-style
       * problems that source review cannot.
       * @returns a short reason code, or null.
       */
      function railLooksWrong() {
        if (typeof document === 'undefined') return 'no-document'
        var rail = document.querySelector('[data-dsh-rail]')
        if (rail === null) return 'not-in-dom'
        var rect = rail.getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1) return 'zero-size'
        var width = typeof window === 'undefined' ? 0 : window.innerWidth
        var height = typeof window === 'undefined' ? 0 : window.innerHeight
        if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= width || rect.top >= height) return 'off-screen'
        var dash = rail.querySelector('.dshr-dash')
        if (dash === null) return 'no-dash'
        var dashRect = dash.getBoundingClientRect()
        if (dashRect.width < 1 || dashRect.height < 1) return 'dash-zero-size'
        if (typeof getComputedStyle !== 'function') return null
        var style = getComputedStyle(dash)
        if (style.backgroundColor === 'transparent' || style.backgroundColor === 'rgba(0, 0, 0, 0)') return 'dash-transparent'
        if (Number(style.opacity) < 0.1) return 'dash-faded'
        return null
      }

      /** Live geometry of the painted rail, for a failure report. */
      function railProbe() {
        if (typeof document === 'undefined') return null
        var rail = document.querySelector('[data-dsh-rail]')
        if (rail === null) return { present: false }
        var rect = rail.getBoundingClientRect()
        var dash = rail.querySelector('.dshr-dash')
        var dashRect = dash === null ? null : dash.getBoundingClientRect()
        var style = dash === null || typeof getComputedStyle !== 'function' ? null : getComputedStyle(dash)
        return {
          present: true,
          rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
          dashes: rail.querySelectorAll('.dshr-dash').length,
          dash: dashRect === null ? null : [Math.round(dashRect.width), Math.round(dashRect.height)],
          opacity: style === null ? null : style.opacity,
          background: style === null ? null : style.backgroundColor,
          viewport: typeof window === 'undefined' ? null : [window.innerWidth, window.innerHeight],
        }
      }

      /**
       * Report the first render outcome of this page load, once.
       * @param stage - where the rail stopped ('painting', 'empty', 'timeout', 'render', ...).
       * @param error - the caught error, when there was one.
       */
      function reportDiag(stage, error) {
        if (!DIAGNOSTIC || reported) return
        reported = true
        diag.stage = stage
        if (error !== null && error !== undefined) {
          diag.error = String(error && error.message ? error.message : error).slice(0, 300)
          diag.stack = error && error.stack ? String(error.stack).replace(/\s+/g, ' ').slice(0, 400) : null
        }
        diag.dom = domProbe()
        diag.rail = railProbe()
        try {
          var service = sessionsOf()
          var id = diag.session
          var binding = service === undefined || id === null ? undefined : service.binding(id)
          var face = binding === undefined ? undefined : binding.session
          if (face !== undefined && typeof face.getSnapshot === 'function') {
            var snapshot = face.getSnapshot()
            var chat = snapshot === null || snapshot === undefined ? undefined : snapshot.chat
            if (chat !== undefined && Array.isArray(chat.order)) {
              var counts = {}
              for (var i = 0; i < chat.order.length; i++) {
                var node = chat.nodes.get(chat.order[i])
                var kind = node === undefined || node === null ? 'missing' : String(node.kind)
                counts[kind] = (counts[kind] ?? 0) + 1
              }
              diag.nodes = chat.order.length
              diag.kinds = counts
            }
          }
        } catch (probeError) {
          diag.probeError = String(probeError && probeError.message ? probeError.message : probeError).slice(0, 200)
        }
        var text
        try {
          text = JSON.stringify(diag)
        } catch (serializeError) {
          text = '{"stage":"' + String(stage) + '","serialize":"failed"}'
        }
        try {
          console.error('[dsh-chat-rail] ' + text)
        } catch (ignore) { /* console may be filtered */ }
        try {
          var probeService = sessionsOf()
          var probeId = diag.session
          var probeBinding = probeService === undefined || probeId === null ? undefined : probeService.binding(probeId)
          var probeFace = probeBinding === undefined ? undefined : probeBinding.session
          if (probeFace !== undefined && typeof probeFace.prompt === 'function') {
            var sent = probeFace.prompt([{ type: 'text', text: '[dsh-chat-rail 自检] ' + text }], 'queue')
            if (sent !== null && sent !== undefined && typeof sent.catch === 'function') sent.catch(function () {})
          }
        } catch (ignore) { /* the probe must never take the page down with it */ }
      }

      /** Fallback surface for a rail that could not render. */
      function DiagnosticBox(props) {
        var text = props.text === null ? '' : String(props.text)
        return h('div', {
          className: 'dshr-diag',
          'data-dsh-rail-diag': '',
          style: {
            right: '16px',
            top: '50%',
            transform: 'translateY(-50%)',
          },
        }, 'dsh-chat-rail: ' + text)
      }

      /** Contains a rail render/effect failure so the slot entry survives it. */
      class RailBoundary extends React.Component {
        constructor(props) {
          super(props)
          this.state = { error: null }
        }

        static getDerivedStateFromError(error) {
          return { error: error }
        }

        componentDidCatch(error) {
          reportDiag('render', error)
        }

        render() {
          if (this.state.error === null) return this.props.children
          return h(DiagnosticBox, {
            text: String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error),
          })
        }
      }

      /** The conversation rail: dashes plus their hover panel. */
      function Rail(props) {
        var useSessions = props.useSessions
        var service = sessionsOf()
        var fromHook = typeof useSessions === 'function'

        var hookSession = fromHook ? useSessions(function (state) { return state.current }) : undefined
        var hookListed = fromHook
          ? useSessions(function (state) {
            return state.current !== undefined && state.byId !== undefined && state.byId[state.current] !== undefined
          })
          : false

        // The framework hook is the intended feed; when a slot is entered
        // without it (an assembly change, a future scope), the same fact is
        // read off the sessions store so the rail degrades instead of vanishing.
        var tickPair = React.useState(0)
        var bumpTick = tickPair[1]
        React.useEffect(function () {
          if (fromHook || service === undefined || service.list === undefined) return undefined
          if (typeof service.list.subscribe !== 'function') return undefined
          var unsubscribe = service.list.subscribe(function () { bumpTick(function (n) { return n + 1 }) })
          return function () {
            if (typeof unsubscribe === 'function') unsubscribe()
          }
        }, [fromHook, service, bumpTick])

        var direct = null
        if (!fromHook && service !== undefined && service.list !== undefined) {
          try {
            direct = service.list.getSnapshot()
          } catch (error) {
            direct = null
          }
        }
        var sessionId = fromHook ? hookSession : (direct === null ? undefined : direct.current)
        var listed = fromHook
          ? hookListed
          : (direct !== null && sessionId !== undefined && direct.byId !== undefined && direct.byId[sessionId] !== undefined)

        diag.session = sessionId === undefined ? null : String(sessionId)
        diag.listed = listed
        diag.service = service === undefined ? 'missing' : 'ok'
        diag.hook = typeof useSessions

        /** Resolve the current session face, or undefined when there is none yet. */
        function currentFace() {
          if (service === undefined || sessionId === undefined || !listed) return undefined
          var binding
          try {
            binding = service.binding(sessionId)
          } catch (error) {
            return undefined
          }
          if (binding === undefined || binding.session === undefined || binding.session === null) return undefined
          return binding.session
        }

        // The seed read runs once, on the first render; the subscription effect
        // below starts from the same signature, so seeding costs no extra commit.
        var signatureRef = React.useRef(null)
        var railPair = React.useState(function () {
          var face = currentFace()
          var seed = face === undefined ? EMPTY_STATE : readItems(face)
          signatureRef.current = seed.signature
          return seed
        })
        var rail = railPair[0]
        var items = rail.items
        var setRail = railPair[1]
        var geomPair = React.useState(function () { return initialGeometry(railPair[0].items) })
        var geom = geomPair[0]
        var setGeom = geomPair[1]
        // The panel's open state outlives this component instance: an entry
        // that remounts (registration churn, a slot re-render) must not swallow
        // a panel the user is working in.
        var openPair = React.useState(function () { return panel.open })
        var open = openPair[0]
        var setOpen = openPair[1]
        var hoverPair = React.useState(null)
        var hover = hoverPair[0]
        var setHover = hoverPair[1]

        var itemsRef = React.useRef(items)
        itemsRef.current = items
        var loadingRef = React.useRef(false)
        loadingRef.current = rail.loading === true
        var closeTimer = React.useRef(0)
        var activeRow = React.useRef(null)
        var rootRef = React.useRef(null)
        var lastGoodRef = React.useRef(0)

        // (1) Reduce the current session's conversation to rail items.
        React.useEffect(function () {
          var face = currentFace()
          if (face === undefined) {
            signatureRef.current = ''
            setRail(EMPTY_STATE)
            return undefined
          }
          var lastSignature = signatureRef.current
          var sync = function () {
            var next = readItems(face)
            if (next.signature === lastSignature) return
            lastSignature = next.signature
            signatureRef.current = lastSignature
            setRail(next)
          }
          sync()
          var unsubscribe = face.subscribe(sync)
          return function () {
            if (typeof unsubscribe === 'function') unsubscribe()
          }
        }, [service, sessionId, listed])

        // (2) Track the chat frame and the message currently in view.
        React.useEffect(function () {
          var frame = 0
          var observed = null
          var observer = null
          var activeStamp = null
          var activeIndex = -1

          function detach() {
            if (observer !== null) {
              try {
                observer.disconnect()
              } catch (error) { /* already detached */ }
              observer = null
            }
            observed = null
          }

          function attach(element) {
            detach()
            observed = element
            if (typeof ResizeObserver !== 'function') return
            observer = new ResizeObserver(function () { schedule() })
            try {
              observer.observe(element)
            } catch (error) {
              observer = null
            }
          }

          function update() {
            frame = 0
            var measured = measure()
            if (measured === null) {
              // Layout churn (a history prepend, a view switch, a settling
              // composer) can hide the anchors for a frame or two. Blinking the
              // rail out then would also drop an open panel, so the last good
              // frame is kept for a short grace before the rail stands down.
              var lastGood = lastGoodRef.current
              if (lastGood !== 0 && Date.now() - lastGood < GEOMETRY_GRACE_MS) return
              detach()
              activeStamp = null
              activeIndex = -1
              setGeom(function (previous) { return previous === null ? previous : null })
              return
            }
            lastGoodRef.current = Date.now()
            if (observed !== measured.body) attach(measured.body)

            var list = itemsRef.current
            var layout = dashLayout(list.length, measured.height)
            var active = -1
            if (list.length > 0) {
              // The active dash can only move when the scroll offset, the flow
              // extent, the viewport box, or the item set changed: re-walk the
              // rows only then, never once per animation frame while streaming.
              var stamp = measured.body.scrollTop + ':' + measured.body.scrollHeight + ':' +
                measured.body.clientHeight + ':' + list.length + ':' + list[list.length - 1].key
              if (stamp === activeStamp) active = activeIndex
              else {
                active = computeActive(measured.body, list)
                activeStamp = stamp
                activeIndex = active
              }
            }
            var next = {
              top: measured.top,
              height: measured.height,
              right: measured.right,
              gap: layout.gap,
              shown: layout.shown,
              active: active,
            }
            setGeom(function (previous) { return sameGeometry(previous, next) ? previous : next })
          }

          function schedule() {
            if (frame !== 0) return
            frame = typeof requestAnimationFrame === 'function'
              ? requestAnimationFrame(update)
              : setTimeout(update, 16)
          }

          window.addEventListener('resize', schedule)
          document.addEventListener('scroll', schedule, true)
          var mutations = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null
          if (mutations !== null && document.body !== null) {
            mutations.observe(document.body, { childList: true, subtree: true })
          }
          schedule()
          return function () {
            window.removeEventListener('resize', schedule)
            document.removeEventListener('scroll', schedule, true)
            if (mutations !== null) mutations.disconnect()
            detach()
            if (frame !== 0) {
              if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
              else clearTimeout(frame)
            }
          }
        }, [items])

        // (3) Panel interaction: opening is instant, closing is deliberate.
        //
        // Hover opens and a plain pointer exit closes after a short grace. Any
        // click inside the panel PINS it, so a load, a jump or simply moving the
        // mouse towards the conversation no longer makes it vanish; it then
        // closes on Escape, on a click outside, or on a jump (the end of the
        // interaction). A load in flight always keeps it up.
        function cancelClose() {
          if (closeTimer.current !== 0) {
            clearTimeout(closeTimer.current)
            closeTimer.current = 0
          }
        }

        function openPanel() {
          cancelClose()
          panel.open = true
          setOpen(true)
        }

        function closePanel() {
          cancelClose()
          panel.open = false
          panel.pinned = false
          setOpen(false)
          setHover(null)
        }

        function scheduleClose() {
          cancelClose()
          if (panel.pinned || loadingRef.current) return
          closeTimer.current = setTimeout(function () {
            closeTimer.current = 0
            if (panel.pinned || loadingRef.current) return
            closePanel()
          }, CLOSE_DELAY_MS)
        }

        React.useEffect(function () {
          if (!open) return undefined
          function onKeyDown(event) {
            if (event.key !== 'Escape') return
            closePanel()
          }
          function onPointerDown(event) {
            var root = rootRef.current
            if (root !== null && root !== undefined && root.contains(event.target)) return
            closePanel()
          }
          document.addEventListener('keydown', onKeyDown)
          document.addEventListener('mousedown', onPointerDown, true)
          return function () {
            document.removeEventListener('keydown', onKeyDown)
            document.removeEventListener('mousedown', onPointerDown, true)
          }
        }, [open])

        React.useEffect(function () {
          return function () { cancelClose() }
        }, [])

        var mapping = geom === null || items.length === 0
          ? []
          : dashMapping(items.length, geom.shown)
        var activeItem = geom === null ? -1 : geom.active
        var hoverItem = hover === null ? -1 : hover.item
        var highlightItem = hoverItem !== -1 && hoverItem < items.length ? hoverItem : activeItem
        // A dash under the pointer wins; otherwise the dash mirrors whichever
        // message is highlighted — the hovered row, else the one in view.
        var highlightDash = hover !== null && hover.dash !== null
          ? hover.dash
          : (highlightItem < 0 ? -1 : dashIndexOf(mapping, highlightItem))

        // (4) Keep the highlighted row inside the open panel. Every hook is
        // declared before the empty-state return below: an early return must
        // never change the hook count between renders.
        React.useEffect(function () {
          if (!open) return
          var row = activeRow.current
          if (row === null || row === undefined || typeof row.scrollIntoView !== 'function') return
          row.scrollIntoView({ block: 'nearest' })
        }, [open, highlightItem, items])

        // (5) Probe deadline: a rail that paints somewhere invisible should say
        // so, once per page load. Silent whenever the rail looks right — and
        // whenever there is no chat view to hold it. Reporting lives in an
        // effect, never in render.
        React.useEffect(function () {
          var timer = setTimeout(function () {
            if (!domProbe().body) return
            var reason = railLooksWrong()
            if (reason !== null) reportDiag('invisible:' + reason, null)
          }, DIAGNOSTIC_DELAY_MS)
          return function () { clearTimeout(timer) }
        }, [])

        diag.items = items.length
        diag.geom = geom
        diag.more = rail.more

        // A window can hold no human message at all (a very long turn pushes
        // them out); with older history still unloaded the rail must stay
        // reachable, so it keeps a placeholder dash to hover.
        var canLoadEarlier = rail.more === true && currentFace() !== undefined
        if (geom === null || geom.height < MIN_AREA_HEIGHT) return null
        if (items.length === 0 && !canLoadEarlier) return null

        function labelOf(item, index) {
          return item.text === '' ? '第 ' + String(index + 1) + ' 条消息' : item.text
        }

        /** Scroll to a row once it exists; prepends commit a frame or two later. */
        function revealMessage(key, attempts) {
          var body = scrollBody()
          if (body === null) return
          if (scrollToAnchor(body, key)) return
          if (attempts <= 0) return
          setTimeout(function () { revealMessage(key, attempts - 1) }, 90)
        }

        /**
         * Extend the loaded window one page backwards and show it.
         *
         * The chat view prepends older events and deliberately holds the
         * reader's anchor, so the new block lands ABOVE the fold and would
         * otherwise look like nothing happened. After the page settles the view
         * is moved to the newest of the messages that just arrived, so the
         * reader continues backwards from where they were.
         */
        function loadEarlier() {
          var face = currentFace()
          if (face === undefined || typeof face.loadOlder !== 'function') return
          // The panel stays put for the whole load: the user asked to browse
          // history, not to have the browser close underneath the pointer.
          panel.pinned = true
          cancelClose()
          var previousOldest = items.length > 0 ? items[0].key : null
          var pending = face.loadOlder()
          if (pending === null || pending === undefined || typeof pending.then !== 'function') return
          pending.then(function () {
            var next = readItems(face).items
            if (next.length === 0) return
            var index = -1
            if (previousOldest !== null) {
              for (var i = 0; i < next.length; i += 1) {
                if (next[i].key === previousOldest) {
                  index = i
                  break
                }
              }
            }
            var target = index > 0 ? next[index - 1] : next[0]
            revealMessage(target.key, 8)
          }, function () { /* failures surface in the session snapshot */ })
        }

        function jumpToItem(index) {
          var item = items[index]
          if (item === undefined) return
          var body = scrollBody()
          if (body !== null) scrollToAnchor(body, item.key)
          // A jump ends the interaction: the reader is now looking at the
          // transcript, so the panel retires until hovered again.
          closePanel()
        }

        function renderDash(dashIndex) {
          var itemIndex = mapping[dashIndex]
          var item = items[itemIndex]
          return h('button', {
            key: 'dash:' + item.key,
            type: 'button',
            className: 'dshr-dash' + (dashIndex === highlightDash ? ' is-active' : ''),
            style: { height: String(DASH_HEIGHT) + 'px' },
            title: labelOf(item, itemIndex),
            'aria-label': labelOf(item, itemIndex),
            onMouseEnter: function () {
              openPanel()
              setHover({ dash: dashIndex, item: itemIndex })
            },
            onFocus: function () {
              openPanel()
              setHover({ dash: dashIndex, item: itemIndex })
            },
            onClick: function () { jumpToItem(itemIndex) },
          })
        }

        function renderRow(item, index) {
          return h('button', {
            key: 'row:' + item.key,
            ref: index === highlightItem ? activeRow : undefined,
            type: 'button',
            className: 'dshr-item' + (index === highlightItem ? ' is-active' : ''),
            title: labelOf(item, index),
            onMouseEnter: function () { setHover({ dash: null, item: index }) },
            onClick: function () { jumpToItem(index) },
          }, labelOf(item, index))
        }

        var dashes = []
        var rows = []
        for (var d = 0; d < mapping.length; d++) dashes.push(renderDash(d))
        if (dashes.length === 0) {
          dashes.push(h('button', {
            key: 'dash:placeholder',
            type: 'button',
            className: 'dshr-dash is-empty',
            style: { height: String(DASH_HEIGHT) + 'px' },
            title: '载入更早的对话以建立导航',
            'aria-label': '载入更早的对话',
            onMouseEnter: openPanel,
            onFocus: openPanel,
          }))
        }
        if (open) for (var i = 0; i < items.length; i++) rows.push(renderRow(items[i], i))

        var railNode = h('div', {
          className: 'dshr-rail',
          style: { gap: String(geom.gap) + 'px' },
          role: 'navigation',
          'aria-label': '对话导航',
        }, dashes)

        var earlier = canLoadEarlier
          ? h('button', {
            className: 'dshr-more',
            type: 'button',
            disabled: rail.loading === true,
            onClick: loadEarlier,
          }, rail.loading === true ? '正在载入更早的消息…' : '↑ 载入更早的消息（本页仅显示已载入的部分）')
          : null

        var panelNode = open
          ? h('div', {
            className: 'dshr-panel',
            onMouseDown: function () { panel.pinned = true },
            style: { maxHeight: String(Math.max(120, geom.height - 16)) + 'px' },
          }, h('div', { className: 'dshr-panel-list' }, earlier, rows))
          : null

        return h('div', {
          ref: rootRef,
          className: 'dshr-root',
          'data-dsh-rail': '',
          'data-dsh-dashes': String(dashes.length),
          'data-dsh-pinned': panel.pinned ? '1' : undefined,
          style: {
            top: String(Math.round(geom.top + geom.height / 2)) + 'px',
            right: String(Math.round(geom.right)) + 'px',
          },
          onMouseEnter: openPanel,
          onMouseLeave: scheduleClose,
          onFocusCapture: openPanel,
          onBlurCapture: scheduleClose,
        }, panelNode, railNode)
      }

      ctx.inject(['slots'], function (scope) {
        scope.slots.inject('shell.overlay', function* () {
          yield scope.slots.register(
            { name: 'shell.overlay', id: 'dsh-chat-rail', order: 40, label: '对话导航' },
            function (props) {
              return h(RailBoundary, null, h(Rail, props))
            },
          )
        })
      })
    }

    exports.apply = apply
    exports.inject = []
    // Offline verification seam: the pure reduction/geometry helpers, exposed so
    // the DOM math can be exercised without a browser (see test/smoke.mjs). The
    // shell reads only `apply` and `inject`.
    exports.__internals = {
      textOfContent: textOfContent,
      readItems: readItems,
      dashLayout: dashLayout,
      dashMapping: dashMapping,
      dashIndexOf: dashIndexOf,
      initialGeometry: initialGeometry,
      measure: measure,
      computeActive: computeActive,
      scrollToAnchor: scrollToAnchor,
      /** The live panel state object (open/pinned), for interaction tests. */
      panel: function () { return panelHandle },
      tuning: {
        DASH_HEIGHT: DASH_HEIGHT,
        DASH_GAP_MIN: DASH_GAP_MIN,
        DASH_GAP_MAX: DASH_GAP_MAX,
        RAIL_CLEARANCE: RAIL_CLEARANCE,
        RAIL_EDGE_INSET: RAIL_EDGE_INSET,
        ACTIVE_THRESHOLD: ACTIVE_THRESHOLD,
        JUMP_OFFSET: JUMP_OFFSET,
      },
    }
    return module.exports
  },
})
