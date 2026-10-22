import type { EngineInterface, Register } from 'claude-code'

export type Snippet = { name: string; text: string }

const STORE_KEY = 'snippets'
export const MAX_SNIPPETS = 200
// Per snippet, in characters: 200 of them stay well inside the store's 4 MiB.
export const MAX_SNIPPET_CHARS = 10000
const NAME_RE = /^[a-z0-9_ -]{1,40}$/
// Words that are subcommands, so never a snippet name.
const RESERVED = ['save', 'rm', 'list']

const USAGE = 'Usage: /snip (list) | /snip <name> | /snip save <name> | /snip rm <name>'

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

/** What `/snip <args>` asks for: a verb and a normalised name; a bare name is an insert. */
export function parseArgs(args: string): { verb: 'list' | 'save' | 'rm' | 'insert'; name: string } {
  const t = args.trim()
  if (t === '' || t.toLowerCase() === 'list') return { verb: 'list', name: '' }
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(t)
  const word = (m?.[1] ?? '').toLowerCase()
  if (word === 'save' || word === 'rm') return { verb: word, name: normName(m?.[2] ?? '') }
  return { verb: 'insert', name: normName(t) }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'snip',
      description: 'Saved prompt snippets: list, insert, save the draft, or remove',
      argumentHint: '[<name> | save <name> | rm <name>]',
    })
    return result
  })

  on('command.run', { command: 'snip' }, async ($, e) => {
    const { verb, name } = parseArgs(e.args)
    const list = await load($)

    if (verb === 'list') {
      if (list.length === 0) return { text: `No snippets yet. Type a prompt, then run /snip save <name>.\n${USAGE}` }
      const rows = [...list].sort((a, b) => a.name.localeCompare(b.name)).map(s => `  ${s.name} - ${preview(s.text)}`)
      return { text: `${list.length} snippet${list.length === 1 ? '' : 's'}:\n${rows.join('\n')}` }
    }

    if (verb === 'save') {
      const problem = nameProblem(name)
      if (problem) return { text: problem }
      const draft = (await $.prompt.read()).text.trim()
      if (draft === '') return { text: 'The prompt box is empty: type the prompt first, then run /snip save <name>.' }
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
      return { text: `${at === -1 ? 'Saved' : 'Updated'} snippet "${name}".` }
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
