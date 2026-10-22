import type { EngineInterface, Register } from 'claude-code'

export type Snippet = { name: string; text: string }

const STORE_KEY = 'snippets'
export const MAX_SNIPPETS = 200
// Per snippet, in characters: 200 of them stay well inside the store's 4 MiB.
export const MAX_SNIPPET_CHARS = 10000
const NAME_RE = /^[a-z0-9_ -]{1,40}$/
// Words that are subcommands, so never a snippet name.
const RESERVED = ['save', 'rm', 'list']

const USAGE = 'Usage: /snip (list) | /snip <name> | /snip save <name> [:: <text>] | /snip rm <name>'
// Splits an inline snippet off the name: `/snip save tests :: fix the tests`.
const INLINE_SEP = '::'

// Typing `/snip save` replaces the draft in the box, so the draft is remembered
// as it is written: the last one that was not a slash command. Deleting keys
// do not move it, so clearing the box key by key keeps the whole draft.
// Module state; a reload starts it afresh.
let lastDraft = ''

/** Remembers `text` as the draft to save, unless it is empty or a slash command. */
export function noteDraft(text: string): void {
  const t = text.trim()
  if (t !== '' && !t.startsWith('/')) lastDraft = t
}

/** A name as stored: trimmed, lower-cased, inner whitespace runs folded to one space. */
export const normName = (raw: string): string => raw.trim().toLowerCase().replace(/\s+/g, ' ')

/** Why a normalised name is not usable, or undefined when it is. */
export function nameProblem(name: string): string | undefined {
  if (name === '') return 'Give the snippet a name.'
  if (!NAME_RE.test(name)) return 'Names are 1-40 characters of a-z, 0-9, space, - and _.'
  if (RESERVED.includes(name.split(' ')[0] ?? '')) return `"${name}" starts with a command word (save, rm, list); pick another name.`
  return undefined
}

// Kept only where it is the shape we write, so a hand-edited store cannot break /snip.
const isSnippet = (v: unknown): v is Snippet =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Snippet).name === 'string' &&
  typeof (v as Snippet).text === 'string'

const load = async ($: EngineInterface): Promise<Snippet[]> => {
  const raw = await $.store.get(STORE_KEY)
  return Array.isArray(raw) ? raw.filter(isSnippet) : []
}

const preview = (text: string): string => {
  const one = text.replace(/\s+/g, ' ')
  return one.length > 50 ? one.slice(0, 50) + '…' : one
}

/**
 * What `/snip <args>` asks for: a verb and a normalised name; a bare name is an
 * insert. `save <name> :: <text>` carries the snippet's text inline.
 */
export function parseArgs(args: string): { verb: 'list' | 'save' | 'rm' | 'insert'; name: string; text?: string } {
  const t = args.trim()
  if (t === '' || t.toLowerCase() === 'list') return { verb: 'list', name: '' }
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(t)
  const word = (m?.[1] ?? '').toLowerCase()
  const rest = m?.[2] ?? ''
  if (word === 'save') {
    const at = rest.indexOf(INLINE_SEP)
    if (at === -1) return { verb: 'save', name: normName(rest) }
    return { verb: 'save', name: normName(rest.slice(0, at)), text: rest.slice(at + INLINE_SEP.length).trim() }
  }
  if (word === 'rm') return { verb: 'rm', name: normName(rest) }
  return { verb: 'insert', name: normName(t) }
}

export const register: Register = on => {
  lastDraft = ''

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    const isDeletion = e.inputText === '' && e.end > e.start
    if (!isDeletion) noteDraft(box.text)
    return box
  })

  // History recall, undo, a draft put back: all but the box being emptied.
  on('prompt.change', ($, e, next) => {
    if (e.origin.kind !== 'clear') noteDraft(e.text)
    return next(e)
  })

  // A prompt sent is a draft too: `/snip save <name>` right after keeps it.
  on('prompt.submit', ($, e, next) => {
    noteDraft(e.text)
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'snip',
      description: 'Saved prompt snippets: list, insert, save the last draft or inline text, or remove',
      argumentHint: '[<name> | save <name> [:: <text>] | rm <name>]',
    })
    return result
  })

  on('command.run', { command: 'snip' }, async ($, e) => {
    const { verb, name, text } = parseArgs(e.args)
    const list = await load($)

    if (verb === 'list') {
      if (list.length === 0) return { text: `No snippets yet. Type a prompt, then run /snip save <name>.\n${USAGE}` }
      const rows = [...list].sort((a, b) => a.name.localeCompare(b.name)).map(s => `  ${s.name} - ${preview(s.text)}`)
      return { text: `${list.length} snippet${list.length === 1 ? '' : 's'}:\n${rows.join('\n')}` }
    }

    if (verb === 'save') {
      const problem = nameProblem(name)
      if (problem) return { text: problem }
      // Inline text first, then the box (when something else ran the command), then the remembered draft.
      const box = (await $.prompt.read()).text.trim()
      const draft = text ?? (box !== '' && !box.startsWith('/') ? box : lastDraft)
      if (draft === '') {
        return { text: `Nothing to save: write the prompt first, or give it inline: /snip save ${name} ${INLINE_SEP} <text>` }
      }
      if (draft.length > MAX_SNIPPET_CHARS) {
        return { text: `That draft is ${draft.length} characters; a snippet holds at most ${MAX_SNIPPET_CHARS}.` }
      }
      const at = list.findIndex(s => s.name === name)
      if (at === -1 && list.length >= MAX_SNIPPETS) {
        return { text: `Snippet limit reached (${MAX_SNIPPETS}). Remove one with /snip rm <name>.` }
      }
      if (at === -1) list.push({ name, text: draft })
      else list[at] = { name, text: draft }
      await $.store.set(STORE_KEY, list)
      return { text: `${at === -1 ? 'Saved' : 'Updated'} snippet "${name}": ${preview(draft)}` }
    }

    // rm and insert both address an existing name; an invalid one cannot exist.
    if (name === '') return { text: USAGE }
    const found = list.find(s => s.name === name)
    if (!found) {
      const near = list.filter(s => s.name.startsWith(name) || name.startsWith(s.name)).map(s => s.name)
      return { text: `No snippet named "${name}".${near.length ? ` Did you mean: ${near.join(', ')}?` : ' /snip lists them.'}` }
    }

    if (verb === 'rm') {
      await $.store.set(STORE_KEY, list.filter(s => s !== found))
      return { text: `Removed snippet "${name}".` }
    }

    const filled = await $.prompt.fill({ text: found.text, mode: 'insert' })
    if (!filled.isFilled) return { text: 'The prompt box could not take the snippet right now (a dialog is open?). Try again.' }
    return { text: `Inserted snippet "${name}".` }
  })
}
