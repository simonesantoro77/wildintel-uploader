import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SyncCollectionsPage from './SyncCollectionsPage'
import { api } from '../api'

vi.mock('../api', () => ({ api: { trapperResearchProjects: vi.fn(), trapperClassificationProjects: vi.fn(), syncCollectionNames: vi.fn(), syncCollections: vi.fn() } }))
const mockedApi = vi.mocked(api, true)

const none = { research_project: [], locations: [], collections: [], deployments: [], timestamp_log: [], images: [] }

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.trapperResearchProjects.mockResolvedValue({ results: [{ pk: 2, name: 'Doñana', acronym: 'DONA' }] })
  mockedApi.trapperClassificationProjects.mockResolvedValue({ results: [{ pk: 10, name: 'Doñana 2024', is_active: true }] })
  mockedApi.syncCollectionNames.mockResolvedValue({ results: [{ name: 'R0003', deployments: ['R0003-DONA_01', 'R0003-DONA_02'] }, { name: 'R0004', deployments: ['R0004-DONA_01'] }] })
})

describe('SyncCollectionsPage', () => {
  it('asks for the research project and the classification project, then syncs and says what was created', async () => {
    mockedApi.syncCollections.mockImplementation(async (_c, _p, _k, _n, _d, _i, onEvent) => {
      onEvent({ type: 'progress', message: 'R0003-DONA_01 (1/1): done.' })
      onEvent({ type: 'done', ...doneResult })
    })
    const doneResult = {
      research_project_id: 'DONA', folder: '/c/DONA', collections: ['R0003'], unassigned: ['R0009-DONA_01'], failed: [{ deployment_id: 'R0003-DONA_04', error: 'start_date: Value error' }],
      created: { ...none, collections: ['R0003'], deployments: ['R0003-DONA_01'], images: ['R0003-DONA_01'] }, kept: { ...none, locations: ['DONA_01'] },
    }
    render(<SyncCollectionsPage />)

    const sync = screen.getByRole('button', { name: 'Sync' })
    expect(sync).toBeDisabled()
    expect(screen.getByRole('img', { name: 'Locked' })).toBeInTheDocument() // the sync waits for the choice
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByText('DONA — Doñana'))
    await userEvent.click(screen.getByLabelText('Classification project'))
    await userEvent.click(await screen.findByText('Doñana 2024'))
    await userEvent.click(await screen.findByLabelText('Collection'))
    await userEvent.click(await screen.findByText('R0003 — 2 deployment(s)'))
    await userEvent.click(screen.getByRole('button', { name: 'Deselect all' }))
    expect(sync).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    await userEvent.click(screen.getByLabelText('R0003-DONA_02'))
    await userEvent.click(sync)

    expect(mockedApi.syncCollections).toHaveBeenCalledWith({}, { pk: 2, name: 'Doñana', acronym: 'DONA' }, 10, ['R0003'], ['R0003-DONA_01'], false, expect.any(Function))
    expect(await screen.findByRole('log', { name: 'Sync progress' })).toHaveTextContent('R0003-DONA_01 (1/1): done.')
    const result = await screen.findByLabelText('Sync result')
    expect(result).toHaveTextContent('Deployments: 1 created, 0 already there')
    expect(result).toHaveTextContent('Locations: 0 created, 1 already there')
    expect(result).toHaveTextContent('Images files (images.json): 1 created, 0 already there')
    expect(result).toHaveTextContent('R0003-DONA_04 — start_date: Value error')
    expect(result).toHaveTextContent('1 deployment of the research project are not in the collections of this classification project, so they were not created (collections R0009).')
    expect(screen.getByText(/DONA › Doñana 2024 › R0003 · 1 deployment/)).toBeInTheDocument() // the summary of step 1
    await userEvent.click(screen.getByRole('button', { name: 'Sync another collection' }))
    expect(screen.queryByLabelText('Sync result')).not.toBeInTheDocument()
  })

  it('says why when Trapper cannot be read', async () => {
    mockedApi.trapperResearchProjects.mockRejectedValue(new Error('Incorrect Trapper username or password.'))
    render(<SyncCollectionsPage />)

    await waitFor(() => expect(screen.getByText('Incorrect Trapper username or password.')).toBeInTheDocument())
  })

  it('downloads the images when asked, and says what came, what failed and what the project does not hold', async () => {
    const doneResult = {
      research_project_id: 'DONA', folder: '/c/DONA', collections: ['R0003'], unassigned: [], failed: [],
      created: { ...none }, kept: { ...none },
      downloaded: {
        images: 1200, bytes: 2_500_000_000, deployments: { 'R0003-DONA_01': 1200 },
        failed: [{ deployment_id: 'R0003-DONA_01', name: 'R0003-DONA_01__20240703_3.JPEG', error: 'connection reset' }],
        not_held: { 'R0003-DONA_02': ['a.JPEG', 'b.JPEG'] },
      },
    }
    mockedApi.syncCollections.mockImplementation(async (_c, _p, _k, _n, _d, _i, onEvent) => { onEvent({ type: 'done', ...doneResult }) })
    render(<SyncCollectionsPage />)
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByText('DONA — Doñana'))
    await userEvent.click(screen.getByLabelText('Classification project'))
    await userEvent.click(await screen.findByText('Doñana 2024'))
    await userEvent.click(await screen.findByLabelText('Collection'))
    await userEvent.click(await screen.findByText('R0003 — 2 deployment(s)'))

    const box = screen.getByRole('checkbox', { name: /Also download the images from Trapper/ })
    expect(box).not.toBeChecked() // the images are only downloaded if asked for
    await userEvent.click(box)
    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    expect(mockedApi.syncCollections).toHaveBeenCalledWith({}, expect.anything(), 10, ['R0003'], ['R0003-DONA_01', 'R0003-DONA_02'], true, expect.any(Function))
    const downloaded = await screen.findByLabelText('Downloaded images')
    expect(downloaded).toHaveTextContent('Images downloaded: 1,200 (2.50 GB)')
    expect(downloaded).toHaveTextContent('R0003-DONA_02 (2)')
    expect(downloaded).toHaveTextContent('1 image could not be downloaded')
    expect(downloaded).toHaveTextContent('connection reset')
  })
})
