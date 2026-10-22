# ccmaf-snippets

Reusable prompts, kept across sessions.

| Command | Does |
| --- | --- |
| `/snip save <name>` | Saves the prompt box's current draft as `<name>` (overwrites an existing one). |
| `/snip <name>` | Inserts that snippet into the prompt box at the cursor. |
| `/snip` or `/snip list` | Lists snippets with a one-line preview. |
| `/snip rm <name>` | Deletes a snippet. |

## Rules
- Names are trimmed and case-insensitive; inner spaces fold to one. 1-40 characters of `a-z 0-9 space - _`. `save`, `rm` and `list` are reserved.
- Up to 200 snippets of up to 10000 characters each; saving over an existing name always works.
- An empty draft is refused with a message. Unknown names suggest near matches.
- Snippets live in the mod's own `$.store` (a JSON file under the Claude Code config directory), shared by all projects.

## Notes
- Commands only. The slash menu shows a static argument hint; the API lets a mod change a command's description and hint, not complete arguments, so `/snip` lists the names instead.
- Requires Claude Code 2.1.290 or newer (tested with 2.1.307). The mod API is early access.

## Install

At a Claude Code prompt:

    /plugin install ccmaf-snippets --marketplace drushegh/CCMAF-Mods
