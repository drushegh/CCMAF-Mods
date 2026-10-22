// What the band keeps in `$.state`. Self-contained: no imports.
export type TurnClock = { startedAt: number; tools: number }

export type GitInfo = { branch: string; ahead: number; behind: number; dirty: number }

declare module 'claude-code' {
  interface PluginState {
    'ccmaf-status-band': {
      // The running main-loop turn; null while idle.
      turn: TurnClock | null
      // Bumped once a second while a turn runs, so the elapsed time redraws.
      tick: number
      // The CCMAF budget class of the first In Progress task that marks one.
      budget: 'S' | 'M' | 'L' | null
      // Whole percentage of the context window used; null until the first response.
      ctx: number | null
      git: GitInfo | null
    }
  }
}
