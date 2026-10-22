import { test, expect } from 'claude-code/testing'
import { countBoard } from './hooks/register.ts'

const BOARD = `# Task Board

### In Progress

#### [TASK-1] Active by section
- **Status:** In Progress — doing it

#### [TASK-2] Status field wins over section
- **Status:** **Ready for Review** — commit abc

#### ▶ Session note (not an entry)
- **Status:** Verify

#### [TASK-3] Active, bold status
- **Status:** **In Progress** (second)

### Verify

#### [TASK-4] Awaiting acceptance
- **Status:** Verify

#### [TASK-5] No status field, section decides
- **Owner:** me

### Done

#### [TASK-6] Finished
- **Status:** Done

### Fixing

#### [BUG-1] Bug being fixed
- **Status:** Fixing
`

const run = (on: any, files: Record<string, string>, failWith?: string) => {
  let status: string | undefined = 'unset'
  on('ui.status', (_$: any, e: any) => {
    status = e.text
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/x' }))
  on('turn.complete', () => ({ text: '' }))
  on('fs.read', (_$: any, e: any) => {
    const key = Object.keys(files).find(k => String(e.path).split(String.fromCharCode(92)).join('/').endsWith('/' + k))
    if (failWith === undefined && key !== undefined) return { value: files[key] }
    throw new Error((failWith ?? 'ENOENT') + ' ' + e.path)
  })
  return { get: () => status }
}

for (const event of ['session.start', 'turn.complete'] as const) {
  test(`${event}: counts in progress and verify`, async ($, on) => {
    const s = run(on, { '.claude/TASKS.md': BOARD })
    if (event === 'session.start') {
      await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    } else {
      await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
    }
    // TASK-1, TASK-3, BUG-1 in progress; TASK-4, TASK-5 verify
    expect(s.get()).toBe('CCMAF · 3 in progress · 2 verify')
  })

  test(`${event}: no board file sets no status and raises no error`, async ($, on) => {
    const s = run(on, {})
    if (event === 'session.start') {
      await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    } else {
      await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
    }
    expect(s.get()).toBe(undefined)
  })
}

test('read error other than ENOENT (EACCES) clears status, no error', async ($, on) => {
  const s = run(on, { '.claude/TASKS.md': BOARD }, 'EACCES')
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
  expect(s.get()).toBe(undefined)
})

test('parser: emoji status, In-progress, h2 boundary, code fence, inline status, comments', () => {
  const md = [
    '### In Progress',
    '#### [TASK-1] emoji done',
    '- **Status:** **✅ DONE** shipped',
    '#### [TASK-2] hyphenated',
    '- **Status:** In-progress',
    '#### [TASK-3] inline',
    '- **Severity:** P1 · **Status:** Fixing',
    '```',
    '#### [TASK-4] inside fence',
    '- **Status:** Verify',
    '```',
    '<!--',
    '#### [TASK-5] inside comment',
    '- **Status:** Verify',
    '-->',
    '## Bug-Fix Lane',
    '#### [BUG-1] no status; h2 reset means section is not In Progress',
    '- **Note:** x',
    '#### [TASK-6] complete',
    '- **Status:** Complete',
  ].join(String.fromCharCode(13, 10))
  expect(countBoard(md).progress).toBe(2)
  expect(countBoard(md).verify).toBe(0)
})
