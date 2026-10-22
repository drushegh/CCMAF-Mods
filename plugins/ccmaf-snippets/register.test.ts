import { test, expect } from 'claude-code/testing'
import { MAX_SNIPPETS, MAX_SNIPPET_CHARS, nameProblem, normName, parseArgs } from './hooks/register.ts'

// Each hook here stands for the engine: an in-memory store, a prompt box, a fill log.
const stub = (on: any, opts: { draft?: string; isFilled?: boolean; seed?: unknown } = {}) => {
  const store = new Map<string, unknown>()
  if (opts.seed !== undefined) store.set('snippets', opts.seed)
  const fills: any[] = []
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'snip' } }))
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_$: any, e: any) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  // The engine applies an edit to the box: the span start..end becomes inputText.
  on('prompt.edit', (_$: any, e: any) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  })
  on('prompt.change', (_$: any, e: any) => ({ text: e.text }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  on('prompt.read', () => ({ value: { text: opts.draft ?? '', cursor: (opts.draft ?? '').length } }))
  on('prompt.fill', (_$: any, e: any) => {
    fills.push({ text: e.text, mode: e.mode })
    return { isFilled: opts.isFilled ?? true }
  })
  return { store, fills }
}

const start = ($: any) => $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
const snip = ($: any, args: string) => $.command.run({ command: 'snip', args })

test('names: normalised and validated', () => {
  expect(normName('  My   Prompt ')).toBe('my prompt')
  expect(nameProblem('ok-name_1 x')).toBeUndefined()
  expect(nameProblem('')).toMatch(/name/)
  expect(nameProblem('bad!')).toMatch(/1-40/)
  expect(nameProblem('a'.repeat(41))).toMatch(/1-40/)
  expect(nameProblem('a'.repeat(40))).toBeUndefined()
  expect(nameProblem('save')).toMatch(/command word/)
  expect(nameProblem('ünï')).toMatch(/1-40/)
})

test('parseArgs: verbs, bare names and case', () => {
  expect(parseArgs('')).toEqual({ verb: 'list', name: '' })
  expect(parseArgs(' LIST ')).toEqual({ verb: 'list', name: '' })
  expect(parseArgs('SAVE My Name')).toEqual({ verb: 'save', name: 'my name' })
  expect(parseArgs('rm foo')).toEqual({ verb: 'rm', name: 'foo' })
  expect(parseArgs('review code')).toEqual({ verb: 'insert', name: 'review code' })
  expect(parseArgs('save')).toEqual({ verb: 'save', name: '' })
})

test('save then insert round-trips the draft', async ($, on) => {
  const s = stub(on, { draft: '  Review this diff\nfor bugs.  ' })
  await start($)
  expect((await snip($, 'save Review')).text).toMatch(/Saved snippet "review"/)
  expect(s.store.get('snippets')).toEqual([{ name: 'review', text: 'Review this diff\nfor bugs.' }])
  expect((await snip($, '  REVIEW ')).text).toMatch(/Inserted/)
  expect(s.fills).toEqual([{ text: 'Review this diff\nfor bugs.', mode: 'insert' }])
})

test('save with an empty draft says so and stores nothing', async ($, on) => {
  const s = stub(on, { draft: '   \n' })
  await start($)
  expect((await snip($, 'save x')).text).toMatch(/Nothing to save/)
  expect(s.store.has('snippets')).toBe(false)
})

test('save with a bad or missing name is refused', async ($, on) => {
  const s = stub(on, { draft: 'hi' })
  await start($)
  expect((await snip($, 'save')).text).toMatch(/name/)
  expect((await snip($, 'save no/slash')).text).toMatch(/1-40/)
  expect((await snip($, 'save rm')).text).toMatch(/command word/)
  expect(s.store.has('snippets')).toBe(false)
})

test('saving an existing name updates it', async ($, on) => {
  const s = stub(on, { draft: 'new', seed: [{ name: 'a', text: 'old' }, { name: 'b', text: 'keep' }] })
  await start($)
  expect((await snip($, 'save A')).text).toMatch(/Updated/)
  expect(s.store.get('snippets')).toEqual([{ name: 'a', text: 'new' }, { name: 'b', text: 'keep' }])
})

test('an over-long draft is refused', async ($, on) => {
  const s = stub(on, { draft: 'x'.repeat(MAX_SNIPPET_CHARS + 1) })
  await start($)
  expect((await snip($, 'save big')).text).toMatch(/at most/)
  expect(s.store.has('snippets')).toBe(false)
})

test('the count cap blocks a new name but not an update', async ($, on) => {
  const seed = Array.from({ length: MAX_SNIPPETS }, (_, i) => ({ name: `n${i}`, text: 't' }))
  const s = stub(on, { draft: 'fresh', seed })
  await start($)
  expect((await snip($, 'save one-more')).text).toMatch(/limit/)
  expect((s.store.get('snippets') as unknown[]).length).toBe(MAX_SNIPPETS)
  expect((await snip($, 'save n3')).text).toMatch(/Updated/)
})

test('list: sorted with one-line previews', async ($, on) => {
  stub(on, { seed: [{ name: 'zed', text: 'last\nline' }, { name: 'alpha', text: 'x'.repeat(80) }] })
  await start($)
  const t = (await snip($, '')).text as string
  expect(t).toMatch(/2 snippets/)
  expect(t.indexOf('alpha')).toBeLessThan(t.indexOf('zed'))
  expect(t).toContain('zed - last line')
  expect(t).toContain('…')
})

test('list with no snippets points at save', async ($, on) => {
  stub(on)
  await start($)
  expect((await snip($, 'list')).text).toMatch(/No snippets yet/)
})

test('rm removes one and leaves the rest; unknown names suggest near ones', async ($, on) => {
  const s = stub(on, { seed: [{ name: 'code review', text: 'a' }, { name: 'b', text: 'c' }] })
  await start($)
  expect((await snip($, 'rm code')).text).toMatch(/No snippet named "code".*code review/)
  expect((await snip($, 'rm Code Review')).text).toMatch(/Removed/)
  expect(s.store.get('snippets')).toEqual([{ name: 'b', text: 'c' }])
  expect((await snip($, 'rm')).text).toMatch(/Usage/)
})

test('an unknown name to insert fills nothing', async ($, on) => {
  const s = stub(on, { seed: [] })
  await start($)
  expect((await snip($, 'nope')).text).toMatch(/No snippet named "nope"/)
  expect(s.fills).toEqual([])
})

test('a prompt box that refuses the fill is reported', async ($, on) => {
  stub(on, { seed: [{ name: 'a', text: 't' }], isFilled: false })
  await start($)
  expect((await snip($, 'a')).text).toMatch(/could not take/)
})

test('a corrupt store is filtered, not fatal', async ($, on) => {
  const s = stub(on, { draft: 'ok', seed: [{ name: 1 }, 'str', null, { name: 'good', text: 't' }] })
  await start($)
  expect((await snip($, '')).text).toMatch(/1 snippet:/)
  await snip($, 'save fresh')
  expect(s.store.get('snippets')).toEqual([{ name: 'good', text: 't' }, { name: 'fresh', text: 'ok' }])
})

test('a snippet named like an object key does not collide', async ($, on) => {
  const s = stub(on, { draft: 'p' })
  await start($)
  expect((await snip($, 'save __proto__')).text).toMatch(/Saved/)
  expect((await snip($, '__proto__')).text).toMatch(/Inserted/)
  expect(s.fills[0].text).toBe('p')
})

test('names may not start with a command word', () => {
  expect(nameProblem('rm foo')).toBeDefined()
  expect(nameProblem('save me')).toBeDefined()
  expect(nameProblem('removal')).toBeUndefined()
})

// The box as a real terminal leaves it: typing the command replaced the draft.
const type = async ($: any, from: string, inputText: string) =>
  $.prompt.edit({ origin: { kind: 'composer' }, text: from, cursor: from.length, start: from.length, end: from.length, inputText })
const backspace = async ($: any, from: string) =>
  $.prompt.edit({ origin: { kind: 'composer' }, text: from, cursor: from.length, start: from.length - 1, end: from.length, inputText: '' })

test('save keeps the draft typed before the command replaced it', async ($, on) => {
  const s = stub(on, { draft: '' })
  await start($)
  await type($, '', 'fix the failing tests')
  await type($, 'fix the failing tests', ' and explain the cause')
  // Cleared key by key, then the command typed: neither is the draft.
  let box = 'fix the failing tests and explain the cause'
  while (box !== '') {
    await backspace($, box)
    box = box.slice(0, -1)
  }
  await type($, '', '/snip save tests')
  expect((await snip($, 'save tests')).text).toMatch(/Saved snippet "tests": fix the failing tests and explain the cause/)
  expect(s.store.get('snippets')).toEqual([{ name: 'tests', text: 'fix the failing tests and explain the cause' }])
})

test('save after a stash or a clear keeps the draft', async ($, on) => {
  const s = stub(on, { draft: '' })
  await start($)
  await type($, '', 'review this diff')
  await $.prompt.change({ text: '', cursor: 0, origin: { kind: 'clear' } })
  expect((await snip($, 'save review')).text).toMatch(/Saved/)
  expect(s.store.get('snippets')).toEqual([{ name: 'review', text: 'review this diff' }])
})

test('save right after sending a prompt keeps that prompt', async ($, on) => {
  const s = stub(on, { draft: '' })
  await start($)
  await $.prompt.submit({ text: 'summarise the last commit', mode: 'prompt' })
  await snip($, 'save sum')
  expect(s.store.get('snippets')).toEqual([{ name: 'sum', text: 'summarise the last commit' }])
})

test('inline text wins over the remembered draft', async ($, on) => {
  const s = stub(on, { draft: '' })
  await start($)
  await type($, '', 'an older draft')
  expect((await snip($, 'save My Name :: do the thing\nwell')).text).toMatch(/Saved snippet "my name"/)
  expect(s.store.get('snippets')).toEqual([{ name: 'my name', text: 'do the thing\nwell' }])
  expect((await snip($, 'save empty ::')).text).toMatch(/Nothing to save/)
})

test('parseArgs: inline text after ::', () => {
  expect(parseArgs('save a b :: x :: y')).toEqual({ verb: 'save', name: 'a b', text: 'x :: y' })
  expect(parseArgs('save a ::')).toEqual({ verb: 'save', name: 'a', text: '' })
})
