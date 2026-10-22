import { test, expect, mock } from 'claude-code/testing'
import { formatDuration, positiveOr } from './hooks/register.ts'

// Nothing sits beneath the plugin: each hook here stands for the engine and
// records what the plugin asked of it.
const harness = (on: any, isHung = false) => {
  const hang = () => new Promise<never>(() => undefined) // a player or bell that never answers
  const clock = mock.clock(on, { now: 1_000_000 })
  const seen = { toasts: [] as string[], clips: [] as string[], bells: [] as string[] }
  on('ui.toast', (_$: any, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  on('audio.play', (_$: any, e: any) => (isHung ? hang() : (seen.clips.push(e.clip.asset), { value: undefined })))
  on('ui.notify', (_$: any, e: any) =>
    isHung ? hang() : (seen.bells.push(e.text), { value: { isSent: true, channel: 'terminal_bell' } }),
  )
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.PermissionRequest', () => ({}))
  on('classic.Notification', () => ({}))
  on('classic.PermissionDenied', () => ({}))
  on('prompt.edit', (_$: any, e: any) => ({ text: e.text, cursor: e.cursor }))
  return { clock, seen }
}

// The sound and bell run beside the hooks: give them a moment to land.
const settle = () => new Promise(r => setTimeout(r, 20))

const complete = async ($: any, durationMs: number, extra: Record<string, unknown> = {}) => {
  await $.turn.complete({ answer: 'ok', durationMs, isAborted: false, turnId: 't', reason: 'answer', ...extra })
  await settle()
}

const permission = async ($: any, tool = 'Bash') => {
  await $.classic.PermissionRequest({ tool_name: tool, tool_input: { command: 'ls' } })
  await settle()
}

test('formatDuration', () => {
  expect(formatDuration(45)).toBe('45s')
  expect(formatDuration(192)).toBe('3m12s')
  expect(formatDuration(3700)).toBe('1h01m')
  expect(formatDuration(-4)).toBe('0s')
})

test('a long turn toasts "Done in 3m12s" with the chime and the bell', async ($, on) => {
  const { seen } = harness(on)
  await complete($, 192_000)
  expect(seen.toasts).toEqual(['Done in 3m12s'])
  expect(seen.clips).toEqual(['sounds/ping.wav'])
  expect(seen.bells).toEqual(['Done in 3m12s'])
})

test('a short turn, an aborted turn and a subagent turn stay quiet', async ($, on) => {
  const { seen } = harness(on)
  await complete($, 59_000)
  await complete($, 300_000, { isAborted: true, reason: 'aborted' })
  await complete($, 300_000, { agentId: 'a1' })
  expect(seen.toasts).toEqual([])
})

test('the threshold option moves the line', { options: { thresholdSeconds: 10 } }, async ($, on) => {
  const { seen } = harness(on)
  await complete($, 11_000)
  expect(seen.toasts).toEqual(['Done in 11s'])
})

test('sound off: toast only', { options: { sound: false } }, async ($, on) => {
  const { seen } = harness(on)
  await complete($, 120_000)
  expect(seen.toasts).toEqual(['Done in 2m00s'])
  expect(seen.clips).toEqual([])
  expect(seen.bells).toEqual([])
})

test('soundVia clip: chime only', { options: { soundVia: 'clip' } }, async ($, on) => {
  const { seen } = harness(on)
  await complete($, 120_000)
  expect(seen.clips).toEqual(['sounds/ping.wav'])
  expect(seen.bells).toEqual([])
})

test('soundVia bell: terminal bell only', { options: { soundVia: 'bell' } }, async ($, on) => {
  const { seen } = harness(on)
  await complete($, 120_000)
  expect(seen.clips).toEqual([])
  expect(seen.bells.length).toBe(1)
})

test('a permission prompt notifies once per wait', async ($, on) => {
  const { seen } = harness(on)
  await permission($)
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  await settle()
  expect(seen.toasts).toEqual(['Claude needs permission: Bash'])
})

test('the next tool running ends the wait; the next prompt is a new wait', async ($, on) => {
  const { seen } = harness(on)
  await permission($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await permission($, 'Write')
  expect(seen.toasts).toEqual(['Claude needs permission: Bash', 'Claude needs permission: Write'])
})

test('an AskUserQuestion call notifies, and each question is its own wait', async ($, on) => {
  const { seen } = harness(on)
  await permission($, 'AskUserQuestion') // the permission path leaves questions to tool.call
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)
  await settle()
  expect(seen.toasts).toEqual(['Claude has a question for you', 'Claude has a question for you'])
})

test('no notification while the person is typing, again after the grace', async ($, on) => {
  const { clock, seen } = harness(on)
  await ($ as any).prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'h' })
  await clock.advance(2000)
  await permission($)
  await complete($, 120_000)
  expect(seen.toasts).toEqual([])

  await clock.advance(6000)
  await complete($, 120_000)
  expect(seen.toasts).toEqual(['Done in 2m00s'])
})

test('positiveOr: NaN, negative, zero and junk fall back', () => {
  expect(positiveOr(30, 60)).toBe(30)
  expect(positiveOr(0, 60)).toBe(60)
  expect(positiveOr(-5, 60)).toBe(60)
  expect(positiveOr(Number.NaN, 60)).toBe(60)
  expect(positiveOr('abc', 60)).toBe(60)
  expect(positiveOr(undefined, 60)).toBe(60)
  expect(positiveOr(Infinity, 60)).toBe(60)
})

test('a bad threshold option acts as 60 s', { options: { thresholdSeconds: -5 } }, async ($, on) => {
  const { seen } = harness(on)
  await complete($, 59_000)
  expect(seen.toasts).toEqual([])
  await complete($, 61_000)
  expect(seen.toasts).toEqual(['Done in 1m01s'])
})

test('a sound player or bell that never answers does not hold the hook', async ($, on) => {
  const { seen } = harness(on, true)
  await $.turn.complete({ answer: 'ok', durationMs: 120_000, isAborted: false, turnId: 't', reason: 'answer' }) // returns
  expect(seen.toasts).toEqual(['Done in 2m00s'])
})

test('a wait that lands while you type is silent, and still counts as notified', async ($, on) => {
  const { clock, seen } = harness(on)
  await ($ as any).prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'h' })
  await clock.advance(1000)
  await permission($) // suppressed by the typing grace
  await clock.advance(10_000)
  await permission($, 'Write') // same wait: no late notification once you stop typing
  expect(seen.toasts).toEqual([])
})
