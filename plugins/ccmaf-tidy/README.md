# ccmaf-tidy

Keeps the chat short and easy to follow.

- **One line per tool call.** `▸ ✓ Bash  Show status  3 lines`. Green ✓ succeeded, red ✗ failed (with the
  error's first line), yellow `…` running, grey ⊘ interrupted. The right-hand end is the one fact worth
  knowing: line counts, `+3 −2` for an edit, `436 tests passed`, `committed a1b2c3d`, `pushed a..b`,
  an agent's time and tool count. Claude Code's own "ran 3 commands" groups get the same treatment.
- **Details on the right, never in the chat.** Click a line and its details open in a pane beside the chat:
  the command and its output, an edit's diff (coloured, with real line numbers), a file written or read,
  an agent's report with a button to open its transcript. Click a group and pick a call from it. The chat
  never moves.
- **Prompt list.** The top of the pane lists your prompts, newest at the bottom. Click one to jump back to it.
- `ctrl+o` still shows everything in full, as Claude Code draws it.

## Commands

| Command | Does |
|---|---|
| `/tidy` | Open the pane |
| `/tidy off` / `/tidy on` | Turn the compact rows off or on (remembered) |
| `/tidy clear` | Empty the details area |
| `/tidy turns on` | Opt-in: once a turn finishes, all its tool rows fold into one line (`▸ ✓ 14 calls · 3 edits`) |
| `/tidy narration on` | Opt-in: once a turn finishes, the short notes between its calls draw as one dim line each |

## Needs

- Claude Code 2.1.307 or later (the mod API is early access and changes between releases).
- **Fullscreen rendering** (`"tui": "fullscreen"` in settings) for clicks and the docked pane. The pane docks
  beside the chat from about 110 columns; narrower, it opens above the prompt.
- Prompt jumps for prompts sent before the mod loaded read the session transcript file; transcripts over
  4 MB fall back to prompts whose rows have been drawn since.

## What it can't change

Permission dialogs, the question dialog, hook-feedback lines and Claude's replies are drawn by Claude Code
itself (or left alone on purpose).

## Install

    /plugin install ccmaf-tidy --marketplace drushegh/CCMAF-Mods

Try without installing: `claude --plugin-dir <this folder>`. Test: `claude plugin test .`
