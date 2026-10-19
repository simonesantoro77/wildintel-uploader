import { describe, expect, it } from 'vitest'
import { applyEntry, entryLabel } from './epicollectImport'
import { EMPTY_DEPLOYMENT_FIELDS } from './types'
import type { DeploymentFields } from './types'

const current: DeploymentFields = {
  ...EMPTY_DEPLOYMENT_FIELDS, deployment_id: 'R0003-DONA_01', location_id: 'dona_01', location_name: 'Doñana 1', latitude: 37, longitude: -6,
  start_date: '2024-09-04T13:10:00+02:00', end_date: '2024-10-12T07:02:41+02:00', camera_model: 'Reconyx', camera_id: null,
}

describe('filling a deployment in from an entry', () => {
  it('sets the period, the camera, the site and the notes', () => {
    const next = applyEntry(current, {
      start_date: '2024-09-05', start_time: '08:30:00', end_date: '2024-10-13', end_time: '19:00:00',
      camera_height: 0.6, camera_tilt: -10, feature_type: 'trailGame', bait_use: false, habitat: 'Pine', tags: ['a', 'b'], comments: 'ok',
    }, 'Europe/Madrid')

    expect(next.start_date).toBe('2024-09-05T08:30:00+02:00')
    expect(next.end_date).toBe('2024-10-13T19:00:00+02:00')
    expect(next).toMatchObject({ camera_height: 0.6, camera_tilt: -10, feature_type: 'trailGame', bait_use: false, habitat: 'Pine', tags: ['a', 'b'], comments: 'ok' })
  })

  it('leaves the location alone, and the camera the images gave, but completes what is missing', () => {
    const next = applyEntry(current, { location_id: 'other', location_name: 'Elsewhere', latitude: 1, longitude: 2, camera_model: 'Bushnell', camera_id: 'P800' }, 'Europe/Madrid')

    expect(next).toMatchObject({ location_id: 'dona_01', location_name: 'Doñana 1', latitude: 37, longitude: -6, camera_model: 'Reconyx', camera_id: 'P800' })
  })

  it('completes a day with the time the images gave on that day, else with the whole day', () => {
    const same = applyEntry(current, { start_date: '2024-09-04', end_date: '2024-10-12' }, 'Europe/Madrid')
    expect(same.start_date).toBe('2024-09-04T13:10:00+02:00')
    expect(same.end_date).toBe('2024-10-12T07:02:41+02:00')

    const other = applyEntry(current, { start_date: '2024-09-01', end_date: '2024-10-20' }, 'Europe/Madrid')
    expect(other.start_date).toBe('2024-09-01T00:00:00+02:00')
    expect(other.end_date).toBe('2024-10-20T23:59:59+02:00')
  })

  it('keeps what the entry leaves blank', () => {
    expect(applyEntry(current, {}, 'Europe/Madrid')).toEqual(current)
  })
})

describe('telling the entries apart', () => {
  it('names an entry by its title and when it was sent', () => {
    expect(entryLabel({ uuid: 'u', title: 'dona_0006', created_at: '2026-10-01T10:00:00.000Z', fields: {} })).toBe('dona_0006 · sent 1 Oct 2026')
    expect(entryLabel({ uuid: 'u', title: '', created_at: '', fields: {} })).toBe('Entry')
  })
})
