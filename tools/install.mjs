#!/usr/bin/env node
// Install (or remove) the dsh-chat-rail bundle in a dsh profile.
//
// A dsh profile resolves each name in `dsh.profile.bundles` from
// `<profile>/node_modules`, reads that package's `dsh.bundle.patch` layer, and
// mounts every row it inserts — so installing a bundle is exactly two edits:
//
//   1. place the package directory under <profile>/node_modules/<name>
//   2. list <name> in <profile>/package.json (dependencies + dsh.profile.bundles)
//
// The profile's own cordis.patch.yml is deliberately left alone: the bundle
// layer already inserts the row, and a row inserted twice would mount the
// plugin twice.
//
// Usage:
//   node tools/install.mjs                 # install into the default profile
//   node tools/install.mjs --profile web   # ... a named profile
//   node tools/install.mjs --remove        # remove it again
//
// Restart the harness afterwards: bundle layers are composed at boot.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addBundle, removeBundle } from './manifest.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = resolve(HERE, '..')
const MANIFEST = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8'))
const PACKAGE_NAME = MANIFEST.name
const PACKAGE_VERSION = MANIFEST.version

/** Files that make up the installed bundle (the test harness stays behind). */
const INSTALLED = ['package.json', 'cordis.patch.yml', 'README.md', 'dsh']

function parseArgs(argv) {
  const options = { remove: false, profile: 'web' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--remove') options.remove = true
    else if (arg === '--profile') {
      i += 1
      if (argv[i] === undefined) throw new Error('--profile needs a name')
      options.profile = argv[i]
    } else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error('unknown argument: ' + arg)
  }
  return options
}

/** The harness home, honouring DSH_HOME exactly like the boot does. */
function dshHome() {
  const configured = process.env.DSH_HOME
  if (configured !== undefined && configured !== '') return resolve(configured)
  const home = process.env.USERPROFILE ?? process.env.HOME
  if (home === undefined || home === '') throw new Error('cannot locate the harness home: set DSH_HOME')
  return join(home, '.dsh')
}

function install(profileDir) {
  const target = join(profileDir, 'node_modules', PACKAGE_NAME)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  for (const entry of INSTALLED) {
    const from = join(PACKAGE_DIR, entry)
    if (!existsSync(from)) continue
    cpSync(from, join(target, entry), { recursive: true })
  }
  console.log('copied    ' + PACKAGE_DIR + '  ->  ' + target)

  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) {
    throw new Error('no profile manifest at ' + manifestPath + ' — run the harness once first')
  }
  const original = readFileSync(manifestPath, 'utf8')
  const edited = addBundle(original, PACKAGE_NAME, PACKAGE_VERSION)
  if (edited === original) {
    console.log('manifest  already lists ' + PACKAGE_NAME + ' — left as is')
  } else {
    writeFileSync(manifestPath + '.bak', original)
    writeFileSync(manifestPath, edited)
    console.log('manifest  ' + manifestPath + ' updated (backup: package.json.bak)')
  }
  return target
}

function remove(profileDir) {
  const target = join(profileDir, 'node_modules', PACKAGE_NAME)
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true })
    console.log('removed   ' + target)
  } else {
    console.log('absent    ' + target)
  }

  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) return
  const original = readFileSync(manifestPath, 'utf8')
  const edited = removeBundle(original, PACKAGE_NAME)
  if (edited === original) {
    console.log('manifest  nothing to remove')
    return
  }
  writeFileSync(manifestPath + '.bak', original)
  writeFileSync(manifestPath, edited)
  console.log('manifest  ' + manifestPath + ' updated (backup: package.json.bak)')
}

function verify(profileDir) {
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  const listed = (manifest.dsh?.profile?.bundles ?? []).includes(PACKAGE_NAME)
  console.log('bundle    ' + (listed ? 'listed in dsh.profile.bundles' : 'NOT listed'))
  if (!listed) return false
  const resolved = createRequire(join(profileDir, 'package.json')).resolve(PACKAGE_NAME + '/package.json')
  const declared = JSON.parse(readFileSync(resolved, 'utf8'))
  const patch = declared.dsh?.bundle?.patch
  const client = declared.exports?.['./client']
  console.log('resolves  ' + resolved)
  console.log('patch     ' + String(patch))
  console.log('client    ' + String(client) + ' (platform ' + String(declared.dsh?.client?.platform) + ')')
  if (patch === undefined || client === undefined) return false
  const clientPath = resolve(dirname(resolved), client)
  const present = existsSync(clientPath)
  console.log('client.js ' + (present ? 'present' : 'MISSING') + '  ' + clientPath)
  return present
}

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  console.log('usage: node tools/install.mjs [--profile <name>] [--remove]')
  process.exit(0)
}

const profileDir = join(dshHome(), 'profiles', options.profile)
console.log('package   ' + PACKAGE_NAME + '@' + PACKAGE_VERSION)
console.log('profile   ' + profileDir)
console.log('')

if (options.remove) {
  remove(profileDir)
  console.log('')
  console.log('Restart the harness to unmount it.')
} else {
  install(profileDir)
  console.log('')
  if (verify(profileDir)) {
    console.log('')
    console.log('Installed. Restart the harness (`dsh web`) and reload the page:')
    console.log('bundle layers are composed at boot, so the new row mounts on the next start.')
  } else {
    console.log('')
    console.log('Installation incomplete — see the lines above.')
    process.exitCode = 1
  }
}
