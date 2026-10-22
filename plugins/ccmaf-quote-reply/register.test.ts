import { test, expect } from 'claude-code/testing'
import { quoteOf, MAX_QUOTE_CHARS } from './hooks/register.ts'

type Harness = { fills: any[]; toasts: string[] }

const stub = (
  on: any,
  opts: { selection?: string | undefined; box?: { text: string; cursor: number }; isFilled?: boolean },
): Harness => {
  const h: Harness = { fills: [], toasts: [] }
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'quote' } }))
  on('ui.selection', () => ({ value: opts.selection === undefined ? undefined : { text: opts.selection } }))
  on('prompt.read', () => ({ value: opts.box ?? { text: '', cursor: 0 } }))
  on('ui.toast', (_$: any, e: any) => {
    h.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.fill', (_$: any, e: any) => {
    h.fills.push({ text: e.text, mode: e.mode })
    return { isFilled: opts.isFilled ?? true }
  })
  return h
}

test('quoteOf: prefixes each line, keeps blank lines as ">", ends with a blank line', () => {
  expect(quoteOf('one\ntwo\n\nthree')).toBe('> one\n> two\n>\n> three\n\n')
})

test('quoteOf: CRLF normalised, trailing spaces and outer blank lines dropped', () => {
  expect(quoteOf('\r\n  a  \r\nb\r\n\r\n')).toBe('>   a\n> b\n\n')
})

test('quoteOf: empty or whitespace-only gives undefined', () => {
  expect(quoteOf('')).toBeUndefined()
  expect(quoteOf(' \n\t \n')).toBeUndefined()
})

test('quoteOf: huge selections are clipped with a marker', () => {
  const q = quoteOf('x'.repeat(MAX_QUOTE_CHARS * 3))!
  expect(q.length).toBeLessThan(MAX_QUOTE_CHARS + 20)
  expect(q.endsWith('> […]\n\n')).toBe(true)
})

test('/quote inserts the quote at the cursor', async ($, on) => {
  const h = stub(on, { selection: 'hello\nworld' })
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'quote' })
  expect(h.fills).toEqual([{ text: '> hello\n> world\n\n', mode: 'insert' }])
  expect(r.text).toMatch(/Quoted/)
})

test('/quote starts a new line when typed text precedes the cursor', async ($, on) => {
  const h = stub(on, { selection: 'q', box: { text: 'why? ', cursor: 5 } })
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'quote' })
  expect(h.fills[0].text).toBe('\n> q\n\n')
})

test('/quote with no selection toasts how to use it and fills nothing', async ($, on) => {
  const h = stub(on, { selection: undefined })
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'quote' })
  expect(h.fills).toEqual([])
  expect(h.toasts[0]).toMatch(/Select text/)
  expect(r.text).toMatch(/Nothing is selected/)
})

test('/quote with a whitespace-only selection behaves as no selection', async ($, on) => {
  const h = stub(on, { selection: '  \n ' })
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'quote' })
  expect(h.fills).toEqual([])
  expect(h.toasts.length).toBe(1)
})

test('/quote reports a prompt box that refuses the text', async ($, on) => {
  stub(on, { selection: 'x', isFilled: false })
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'quote' })
  expect(r.text).toMatch(/could not take/)
})
