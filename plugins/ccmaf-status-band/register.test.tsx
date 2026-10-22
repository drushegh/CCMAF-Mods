import { test, expect, mock } from 'claude-code/testing'
import { bandSegments, fit, formatDuration, gitSegment, parseBudget, parseGit, toolsSegment } from './hooks/register.tsx'

const BOARD = `# Board

### In Progress

#### [TASK-1] Something
- **Status:** In Progress
- **Budget:** M (~60 calls)

#### [TASK-2] Second
- **Budget:** L

### Todo

#### [TASK-3] Later
- **Budget:** S
`

const GIT = `# branch.oid 0123456789abcdef
# branch.head main
# branch.upstream origin/main
# branch.ab +1 -0
1 .M N... 100644 100644 100644 aaa bbb a.txt
1 M. N... 100644 100644 100644 aaa bbb b.txt
? new.txt
`

test('parseBudget reads the first In Progress entry that marks one', () => {
  expect(parseBudget(BOARD)).toBe('M')
  expect(parseBudget('### In Progress\n- **Budget**: `L`\n')).toBe('L')
  expect(parseBudget('### Todo\n- **Budget:** S\n')).toBeNull() // not In Progress
  expect(parseBudget('### In Progress\n#### [TASK-1] x\n- **Status:** In Progress\n')).toBeNull()
  expect(parseBudget('')).toBeNull()
})

test('parseGit: branch, ahead/behind, dirty count', () => {
  expect(parseGit(GIT)).toEqual({ branch: 'main', ahead: 1, behind: 0, dirty: 3 })
  expect(parseGit('# branch.oid abcdef0123\n# branch.head (detached)\n')).toEqual({ branch: 'abcdef0', ahead: 0, behind: 0, dirty: 0 })
  expect(parseGit('fatal: not a git repository')).toBeNull()
  expect(gitSegment({ branch: 'main', ahead: 1, behind: 2, dirty: 3 }).text).toBe('main ↑1 ↓2 ✱3')
  expect(gitSegment({ branch: 'main', ahead: 0, behind: 0, dirty: 0 }).text).toBe('main')
})

test('toolsSegment: plain count without a class; amber at half, red past the budget', () => {
  expect(toolsSegment(14, null)).toEqual({ text: 'turn tools 14' })
  expect(toolsSegment(14, 'M')).toEqual({ text: 'turn tools 14 / M60', color: undefined })
  expect(toolsSegment(30, 'M').color).toBe('warning')
  expect(toolsSegment(60, 'M').color).toBe('warning')
  expect(toolsSegment(61, 'M').color).toBe('error')
  expect(toolsSegment(31, 'S').color).toBe('error')
})

test('formatDuration', () => {
  expect(formatDuration(45)).toBe('45s')
  expect(formatDuration(130)).toBe('2m10s')
  expect(formatDuration(3700)).toBe('1h01m')
})

test('bandSegments hides turn segments when idle and is empty with nothing to show', () => {
  const base = { ctx: null, turn: null, now: 0, isWorking: false, budget: null, git: null }
  expect(bandSegments(base)).toEqual([])
  expect(bandSegments({ ...base, ctx: 62 }).map(s => s.text)).toEqual(['ctx 62%'])
  // a stale turn record does not show once the engine says it is not working
  expect(bandSegments({ ...base, turn: { startedAt: 0, tools: 3 } })).toEqual([])
})

test('fit drops the trailing segments, never the first', () => {
  const segs = [{ text: 'ctx 62%' }, { text: 'turn tools 14 / M60' }, { text: '2m10s' }, { text: 'main ↑1 ✱3' }]
  expect(fit(segs, 200)).toHaveLength(4)
  expect(fit(segs, 30).map(s => s.text)).toEqual(['ctx 62%', 'turn tools 14 / M60'])
  expect(fit(segs, 3).map(s => s.text)).toEqual(['ctx 62%'])
})

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
} as const

// Nothing sits beneath the plugin: each hook stands for the engine.
const gitCalls: string[][] = []
const engine = (on: any, o: { percent?: number; git?: string; board?: string; isGitHung?: boolean } = {}) => {
  gitCalls.length = 0
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('fs.read', () => {
    if (o.board === undefined) throw new Error('ENOENT')
    return { value: o.board }
  })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000, percent: o.percent }, rateLimits: [] },
  }))
  on('process.run', async (_$: any, e: any) => {
    gitCalls.push(e.argv)
    if (o.isGitHung) await new Promise(() => undefined) // git that never answers
    return { value: { exitCode: o.git === undefined ? 128 : 0, stdout: o.git ?? '', stderr: '' } }
  })
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId ?? 't' }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return clock
}

// Refreshes run beside the hooks, so let them land before looking.
const settle = () => new Promise(r => setTimeout(r, 30))
const start = async ($: any) => {
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
  await settle()
}
const beginTurn = ($: any) => $.turn.start({ prompt: 'go', turnId: 't' })
const endTurn = async ($: any) => {
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await settle()
}

