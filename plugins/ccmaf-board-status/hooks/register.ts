import type { EngineInterface, Register } from 'claude-code'

const BOARD = '.claude/TASKS.md'

type Bucket = 'progress' | 'verify' | 'other'

// Leading words of a `**Status:**` value, mapped to a bucket.
const STATUS_BUCKETS: [RegExp, Bucket][] = [
  [/^(in[\s-]?progress|fixing)\b/, 'progress'],
  [/^verify\b/, 'verify'],
  [
    /^(todo|reported|open|blocked|done|complete|implemented|smoke-passed|mostly done|ready for|in review|testing)\b/,
    'other',
  ],
]

const bucketOf = (text: string): Bucket | undefined => {
  const t = text
    .replace(/[*_`]/g, '')
    .trim()
    .toLowerCase()
    .replace(/^[^a-z]+/, '') // leading emoji / punctuation, e.g. "✅ DONE"
  return STATUS_BUCKETS.find(([re]) => re.test(t))?.[1]
}

/**
 * Counts board entries (`#### [TASK-N]` / `#### [BUG-N]`) in TASKS.md text.
 * An entry's own `**Status:**` field (anywhere in a bullet line) wins when it
 * starts with a known status; otherwise the enclosing `### ` section decides.
 * Fenced code blocks and HTML comments are skipped.
 */
export function countBoard(md: string): { progress: number; verify: number } {
  let progress = 0
  let verify = 0
  let section: Bucket = 'other'
  let pending = false // inside an entry whose status is not yet decided
  let entryFallback: Bucket = 'other'
  let inFence = false
  let inComment = false

  const settle = (b: Bucket) => {
    if (b === 'progress') progress++
    else if (b === 'verify') verify++
    pending = false
  }

  for (const line of md.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (inComment) {
      if (line.includes('-->')) inComment = false
      continue
    }
    if (/^\s*<!--/.test(line)) {
      if (!line.includes('-->')) inComment = true
      continue
    }

    const h3 = /^###\s+(?!#)(.*)$/.exec(line)
    if (h3) {
      if (pending) settle(entryFallback)
      section = bucketOf(h3[1]) ?? 'other'
      continue
    }
    if (/^####\s+\[(TASK|BUG)-\d+\]/.test(line)) {
      if (pending) settle(entryFallback)
      pending = true
      entryFallback = section
      continue
    }
    if (/^#{1,4}\s/.test(line)) {
      if (pending) settle(entryFallback)
      if (/^#{1,2}\s/.test(line)) section = 'other'
      continue
    }
    if (pending) {
      const s = /^\s*[-*]\s+.*?\*\*Status:\*\*\s*(.*)$/.exec(line)
      if (s) settle(bucketOf(s[1]) ?? entryFallback)
    }
  }
  if (pending) settle(entryFallback)
  return { progress, verify }
}

/** The status-line text for a TASKS.md body. */
export const statusText = (md: string) => {
  const { progress, verify } = countBoard(md)
  return `CCMAF · ${progress} in progress · ${verify} verify`
}

// A missing/unreadable board clears the status and raises nothing.
const refreshBoard = async ($: EngineInterface) => {
  try {
    $.ui.status(statusText(await $.fs.read(BOARD)))
  } catch {
    $.ui.status(undefined)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refreshBoard($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e) // subagent turn: the board has not changed for us
    await refreshBoard($)
    return next(e)
  })
}
