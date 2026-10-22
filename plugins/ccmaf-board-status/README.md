# ccmaf-board-status

Status-line mod. Shows `CCMAF · N in progress · M verify` from `.claude/TASKS.md`.

- Updates on `session.start` and `turn.complete` (subagent turns are skipped).
- Entries are `#### [TASK-N]` / `#### [BUG-N]`. An entry's `**Status:**` field decides (In Progress/Fixing, Verify); otherwise its `### ` section heading does. Fenced code and HTML comments are ignored.
- No board file or a read error: the status entry is cleared, no error.

Install (from the published marketplace; user scope by default, see the repo README for `--scope`):

    claude plugin install ccmaf-board-status@ccmaf-mods

Try without installing: `claude --plugin-dir <this folder>`. Test: `claude plugin test .`
