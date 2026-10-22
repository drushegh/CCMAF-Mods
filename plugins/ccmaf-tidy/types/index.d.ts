// One tool call as its row last drew it: what the details view shows.
export type CallSnap = {
  id: string
  tool: string
  input: unknown
  output: unknown
  isRunning: boolean
  isErrored: boolean
  isInterrupted: boolean
}

// What the details view shows: one call, or a run of calls the engine grouped.
export type Selection =
  | { kind: 'call'; call: CallSnap; group?: CallSnap[] }
  | { kind: 'group'; id: string; calls: CallSnap[] }

// One of the person's prompts; `uuid` is its transcript row, absent when the
// prompt was sent before the mod loaded.
export type PromptRow = { uuid?: string; text: string }

// One finished turn of the main conversation: its calls in order, and the ids of
// the reply blocks that came before its last (the narration between calls).
export type TurnRecord = { id: string; calls: CallSnap[]; narration: string[] }

// The turn under way: what it has done so far.
export type TurnDraft = { calls: CallSnap[]; replies: string[] }

declare module 'claude-code' {
  interface PluginState {
    'ccmaf-tidy': {
      enabled: boolean
      selected: Selection | null
      prompts: PromptRow[]
      showAllPrompts: boolean
      // Opt-in: a finished turn's tool rows fold into one summary line.
      collapseTurns: boolean
      // Opt-in: a finished turn's narration between calls draws dim.
      foldNarration: boolean
      draft: TurnDraft
      turns: TurnRecord[]
    }
  }
}
