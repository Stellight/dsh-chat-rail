// Tests for the profile-manifest splice used by tools/install.mjs.
//
// The real profile manifest is the interesting input, so the suite reads it
// (read-only) as a fixture and requires an exact round trip:
// add -> remove must reproduce the user's original bytes.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addBundle, removeBundle } from '../tools/manifest.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const NAME = 'dsh-chat-rail'
const VERSION = '1.0.0'

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  ok   ' + label)
    return
  }
  failures += 1
  console.error('  FAIL ' + label + (detail === undefined ? '' : ' — ' + detail))
}

/** A profile manifest shaped like the ones this harness writes. */
const FIXTURE = `{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "@liustack/modlens": "3.17.3",
    "dsh-imggen": "1.0.0"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "dsh-imggen"
      ]
    }
  }
}
`

const added = addBundle(FIXTURE, NAME, VERSION)
const addedParsed = JSON.parse(added)
check('install records the dependency', addedParsed.dependencies[NAME] === VERSION)
check('install records the bundle layer',
  addedParsed.dsh.profile.bundles[addedParsed.dsh.profile.bundles.length - 1] === NAME)
check('install keeps every existing dependency',
  addedParsed.dependencies['@liustack/modlens'] === '3.17.3' && addedParsed.dependencies['dsh-imggen'] === '1.0.0')
check('install keeps the bundle order',
  addedParsed.dsh.profile.bundles.slice(0, 2).join(',') === '@deepseek-ai/dsh-base,dsh-imggen')
check('install produces valid JSON with trailing commas cleaned up', added.includes('"dsh-imggen": "1.0.0",'))
check('install is idempotent', addBundle(added, NAME, VERSION) === added)
check('remove restores the original bytes exactly', removeBundle(added, NAME) === FIXTURE,
  JSON.stringify(removeBundle(added, NAME).slice(0, 200)))

const EMPTY = `{
  "name": "dsh-profile-x",
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": []
    }
  }
}
`
const emptyAdded = addBundle(EMPTY, NAME, VERSION)
const emptyParsed = JSON.parse(emptyAdded)
check('install fills an empty dependency map', emptyParsed.dependencies[NAME] === VERSION)
check('install fills an empty bundle list', emptyParsed.dsh.profile.bundles.join(',') === NAME)
check('install indents into an empty block and keeps the closing bracket aligned',
  emptyAdded.includes('\n        "' + NAME + '"\n      ]'), JSON.stringify(emptyAdded))
check('remove restores an empty-block manifest exactly', removeBundle(emptyAdded, NAME) === EMPTY,
  JSON.stringify(removeBundle(emptyAdded, NAME)))

// The live profile, when this suite runs on a machine that has one.
const profileManifest = join(
  process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh'),
  'profiles',
  'web',
  'package.json',
)
let real = null
try {
  real = readFileSync(profileManifest, 'utf8')
} catch (error) {
  console.log('  skip the live profile manifest is not readable here')
}
if (real !== null) {
  // Normalize first: on a machine where the bundle is already installed the
  // live manifest contains the entry, and adding it again must stay a no-op.
  const base = removeBundle(real, NAME)
  check('the live profile manifest drops back to a valid manifest', JSON.parse(base).name === 'dsh-profile-web')
  const reAdded = addBundle(base, NAME, VERSION)
  check('install on an installed profile is idempotent', addBundle(reAdded, NAME, VERSION) === reAdded)
  const roundTrip = removeBundle(reAdded, NAME)
  check('the live profile manifest survives add -> remove byte for byte', roundTrip === base,
    roundTrip === base ? '' : firstDifference(roundTrip, base))
  const parsed = JSON.parse(reAdded)
  check('the live profile keeps its existing bundles',
    (parsed.dsh.profile.bundles ?? []).includes('@deepseek-ai/dsh-web-app') &&
    (parsed.dsh.profile.bundles ?? []).includes('dsh-imggen'))
  check('the live profile keeps its existing dependencies',
    parsed.dependencies['@liustack/modlens'] === '3.17.3' &&
    parsed.dependencies['dsh-imggen'] === '1.0.0' &&
    parsed.dependencies['dsh-deepseek-balance'] === '1.1.1')
}

function firstDifference(left, right) {
  const limit = Math.min(left.length, right.length)
  for (let i = 0; i < limit; i += 1) {
    if (left[i] !== right[i]) return 'at ' + String(i) + ': ' + JSON.stringify(left.slice(i - 20, i + 20))
  }
  return 'length ' + String(left.length) + ' vs ' + String(right.length)
}

void resolve
console.log('')
if (failures === 0) console.log('manifest: all checks passed')
else console.error('manifest: ' + String(failures) + ' check(s) failed')
process.exitCode = failures === 0 ? 0 : 1
