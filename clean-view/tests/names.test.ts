import { expect, test } from 'claude-code/testing'

import { cleanName, cleanTitle } from '../hooks/names'

test('drops code in backticks from a name', () => {
  expect(cleanName('Build the pricing section in `src/Pricing.tsx`')).toBe('Build the pricing section in')
})

test('drops a path from the middle of a sentence', () => {
  expect(cleanName('Move src/app/main.ts into the new folder')).toBe('Move into the new folder')
  expect(cleanName('Copy C:\\work\\notes into place')).toBe('Copy into place')
})

test('drops a file name with a code extension', () => {
  expect(cleanName('Update package.json and tidy up')).toBe('Update and tidy up')
  expect(cleanName('Fix Pricing.tsx, then test')).toBe('Fix then test')
})

test('keeps a word that only looks like a file name', () => {
  expect(cleanName('Compare v2.5 with the old one')).toBe('Compare v2.5 with the old one')
})

test('collapses whitespace and capitalises the first letter', () => {
  expect(cleanName('  add   the\ncontact\tform ')).toBe('Add the contact form')
})

test('trims a long name at a word boundary to forty characters or less', () => {
  const long = 'Rebuild the whole pricing section so that every plan shows both yearly discounts'
  const name = cleanName(long)

  expect(long).toHaveLength(80)
  expect(name.length).toBeLessThanOrEqual(40)
  expect(name).toBe('Rebuild the whole pricing section so…')
})

test('trims a name of one long word where it must', () => {
  const name = cleanName('a'.repeat(80))

  expect(name).toBe(`A${'a'.repeat(38)}…`)
})

test('keeps a name of exactly forty characters whole', () => {
  const name = 'Write the welcome text for the home page'

  expect(name).toHaveLength(40)
  expect(cleanName(name)).toBe(name)
})

test('says "Working on it" when nothing is left of a name', () => {
  expect(cleanName('`npm test`')).toBe('Working on it')
  expect(cleanName('   ')).toBe('Working on it')
  expect(cleanName('src/index.ts')).toBe('Working on it')
})

test('makes a job title of what the naming model answered: no quotes, no full stop, six words at most', () => {
  expect(cleanTitle('"Build my landing page."')).toBe('Build my landing page')
  expect(cleanTitle('Title: build the bakery landing page with pricing and contact')).toBe('Build the bakery landing page with')
  expect(cleanTitle('')).toBe('Working on it')
})
