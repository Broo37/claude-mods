import { type Engine, expect, test } from 'claude-code/testing'

import { parseProjects } from '../hooks/projects'
import { PANE, SAMPLE, START, world } from './world'

const out = (rows: [string, number][]) => JSON.stringify({ projects: rows.map(([cwd, weight]) => ({ cwd, weight })) })

const SIX = out([
  ['D:\\work\\shop-app', 410],
  ['C:\\Users\\me\\mods', 230],
  ['C:\\Users\\me\\mods\\deck', 110],
  ['C:\\Users\\me\\notes', 90],
  ['C:\\Users\\me', 80],
  ['D:\\scratch\\tmp', 80],
])

test('top five by weight, each a share of all of them', () => {
  const rows = parseProjects(SIX)
  expect(rows?.map(r => r.name)).toEqual(['shop-app', 'mods', 'deck', 'notes', 'me'])
  expect(rows?.[0]).toEqual({ name: 'shop-app', share: 41 })
  expect(rows?.reduce((sum, r) => sum + r.share, 0)).toBeLessThanOrEqual(100)
})

test('two folders of the same name keep their parent', () => {
  const rows = parseProjects(out([['D:\\blog\\api', 50], ['D:\\shop\\api', 30], ['D:\\x', 20]]))
  expect(rows?.map(r => r.name)).toEqual(['blog/api', 'shop/api', 'x'])
})

test('junk is no answer', () => {
  expect(parseProjects('powershell.exe : out of memory')).toBeNull()
  expect(parseProjects('{"projects":"x"}')).toBeNull()
  expect(parseProjects(out([]))).toEqual([])
})

async function paneTexts($: Engine) {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 42 }, surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })) as { text: string; props: Record<string, unknown> }[]
  await ui.unmount()
  return texts
}

test('pane: PROJECTS this week, a row each, and that it is an estimate', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  w.scripts.projects = () => SIX
  await $.session.start(START)
  await w.clock.advance(2000)
  const run = w.runs.find(argv => argv.some(arg => arg.endsWith('projects.ps1')))
  expect(run?.slice(-4)).toEqual(['-ProjectsDir', 'C:/cfg/projects', '-Since', expect.stringMatching(/^\d+$/)])
  const texts = await paneTexts($)
  expect(texts.find(t => t.text === '▌ PROJECTS' && t.props.weight === 'bold')?.props.color).toBe('#C084FC')
  expect(texts.some(t => /^▌ PROJECTS\s+this week$/.test(t.text))).toBe(true)
  expect(texts.some(t => /^shop-app\s+41%$/.test(t.text))).toBe(true)
  expect(texts.find(t => t.text === '41%')?.props.color).toBe('#C084FC')
  expect(texts.find(t => /estimated from this PC's logs/.test(t.text))?.props.dimColor).toBe(true)
})
