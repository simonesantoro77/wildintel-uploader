import { describe, expect, it } from 'vitest'
import { availabilityErrors, cameraAt, cameraAtSite, cardAt, cardBlock, unfinishedRevision } from './visitAvailability'
import { EMPTY_DEPLOYMENT_FIELDS } from './types'
import type { StoredVisit } from './types'
import type { Visit } from './pages/VisitsPage'

const stored = (over: Partial<StoredVisit>): StoredVisit => ({
  location_id: 'DONA_01', session: 'R0001', date: '2026-06-10', time: '09:00:00', actions: ['Installation'], trappers: null, camera_status: null,
  battery_status: null, card_status: null, num_photos: null, sd: null, date_time_ok: null, latitude: null, longitude: null, camera_id: null, ...over,
} as StoredVisit)

const visit = (over: Partial<Visit> & { camera?: string }): Visit => ({
  trappers: '', session: '', when: '2026-12-01T09:00:00', site: 'DONA_02', actions: ['Installation'], status: '', card: 'OK', batteries: 'OK', numPhotos: '', sd: '',
  dateTimeOK: 'Yes', longitude: '', latitude: '', details: { ...EMPTY_DEPLOYMENT_FIELDS, camera_id: over.camera ?? null }, ...over,
})

const KEPT = [
  stored({ camera_id: 'C1', sd: 'A1' }),                                                                      // C1 and A1 put up at DONA_01
  stored({ date: '2026-08-01', actions: ['Revision'], camera_id: 'C1', sd: 'A2', num_photos: 100 }),          // A1 collected, A2 left
  stored({ location_id: 'DONA_03', date: '2026-07-01', camera_id: 'C3', sd: 'B1' }),
  stored({ location_id: 'DONA_03', date: '2026-09-01', actions: ['Desinstallation'], camera_id: 'C3', num_photos: 50 }), // C3 taken away with B1
]

describe('where a camera is', () => {
  it('is where it was put up, until it is uninstalled or found stolen', () => {
    expect(cameraAt(KEPT, 'c1', '2026-12-01T00:00:00')).toEqual({ site: 'DONA_01', date: '2026-08-01' })
    expect(cameraAt(KEPT, 'C3', '2026-08-01T00:00:00')).toEqual({ site: 'DONA_03', date: '2026-07-01' })
    expect(cameraAt(KEPT, 'C3', '2026-12-01T00:00:00')).toBeNull()
    expect(cameraAt([...KEPT, stored({ date: '2026-09-15', actions: ['Stolen'], camera_id: 'C1' })], 'C1', '2026-12-01T00:00:00')).toBeNull()
    expect(cameraAt(KEPT, 'NEVER', '2026-12-01T00:00:00')).toBeNull()
  })

  it('counts only the visits before the moment asked', () => {
    expect(cameraAt(KEPT, 'C1', '2026-06-10T09:00:00')).toBeNull() // the installation itself is not before itself
  })
})

describe('where an SD card is', () => {
  it('is in the camera it was left in, until a revision, an uninstallation or a theft collects it', () => {
    expect(cardAt(KEPT, 'A1', '2026-07-01T00:00:00')).toEqual({ site: 'DONA_01', date: '2026-06-10' })
    expect(cardAt(KEPT, 'A1', '2026-12-01T00:00:00')).toBeNull() // collected by the revision
    expect(cardAt(KEPT, 'A2', '2026-12-01T00:00:00')).toEqual({ site: 'DONA_01', date: '2026-08-01' })
    expect(cardAt(KEPT, 'B1', '2026-12-01T00:00:00')).toBeNull() // went with the camera
  })
})

