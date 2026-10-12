// Draws the bars with the mod's own code (hooks/format.ts, imported as it is), for a
// quick look at readings a real session cannot be put into. The bars are text in exact
// colors, so printing them here shows what the band draws; `live.ps1` is the proof, as
// it photographs a real session and so includes what Claude Code does to a drawing.
// usage: node --no-warnings preview.mjs [seconds to stay open]
const { barCells, barSpans } = await import(new URL('../../hooks/format.ts', import.meta.url).href)
const [, , stay = '8'] = process.argv

const LABELS = {
  context: ['Context ', [245, 194, 231]],
  fiveHour: ['5H Limit', [180, 190, 254]],
  sevenDay: ['7D Limit', [249, 226, 175]],
  codex: ['Codex 7D', [16, 163, 127]],
}
const SETS = [
  ['everyday readings', [['context', 34], ['fiveHour', 62, 63], ['sevenDay', 26, 78], ['codex', 43, 6]]],
  ['busier: over pace, on pace, far under pace', [['context', 88], ['fiveHour', 91, 35], ['sevenDay', 55, 56], ['codex', 3, 90]]],
  ['edges: nothing used, window just begun, all used', [['context', 0], ['fiveHour', 0, 3], ['sevenDay', 10, 100], ['codex', 100, 60]]],
]

const colored = (text, color) => `\x1b[38;2;${color.join(';')}m\x1b[49m${text}`
const drawn = spans =>
  `${spans
    .map(
      ({ text, color, backgroundColor }) =>
        `\x1b[38;2;${color.join(';')}m${backgroundColor ? `\x1b[48;2;${backgroundColor.join(';')}m` : '\x1b[49m'}${text}`,
    )
    .join('')}\x1b[0m`

const out = ['']
for (const [name, rows] of SETS) {
  out.push(colored(` ${name}`, [166, 173, 200]))
  for (const [kind, percent, pace] of rows) {
    const [label, color] = LABELS[kind]
    out.push(
      ` ${colored(label, color)} ${drawn(barSpans(barCells(percent, 40, kind, pace)))} ${colored(`${percent}%`, color)}` +
        (pace === undefined ? '' : colored(`   pace ${pace}%`, [108, 112, 134])),
    )
  }
  out.push('')
}
process.stdout.write(`${out.join('\n')}\x1b[0m`)
await new Promise(done => setTimeout(done, Number(stay) * 1000))
