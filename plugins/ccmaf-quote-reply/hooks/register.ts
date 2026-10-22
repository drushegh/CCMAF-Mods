import type { Register } from 'claude-code'

// Longest selection quoted, in characters; the rest is replaced by a marker line.
export const MAX_QUOTE_CHARS = 4000

const HOW_TO =
  'Nothing is selected. Select text in the transcript with the mouse (fullscreen mode), then run /quote.'

/**
 * Selected text as a markdown block quote followed by a blank line: `> ` on
 * each line (`>` on empty ones), long selections clipped with a marker line.
 * Undefined when the text holds nothing but whitespace.
 */
export function quoteOf(selected: string, max = MAX_QUOTE_CHARS): string | undefined {
  // Blank lines around the selection go; the first line's own indentation stays.
  let text = selected.replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd()
  if (text === '') return undefined
  let isClipped = false
  if (text.length > max) {
    text = text.slice(0, max).trimEnd()
    isClipped = true
  }
  const lines = text.split('\n').map(l => l.trimEnd())
  if (isClipped) lines.push('[…]')
  return lines.map(l => (l === '' ? '>' : `> ${l}`)).join('\n') + '\n\n'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'quote',
      description: 'Quote the selected transcript text into the prompt box',
    })
    return result
  })

  on('command.run', { command: 'quote' }, async $ => {
    const selected = await $.ui.selection()
    if (selected === undefined) {
      $.ui.toast(HOW_TO)
      return { text: HOW_TO }
    }
    const quote = quoteOf(selected.text)
    if (quote === undefined) {
      $.ui.toast(HOW_TO)
      return { text: HOW_TO }
    }

    // Typed text before the cursor must not run into the quote's first line.
    const box = await $.prompt.read()
    const before = box.text.slice(0, box.cursor)
    const lead = before === '' || before.endsWith('\n') ? '' : '\n'

    const filled = await $.prompt.fill({ text: lead + quote, mode: 'insert' })
    if (!filled.isFilled) {
      return { text: 'The prompt box could not take the quote right now (a dialog is open?). Try again.' }
    }
    return { text: 'Quoted the selection into the prompt.' }
  })
}
