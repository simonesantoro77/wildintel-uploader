import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'

describe('api.importVisitsCsv', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends every option of the import: what to create, the defaults, closing the revision, the coordinates of the location and the images not counted', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ visits: [], problems: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await api.importVisitsCsv('EXAM', 'a,b', false, 'epicollect-csv', undefined, {
      create: { locations: true, cameras: true, sd_cards: true, trappers: true }, defaults: { timezone: 'UTC' }, close_revisions: true, coordinates_from_location: false, photos_not_counted: true,
    })
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body).toMatchObject({ close_revisions: true, coordinates_from_location: false, photos_not_counted: true, defaults: { timezone: 'UTC' } })
  })

  it('leaves out the options that are not given', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ visits: [], problems: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await api.importVisitsCsv('EXAM', 'a,b')
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body).not.toHaveProperty('photos_not_counted')
    expect(body).not.toHaveProperty('coordinates_from_location')
  })
})
