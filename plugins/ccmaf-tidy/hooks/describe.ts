// Pure helpers: what a tool call was about, and how it went, in a few words.

export type Fields = Record<string, unknown>

export const asFields = (value: unknown): Fields =>
  value !== null && typeof value === 'object' ? (value as Fields) : {}

export const str = (value: unknown): string => (typeof value === 'string' ? value : '')

export const firstLine = (text: string): string => text.trim().split('\n')[0] ?? ''

export const lineCount = (text: string): number =>
  text === '' ? 0 : text.replace(/\n$/, '').split('\n').length

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export const clip = (text: string, room: number): string =>
  text.length <= room ? text : `${text.slice(0, Math.max(0, room - 1))}…`

// The last two segments of a path: enough to tell files apart, short enough for one line.
export const shortPath = (path: string): string => {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.length <= 2 ? parts.join('/') : `…/${parts.slice(-2).join('/')}`
}

export const toolLabel = (tool: string): string => {
  if (!tool.startsWith('mcp__')) return tool
  const [, server = '', name = ''] = tool.split('__')
  return `${server.replace(/^claude_ai_/, '')}·${name}`
}

export type Status = { mark: string; color: string; word: string }

export const statusOf = (s: { isRunning: boolean; isErrored: boolean; isInterrupted: boolean }): Status =>
  s.isRunning
    ? { mark: '…', color: 'yellow', word: 'running' }
    : s.isInterrupted
      ? { mark: '⊘', color: 'gray', word: 'interrupted' }
      : s.isErrored
        ? { mark: '✗', color: 'red', word: 'failed' }
        : { mark: '✓', color: 'green', word: 'succeeded' }

// The one argument that says what the call was about.
export const keyArg = (tool: string, input: unknown): string => {
  const f = asFields(input)
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return firstLine(str(f.description) || str(f.command))
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return shortPath(str(f.file_path) || str(f.notebook_path))
    case 'Grep':
    case 'Glob':
      return str(f.pattern)
    case 'Agent':
      return [str(f.subagent_type), str(f.description)].filter(Boolean).join(': ')
    case 'Skill':
      return str(f.skill)
    case 'WebFetch':
      return str(f.url)
    case 'WebSearch':
      return str(f.query)
    default: {
      const text = Object.values(f).find(v => typeof v === 'string')
      return firstLine(str(text))
    }
  }
}

// Recognises the shell commands whose output has one fact worth more than a line count.
const shellFact = (command: string, stdout: string, stderr: string): string | undefined => {
  const all = `${stdout}\n${stderr}`
  // bats: "436 tests, 0 failures"
  const bats = all.match(/(\d+) tests?, (\d+) failures?/)
  if (bats) return bats[2] === '0' ? `${bats[1]} tests passed` : `${bats[2]} of ${bats[1]} tests failed`
  // TAP-style totals and most JS runners: "Tests: 3 failed, 41 passed"
  const jsFailed = all.match(/Tests?:\s+(\d+) failed/)
  const jsPassed = all.match(/Tests?:\s+(?:\d+ failed, )?(\d+) passed/)
  if (jsFailed) return `${jsFailed[1]} tests failed`
  if (jsPassed) return `${jsPassed[1]} tests passed`
  // pytest: "== 12 passed, 1 failed in 0.4s =="
  const py = all.match(/=+ (?:(\d+) failed, )?(\d+) passed/)
  if (py) return py[1] ? `${py[1]} failed, ${py[2]} passed` : `${py[2]} passed`
  if (/\bgit\b[^|;&]*\bcommit\b/.test(command)) {
    const sha = stdout.match(/^\[\S+(?: \(root-commit\))? ([0-9a-f]{7,})\]/m)
    if (sha) return `committed ${sha[1]}`
  }
  if (/\bgit\b[^|;&]*\bpush\b/.test(command)) {
    if (/Everything up-to-date/.test(all)) return 'up to date'
    const ref = all.match(/\s([0-9a-f]{7,}\.\.[0-9a-f]{7,})\s/)
    if (ref) return `pushed ${ref[1]}`
  }
  if (/\bgit\b[^|;&]*\bpull\b/.test(command) && /Already up to date/.test(all)) return 'up to date'
  return undefined
}

// The one fact about how the call went.
export const outcome = (tool: string, input: unknown, output: unknown, isErrored: boolean): string => {
  if (isErrored) return firstLine(typeof output === 'string' ? output : str(asFields(output).error))
  const f = asFields(output)
  const i = asFields(input)
  switch (tool) {
    case 'Bash':
    case 'PowerShell': {
      const stdout = str(f.stdout) || str(f.output)
      const fact = shellFact(str(i.command), stdout, str(f.stderr))
      if (fact) return fact
      const n = lineCount(stdout)
      return n === 0 ? 'no output' : plural(n, 'line')
    }
    case 'Edit':
      return `+${lineCount(str(i.new_string))} −${lineCount(str(i.old_string))}`
    case 'Write':
      return plural(lineCount(str(i.content)), 'line')
    case 'Read': {
      const n = asFields(f.file).numLines ?? f.numLines
      return typeof n === 'number' ? plural(n, 'line') : ''
    }
    case 'Grep':
    case 'Glob': {
      const n = f.numFiles ?? f.numMatches
      return typeof n === 'number' ? plural(n, 'match') : ''
    }
    case 'Agent': {
      const ms = f.totalDurationMs
      const tools = f.totalToolUseCount
      if (typeof ms !== 'number') return str(f.status)
      const s = Math.round(ms / 1000)
      const time = s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`
      return typeof tools === 'number' ? `${time} · ${plural(tools, 'tool')}` : time
    }
    default:
      return ''
  }
}

// A unified diff of one Edit: the engine's own patch when the result carries it,
// else old against new as one hunk.
export const editDiff = (input: unknown, output: unknown): string => {
  const patch = asFields(output).structuredPatch
  if (Array.isArray(patch) && patch.length > 0) {
    return patch
      .map(h => {
        const hunk = asFields(h)
        const lines = Array.isArray(hunk.lines) ? hunk.lines.map(str) : []
        return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${lines.join('\n')}`
      })
      .join('\n')
  }
  const i = asFields(input)
  const before = str(i.old_string).replace(/\n$/, '').split('\n')
  const after = str(i.new_string).replace(/\n$/, '').split('\n')
  return [
    `@@ -1,${before.length} +1,${after.length} @@`,
    ...before.map(l => `-${l}`),
    ...after.map(l => `+${l}`),
  ].join('\n')
}

// Keeps a snapshot small enough to sit in session state: long strings are cut.
export const trimmed = (value: unknown, room = 30000): unknown => {
  if (typeof value === 'string') return clip(value, room)
  if (Array.isArray(value)) return value.slice(0, 500).map(v => trimmed(v, room))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trimmed(v, room)]))
  }
  return value
}

// The text a result carries, whatever its shape: a string, stdout, content blocks.
export const resultText = (output: unknown): string => {
  if (typeof output === 'string') return output
  const f = asFields(output)
  const direct = str(f.stdout) || str(f.output) || str(f.content) || str(f.result)
  if (direct) return direct
  if (Array.isArray(f.content)) {
    return f.content.map(b => str(asFields(b).text)).filter(Boolean).join('\n\n')
  }
  const file = asFields(f.file)
  if (str(file.content)) return str(file.content)
  return ''
}
