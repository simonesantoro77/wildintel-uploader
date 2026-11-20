import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import VisitDetails from './VisitDetails'
import type { ClosedVisit } from '../types'

const stored = (over: object) => ({
  location_id: 'WICP_02_004', session: 'R0002', date: '2026-10-19', time: '13:15:00', actions: ['Revision'], trappers: 'Luis Gómez', status: null, battery_status: null, card_status: null,
  num_photos: null, sd: '8', date_time_ok: null, latitude: 37.0471, longitude: -6.4815, camera_id: 'SP1776213899', camera_status: null, ...over,
}) as never
const closed: ClosedVisit = {
  visit: stored({ date_time_ok: 'Yes' }),
  end: stored({ session: 'R0003', date: '2026-11-23', time: '13:20:00', actions: ['Revision'], trappers: 'Ana Pérez', num_photos: 920, camera_status: 'Damaged', battery_status: 'OK', card_status: 'OK', date_time_ok: 'Yes' }),
}

describe('VisitDetails', () => {
  it('puts whether the camera date and time were right with the state of the camera, the batteries and the SD card of the visit that collected the card — not in the visit that left it', () => {
    render(<VisitDetails closed={closed} onClose={vi.fn()} />)

    const left = within(screen.getByRole('region', { name: 'The visit that left the card' }))
    const collected = within(screen.getByRole('region', { name: 'The visit that collected it' }))
    expect(left.queryByText('Camera date & time OK')).not.toBeInTheDocument()
    expect(collected.getByText('Camera date & time OK')).toBeInTheDocument()
    expect(collected.getAllByText('OK').length).toBeGreaterThanOrEqual(2)              // batteries and card; the date and time say Yes
    expect(collected.getByText('Damaged')).toBeInTheDocument()
    expect(collected.getByText('920 images')).toBeInTheDocument()
    expect(screen.getByText('35 days in the field')).toBeInTheDocument()
  })

  it('tells everything else a visit says in a block of more data, so that no field it holds is left out', () => {
    const full: ClosedVisit = {
      visit: stored({ setup_by: 'Ana Pérez', camera_model: 'GardePro', camera_height: 1.2, camera_tilt: 0, camera_heading: 90, detection_distance: 10, bait_use: false, feature_type: 'trailHiking', habitat: 'Holm oak',
        tags: ['forest edge', 'near water'], deployment_groups: 'season:winter', when: '2026-10-19T13:15:00Z', deployment_id: 'R0002-WICP_02_004' }),
      end: stored({ session: 'R0003', date: '2026-11-23', time: '13:20:00', num_photos: 920, camera_status: 'Damaged', calibration: true, camera_interval: 5, when: '2026-11-23T13:20:00Z' }),
    }
    render(<VisitDetails closed={full} onClose={vi.fn()} />)

    const left = within(screen.getByRole('region', { name: 'The visit that left the card' }))
    expect(left.getByText('More data')).toBeInTheDocument()
    for (const [label, value] of [['Set up by', 'Ana Pérez'], ['Camera height (m)', '1.2'], ['Camera tilt (°)', '0'], ['Camera heading (°)', '90'], ['Detection distance (m)', '10'], ['Bait use', 'No'],
      ['Feature type', 'trailHiking'], ['Habitat', 'Holm oak'], ['Tags', 'forest edge, near water'], ['Deployment groups', 'season:winter'], ['Instant (UTC)', '2026-10-19T13:15:00Z'], ['Deployment imported', 'R0002-WICP_02_004'], ['Actions', 'Revision']]) {
      expect(left.getByText(label)).toBeInTheDocument()
      expect(left.getByText(value)).toBeInTheDocument()
    }
    expect(left.queryByText('Camera date & time OK')).not.toBeInTheDocument()          // that one is with the state of the camera of the visit that collected the card
    const collected = within(screen.getByRole('region', { name: 'The visit that collected it' }))
    expect(collected.queryByText('More data')).not.toBeInTheDocument()                 // the visit that collected the card does not show it
    expect(collected.queryByText('Camera calibrated')).not.toBeInTheDocument()
  })

  it('says that the visit left the camera, not the card, when it left no SD card', () => {
    render(<VisitDetails closed={{ visit: stored({ sd: null }), end: closed.end }} onClose={vi.fn()} />)
    expect(screen.getByRole('region', { name: 'The visit that left the camera' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'The visit that left the card' })).not.toBeInTheDocument()
  })

  it('puts a dot on the line for each revision between the two visits that says nothing, so that it is told why the card goes from one revision to a later one', () => {
    render(<VisitDetails closed={{ ...closed, between: [{ session: 'R0004', label: 'Not visited' }, { session: 'R0005', label: 'Unknown' }] }} onClose={vi.fn()} />)
    expect(screen.getByText('R0004')).toBeInTheDocument()
    expect(screen.getByText(/Not visited/)).toBeInTheDocument()
    expect(screen.getByText(/Unknown/)).toBeInTheDocument()
  })
})
