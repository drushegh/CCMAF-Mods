import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CallSnap, PromptRow, Selection, TurnRecord } from '../types'
import {
  asFields,
  clip,
  editDiff,
  firstLine,
  keyArg,
  outcome,
  plural,
  resultText,
  statusOf,
  str,
  toolLabel,
  trimmed,
} from './describe'

const PANE = 'tidy'
const enabled = atom({ plugin: 'ccmaf-tidy', key: 'enabled' } as const, true)
const selected = atom({ plugin: 'ccmaf-tidy', key: 'selected' } as const, null)
const prompts = atom({ plugin: 'ccmaf-tidy', key: 'prompts' } as const, [])
const showAllPrompts = atom({ plugin: 'ccmaf-tidy', key: 'showAllPrompts' } as const, false)
const collapseTurns = atom({ plugin: 'ccmaf-tidy', key: 'collapseTurns' } as const, false)
const foldNarration = atom({ plugin: 'ccmaf-tidy', key: 'foldNarration' } as const, false)
const draft = atom({ plugin: 'ccmaf-tidy', key: 'draft' } as const, { calls: [], replies: [] })
const turns = atom({ plugin: 'ccmaf-tidy', key: 'turns' } as const, [])

// Finished turns kept for folding; older ones draw as plain rows again.
const KEPT_TURNS = 200
// A turn record keeps smaller snapshots than a click does, and only for its first
// calls; later calls keep just what the summary line needs.
const TURN_SNAP_ROOM = 2000
const TURN_DETAILED_CALLS = 50
// A runaway turn stops being recorded here; its later rows draw as plain one-liners.
const TURN_MAX_CALLS = 1000

// The finished turn a row belongs to, and whether it is that turn's first call.
const turnOfCall = (all: readonly TurnRecord[], id: string): { turn: TurnRecord; isFirst: boolean } | undefined => {
  for (const turn of all) {
    const at = turn.calls.findIndex(c => c.id === id)
    if (at >= 0) return { turn, isFirst: at === 0 }
  }
  return undefined
}

const turnLine = (turn: TurnRecord): { status: ReturnType<typeof statusOf>; text: string; result: string } => {
  const failed = turn.calls.filter(c => c.isErrored).length
  const edits = turn.calls.filter(c => c.tool === 'Edit' || c.tool === 'Write' || c.tool === 'NotebookEdit').length
  const agents = turn.calls.filter(c => c.tool === 'Agent').length
  const parts = [plural(turn.calls.length, 'call')]
  if (edits > 0) parts.push(plural(edits, 'edit'))
  if (agents > 0) parts.push(plural(agents, 'agent'))
  return {
    status: statusOf({ isRunning: false, isErrored: failed > 0, isInterrupted: turn.calls.some(c => c.isInterrupted) }),
    text: parts.join(' · '),
    result: failed > 0 ? `${failed} failed` : '',
  }
}

// How many prompts the nav lists before folding the older ones away.
const RECENT_PROMPTS = 8

const norm = (text: string): string => text.trim().replace(/\s+/g, ' ').slice(0, 200)

// A prompt row's text as stored: a string, or its text blocks joined.
const contentText = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map(b => str(asFields(b).text)).join('\n')
      : ''

const snap = (
  id: string,
  p: Omit<CallSnap, 'id' | 'input' | 'output'> & { input: unknown; output?: unknown },
  room?: number,
): CallSnap => ({
  id,
  tool: p.tool,
  input: trimmed(p.input, room),
  output: trimmed(p.output, room),
  isRunning: p.isRunning,
  isErrored: p.isErrored,
  isInterrupted: p.isInterrupted,
})

const isSelected = (sel: Selection | null, id: string): boolean =>
  sel !== null &&
  ((sel.kind === 'call' && sel.call.id === id) || (sel.kind === 'group' && sel.id === id))

// The bytes one $.fs.read may copy in; a transcript past it is not read.
const READ_LIMIT = 4 * 1024 * 1024

