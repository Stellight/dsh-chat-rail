# dsh-chat-rail

A conversation rail for DeepSeek Harness, modelled on DeepSeek's web UI: a
column of short dashes pinned to the right edge of the chat column, one per
human message.

- **Idle** — grey dashes, with the message currently in view painted brand blue.
- **Hover or focus** — a rounded panel expands to the left listing every human
  message of the session, the current one highlighted in the same blue.
- **Click a dash or a row** — that message scrolls back to the top of the
  viewport.

The rail follows the reading column through sidebar, details-panel, composer and
window-size changes, and never covers the text while idle.

## Reading history further back

The client holds a **window** of the session log, so the rail can only offer what
is loaded — in a long session that window may hold a single human message. The
panel therefore carries `↑ 载入更早的消息` while older history remains: clicking
it extends the window one page, the rail gains the newly loaded dashes, and the
conversation is moved to the newest of the messages that just arrived, so the
load is visible instead of landing above the fold. Repeat as far back as needed.

### Panel lifetime

| Action | Panel |
| --- | --- |
| pointer over the rail or the panel | open |
| pointer leaves, nothing pinned | closes after `CLOSE_DELAY_MS` |
| any click inside the panel | **pinned** — stays open while the pointer goes anywhere, including through a load |
| Escape, or a click outside | closes and unpins |
| click a message row | jumps, then closes (the interaction is over) |
| a load in flight | never closes |
| a transient measurement miss | the last frame is kept for `GEOMETRY_GRACE_MS` instead of blinking out |

## Install

```powershell
node tools/install.mjs              # default profile (`web`)
node tools/install.mjs --profile web
node tools/install.mjs --remove     # uninstall
```

The installer copies this package to `<profile>/node_modules/dsh-chat-rail` and
lists it in `<profile>/package.json` (`dependencies` plus
`dsh.profile.bundles`), keeping the rest of that file byte-identical and leaving
`package.json.bak` behind.

**Restart the harness afterwards** (`dsh web`) and reload the page: a profile's
bundle layers are composed at boot, so a newly listed bundle mounts on the next
start.

## How it mounts

This is a *bundle*, not a dynamic Cordis plugin: `package.json` declares
`dsh.bundle.patch` (a profile patch layer) and `dsh.client` (a browser half), so
the composition itself mounts the row:

```yaml
# cordis.patch.yml — this package's layer
- insert:
    - id: dsh-chat-rail
      name: 'dsh-chat-rail'
```

- `dsh/index.js` — the Host half. Deliberately inert: the feature is entirely
  browser-side, and an entry that declares no `inject` can never leave the boot
  sweep waiting on an unresolvable service.
- `dsh/client.js` — the browser half. A hand-written lazy-CJS bundle
  (`window.__ModuleLoader__.load`), the same protocol the shipped client plugins
  and other profile bundles use; there is no build step.

The Host's client-module registry scans enabled loader entries for packages
declaring `dsh.client`, resolves `exports["./client"]`, hashes the bundle into
`window.__DSH_BOOT__`, and serves it under `/plugins/dsh-chat-rail/client.js`.

## Where the data comes from

Only public client contract, no Host round trip:

| Need | Source |
| --- | --- |
| current session | `props.useSessions` — the root-scope standard kit of `shell.overlay` |
| messages | `ctx.get('sessions').binding(id).session` — the session face, an `ObservableSnapshot<ConversationSnapshot>` |
| message text | the `content` blocks of `user` / `steering` chat nodes, reduced to one display line |
| scrollport | the chat view's own structural anchors: `[data-conversation-scroll]`, `[data-chat-flow]`, `[data-chat-anchor-key]`, `[data-composer-seat]` |
| frame layer | `[data-shell-overlay]`, the frame-wide layer the rail renders into |

Only leaf scalars (a node key, a message string, rectangles) ever reach React
state; the snapshot itself is never copied, serialized or retained.

Work is kept off the streaming path: the subscription reduces each snapshot
flush to a cheap signature, an unchanged signature skips the commit, the active
dash is reused unless the scroll offset, flow extent, viewport box or item set
actually moved, and at the bottom of a conversation the newest message is
current without walking any rows.

## Tuning

All knobs are the constants at the top of `dsh/client.js`:

| Constant | Default | Meaning |
| --- | --- | --- |
| `DASH_HEIGHT` / `DASH_GAP_MAX` / `DASH_GAP_MIN` | 3 / 9 / 3 | dash geometry |
| `RAIL_CLEARANCE` | 40 | gap between the reading column's right edge and the rail |
| `RAIL_EDGE_INSET` | 10 | minimum inset from the scrollport's own right edge |
| `ACTIVE_THRESHOLD` | 32 | how far below the scrollport top still counts as "current" |
| `JUMP_OFFSET` | 16 | breathing room above a message after a jump |
| `CLOSE_DELAY_MS` | 160 | grace period so panel↔rail travel never flickers |
| `GEOMETRY_GRACE_MS` | 1500 | how long a stale frame survives a transient measurement miss |
| `DIAGNOSTIC` | `true` | report a verifiably invisible rail once per page load |

A conversation too long to fit even at `DASH_GAP_MIN` is **sampled**: the rail
draws only the dashes that fit, spread evenly and always keeping both endpoints,
and lays them out onto the messages they stand for. The hover panel always lists
every message regardless.

Vertical placement is centred in the message viewport (the scrollport's top down
to the composer seat), which is the one line to change in `Rail`'s root style if
you prefer a top-anchored rail.

## Tests

```powershell
node test/smoke.mjs      # the browser half against a synthetic DOM + a real React render
node test/manifest.mjs   # the profile-manifest splice used by the installer
```

`test/smoke.mjs` loads the actual bundle through a stand-in
`window.__ModuleLoader__`, then checks the snapshot reduction, the dash
fitting/sampling math, the chat-frame measurement, the active-message
resolution, the jump scroll, style/slot ownership under `ctx.effect`, and a full
`react-dom/server` render of the registered component (dash count, highlight,
placement, labels). It reads React from the installed harness so the render uses
the browser's version.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| No rail after install | The harness was not restarted, so the boot graph predates the bundle. |
| Rail never appears in a session | The session has no human message yet, or the chat view is not the active view tab. |
| `cannot resolve profile bundle` at boot | The package directory is missing from `<profile>/node_modules`. |
| Row mounts but nothing renders | Check the browser console for a `dsh-chat-rail` error; the module loader reports a failed bundle loudly. |
