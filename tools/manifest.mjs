// Text-level edits for a dsh profile manifest.
//
// A profile's package.json is user-owned: it may be hand-arranged, commented by
// tooling, or diffed in review. Re-serializing it through JSON.stringify would
// rewrite every unrelated line, so these helpers splice the two places a bundle
// has to appear — `dependencies` and `dsh.profile.bundles` — by editing text and
// validating the result by parsing it.

/** Index of the bracket matching the one at `open`, ignoring quoted strings. */
function matchingBracket(text, open) {
  const closer = { '{': '}', '[': ']' }[text[open]]
  if (closer === undefined) throw new Error('not a bracket at offset ' + String(open))
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const char = text[i]
    if (char === '"') {
      i += 1
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i += 1
        i += 1
      }
      continue
    }
    if (char === text[open]) depth += 1
    else if (char === closer) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  throw new Error('unbalanced brackets in the profile manifest')
}

/** Locate the object/array value that follows `"key":`. */
function blockOf(text, key) {
  const keyIndex = text.indexOf(JSON.stringify(key) + ':')
  if (keyIndex === -1) throw new Error('profile manifest has no ' + JSON.stringify(key))
  const candidates = [text.indexOf('{', keyIndex), text.indexOf('[', keyIndex)].filter((value) => value !== -1)
  if (candidates.length === 0) throw new Error(JSON.stringify(key) + ' has no object or array value')
  const open = Math.min(...candidates)
  return { open, close: matchingBracket(text, open) }
}

/** Insert one line as the last member of a JSON block. */
function insertIntoBlock(text, key, entryLine) {
  const { open, close } = blockOf(text, key)
  const inner = text.slice(open + 1, close)
  let indent
  for (const line of inner.split('\n').reverse()) {
    if (line.trim() === '') continue
    indent = /^\s*/.exec(line)[0]
    break
  }
  if (indent === undefined) {
    // Empty block: sit one level deeper than the key that owns it.
    const lineStart = text.lastIndexOf('\n', text.indexOf(JSON.stringify(key))) + 1
    indent = (/^\s*/.exec(text.slice(lineStart))[0]) + '  '
  }
  // `body` drops the whitespace the closing bracket sat on; re-emit it so an
  // untouched manifest keeps the owner's own bracket indentation.
  const body = inner.replace(/\s+$/, '')
  const tail = inner.slice(body.length)
  if (body === '') {
    const closing = tail === '' ? '\n' + indent.slice(0, Math.max(0, indent.length - 2)) : tail
    return text.slice(0, open + 1) + '\n' + indent + entryLine + closing + text.slice(close)
  }
  const separator = body.endsWith(',') || body.endsWith('{') || body.endsWith('[') ? '' : ','
  const closing = tail === '' ? '\n' + indent.slice(0, Math.max(0, indent.length - 2)) : tail
  return text.slice(0, open + 1) + body + separator + '\n' + indent + entryLine + closing + text.slice(close)
}

/** Drop one exact member line, with whichever comma separated it. */
function removeFromBlock(text, entryLine) {
  const escaped = entryLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const withComma = new RegExp('\\n\\s*' + escaped + ',')
  if (withComma.test(text)) return text.replace(withComma, '')
  return text.replace(new RegExp(',\\n\\s*' + escaped), '')
}

/** Drop one member, collapsing the block when it was the only one. */
function removeMember(text, key, entryLine) {
  const { open, close } = blockOf(text, key)
  const trimmed = text.slice(open + 1, close).trim()
  if (trimmed === entryLine || trimmed === entryLine + ',') {
    return text.slice(0, open + 1) + text.slice(close)
  }
  return removeFromBlock(text, entryLine)
}

function dependencyLine(name, version) {
  return JSON.stringify(name) + ': ' + JSON.stringify(version)
}

/**
 * Add a bundle to a profile manifest.
 * @param text - the manifest source.
 * @param name - package name.
 * @param version - dependency specifier to record.
 * @returns the edited manifest source (parsed for validity).
 */
export function addBundle(text, name, version) {
  const parsed = JSON.parse(text)
  let edited = text
  if (!Object.hasOwn(parsed.dependencies ?? {}, name)) {
    edited = insertIntoBlock(edited, 'dependencies', dependencyLine(name, version))
  }
  if (!(parsed.dsh?.profile?.bundles ?? []).includes(name)) {
    edited = insertIntoBlock(edited, 'bundles', JSON.stringify(name))
  }
  const result = JSON.parse(edited)
  if (!Object.hasOwn(result.dependencies ?? {}, name)) throw new Error('dependency insert did not take')
  if (!(result.dsh?.profile?.bundles ?? []).includes(name)) throw new Error('bundle insert did not take')
  return edited
}

/**
 * Remove a bundle from a profile manifest.
 * @param text - the manifest source.
 * @param name - package name.
 * @returns the edited manifest source (parsed for validity).
 */
export function removeBundle(text, name) {
  const parsed = JSON.parse(text)
  let edited = text
  if (Object.hasOwn(parsed.dependencies ?? {}, name)) {
    edited = removeMember(edited, 'dependencies', dependencyLine(name, parsed.dependencies[name]))
  }
  if ((parsed.dsh?.profile?.bundles ?? []).includes(name)) {
    edited = removeMember(edited, 'bundles', JSON.stringify(name))
  }
  const result = JSON.parse(edited)
  if (Object.hasOwn(result.dependencies ?? {}, name)) throw new Error('dependency removal did not take')
  if ((result.dsh?.profile?.bundles ?? []).includes(name)) throw new Error('bundle removal did not take')
  return edited
}