const textOf = async (ui: any, re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text

for (const surface of ['terminal'] as const) {
  test(`${surface}: idle band shows context and git; nothing else`, async ($, on) => {
    engine(on, { percent: 62, git: GIT, board: BOARD })
    await start($)
    const ui = await $.ui.mount({ plugin: 'ccmaf-status-band', surface, component: 'AbovePrompt', props: PROPS })
    expect(await textOf(ui, /ctx 62%/)).toContain('ctx 62% · main ↑1 ✱3')
    expect(await textOf(ui, /tools/)).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: a running turn shows tools against the budget class and a live clock`, async ($, on) => {
    const clock = engine(on, { percent: 62, git: GIT, board: BOARD })
    await start($)
    await beginTurn($)
    for (let i = 0; i < 14; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'sub' }) // a subagent's call is not counted
    await settle()

    const ui = await $.ui.mount({
      plugin: 'ccmaf-status-band',
      surface,
      component: 'AbovePrompt',
      props: { ...PROPS, isWorking: true },
    })
    expect(await textOf(ui, /ctx/)).toContain('ctx 62% · turn tools 14 / M60 · 0s · main ↑1 ✱3')

    await clock.advance(130_000)
    expect(await textOf(ui, /ctx/)).toContain('turn tools 14 / M60 · 2m10s')
    await ui.unmount()
  })

  test(`${surface}: finishing the turn stops the clock (no timer left to spin when idle)`, async ($, on) => {
    const clock = engine(on, { percent: 40, git: GIT, board: BOARD })
    let ticks = 0
    const store = new Map<string, unknown>()
    on('state.set', (_$: any, e: any) => {
      if (e.key === 'tick') ticks++
      store.set(e.key, e.value)
      return { value: { isSet: true, version: ticks } }
    })
    on('state.get', (_$: any, e: any) => ({ value: { value: store.get(e.key), version: ticks } }))
    await start($)
    await beginTurn($)
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await clock.advance(3000)
    expect(ticks).toBe(3)
    await endTurn($)
    await clock.advance(60_000)
    expect(ticks).toBe(3) // no timer left once the turn ended
  })

  test(`${surface}: after the turn the band is back to context and git`, async ($, on) => {
    engine(on, { percent: 40, git: GIT, board: BOARD })
    await start($)
    await beginTurn($)
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await endTurn($)
    const ui = await $.ui.mount({ plugin: 'ccmaf-status-band', surface, component: 'AbovePrompt', props: PROPS })
    expect(await textOf(ui, /ctx/)).toBe('ctx 40% · main ↑1 ✱3')
    await ui.unmount()
  })

  test(`${surface}: no board, no git, no context reading: the band hides and the engine's draws`, async ($, on) => {
    engine(on)
    await start($)
    const ui = await $.ui.mount({ plugin: 'ccmaf-status-band', surface, component: 'AbovePrompt', props: PROPS })
    expect(await textOf(ui, /engine/)).toBe('engine')
    expect(await textOf(ui, /ctx|main/)).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: a survey keeps the band (no fight)`, async ($, on) => {
    engine(on, { percent: 62, git: GIT })
    await start($)
    const ui = await $.ui.mount({
      plugin: 'ccmaf-status-band',
      surface,
      component: 'AbovePrompt',
      props: { ...PROPS, hasSurvey: true },
    })
    expect(await textOf(ui, /engine/)).toBe('engine')
    expect(await textOf(ui, /ctx/)).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: narrow columns clip to one line`, async ($, on) => {
    engine(on, { percent: 62, git: GIT })
    await start($)
    const ui = await $.ui.mount({
      plugin: 'ccmaf-status-band',
      surface,
      component: 'AbovePrompt',
      props: { ...PROPS, bodyColumns: 12 },
    })
    expect(await textOf(ui, /ctx/)).toBe('ctx 62%')
    await ui.unmount()
  })
}

test('parseBudget skips the template line "S|M|L" and takes the next real class', () => {
  expect(parseBudget(['### In Progress', '- **Budget:** S|M|L (pick one)', '- **Budget:** L'].join('\n'))).toBe('L')
  expect(parseBudget(['### In Progress', '- **Budget:** S|M|L'].join('\n'))).toBeNull()
})

test('git is read without the optional index lock, and never holds a hook back', async ($, on) => {
  engine(on, { percent: 10, git: GIT, isGitHung: true })
  await start($) // would never return if session.start awaited git
  await beginTurn($)
  await endTurn($) // nor would turn.complete
  expect(gitCalls[0]).toEqual(['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'])
  expect(gitCalls.length).toBe(2)
})

test('a missing context reading keeps the last one', async ($, on) => {
  const o = { percent: 62 as number | undefined, git: GIT }
  engine(on, o)
  await start($)
  o.percent = undefined // e.g. just compacted
  await beginTurn($)
  await endTurn($)
  const ui = await $.ui.mount({ plugin: 'ccmaf-status-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await textOf(ui, /ctx/)).toContain('ctx 62%')
  await ui.unmount()
})
