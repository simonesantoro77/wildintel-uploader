import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FieldLogPage, { utc } from './FieldLogPage'
import { api } from '../api'
import { EMPTY_RESEARCH_PROJECT } from '../types'
import type { FieldDeployment, FieldlogResult } from '../types'

vi.mock('../api', () => ({
  api: {
    listResearchProjects: vi.fn(), fieldlogLast: vi.fn(), fieldlogPickFile: vi.fn(), fieldlogAnalyze: vi.fn(), fieldlogApply: vi.fn(), fieldlogOpenFolder: vi.fn(),
  },
}))
const mockedApi = vi.mocked(api, true)

const visit = { session: 'R0002', action: 'Revision', when: '2026-02-20T09:30:00Z', camera: 11, card: '1b', photos: 120, trappers: 'Ben', notes: null, new: false }
const dep = (id: string, over: Partial<FieldDeployment> = {}): FieldDeployment => ({
  deployment_id: id, collection: 'R0002', site: id.slice(6), status: 'closed', start: '2026-02-20T09:30:00Z', end: '2026-03-30T08:15:00Z',
  setup_by: 'Ben', camera_id: '11', card: '1b', photos_counted: null, comments: 'End: card full', start_visit: visit, end_visit: { ...visit, new: true }, ...over,
})
const RESULT: FieldlogResult = {
  datasheet: 'TatraFieldSheet_R0001-R0002.xlsx', sessions: ['R0001', 'R0003'], new_rows: 2, new_visits: [], collections: ['R0002'],
  deployments: [
    dep('R0002-TATR_0001'),
    dep('R0002-TATR_0002', { status: 'open', end: null, end_visit: null, comments: '' }),
    dep('R0003-TATR_0003', { collection: 'R0003', status: 'open', end: null, end_visit: null }),
  ],
  new_sites: [{ site: 'TATR_0003', session: 'R0003', action: 'Installation', latitude: 49.3, longitude: 20.2 }],
  locations_known: true,
  warnings: ['Sites not among the locations of TATRA: TATR_0003. Add them…', 'R0003: camera 11 is at 2 sites (TATR_0001, TATR_0003).'],
  notes: ['Datasheet: TatraFieldSheet_R0001-R0002.xlsx (4 visits, sessions R0001 to R0002)'],
  camera_timezone: 'UTC',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.listResearchProjects.mockResolvedValue({ results: [{ ...EMPTY_RESEARCH_PROJECT, name: 'Tatra', acronym: 'TATRA', trapper_pk: 3 }] })
  mockedApi.fieldlogLast.mockResolvedValue({ epicollect: null, datasheet: '/data/TatraFieldSheet_R0001-R0002.xlsx', research_project_id: 'TATRA' })
  mockedApi.fieldlogPickFile.mockResolvedValue({ path: '/data/form-backup.csv' })
  mockedApi.fieldlogAnalyze.mockResolvedValue(RESULT)
  mockedApi.fieldlogOpenFolder.mockResolvedValue({ opened: '/c' })
  mockedApi.fieldlogApply.mockResolvedValue({ ...RESULT, files: ['/data/TatraFieldSheet_R0001-R0003.xlsx', '/c/TATRA/R0002/R0002_FileTimestampLog.csv'] })
})

async function checked() {
  render(<FieldLogPage />)
  await screen.findByDisplayValue('/data/TatraFieldSheet_R0001-R0002.xlsx')
  await userEvent.click(screen.getAllByRole('button', { name: 'Browse…' })[0])
  await screen.findByDisplayValue('/data/form-backup.csv')
  await userEvent.click(screen.getByRole('button', { name: 'Check the field records' }))
}

describe('FieldLogPage', () => {
  it('starts from the datasheet and the research project used last, and checks the trip', async () => {
    await checked()

    expect(mockedApi.fieldlogAnalyze).toHaveBeenCalledWith('/data/form-backup.csv', '/data/TatraFieldSheet_R0001-R0002.xlsx', 'TATRA')
    expect(await screen.findByText('R0002-TATR_0001')).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument() // cards to copy
    // The deployments of the next collection are not listed among this one's.
    expect(screen.queryByText('R0003-TATR_0003')).not.toBeInTheDocument()
  })

  it('says which sites are not locations yet, apart from the other warnings', async () => {
    await checked()

    const alert = await screen.findByText(/1 site is not among the locations of TATRA/)
    expect(within(alert.parentElement!).getByText('TATR_0003')).toBeInTheDocument()
    expect(screen.getByText('R0003: camera 11 is at 2 sites (TATR_0001, TATR_0003).')).toBeInTheDocument()
  })

  it('filters the deployments by whether their card was collected', async () => {
    await checked()
    await userEvent.click(await screen.findByRole('button', { name: 'Camera still out (1)' }))

    expect(screen.getByText('R0002-TATR_0002')).toBeInTheDocument()
    expect(screen.queryByText('R0002-TATR_0001')).not.toBeInTheDocument()
  })

  it('writes the files and lists them', async () => {
    await checked()
    await userEvent.click(await screen.findByRole('button', { name: 'Write the files' }))

    expect(mockedApi.fieldlogApply).toHaveBeenCalledWith('/data/form-backup.csv', '/data/TatraFieldSheet_R0001-R0002.xlsx', 'TATRA')
    expect(await screen.findByText('/c/TATRA/R0002/R0002_FileTimestampLog.csv')).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Open folder' })[1])
    expect(mockedApi.fieldlogOpenFolder).toHaveBeenCalledWith('/c/TATRA/R0002/R0002_FileTimestampLog.csv')
  })

  it('shows what went wrong reading the files', async () => {
    mockedApi.fieldlogAnalyze.mockRejectedValue(new Error('The Epicollect file does not have these columns: 12_Observation.'))
    await checked()

    expect(await screen.findByRole('alert')).toHaveTextContent('12_Observation')
  })
})

describe('utc', () => {
  it('shows a time of the field records as UTC, with the seconds only when there are any', () => {
    expect(utc('2026-03-30T08:15:00Z')).toBe('2026-03-30 08:15 UTC')
    expect(utc('2026-03-30T08:15:42Z')).toBe('2026-03-30 08:15:42 UTC')
    expect(utc(null)).toBe('—')
  })
})