// The person's typed prompts as the session's transcript file keeps them, with
// their row ids: the way to every prompt, those sent before the mod loaded too.
// Null when the file can't be found or read.
const transcriptPrompts = async ($: EngineInterface): Promise<PromptRow[] | null> => {
  try {
    const configDir =
      (await $.env.get('CLAUDE_CONFIG_DIR')) ??
      `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''}/.claude`
    const id = await $.session.id()
    // Claude Code files a project's transcripts under its root, every non-alphanumeric as '-'.
    const project = (await $.session.root()).replace(/[^a-zA-Z0-9]/g, '-')
    const path = `${configDir}/projects/${project}/${id}.jsonl`
    if ((await $.fs.stat(path)).size > READ_LIMIT) return null

    const rows: PromptRow[] = []
    for (const line of (await $.fs.read(path)).split('\n')) {
      if (!line.includes('"type":"user"')) continue
      const row = asFields(JSON.parse(line))
      const message = asFields(row.message)
      if (row.isMeta || row.isSidechain || asFields(row.origin).kind !== 'human') continue
      const text = contentText(message.content)
      if (text.trim() === '' || typeof row.uuid !== 'string') continue
      rows.push({ uuid: row.uuid, text: clip(text, 500) })
    }
    return rows
  } catch {
    return null
  }
}

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Tidy', columns: 64 })

const choose = async ($: EngineInterface, sel: Selection) => {
  await update($, selected, () => sel)
  await openPane($)
}

// Under turn folding: the one line a finished turn's first call draws; its later
// calls draw nothing. Undefined when the row is not in a finished turn (or folding is off).
const foldedRow = async (
  $: EngineInterface,
  e: Parameters<EngineInterface['ui']['resolve']>[0],
  firstCallId: string | undefined,
  sel: Selection | null,
) => {
  if (!firstCallId || !(await read($, collapseTurns))) return undefined
  const hit = turnOfCall(await read($, turns), firstCallId)
  if (!hit) return undefined
  const { Box, Button, Text } = $.ui.resolve(e)
  if (!hit.isFirst) return <Box display="none" />
  const line = turnLine(hit.turn)
  const isMine = isSelected(sel, hit.turn.id)
  const group: Selection = { kind: 'group', id: hit.turn.id, calls: hit.turn.calls }
  return (
    <Button key="turn" plain onPress={() => choose($, group)}>
      <Text color={isMine ? 'cyan' : undefined} dimColor={!isMine}>{isMine ? '▶' : '▸'} </Text>
      <Text color={line.status.color}>{line.status.mark} </Text>
      <Text bold>{line.text} </Text>
      <Text dimColor color={line.result ? 'red' : undefined}>{line.result}</Text>
    </Button>
  )
}

