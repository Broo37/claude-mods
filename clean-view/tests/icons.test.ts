import { expect, test } from 'claude-code/testing'

import { FALLBACK, ICONS, iconFor, iconOf, pickedIcon } from '../hooks/icons'
import { PLAN_TOOL } from '../hooks/words'

test('takes the emoji a step name starts with, and leaves the name bare', () => {
  expect(pickedIcon('🔍 Check what changed')).toEqual({ icon: '🔍', rest: 'Check what changed' })
  expect(pickedIcon('  🧪Run the tests')).toEqual({ icon: '🧪', rest: 'Run the tests' })
  expect(pickedIcon('Plain name')).toEqual({ icon: null, rest: 'Plain name' })
})

test('takes an emoji written with a variation selector as the same emoji', () => {
  expect(pickedIcon('🔍️ Check what changed')).toEqual({ icon: '🔍', rest: 'Check what changed' })
})

test('drops an emoji from outside the set, and one made of several, but keeps the name', () => {
  // Outside the set, two columns wide or not: the name is guessed from instead.
  expect(pickedIcon('🎯 Aim for the goal')).toEqual({ icon: null, rest: 'Aim for the goal' })
  expect(pickedIcon('✏️ Edit the intro')).toEqual({ icon: null, rest: 'Edit the intro' })
  // Joined, toned or doubled, it is no single emoji.
  expect(pickedIcon('👩‍💻 Write the code')).toEqual({ icon: null, rest: 'Write the code' })
  expect(pickedIcon('🔍🔍 Look twice')).toEqual({ icon: null, rest: 'Look twice' })
})

test('guesses a step by the verb it starts with', () => {
  expect(iconFor('Read your brand notes')).toBe('📖')
  expect(iconFor('Build the pricing section')).toBe('🔨')
  expect(iconFor('Fix the failing test')).toBe('🐛')
  expect(iconFor('Send them up to GitHub')).toBe('🚀')
  expect(iconFor('Save the changes with a message')).toBe('💾')
  expect(iconFor('Look at how steps are drawn')).toBe('🔍')
  expect(iconFor('Polish the footer')).toBe('🎨')
})

test('guesses a step that starts with a vague verb by what it works on', () => {
  expect(iconFor('Write tests for the login')).toBe('🧪')
  expect(iconFor('Update my notes')).toBe('📝')
  expect(iconFor('Add the contact form')).toBe('🔨')
  expect(iconFor('Run the tests one more time')).toBe('🧪')
})

test('guesses the steps that stand before a plan', () => {
  expect(iconFor('Understand your request')).toBe('🤔')
  expect(iconFor('Plan the steps')).toBe('📋')
})

test('guesses by a verb later in the name, and gives a plain mark where nothing fits', () => {
  expect(iconFor('Teach Claude to choose one')).toBe('💬')
  expect(iconFor('Then check the result')).toBe('🔍')
  expect(iconFor('Ponder')).toBe(FALLBACK)
  expect(iconFor('')).toBe(FALLBACK)
})

test("keeps Claude's pick over the guess", () => {
  expect(iconOf({ name: 'Read your brand notes', icon: '🎨' })).toBe('🎨')
  expect(iconOf({ name: 'Read your brand notes' })).toBe('📖')
})

test('has only emoji two columns wide wherever they are drawn, each counted as two', () => {
  for (const icon of [...ICONS.map(entry => entry.icon), FALLBACK]) {
    // One code point beyond the first plane, drawn as a picture by default.
    expect([...icon]).toHaveLength(1)
    expect(icon.length).toBe(2)
    expect(icon.codePointAt(0) ?? 0).toBeGreaterThan(0xffff)
  }

  expect(new Set(ICONS.map(entry => entry.icon)).size).toBe(ICONS.length)
})

test('shows Claude every emoji of the set with what it stands for', () => {
  for (const { icon, means } of ICONS) {
    expect(PLAN_TOOL.description).toContain(`${icon} ${means}`)
  }
})
