import type { EngineInterface, Register } from 'claude-code'

const CHIME = 'sounds/ping.wav'
// Typing this recently means the person is at the keyboard and looking.
const TYPING_GRACE_MS = 5000

type Config = { thresholdSeconds: number; isSound: boolean; via: string }

// Module state; a reload (options change) starts it afresh.
let lastTypedAt = -Infinity
let isWaiting = false // one notification per wait

/** A finite number above zero, else the fallback. */
export function positiveOr(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** 192 -> "3m12s", 45 -> "45s", 3700 -> "1h01m". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

// A toast always; plus a sound when enabled. `$.audio.play` only has a player
// on macOS, so by default the terminal bell rings too (`$.ui.notify`).
// The sound and the bell run beside the hook: next() never waits on them.
function alertUser($: EngineInterface, text: string, cfg: Config): void {
  $.ui.toast(text, { timeoutMs: 8000 })
  if (!cfg.isSound) return
  if (cfg.via !== 'bell') $.audio.play({ asset: CHIME }).catch(() => undefined)
  if (cfg.via !== 'clip') $.ui.notify(text, { title: 'Claude Code' }).catch(() => undefined)
}

async function isTyping($: EngineInterface): Promise<boolean> {
  return (await $.clock.now()) - lastTypedAt < TYPING_GRACE_MS
}

// Notifies unless the person is typing; `isForced` skips the one-per-wait
// guard (each AskUserQuestion call is a wait of its own).
async function waitFor($: EngineInterface, text: string, cfg: Config, isForced = false): Promise<void> {
  if (isWaiting && !isForced) return
  isWaiting = true
  if (await isTyping($)) return
  alertUser($, text, cfg)
}

export const register: Register = (on, options) => {
  lastTypedAt = -Infinity
  isWaiting = false
  const cfg: Config = {
    thresholdSeconds: positiveOr(options.thresholdSeconds, 60),
    isSound: options.sound !== false,
    via: String(options.soundVia ?? 'both'),
  }

  on('prompt.edit', async ($, e, next) => {
    lastTypedAt = await $.clock.now()
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    isWaiting = false
    return next(e)
  })

  // Claude asked a question: the AskUserQuestion dialog opens as the tool runs.
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    if (e.tool === 'AskUserQuestion') await waitFor($, 'Claude has a question for you', cfg, true)
    else isWaiting = false // any other tool running means the wait is over
    return next(e)
  })

  // A permission prompt is about to be shown.
  on('classic.PermissionRequest', async ($, e, next) => {
    if (e.tool_name !== 'AskUserQuestion') await waitFor($, `Claude needs permission: ${e.tool_name}`, cfg)
    return next(e)
  })

  // The engine's own notification for a permission or elicitation dialog.
  on('classic.Notification', async ($, e, next) => {
    if (e.notification_type === 'permission_prompt' || e.notification_type === 'elicitation_dialog') {
      await waitFor($, e.message || 'Claude is waiting on you', cfg)
    }
    return next(e)
  })

  on('classic.PermissionDenied', ($, e, next) => {
    isWaiting = false
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e) // a subagent's turn is not the person's wait
    isWaiting = false
    const seconds = e.durationMs / 1000
    if (e.reason !== 'aborted' && seconds > cfg.thresholdSeconds && !(await isTyping($))) {
      const took = formatDuration(seconds)
      alertUser($, e.reason === 'answer' ? `Done in ${took}` : `Stopped (${e.reason}) after ${took}`, cfg)
    }
    return next(e)
  })
}
