# ccmaf-quote-reply

Select text in the transcript with the mouse, run `/quote`, and it lands in the prompt box as a markdown block quote. What you had already typed stays.

```
> the selected line
> and the next one

```

## Use
1. Select transcript text with the mouse (needs fullscreen rendering; `/quote` says so when it sees no selection).
2. Type `/quote` and press Enter. The quote is inserted at the cursor, followed by a blank line, ready for your reply. If typed text sits right before the cursor, the quote starts on a new line.

No selection: a toast and the command's output explain how to use it.

## Behaviour
- Each line is prefixed `> `; empty lines become `>`. Line endings are normalised and trailing spaces dropped.
- Selections over 4000 characters are clipped and end with a `> […]` line.
- Does nothing else: no state, no files, no network.

## Notes
- Command only. A mod has no free keybinding hook, and a band button cannot know that a selection exists (no selection-change event), so neither is offered.
- Requires Claude Code 2.1.290 or newer (tested with 2.1.307). The mod API is early access.

## Install

At a Claude Code prompt:

    /plugin install ccmaf-quote-reply --marketplace drushegh/CCMAF-Mods
