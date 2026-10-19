import { describe, expect, it } from 'vitest'
import { ALL_MAPPED_FIELDS, DEPLOYMENT_FIELD_GROUPS, canFill, suggestMapping } from './epicollectMapping'
import type { EpicollectInput } from './types'

const input = (ref: string, label: string, type: string): EpicollectInput => ({ ref, label, type, form: 'Visit', group: null, branch: null, options: [] })

describe('the deployment fields to map', () => {
  it('are every field of the deployment form, each once', () => {
    const keys = ALL_MAPPED_FIELDS.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of ['location_id', 'revision', 'start_date', 'start_time', 'end_date', 'end_time', 'camera_model', 'camera_id', 'camera_height', 'habitat', 'bait_use', 'deployment_groups', 'tags', 'comments']) {
      expect(keys).toContain(key)
    }
    expect(DEPLOYMENT_FIELD_GROUPS.map((g) => g.label)).toEqual(['Where', 'When', 'Camera', 'Site', 'Grouping and notes'])
  })
})

describe('what can fill a field', () => {
  it('is an input of a type that holds that kind of value — a text one can fill almost any', () => {
    expect(canFill('date', 'date')).toBe(true)
    expect(canFill('date', 'integer')).toBe(false)
    expect(canFill('time', 'time')).toBe(true)
    expect(canFill('time', 'date')).toBe(false)
    expect(canFill('number', 'integer')).toBe(true)
    expect(canFill('number', 'decimal')).toBe(true)
    expect(canFill('number', 'photo')).toBe(false)
    expect(canFill('place', 'location')).toBe(true)
    expect(canFill('yesno', 'radio')).toBe(true)
    expect(canFill('list', 'checkbox')).toBe(true)
  })
})

describe('suggesting a mapping', () => {
  const inputs = [
    input('a', 'Start date', 'date'), input('b', 'End date', 'date'), input('c', 'Camera model', 'text'), input('d', 'Camera height', 'decimal'),
    input('e', 'Notas', 'textarea'), input('f', 'Bait used', 'radio'), input('g', 'Photo of the site', 'photo'),
  ]

  it('keeps the day and the time of a date apart, and finds the revision', () => {
    const mapping = suggestMapping([
      input('r', 'Revision', 'integer'), input('sd', 'Start date', 'date'), input('st', 'Start time', 'time'),
      input('ed', 'End date', 'date'), input('et', 'End time', 'time'),
    ], {})
    expect(mapping).toMatchObject({ revision: 'r', start_date: 'sd', start_time: 'st', end_date: 'ed', end_time: 'et' })
  })

  it('prefers a GPS input to a text one that has "location" in its name', () => {
    const mapping = suggestMapping([input('n', 'Location name', 'text'), input('g', 'Location (GPS)', 'location')], {})
    expect(mapping.location_name).toBe('n')
    expect(mapping.latitude).toBe('g')
    expect(mapping.longitude).toBe('g')
  })

  it('matches the questions by name, or by what they are usually called, and by type', () => {
    const mapping = suggestMapping(inputs, {})

    expect(mapping).toMatchObject({ start_date: 'a', end_date: 'b', camera_model: 'c', camera_height: 'd', comments: 'e', bait_use: 'f' })
    expect(Object.values(mapping)).not.toContain('g') // a photo fills nothing
    expect(mapping.camera_depth).toBeUndefined() // nothing is called so
  })

  it('keeps what is mapped already', () => {
    expect(suggestMapping(inputs, { start_date: 'e' }).start_date).toBe('e')
  })

  it('never offers an input that cannot fill the field', () => {
    expect(suggestMapping([input('x', 'Start date', 'integer')], {}).start_date).toBeUndefined()
  })
})