describe('availabilityErrors', () => {
  it('refuses to put up a camera that is installed somewhere else', () => {
    expect(availabilityErrors(KEPT, visit({ camera: 'C1' })).camera).toBe('Camera C1 is installed at DONA_01 (since 2026-08-01): it has to be uninstalled there before it is installed here.')
    expect(availabilityErrors(KEPT, visit({ camera: 'C3' }))).toEqual({}) // it was uninstalled
    expect(availabilityErrors(KEPT, visit({ camera: 'C9' }))).toEqual({})
  })

  it('says a camera is already installed when it is at the very site', () => {
    expect(availabilityErrors(KEPT, visit({ camera: 'C1', site: 'DONA_01' })).camera).toMatch(/already installed here/)
    expect(availabilityErrors(KEPT, visit({ camera: 'C1', site: 'DONA_01', actions: ['Revision', 'Installation'] })).camera).toBeUndefined()
  })

  it('asks nothing of the camera of a visit that does not put one up', () => {
    expect(availabilityErrors(KEPT, visit({ camera: 'C1', actions: ['Revision'] })).camera).toBeUndefined()
    expect(availabilityErrors(KEPT, visit({ camera: 'C1', actions: ['Desinstallation'] })).camera).toBeUndefined()
  })

  it('refuses to leave a card that is in another camera or the one this visit collects, but not one that was collected', () => {
    expect(availabilityErrors(KEPT, visit({ sd: 'A2' })).sd).toBe('SD card A2 is in the camera at DONA_01 (left on 2026-08-01): it has to be collected before it is left here.')
    expect(availabilityErrors(KEPT, visit({ sd: 'A1' }))).toEqual({})
    expect(availabilityErrors(KEPT, visit({ sd: 'A2', site: 'DONA_01', actions: ['Revision'] })).sd).toBe('SD card A2 is the one this visit collects (left on 2026-08-01): the card left in the camera has to be another.')
    expect(availabilityErrors(KEPT, visit({ sd: 'A9', site: 'DONA_01', actions: ['Revision'] }))).toEqual({})
    expect(availabilityErrors(KEPT, visit({ sd: 'A2', site: 'DONA_01', actions: ['Installation'] })).sd).toMatch(/is in the camera at DONA_01/)
  })

  it('looks at where things were on the day of the visit, not today', () => {
    expect(availabilityErrors(KEPT, visit({ camera: 'C1', when: '2026-07-01T09:00:00' })).camera).toMatch(/since 2026-06-10/)
    expect(availabilityErrors(KEPT, visit({ camera: 'C3', when: '2026-08-01T09:00:00' })).camera).toMatch(/installed at DONA_03/)
  })
})

describe('a Revision is of the camera that is at the site', () => {
  it('says the camera at the site when a Revision names another, unless the visit also installs one', () => {
    const revision = (camera: string, actions: string[] = ['Revision']) => availabilityErrors(KEPT, visit({ site: 'DONA_01', actions, camera }))
    expect(revision('C9').camera).toBe('The camera at DONA_01 is C1 (since 2026-08-01): a Revision is of that camera. If it was replaced, add an Installation to the visit.')
    expect(revision('c1').camera).toBeUndefined()                         // the camera that is there, whatever its case
    expect(revision('C9', ['Revision', 'Installation']).camera).toBeUndefined() // replaced: the visit says so
    expect(availabilityErrors(KEPT, visit({ site: 'DONA_01', actions: ['Desinstallation'], camera: 'C9' })).camera).toContain('is of that camera')
    expect(availabilityErrors(KEPT, visit({ site: 'DONA_03', actions: ['Revision'], camera: 'C9', when: '2026-12-01T09:00:00' })).camera).toBeUndefined() // no camera there: nothing to compare
  })
})