export const register: Register = on => {
  // Transcript ids of the prompt rows drawn since load, by their text: the way back
  // to a prompt sent before the mod was listening.
  const promptIds = new Map<string, string>()

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'tidy',
      description: 'Tidy: open the side pane, or turn compact tool rows on/off',
      argumentHint: '[on|off|clear|turns on|turns off|narration on|narration off]',
    })
    const kept = await $.store.get('enabled')
    if (typeof kept === 'boolean') await update($, enabled, () => kept)
    const keptTurns = await $.store.get('collapseTurns')
    if (typeof keptTurns === 'boolean') await update($, collapseTurns, () => keptTurns)
    const keptNarration = await $.store.get('foldNarration')
    if (typeof keptNarration === 'boolean') await update($, foldNarration, () => keptNarration)

    // Prompts sent before the mod loaded (a reload, a resume): from the transcript file with
    // their ids; failing that, their text alone, ids found as their rows draw.
    const fromFile = await transcriptPrompts($)
    if (fromFile !== null && fromFile.length > 0) {
      await update($, prompts, () => fromFile)
    } else if ((await read($, prompts)).length === 0) {
      const earlier = (await $.session.messages())
        .filter(m => m.role === 'user' && !(m.toolResults?.length) && m.text.trim() !== '' && !m.text.startsWith('<'))
        .map((m): PromptRow => ({ text: clip(m.text, 500) }))
      if (earlier.length > 0) await update($, prompts, () => earlier)
    }
    if (await read($, enabled)) void openPane($).catch(() => undefined) // a surface with no room for it
    return result
  })

  on('command.run', { command: 'tidy' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'off' || arg === 'on') {
      const value = arg === 'on'
      await update($, enabled, () => value)
      await $.store.set('enabled', value)
      if (value) await openPane($)
      return { text: `Tidy is ${arg}.` }
    }
    const toggle = arg.match(/^(turns|narration)\s+(on|off)$/)
    if (toggle) {
      const value = toggle[2] === 'on'
      if (toggle[1] === 'turns') {
        await update($, collapseTurns, () => value)
        await $.store.set('collapseTurns', value)
      } else {
        await update($, foldNarration, () => value)
        await $.store.set('foldNarration', value)
      }
      return { text: `Tidy ${toggle[1]} folding is ${toggle[2]}.` }
    }
    if (arg === 'clear') {
      await update($, selected, () => null)
      return { text: 'Tidy details cleared.' }
    }
    await openPane($)
    return { text: 'Tidy pane opened.' }
  })

  // The person's own prompts, as the transcript stores them: one nav entry each.
  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    const stored = await next(e)
    if (e.origin.kind === 'composer' && !e.message.isMeta && !e.agentId) {
      const text = contentText(e.message.content)
      if (text.trim() !== '') {
        const row: PromptRow = { uuid: stored.uuid ?? e.uuid, text: clip(text, 500) }
        await update($, prompts, list => [...list, row])
      }
    }
    return stored
  }).catch(($, e, next) => next(e)) // a failure here must never cost the person's prompt

  // The main conversation's calls and reply blocks, gathered per turn for folding.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId || !e.tool_use_id) return ran
    const { tool, tool_use_id, agentId: _agent, ...rest } = e
    // What the model sent: the call's own arguments, without the engine's envelope fields.
    const input = Object.fromEntries(Object.entries(rest).filter(([k]) => k !== 'consent'))
    const isErrored = ran.deny !== undefined || ran.isError === true
    const output = ran.deny !== undefined ? ran.deny : ran.isError ? (ran.text ?? ran.result) : ran.result
    await update($, draft, d => {
      if (d.calls.length >= TURN_MAX_CALLS) return d
      const detailed = d.calls.length < TURN_DETAILED_CALLS
      const call = snap(
        tool_use_id,
        { tool, input: detailed ? input : null, output: detailed ? output : null, isRunning: false, isErrored, isInterrupted: false },
        TURN_SNAP_ROOM,
      )
      return { ...d, calls: [...d.calls, call] }
    })
    return ran
  }).catch(($, e, next) => next(e)) // gathering must never cost a tool call

  on('session.append', { door: 'response' }, async ($, e, next) => {
    const stored = await next(e)
    if (!e.agentId && stored.uuid) {
      const uuid = stored.uuid
      await update($, draft, d => ({ ...d, replies: [...d.replies, uuid] }))
    }
    return stored
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    const done = await read($, draft)
    await update($, draft, () => ({ calls: [], replies: [] }))
    const first = done.calls[0]
    if (first) {
      const turn: TurnRecord = { id: first.id, calls: done.calls, narration: done.replies.slice(0, -1) }
      await update($, turns, list => [...list, turn].slice(-KEPT_TURNS))
    }
    return result
  })

  // Narration between a finished turn's calls: one dim line, opt-in.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!(await read($, enabled)) || !(await read($, foldNarration))) return next(e)
    const all = await read($, turns)
    if (!all.some(t => t.narration.includes(e.requestId))) return next(e)
    const { Text } = $.ui.resolve(e)
    const cols = e.viewport?.columns ?? 100
    return <Text dimColor>  · {clip(firstLine(e.props.text).replace(/[*_`#]/g, ''), cols - 6)}</Text>
  })

  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    if (e.props.origin.kind === 'composer') promptIds.set(norm(e.props.text), e.requestId)
    return next(e)
  })

  // The "(ctrl+b to run in background)" pill under a running command.
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) =>
    (await read($, enabled)) ? next({ ...e, props: { ...e.props, hint: '' } }) : next(e),
  )

  // The engine's fold of a run of calls: one line of ours; a click shows the run in the pane.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded || !(await read($, enabled))) return next(e)

    const sel = await read($, selected)
    // Folding first: a finished turn's group folds whatever else the group holds.
    const folded = await foldedRow($, e, e.props.calls[0]?.tool_use_id, sel)
    if (folded) return folded
    if (e.props.isCallsOnly !== true) return next(e)
    const { Button, Text } = $.ui.resolve(e)
    const { calls } = e.props
    const status = statusOf({
      isRunning: calls.some(c => c.isRunning),
      isErrored: calls.some(c => c.isErrored),
      isInterrupted: calls.some(c => c.isInterrupted),
    })
    const counts = new Map<string, number>()
    for (const c of calls) counts.set(toolLabel(c.tool), (counts.get(toolLabel(c.tool)) ?? 0) + 1)
    const summary = [...counts].map(([tool, n]) => (n === 1 ? tool : `${tool} ×${n}`)).join(' · ')
    const failed = calls.filter(c => c.isErrored).length
    const result = calls.some(c => c.isRunning)
      ? 'running'
      : failed > 0
        ? `${failed} of ${calls.length} failed`
        : plural(calls.length, 'call')
    const isMine = isSelected(sel, e.requestId)
    const group: Selection = {
      kind: 'group',
      id: e.requestId,
      calls: calls.map((c, i) => snap(c.tool_use_id ?? `${e.requestId}:${i}`, c)),
    }

    return (
      <Button key="open" plain onPress={() => choose($, group)}>
        <Text color={isMine ? 'cyan' : undefined} dimColor={!isMine}>{isMine ? '▶' : '▸'} </Text>
        <Text color={status.color}>{status.mark} </Text>
        <Text bold>{summary} </Text>
        <Text dimColor color={failed > 0 ? 'red' : undefined}>{result}</Text>
      </Button>
    )
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    // ctrl+o and --verbose show everything, as the engine draws it.
    if (e.props.isExpanded || !(await read($, enabled))) return next(e)

    const sel = await read($, selected)
    const folded = await foldedRow($, e, e.props.tool_use_id, sel)
    if (folded) return folded
    const { Button, Text } = $.ui.resolve(e)
    const { tool, input, output, isRunning, isErrored, isInterrupted } = e.props
    const status = statusOf({ isRunning, isErrored, isInterrupted })
    const label = toolLabel(tool)
    const result = isRunning || isInterrupted ? status.word : outcome(tool, input, output, isErrored)
    const columns = e.viewport?.columns ?? 100
    // Arrow, mark, label and the spaces between take the rest of the row.
    const room = Math.max(10, columns - label.length - result.length - 12)
    const arg = clip(keyArg(tool, input).replace(/\s+/g, ' '), room)
    const isMine = isSelected(sel, e.props.tool_use_id)
    const call: Selection = { kind: 'call', call: snap(e.props.tool_use_id, e.props) }

    return (
      <Button key="open" plain onPress={() => choose($, call)}>
        <Text color={isMine ? 'cyan' : undefined} dimColor={!isMine}>{isMine ? '▶' : '▸'} </Text>
        <Text color={status.color}>{status.mark} </Text>
        <Text bold color={isErrored ? 'red' : undefined}>{label} </Text>
        <Text>{arg} </Text>
        <Text dimColor color={isErrored ? 'red' : undefined}>{result}</Text>
      </Button>
    )
  })

  // The result block under a standalone row: in the pane now, not the chat.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.isExpanded || !(await read($, enabled))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Code, Markdown, Text } = $.ui.resolve(e)
    const cols = Math.max(20, e.props.bodyColumns)
    const list = await read($, prompts)
    const showAll = await read($, showAllPrompts)
    const sel = await read($, selected)

    const hidden = showAll ? 0 : Math.max(0, list.length - RECENT_PROMPTS)
    const jump = async (row: PromptRow, at: number) => {
      let id = row.uuid
      if (!id) {
        // Not known: the transcript file has every prompt in order. Of the prompts with this
        // text ("continue" twice), take the same occurrence as the one clicked.
        const key = norm(row.text)
        const nth = list.slice(0, at).filter(r => norm(r.text) === key).length
        const same = ((await transcriptPrompts($)) ?? []).filter(r => norm(r.text) === key)
        id = same[nth]?.uuid ?? promptIds.get(key)
      }
      if (!id) {
        $.ui.toast("Can't find that prompt in this session's transcript.")
        return
      }
      const moved = await $.ui.scroll({ to: { requestId: id }, block: 'start' })
      if (moved.deny) $.ui.toast(`Can't jump there: ${moved.deny}`)
    }

    const callLine = (c: CallSnap, key: string, onPress: () => unknown) => {
      const status = statusOf(c)
      const result = c.isRunning || c.isInterrupted ? status.word : outcome(c.tool, c.input, c.output, c.isErrored)
      return (
        <Button key={key} plain onPress={onPress}>
          <Text color={status.color}>{status.mark} </Text>
          <Text bold>{toolLabel(c.tool)} </Text>
          <Text>{clip(keyArg(c.tool, c.input), Math.max(8, cols - toolLabel(c.tool).length - result.length - 6))} </Text>
          <Text dimColor>{result}</Text>
        </Button>
      )
    }

    const block = (source: string, opts: { language?: string; path?: string } = {}) =>
      source.trim() === '' ? <Text dimColor>(empty)</Text> : <Code source={source} {...opts} />

    const callBody = (c: CallSnap) => {
      const i = asFields(c.input)
      const o = asFields(c.output)
      const text = resultText(c.output)
      if (c.isRunning) return <Text dimColor>Still running. Click its line again once it finishes.</Text>
      if (c.isErrored || c.isInterrupted) {
        return (
          <Box flexDirection="column">
            {c.tool === 'Bash' || c.tool === 'PowerShell' ? block(str(i.command), { language: c.tool === 'Bash' ? 'bash' : 'powershell' }) : null}
            <Text color="red">{text || 'Failed with no message.'}</Text>
          </Box>
        )
      }
      switch (c.tool) {
        case 'Bash':
        case 'PowerShell':
          return (
            <Box flexDirection="column">
              {block(str(i.command), { language: c.tool === 'Bash' ? 'bash' : 'powershell' })}
              <Text dimColor>output</Text>
              {block(str(o.stdout) || text)}
              {str(o.stderr).trim() !== '' && <Text color="yellow">{str(o.stderr)}</Text>}
            </Box>
          )
        case 'Edit':
          return (
            <Box flexDirection="column">
              <Text dimColor>{str(i.file_path)}</Text>
              <Code source={editDiff(c.input, c.output)} format="diff" path={str(i.file_path)} />
            </Box>
          )
        case 'Write':
          return (
            <Box flexDirection="column">
              <Text dimColor>{str(i.file_path)}</Text>
              {block(str(i.content), { path: str(i.file_path) })}
            </Box>
          )
        case 'Read':
          return (
            <Box flexDirection="column">
              <Text dimColor>{str(i.file_path)}</Text>
              {block(text, { path: str(i.file_path) })}
            </Box>
          )
        case 'Agent': {
          const agentId = str(o.agentId)
          return (
            <Box flexDirection="column">
              {agentId !== '' && (
                <Button key="agent" label="Open this agent's transcript" onPress={() => $.ui.view({ agentId })} />
              )}
              {text.trim() === '' ? <Text dimColor>(no report)</Text> : <Markdown text={text} />}
            </Box>
          )
        }
        default:
          return (
            <Box flexDirection="column">
              <Text dimColor>input</Text>
              {block(JSON.stringify(c.input, null, 2), { language: 'json' })}
              <Text dimColor>result</Text>
              {block(text || JSON.stringify(c.output, null, 2), { language: text ? undefined : 'json' })}
            </Box>
          )
      }
    }

    const details = () => {
      if (sel === null) return <Text dimColor>Click a tool line in the chat to see its details here.</Text>
      if (sel.kind === 'group') {
        const calls = sel.calls
        return (
          <Box flexDirection="column">
            <Text bold>{plural(calls.length, 'call')}</Text>
            {calls.map((c: CallSnap, n: number) =>
              callLine(c, `g${n}`, () => update($, selected, (): Selection => ({ kind: 'call', call: c, group: calls }))),
            )}
          </Box>
        )
      }
      const c = sel.call
      const status = statusOf(c)
      const group = sel.group
      return (
        <Box flexDirection="column">
          {group && (
            <Button key="back" plain onPress={() => update($, selected, () => ({ kind: 'group', id: c.id, calls: group }))}>
              <Text dimColor>◂ back to the {plural(group.length, 'call')}</Text>
            </Button>
          )}
          <Text>
            <Text color={status.color}>{status.mark} </Text>
            <Text bold>{toolLabel(c.tool)} </Text>
            <Text>{clip(keyArg(c.tool, c.input), cols - 12)}</Text>
          </Text>
          {callBody(c)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>PROMPTS</Text>
        {list.length === 0 && <Text dimColor>Your prompts will be listed here.</Text>}
        {hidden > 0 && (
          <Button key="more" plain onPress={() => update($, showAllPrompts, () => true)}>
            <Text dimColor>▲ {plural(hidden, 'earlier prompt')}</Text>
          </Button>
        )}
        {showAll && list.length > RECENT_PROMPTS && (
          <Button key="less" plain onPress={() => update($, showAllPrompts, () => false)}>
            <Text dimColor>▼ recent only</Text>
          </Button>
        )}
        {list.slice(hidden).map((row, n) => (
          <Button key={`p${hidden + n}`} plain onPress={() => jump(row, hidden + n)}>
            <Text dimColor>{String(hidden + n + 1).padStart(2)} </Text>
            <Text>{clip(firstLine(row.text), cols - 4)}</Text>
          </Button>
        ))}
        <Text dimColor>{'─'.repeat(cols)}</Text>
        {details()}
      </Box>
    )
  })
}
