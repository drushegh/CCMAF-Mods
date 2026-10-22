# ccmaf-waiting-notifier

Notification mod for when you have looked away. A toast plus a sound when:

- Claude is waiting on a permission prompt (`classic.PermissionRequest`; the engine's own `permission_prompt` / `elicitation_dialog` notification is heard too).
- Claude asks an `AskUserQuestion` (`tool.call`).
- A turn ends after more than N seconds: `Done in 3m12s`. Aborted turns and subagent turns stay quiet.

Don't-nag rules: one notification per wait (ended by the next tool running, a prompt submit, a permission denial or the end of the turn; each `AskUserQuestion` is its own wait), and nothing within 5 s of your last keystroke in the prompt box (`prompt.edit`). A wait that begins while you are typing is silent, and it still counts as that wait's one notification: you will not be pinged about it after you stop typing (the dialog is on screen). The next wait notifies normally.

The sound and the bell run beside the hook and never delay Claude. `thresholdSeconds` must be a finite number above zero, else 60 is used.

## Sound

`$.audio.play({ asset })` only has a player on macOS (`afplay`); on Windows and Linux it plays nothing. So the sound is two channels, picked by `soundVia`:

- `clip`: the bundled chime `sounds/ping.wav` (a 0.3 s two-note tone, generated, 16-bit mono PCM).
- `bell`: `$.ui.notify`, i.e. your terminal's notification channel (terminal bell, iTerm2/kitty/ghostty banner).
- `both` (default): both. On macOS that is a chime and a bell; set `clip` or `bell` if that is too much.

## Options (`userConfig`)

| Field | Default | Meaning |
|---|---|---|
| `thresholdSeconds` | 60 | Notify when a turn takes longer than this |
| `sound` | true | Play a sound at all (toast always shows) |
| `soundVia` | both | `clip`, `bell` or `both` |

Install: `claude plugin install ccmaf-waiting-notifier@ccmaf-mods`. Try without installing: `claude --plugin-dir <this folder>`. Test: `claude plugin test .`

## Install

At a Claude Code prompt:

    /plugin install ccmaf-waiting-notifier --marketplace drushegh/CCMAF-Mods