describe('when a revision can start', () => {
  const sites = [{ location_id: 'WICP_0001' }, { location_id: 'WICP_0002' }, { location_id: 'WICP_0003', status: 'archived', status_date: '2026-01-01' }]
  const first = [stored({ location_id: 'WICP_0001' })]

  it('is not until every location that is not archived has been visited in the one before', () => {
    expect(unfinishedRevision(2, first, sites)).toEqual({ message: 'R0002 cannot start: R0001 is not finished, 1 location(s) still to be visited in it: WICP_0002.', previous: 'R0001', missing: ['WICP_0002'] })
    expect(unfinishedRevision(2, [...first, stored({ location_id: 'wicp_0002' })], sites)).toBeNull()
  })

  it('does not wait for a pending site until a visit to it is known, nor for one that starts after the revision', () => {
    const withPending = [{ location_id: 'WICP_0001', status: 'active' }, { location_id: 'WICP_0002', status: 'pending' }]
    expect(unfinishedRevision(2, first, withPending)).toBeNull()                                           // pending: not started, not waited for

    const known = [...first, stored({ location_id: 'WICP_0002', session: 'R0001' })]
    expect(unfinishedRevision(3, [...known, stored({ location_id: 'WICP_0001', session: 'R0002' })], withPending)?.missing).toEqual(['WICP_0002'])   // a visit to it is known: it is waited for

    const starting = [...first, stored({ location_id: 'WICP_0002', session: 'R0003', actions: ['SiteStart', 'Installation'] })]
    const active = [{ location_id: 'WICP_0001', status: 'active' }, { location_id: 'WICP_0002', status: 'active' }]
    expect(unfinishedRevision(2, starting, active)).toBeNull()                                              // it starts in R0003: R0001 does not wait for it
  })

  it('is when it is the first revision there is, or a location was archived before the one before it started', () => {
    expect(unfinishedRevision(1, [], sites)).toBeNull()
    expect(unfinishedRevision(13, [stored({ session: 'R0013' })], sites)).toBeNull()
    expect(unfinishedRevision(2, first, [{ location_id: 'WICP_0001' }, { location_id: 'WICP_0002', status: 'archived', status_date: '2026-06-01' }])).toBeNull()
    // archived after the revision started: it was still to be visited
    expect(unfinishedRevision(2, first, [{ location_id: 'WICP_0001' }, { location_id: 'WICP_0002', status: 'archived', status_date: '2026-12-01' }])?.missing).toContain('WICP_0002')
  })
})

describe('cardBlock', () => {
  const cards = [
    { label: 'Z1', status: 'archived', status_date: '2026-10-01', archive_reason: 'lost' },
    { label: 'Z2', status: 'archived', status_date: null },
  ] as never[]
  it('refuses a card archived from the day it was, not before', () => {
    expect(cardBlock(KEPT, 'Z1', visit({ when: '2026-12-01T09:00:00' }), { cards })).toMatch(/not available since 2026-10-01/)
    expect(cardBlock(KEPT, 'Z1', visit({ when: '2026-09-30T09:00:00' }), { cards })).toBeUndefined()
    expect(cardBlock(KEPT, 'Z2', visit({}), { cards })).toMatch(/not available: it is archived/)
  })
  it('refuses a card collected in the same revision, not in another', () => {
    const kept = [...KEPT, stored({ location_id: 'DONA_05', session: 'R0002', date: '2026-11-01', actions: ['Revision'], camera_id: 'C5', sd: 'Q1' })]
    const taken = [...kept, stored({ location_id: 'DONA_01', session: 'R0003', date: '2026-11-02', actions: ['Revision'], camera_id: 'C1', num_photos: 1 })]
    // A2 is in the camera at DONA_01 and collected there by R0003: it cannot be left elsewhere in R0003.
    expect(cardBlock(taken, 'A2', visit({ site: 'DONA_02', when: '2026-11-03T09:00:00' }), { session: 'R0003' })).toMatch(/collected at DONA_01 in this revision \(R0003\)/)
    expect(cardBlock(taken, 'A2', visit({ site: 'DONA_02', when: '2026-11-03T09:00:00' }), { session: 'R0004' })).toBeUndefined()
  })
})

describe('cameraAtSite', () => {
  it('is the camera the last visit left, and says which visit it was — a replacement leaves the new one, a removal leaves none', () => {
    const put = stored({ session: 'R0001', date: '2026-06-10', camera_id: 'C1', sd: 'A1' })
    const replaced = stored({ session: 'R0002', date: '2026-07-10', actions: ['Revision', 'Desinstallation', 'Installation'], camera_id: 'C2', sd: 'A2' })
    const removed = stored({ session: 'R0003', date: '2026-08-10', actions: ['Revision', 'Desinstallation'], camera_id: 'C2' })
    const later = '2026-12-01T09:00:00'
    expect(cameraAtSite([put], 'DONA_01', later)).toEqual({ camera: 'C1', date: '2026-06-10', session: 'R0001' })
    expect(cameraAtSite([put, replaced], 'DONA_01', later)).toMatchObject({ camera: 'C2', session: 'R0002' })
    expect(cameraAtSite([put, replaced, removed], 'DONA_01', later)).toBeNull()
  })
})
