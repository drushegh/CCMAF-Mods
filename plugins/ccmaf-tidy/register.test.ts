import { test, expect } from 'claude-code/testing'
import { editDiff, keyArg, outcome, shortPath, statusOf, toolLabel, trimmed } from './hooks/describe.ts'

test('keyArg: Bash prefers the description, files show their last two segments', () => {
  expect(keyArg('Bash', { command: 'git status --short', description: 'Show status' })).toBe('Show status')
  expect(keyArg('Bash', { command: 'ls -la\necho hi' })).toBe('ls -la')
  expect(keyArg('Edit', { file_path: 'C:\\repo\\src\\app\\main.ts' })).toBe('…/app/main.ts')
  expect(keyArg('Agent', { subagent_type: 'researcher', description: 'Astro docs' })).toBe('researcher: Astro docs')
})

test('toolLabel shortens MCP tool names', () => {
  expect(toolLabel('mcp__claude_ai_Gmail__search_threads')).toBe('Gmail·search_threads')
  expect(toolLabel('Bash')).toBe('Bash')
})

test('outcome: shell facts beat line counts', () => {
  const bats = outcome('Bash', { command: 'bats tests' }, { stdout: 'ok 1\n436 tests, 0 failures\n', stderr: '' }, false)
  expect(bats).toBe('436 tests passed')
  const failing = outcome('Bash', { command: 'bats tests' }, { stdout: '40 tests, 3 failures\n', stderr: '' }, false)
  expect(failing).toBe('3 of 40 tests failed')
  const commit = outcome('Bash', { command: 'git commit -m x' }, { stdout: '[main a1b2c3d] x\n 1 file changed\n', stderr: '' }, false)
  expect(commit).toBe('committed a1b2c3d')
  const push = outcome('Bash', { command: 'git push' }, { stdout: '', stderr: 'To github.com:o/r.git\n   1f6a075..3dc6901  main -> main\n' }, false)
  expect(push).toBe('pushed 1f6a075..3dc6901')
  expect(outcome('Bash', { command: 'ls' }, { stdout: 'a\nb\nc\n', stderr: '' }, false)).toBe('3 lines')
  expect(outcome('Bash', { command: 'true' }, { stdout: '', stderr: '' }, false)).toBe('no output')
})

test('outcome: errors show their first line; edits show +/−', () => {
  expect(outcome('Bash', {}, 'Exit code 2\nls: cannot access', true)).toBe('Exit code 2')
  expect(outcome('Edit', { old_string: 'a\nb', new_string: 'a\nb\nc' }, {}, false)).toBe('+3 −2')
  expect(outcome('Agent', {}, { totalDurationMs: 134000, totalToolUseCount: 38 }, false)).toBe('2m14s · 38 tools')
})

test('editDiff uses the engine patch when present, else one hunk', () => {
  const patch = { structuredPatch: [{ oldStart: 12, oldLines: 1, newStart: 12, newLines: 1, lines: ['-a', '+b'] }] }
  expect(editDiff({}, patch)).toBe('@@ -12,1 +12,1 @@\n-a\n+b')
  expect(editDiff({ old_string: 'x', new_string: 'y' }, {})).toBe('@@ -1,1 +1,1 @@\n-x\n+y')
})

test('statusOf: running, interrupted, failed, ok', () => {
  expect(statusOf({ isRunning: true, isErrored: false, isInterrupted: false }).mark).toBe('…')
  expect(statusOf({ isRunning: false, isErrored: false, isInterrupted: true }).mark).toBe('⊘')
  expect(statusOf({ isRunning: false, isErrored: true, isInterrupted: false }).color).toBe('red')
  expect(statusOf({ isRunning: false, isErrored: false, isInterrupted: false }).color).toBe('green')
})

test('trimmed cuts long strings anywhere in a value', () => {
  const out = trimmed({ a: 'x'.repeat(50), b: ['y'.repeat(50)] }, 10) as { a: string; b: string[] }
  expect(out.a.length).toBe(10)
  expect(out.b[0]?.endsWith('…')).toBe(true)
  expect(shortPath('a/b')).toBe('a/b')
})
