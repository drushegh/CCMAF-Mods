import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GitInfo } from '../types'

const BOARD = '.claude/TASKS.md'
const SEP = ' · '

// CCMAF budget classes: tool calls per task.
export const BUDGETS = { S: 30, M: 60, L: 120 } as const
type Budget = keyof typeof BUDGETS

const turn = atom({ plugin: 'ccmaf-status-band', key: 'turn' } as const, null)
const tick = atom({ plugin: 'ccmaf-status-band', key: 'tick' } as const, 0)
const budget = atom({ plugin: 'ccmaf-status-band', key: 'budget' } as const, null)
const ctx = atom({ plugin: 'ccmaf-status-band', key: 'ctx' } as const, null)
const git = atom({ plugin: 'ccmaf-status-band', key: 'git' } as const, null)

// The live-clock timer; exists only while a main-loop turn runs.
let ticker: { cancel: () => void } | null = null

/** 130 -> "2m10s", 45 -> "45s", 3700 -> "1h01m". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/**
 * The `**Budget:** S|M|L` of the first entry under the board's `In Progress`
 * heading that has one; null when none does. Tolerant: any `##`/`###` heading
 * containing "In Progress", `**Budget:** M (~60)` or `**Budget**: M`.
 */
export function parseBudget(md: string): Budget | null {
  let isSection = false
  for (const line of md.split(/\r?\n/)) {
    const h = /^(#{2,3})\s+(.*)$/.exec(line)
    if (h) {
      isSection = /in[\s-]?progress/i.test(h[2] ?? '')
      continue
    }
    if (!isSection) continue
    const m = /\*\*Budget:?\*\*:?\s*`?([SML])(?![\w|/])/.exec(line)
    if (m) return m[1] as Budget
  }
  return null
}

/** Reads `git status --porcelain=v2 --branch` output; null when it holds no branch line. */
export function parseGit(out: string): GitInfo | null {
  let head: string | undefined
  let oid = ''
  let ahead = 0
  let behind = 0
  let dirty = 0
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) head = line.slice(14).trim()
    else if (line.startsWith('# branch.oid ')) oid = line.slice(13).trim()
    else if (line.startsWith('# branch.ab ')) {
      const ab = /\+(\d+) -(\d+)/.exec(line)
      ahead = Number(ab?.[1] ?? 0)
      behind = Number(ab?.[2] ?? 0)
    } else if (line !== '' && !line.startsWith('#')) dirty++
  }
  if (head === undefined) return null
  return { branch: head === '(detached)' ? oid.slice(0, 7) : head, ahead, behind, dirty }
}

export type Segment = { text: string; color?: string }

/** The tools segment: count, against the budget class when there is one. */
export function toolsSegment(tools: number, cls: Budget | null): Segment {
  if (cls === null) return { text: `turn tools ${tools}` }
  const limit = BUDGETS[cls]
  const color = tools > limit ? 'error' : tools >= limit / 2 ? 'warning' : undefined
  return { text: `turn tools ${tools} / ${cls}${limit}`, color }
}

export function gitSegment(g: GitInfo): Segment {
  const parts = [g.branch]
  if (g.ahead) parts.push(`↑${g.ahead}`)
  if (g.behind) parts.push(`↓${g.behind}`)
  if (g.dirty) parts.push(`✱${g.dirty}`)
  return { text: parts.join(' ') }
}

/** Drops trailing segments until the line fits `columns`; the first is kept and clipped by the Text. */
export function fit(segments: Segment[], columns: number): Segment[] {
  const out = [...segments]
  const width = (s: Segment[]) => s.reduce((n, x) => n + x.text.length, 0) + SEP.length * (s.length - 1)
  while (out.length > 1 && width(out) > columns) out.pop()
  return out
}

// Builds the band's segments; empty means "nothing useful to show".
export function bandSegments(p: {
  ctx: number | null
  turn: { startedAt: number; tools: number } | null
  now: number
  isWorking: boolean
  budget: Budget | null
  git: GitInfo | null
}): Segment[] {
  const out: Segment[] = []
  if (p.ctx !== null) out.push({ text: `ctx ${p.ctx}%` })
  if (p.isWorking && p.turn !== null) {
    out.push(toolsSegment(p.turn.tools, p.budget))
    out.push({ text: formatDuration((p.now - p.turn.startedAt) / 1000) })
  }
  if (p.git !== null) out.push(gitSegment(p.git))
  return out
}

async function refreshBudget($: EngineInterface) {
  const md = await $.fs.read(BOARD).catch(() => '')
  await update($, budget, () => parseBudget(md))
}

async function refreshCtx($: EngineInterface) {
  try {
    const { context } = await $.session.usage()
    const { percent } = context
    // None yet (fresh or just compacted): keep the last reading.
    if (percent !== undefined) await update($, ctx, () => percent)
  } catch {
    // no reading: keep what was shown
  }
}

async function refreshGit($: EngineInterface) {
  try {
    const r = await $.process.run(['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'], { timeoutMs: 5000 })
    await update($, git, () => (r.exitCode === 0 ? parseGit(r.stdout) : null))
  } catch {
    await update($, git, () => null)
  }
}

// Runs a refresh beside the hook: next() never waits on it, a failure is dropped.
function fire(work: Promise<unknown>) {
  work.catch(() => undefined)
}

// One tick; with no turn running the timer ends itself.
async function tickOrStop($: EngineInterface) {
  if ((await read($, turn)) === null) stopTicker()
  else await update($, tick, n => n + 1)
}

function stopTicker() {
  ticker?.cancel()
  ticker = null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refreshBudget($)
    fire(refreshCtx($))
    fire(refreshGit($))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const startedAt = await $.clock.now()
    await update($, turn, () => ({ startedAt, tools: 0 }))
    await refreshBudget($)
    stopTicker()
    // The live clock: one write a second while the turn runs, nothing when idle.
    ticker = $.clock.every(1000, () => tickOrStop($))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, turn, t => (t === null ? t : { ...t, tools: t.tools + 1 }))
      fire(refreshCtx($)) // after a model response; never holds the tool back
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    stopTicker()
    await update($, turn, () => null)
    fire(refreshCtx($))
    fire(refreshGit($))
    return next(e)
  })

  on('session.end', ($, e, next) => {
    stopTicker()
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const [t, b, c, g] = await Promise.all([read($, turn), read($, budget), read($, ctx), read($, git)])
    await read($, tick) // subscribes this drawing to the once-a-second tick
    const segments = fit(
      bandSegments({ ctx: c, turn: t, now: await $.clock.now(), isWorking: e.props.isWorking, budget: b, git: g }),
      e.props.bodyColumns,
    )
    if (segments.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text wrap="truncate-end" dimColor>
          {segments.map((s, i) => (
            <Text key={String(i)}>
              {i > 0 ? SEP : ''}
              <Text color={s.color} dimColor={s.color === undefined}>
                {s.text}
              </Text>
            </Text>
          ))}
        </Text>
      </Box>
    )
  })
}
