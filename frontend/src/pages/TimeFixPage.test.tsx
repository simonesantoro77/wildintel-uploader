import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TimeFixPage, { FixDatesBanner, cardsTarget, offsetText, secondsBetween } from './TimeFixPage'
import { api } from '../api'
import { EMPTY_RESEARCH_PROJECT } from '../types'
import type { Timeline } from '../types'

vi.mock('../api', () => ({
  api: { listResearchProjects: vi.fn(), timefixCollections: vi.fn(), timefixTimeline: vi.fn(), timefixShift: vi.fn(), timefixRemove: vi.fn(), timefixRestore: vi.fn() },
}))
const mockedApi = vi.mocked(api, true)

const OFFSET = 2 * 86400 + 3600 + 1
const BROKEN: Timeline = {
  deployment_id: 'R0042-DONA_0011', collection: 'R0042', folder: '/cards/DONA/R0042/R0042-DONA_0011',
  period: { start: '2026-06-01T09:00:00', end: '2026-09-30T15:37:00' }, tolerance_hours: 1, camera_timezone: 'UTC',
  images: [
    { name: 'IMG_0001.JPG', time: '2026-06-02T10:00:00' }, { name: 'IMG_0002.JPG', time: '2020-01-01T00:00:00' }, { name: 'IMG_0003.JPG', time: null },
  ],
  segments: [
    { first_index: 0, last_index: 0, first: 'IMG_0001.JPG', last: 'IMG_0001.JPG', first_time: '2026-06-02T10:00:00', last_time: '2026-06-02T10:00:00', count: 1, inside: 1, state: 'ok', suggestion: null },
    { first_index: 1, last_index: 1, first: 'IMG_0002.JPG', last: 'IMG_0002.JPG', first_time: '2020-01-01T00:00:00', last_time: '2020-01-01T00:00:00', count: 1, inside: 0, state: 'outside', suggestion: { offset_seconds: OFFSET, why: 'so that it goes on' } },
  ],
  undated: ['IMG_0003.JPG'], outside: 1, problems: ['1 image(s) have no date.'], ok: false, corrections: [], has_originals: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.listResearchProjects.mockResolvedValue({ results: [{ ...EMPTY_RESEARCH_PROJECT, name: 'Doñana', acronym: 'DONA', trapper_pk: 2 }] })
  mockedApi.timefixCollections.mockResolvedValue({ results: [{ collection: 'R0042', deployments: ['R0042-DONA_0011'] }] })
  mockedApi.timefixTimeline.mockResolvedValue(BROKEN)
  mockedApi.timefixShift.mockResolvedValue({ ...BROKEN, ok: true, problems: [], corrections: [{ at: '2026-10-20T18:00:00Z', by: 'me', action: 'shift', first: 'IMG_0002.JPG', last: 'IMG_0002.JPG', count: 1, offset_seconds: OFFSET }], has_originals: true })
  mockedApi.timefixRemove.mockResolvedValue({ ...BROKEN, has_originals: true })
})

async function openDeployment() {
  render(<TimeFixPage />)
  await userEvent.click(await screen.findByLabelText('Research project'))
  await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
  await userEvent.click(await screen.findByLabelText('Deployment'))
  await userEvent.click(await screen.findByRole('option', { name: 'R0042-DONA_0011' }))
  await screen.findByRole('heading', { name: 'Segments' })
}

describe('TimeFixPage', () => {
  it('shows the segments and shifts one by its suggested offset', async () => {
    await openDeployment()
    expect(screen.getByText('Outside its period')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Shift +2 d 1 h 1 s' }))
    await userEvent.click(screen.getByRole('button', { name: 'Shift the dates' }))

    expect(mockedApi.timefixShift).toHaveBeenCalledWith('DONA', 'R0042', 'R0042-DONA_0011', 'IMG_0002.JPG', 'IMG_0002.JPG', OFFSET, expect.stringContaining('IMG_0002.JPG'))
    expect(await screen.findByText(/shifted \+2 d 1 h 1 s/)).toBeInTheDocument()
  })

  it('works the offset out from an image whose real time is known', async () => {
    await openDeployment()
    await userEvent.click(screen.getByRole('radio', { name: 'From an image whose real time I know' }))
    await userEvent.selectOptions(screen.getByLabelText('Image'), 'IMG_0002.JPG')
    await userEvent.type(screen.getByLabelText(/Was really taken at/), '2020-01-01T01:00:00')

    expect(screen.getByText('+1 h')).toBeInTheDocument()
  })

  it('removes the images with no date after asking', async () => {
    await openDeployment()
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove these images' })[1])
    await userEvent.click(screen.getByRole('button', { name: 'Remove 1 image(s)' }))

    expect(mockedApi.timefixRemove).toHaveBeenCalledWith('DONA', 'R0042', 'R0042-DONA_0011', ['IMG_0003.JPG'], '')
  })
})

describe('offsets', () => {
  it('says an offset in days, hours, minutes and seconds', () => {
    expect(offsetText(OFFSET)).toBe('+2 d 1 h 1 s')
    expect(offsetText(-90)).toBe('−1 min 30 s')
  })
  it('counts the seconds between two times of the same clock', () => {
    expect(secondsBetween('2020-01-01T00:00:00', '2020-01-01T01:00')).toBe(3600)
  })
})

describe('opened from where the dates were found wrong', () => {
  it('opens on the deployment given', async () => {
    render(<TimeFixPage initial={{ researchProjectId: 'DONA', collection: 'R0042', deploymentId: 'R0042-DONA_0011' }} />)

    expect(await screen.findByRole('heading', { name: 'Segments' })).toBeInTheDocument()
    expect(mockedApi.timefixTimeline).toHaveBeenCalledWith('DONA', 'R0042', 'R0042-DONA_0011')
  })

  it('knows a collection of the cards folder, and offers to fix each deployment of it', async () => {
    expect(cardsTarget('C:\\Users\\me\\Documents\\wildintel-uploader\\cards\\DONA_24\\R0042')).toEqual({ researchProjectId: 'DONA_24', collection: 'R0042' })
    expect(cardsTarget('/home/me/Pictures/R0042')).toBeNull()
    const onFixDates = vi.fn()
    render(<FixDatesBanner folder="/data/cards/DONA/R0042/" names={['R0042-DONA_0011']} onFixDates={onFixDates} />)
    await userEvent.click(screen.getByRole('button', { name: 'Fix dates of R0042-DONA_0011' }))
    expect(onFixDates).toHaveBeenCalledWith({ researchProjectId: 'DONA', collection: 'R0042', deploymentId: 'R0042-DONA_0011' })
  })
})
