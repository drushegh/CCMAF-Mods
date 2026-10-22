# CCMAF-Mods

A Claude Code plugin marketplace of CCMAF "mods". A mod is a plugin whose
`hooks/hooks.json` points at one JS/TS module exporting `register(on, options)`. Mods draw inside the
terminal (panes, bands, the status line, toasts, compact transcript rows), so they work the same in a
plain terminal and in the CCMAF app. The marketplace also carries workspace-type kits for the CCMAF app.

Install any of them from a Claude Code prompt:

    /plugin install <name> --marketplace drushegh/CCMAF-Mods
Requires Claude Code 2.1.290 or later; each plugin's `ccmaf-mod.json` names its own minimum (`ccmaf-tidy` needs 2.1.307) and the version it was tested with. The mod API is early access and changes between releases.


## Layout
- `.claude-plugin/marketplace.json` - the marketplace (`ccmaf-mods`).
- `template/` - source for "new mod" scaffolding (`{{NAME}}`, `{{DESCRIPTION}}`, `{{AUTHOR}}` placeholders; a scaffolder must JSON-escape substitutions into the `.json` templates).
- `plugins/` - one folder per plugin:

| Plugin | Kind | What it does |
|---|---|---|
| `ccmaf-tidy` | mod | One green/red line per tool call; details, diffs and a prompt list in a pane on the right |
| `ccmaf-quote-reply` | mod | `/quote` puts your selected transcript text in the prompt box as a `>` quote |
| `ccmaf-snippets` | mod | `/snip` saves and inserts reusable prompts, kept across sessions |
| `ccmaf-waiting-notifier` | mod | Toast and sound when Claude waits on a permission prompt or a question, or finishes a long turn |
| `ccmaf-status-band` | mod | One line above the prompt: context %, tool calls against the CCMAF budget, live turn time, git branch |
| `ccmaf-board-status` | mod | Status line `CCMAF · N in progress · M verify` from `.claude/TASKS.md` |
| `ccmaf-blank-workspace` | workspace kit | Sample general-purpose workspace type |

## Try a mod locally (recommended: zero footprint)
    claude --plugin-dir ./plugins/ccmaf-board-status            # from a clone of this repo
Loads the mod for that one session only; nothing is installed. Run it in a project that has `.claude/TASKS.md`. Edits hot-reload. (It writes generated types under the mod's `.claude-plugin/types/`; that path is gitignored.)

## Installing from the marketplace (changes your plugin state)
`claude plugin marketplace add` and `claude plugin install` default to **user scope**: the mod then runs in every session in every project, including sessions the CCMAF app spawns. Narrower scopes:

    claude plugin marketplace add drushegh/CCMAF-Mods
    claude plugin install ccmaf-board-status@ccmaf-mods --scope local     # this project, just you
    claude plugin install ccmaf-board-status@ccmaf-mods -s project        # this project, shared via .claude/settings.json

Undo:

    claude plugin uninstall ccmaf-board-status@ccmaf-mods
    claude plugin marketplace remove ccmaf-mods

## Check a mod
    claude plugin validate plugins/<mod> --strict
    claude plugin validate . --strict          # from the repo root: the marketplace
    claude plugin test plugins/<mod>

## Author a new mod
1. Copy `template/` into `plugins/<name>/`: `plugin.json.tmpl` -> `.claude-plugin/plugin.json`, `hooks.json` -> `hooks/hooks.json`, `register.ts.tmpl` -> `hooks/register.ts`, `register.test.ts.tmpl` -> `register.test.ts`, `ccmaf-mod.json.tmpl` -> `ccmaf-mod.json` (fill the placeholders).
2. Add an entry (same `name`) to `.claude-plugin/marketplace.json`.
3. Write the hooks in `hooks/register.ts` and extend `register.test.ts` (kit: `claude-code/testing`).
4. Gotchas verified on 2.1.295: hook functions must be declared at the module's top level, but helpers may take `$` (e.g. `refreshBoard($)`). `$.fs` relative paths resolve against the session cwd. In tests, hooks registered with `on` stand for the engine and must return a result object (`{ value }`, `{ cwd }`, `{ text }`).
5. `ccmaf-mod.json` is CCMAF metadata (`minClaudeCode`, `testedWith`, `capabilities`); Claude Code ignores it and `validate` accepts it.

## Publishing

Every commit to `main` is a release: Claude Code installs read the marketplace straight from this repo. Before
pushing, run `claude plugin validate . --strict` at the root and `claude plugin test` for each mod you changed.

## Licence

MIT, see `LICENSE`.
