import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SyncCollectionsPage from './SyncCollectionsPage'
import { api } from '../api'

vi.mock('../api', () => ({ api: { trapperResearchProjects: vi.fn(), trapperClassificationProjects: vi.fn(), syncCollectionNames: vi.fn(), syncCollections: vi.fn() } }))
const mockedApi = vi.mocked(api, true)

const none = { research_project: [], locations: [], collections: [], deployments: [], timestamp_log: [], images: [] }
const PROJECT = { pk: 2, name: 'Doñana', acronym: 'DONA' }

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.trapperResearchProjects.mockResolvedValue({ results: [PROJECT] })
  mockedApi.trapperClassificationProjects.mockResolvedValue({ results: [{ pk: 10, name: 'Iberian Camera Trap Project', is_active: true }] })
  mockedApi.syncCollectionNames.mockResolvedValue({
    field: [
      { name: 'R0003', deployments: ['R0003-DONA_01', 'R0003-DONA_02'], local: { exists: true, deployments: ['R0003-DONA_01'], with_images: ['R0003-DONA_01'] } },
      { name: 'R0004', deployments: ['R0004-DONA_01'], local: { exists: false, deployments: [], with_images: [] } },
    ],
    other: [{ pk: 39, name: 'R0039-SOLONOVIEMBRE', downloaded: 0 }, { pk: 40, name: 'solo linces', downloaded: 12 }],
  })
})

async function chooseProject() {
  render(<SyncCollectionsPage />)
  await userEvent.click(await screen.findByLabelText('Research project'))
  await userEvent.click(await screen.findByText('DONA — Doñana'))
  await screen.findByText('Field collections')
}

describe('SyncCollectionsPage', () => {
  it('lists the research project’s collections with nothing ticked, and what is already here', async () => {
    await chooseProject()

    expect(mockedApi.syncCollectionNames).toHaveBeenCalledWith({}, PROJECT)
    expect(screen.getByRole('checkbox', { name: 'R0003' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'R0039-SOLONOVIEMBRE' })).not.toBeChecked()
    expect(screen.getByText(/Here: 1 of 2 deployment\(s\), 1 with images/)).toBeInTheDocument()
    expect(screen.getByText('12 file(s) already here')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sync' })).toBeDisabled()
    // No classification project is asked for just to sync.
    expect(screen.queryByLabelText(/Classification project/)).not.toBeInTheDocument()
  })

  it('syncs the chosen field collection and deployments without a classification project, and says what was created', async () => {
    const doneResult = {
      research_project_id: 'DONA', folder: '/c/DONA', collections: ['R0003'], unassigned: ['R0009-DONA_01'], failed: [{ deployment_id: 'R0003-DONA_04', error: 'start_date: Value error' }],
      created: { ...none, collections: ['R0003'], deployments: ['R0003-DONA_02'] }, kept: { ...none, locations: ['DONA_01'] },
    }
    mockedApi.syncCollections.mockImplementation(async (_c, _p, _k, _n, _d, _i, _o, onEvent) => {
      onEvent({ type: 'progress', message: 'R0003-DONA_02 (1/1): done.' })
      onEvent({ type: 'done', ...doneResult })
    })
    await chooseProject()
    await userEvent.click(screen.getByRole('checkbox', { name: 'R0003' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Choose deployments' })[0])
    await userEvent.click(screen.getByRole('checkbox', { name: 'R0003-DONA_01' })) // already here: left out
    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    expect(mockedApi.syncCollections).toHaveBeenCalledWith({}, PROJECT, null, ['R0003'], ['R0003-DONA_02'], false, [], expect.any(Function))
    expect(await screen.findByRole('log', { name: 'Sync progress' })).toHaveTextContent('R0003-DONA_02 (1/1): done.')
    const result = await screen.findByLabelText('Sync result')
    expect(result).toHaveTextContent('Deployments: 1 created, 0 already there')
    expect(result).toHaveTextContent('R0003-DONA_04 — start_date: Value error')
    expect(result).toHaveTextContent('not in any of its field collections')
  })

  it('asks for a classification project only to download images, and downloads other collections apart', async () => {
    mockedApi.syncCollections.mockImplementation(async (_c, _p, _k, _n, _d, _i, _o, onEvent) => {
      onEvent({ type: 'done', research_project_id: 'DONA', folder: '/c/DONA', collections: [], unassigned: [], failed: [], created: { ...none }, kept: { ...none },
        others: [{ name: 'R0039-SOLONOVIEMBRE', folder: '/d/DONA/R0039-SOLONOVIEMBRE', downloaded: 30, already: 0, bytes: 3_000_000, failed: [] }] })
    })
    await chooseProject()
    await userEvent.click(screen.getByRole('checkbox', { name: 'R0039-SOLONOVIEMBRE' }))
    const sync = screen.getByRole('button', { name: 'Sync' })
    expect(sync).toBeDisabled() // the classification project is missing
    await userEvent.click(screen.getByLabelText(/Classification project/))
    await userEvent.click(await screen.findByText('Iberian Camera Trap Project'))
    await userEvent.click(sync)

    expect(mockedApi.syncCollections).toHaveBeenCalledWith({}, PROJECT, 10, [], [], false, [{ pk: 39, name: 'R0039-SOLONOVIEMBRE' }], expect.any(Function))
    expect(await screen.findByLabelText('Other collections downloaded')).toHaveTextContent('R0039-SOLONOVIEMBRE: 30 image(s) downloaded')
  })

  it('says why when Trapper cannot be read', async () => {
    mockedApi.trapperResearchProjects.mockRejectedValue(new Error('Incorrect Trapper username or password.'))
    render(<SyncCollectionsPage />)

    await waitFor(() => expect(screen.getByText('Incorrect Trapper username or password.')).toBeInTheDocument())
  })

  it('has a Back, level with Continue, that leaves the task from the first step', async () => {
    const onBack = vi.fn()
    render(<SyncCollectionsPage onBack={onBack} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalled()
  })
})
