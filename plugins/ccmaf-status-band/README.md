# ccmaf-status-band

One compact line in the band above the prompt:

    ctx 62% · tools 14 / M60 · 2m10s · main ↑1 ✱3

- `ctx`: the context window's fill, from `$.session.usage().context.percent` (none yet, or just after a compaction: the last reading is kept; before any, the segment is left out). Refreshed (without blocking) at session start, after every tool call and at turn end.
- `turn tools N / M60`: main-loop tool calls this turn (the CCMAF budget is per task; this count restarts every turn) (subagent calls are not counted) against the CCMAF budget class (S 30, M 60, L 120). The class is the first `**Budget:** S|M|L` (a template line listing all three is skipped) under an `In Progress` heading of `.claude/TASKS.md`; with none, just `tools N`. Amber from half the budget, red past it.
- `2m10s`: turn time, live. One `$.clock.every(1000)` timer exists only while a main-loop turn runs; it is cancelled at `turn.complete` and `session.end`, so an idle session has no timer. The timer also stops itself if it ever ticks with no turn running. The tools and time segments also need `e.props.isWorking`.
- `main ↑1 ✱3`: branch (short hash when detached), ahead/behind, dirty count (changed + untracked), from `git --no-optional-locks status --porcelain=v2 --branch` (fire-and-forget, never blocks a hook) via `$.process.run`, refreshed at session start and turn end. Hidden outside a repo.

The band hides when there is nothing to show, yields to a survey (`e.props.hasSurvey`), keeps to one line and drops trailing segments (git first) to fit `bodyColumns`.

Install: `claude plugin install ccmaf-status-band@ccmaf-mods`. Try without installing: `claude --plugin-dir <this folder>`. Test: `claude plugin test .`

## Install

At a Claude Code prompt:

    /plugin install ccmaf-status-band --marketplace drushegh/CCMAF-Mods
