import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import UploadDeploymentPage from './UploadDeploymentPage'
import { EMPTY_RESEARCH_PROJECT } from '../types'
import type { LocalResearchProject, UploadCollection, UploadDeploymentInfo, UploadEvent } from '../types'

vi.mock('../api', () => ({
  api: { listResearchProjects: vi.fn(), uploadCollections: vi.fn(), uploadDeployment: vi.fn(), openFolder: vi.fn(), trapperGetConfig: vi.fn(), checkUploadSelection: vi.fn(), uploadClassificationProjects: vi.fn() },
}))

const mockedApi = vi.mocked(api)

const PROJECT: LocalResearchProject = { ...EMPTY_RESEARCH_PROJECT, name: 'Doñana', acronym: 'DONA', trapper_pk: 2 }

const dep = (id: string, over: Partial<UploadDeploymentInfo> = {}): UploadDeploymentInfo => ({
  deployment_id: id, location_id: id.slice(6), start_date: '2024-09-04T13:10:00+02:00', end_date: '2024-11-04T14:28:00+01:00',
  images: 120, bytes: 10 * 1024 * 1024, preprocessed: true, uploaded_at: null, ...over,
})

const COLLECTIONS: UploadCollection[] = [
  { name: 'R0001', path: '/c/DONA/R0001', deployments: [dep('R0001-DONA_01', { uploaded_at: '2024-12-01T10:00:00+00:00' })] },
  {
    name: 'R0003', path: '/c/DONA/R0003',
    deployments: [
      dep('R0003-DONA_01'), dep('R0003-DONA_02'),
      dep('R0003-DONA_03', { preprocessed: false, images: 0 }),
      dep('R0003-DONA_04', { uploaded_at: '2025-01-15T09:30:00+00:00' }),
    ],
  },
]

const STEP_EVENTS = (id: string): UploadEvent[] => [
  { type: 'step', step: 'connect', status: 'running', message: 'Connecting to Trapper…' },
  { type: 'step', step: 'connect', status: 'done', message: 'Connected — research project DONA is #2 in Trapper.' },
  { type: 'step', step: 'location', status: 'done', message: `Location ${id.slice(6)} created.` },
  { type: 'step', step: 'deployment', status: 'done', message: `Deployment ${id} was already in Trapper.` },
  { type: 'step', step: 'package', status: 'done', message: '1 package(s) of 120 image(s).' },
  { type: 'package_ready', images: 120, parts: 1, bytes: 10 * 1024 * 1024 },
  { type: 'upload_progress', file: 'package_2_x_part001.zip', bytes: 5 * 1024 * 1024, total: 20 * 1024 * 1024 },
  { type: 'step', step: 'upload', status: 'done', message: 'Package 1 of 1 uploaded.' },
  { type: 'step', step: 'process', status: 'done', message: 'Trapper is processing the package.' },
  { type: 'step', step: 'wait', status: 'done', message: 'Collection R0003 is in Trapper.' },
  { type: 'done', mode: 'upload', collection: 'R0003', deployment_id: id, location_created: true, deployment_created: false, parts: 1, images: 120, bytes: 10 * 1024 * 1024 },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.listResearchProjects.mockResolvedValue({ results: [PROJECT] })
  mockedApi.uploadCollections.mockResolvedValue({ results: COLLECTIONS })
  mockedApi.trapperGetConfig.mockResolvedValue({ base_url: 'https://trapper.example.org', user_name: 'alice@example.org', has_password: true })
  mockedApi.uploadClassificationProjects.mockResolvedValue({ results: [{ pk: 7, name: 'Doñana classification', is_active: true }] })
  mockedApi.uploadDeployment.mockImplementation(async (_rp, _col, id, _mode, onEvent) => { STEP_EVENTS(id).forEach(onEvent) })
  mockedApi.checkUploadSelection.mockResolvedValue({ checks: [
    { check: 'research_project', ok: true, message: 'You have access to the research project DONA (#2) in Trapper.' },
    { check: 'collection', ok: true, message: 'You have access to the collection R0003 (#26): it is already in Trapper, so the upload adds to it.', found: true },
  ] })
})

/** Settles what to upload — step 1 shuts and step 2 opens. */
async function proceed() {
  const button = await screen.findByRole('button', { name: 'Continue to step 2' })
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
}

/** Settles what to do — step 2 shuts and step 3 opens. */
async function proceedToStep3() {
  await userEvent.click(await screen.findByRole('button', { name: 'Continue to step 3' }))
}

/** Picks the research project and the collection and goes on to step 2 — unless `go` is false (the classification project is yet to be settled). */
async function pickCollection(name = 'R0003', go = true, toStep3 = false) {
  render(<UploadDeploymentPage />)
  await userEvent.click(await screen.findByLabelText('Research project'))
  await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
  await userEvent.click(await screen.findByLabelText('Collection'))
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(`^${name}`) }))
  if (go) await proceed()
  if (go && toStep3) await proceedToStep3()
}

describe('UploadDeploymentPage', () => {
  it('offers to change the account in the settings', async () => {
    const onOpenSettings = vi.fn()
    render(<UploadDeploymentPage onOpenSettings={onOpenSettings} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Change in Settings' }))
    expect(onOpenSettings).toHaveBeenCalled()
  })

  it('shows the Trapper account saved in the settings', async () => {
    render(<UploadDeploymentPage />)

    expect(await screen.findByText('alice@example.org')).toBeInTheDocument()
    expect(screen.getByText('https://trapper.example.org')).toBeInTheDocument()
  })

  it('says to set the account up in the settings when there is none, and does not offer to upload', async () => {
    mockedApi.trapperGetConfig.mockResolvedValue({ base_url: null, user_name: null, has_password: false })
    await pickCollection('R0003', false)
    await userEvent.type(await screen.findByLabelText('Classification project'), '7')
    await proceed()
    await proceedToStep3()

    expect(await screen.findByText(/no Trapper account saved yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload to Trapper' })).toBeDisabled()
  })

  it('also needs the password saved, not just the URL and the user', async () => {
    mockedApi.trapperGetConfig.mockResolvedValue({ base_url: 'https://trapper.example.org', user_name: 'alice@example.org', has_password: false })
    await pickCollection('R0003', false)
    await userEvent.type(await screen.findByLabelText('Classification project'), '7')
    await proceed()
    await proceedToStep3()

    expect(screen.getByRole('button', { name: 'Upload to Trapper' })).toBeDisabled()
  })

  it('says so when the collections folder has no research projects yet', async () => {
    mockedApi.listResearchProjects.mockResolvedValue({ results: [] })
    render(<UploadDeploymentPage />)

    expect(await screen.findByText(/Nothing is kept in the collections folder yet — import a deployment first/)).toBeInTheDocument()
  })

  it('asks for the collection only once a research project is picked, and for its deployments once a collection is', async () => {
    render(<UploadDeploymentPage />)
    await screen.findByLabelText('Research project')
    expect(screen.queryByLabelText('Collection')).not.toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
    expect(mockedApi.uploadCollections).toHaveBeenCalledWith('DONA')
    await userEvent.click(await screen.findByLabelText('Collection'))
    expect(await screen.findByRole('option', { name: 'R0001 · 1 deployment' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'R0003 · 4 deployments' })).toBeInTheDocument()
    expect(screen.queryByText('Deployments')).not.toBeInTheDocument()
  })

  it('lists the deployments of the collection, with their images and dates', async () => {
    await pickCollection()

    expect(await screen.findByText('R0003-DONA_01')).toBeInTheDocument()
    expect(screen.getAllByText(/4 Sep → 4 Nov 2024/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('120 images').length).toBeGreaterThanOrEqual(1) // its images
  })

  it('picks the deployments still to send: preprocessed and not uploaded before', async () => {
    await pickCollection()

    expect(await screen.findByRole('checkbox', { name: 'R0003-DONA_01' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'R0003-DONA_02' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'R0003-DONA_03' })).not.toBeChecked() // not preprocessed
    expect(screen.getByRole('checkbox', { name: 'R0003-DONA_04' })).not.toBeChecked() // sent already
    expect(screen.getByRole('button', { name: 'Continue to step 2' })).toBeEnabled()
  })

  it('a deployment that was not preprocessed cannot be chosen, and says what to do', async () => {
    await pickCollection()

    const box = await screen.findByRole('checkbox', { name: 'R0003-DONA_03' })
    expect(box).toBeDisabled()
    expect(screen.getByText(/Not preprocessed — import it again through the wizard before uploading it/)).toBeInTheDocument()
  })

  it('shows when a deployment was uploaded, which can still be chosen to send again', async () => {
    await pickCollection()

    expect(await screen.findByText('Already in Trapper')).toBeInTheDocument() // only R0003-DONA_04
    expect(screen.getAllByText('New in Trapper')).toHaveLength(2) // 01 and 02; 03 can't be sent at all, so it has neither
    const box = screen.getByRole('checkbox', { name: 'R0003-DONA_04' })
    expect(box).toBeEnabled()
    await userEvent.click(box)
    expect(screen.getByRole('button', { name: 'Continue to step 2' })).toBeEnabled()
  })

  it('says how many deployments and images will be sent as they are ticked, and cannot upload none', async () => {
    await pickCollection()
    expect(await screen.findByText(/2 deployments \(240 images\) sent to DONA › R0003 in Trapper/)).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'R0003-DONA_01' }))
    expect(screen.getByText(/1 deployment \(120 images\) sent to DONA › R0003 in Trapper/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to step 2' })).toBeEnabled()

    await userEvent.click(screen.getByRole('checkbox', { name: 'R0003-DONA_02' }))
    expect(screen.getByRole('button', { name: 'Continue to step 2' })).toBeDisabled()
    expect(screen.getAllByText('Pick at least one deployment.').length).toBeGreaterThan(0)
  })

  it('uploads each chosen deployment in turn', async () => {
    await pickCollection()
    await proceedToStep3()

    await screen.findByText('Upload complete')
    expect(mockedApi.uploadDeployment.mock.calls.map((c) => c.slice(0, 3))).toEqual([
      ['DONA', 'R0003', 'R0003-DONA_01'], ['DONA', 'R0003', 'R0003-DONA_02'],
    ])
  })

  it('shows what each step of an upload did', async () => {
    await pickCollection()
    await proceedToStep3()

    await screen.findByText('Upload complete')
    expect(screen.getByText(/All the images are in Trapper/)).toBeInTheDocument()
    expect(screen.getByText(/Trapper is now processing the images/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /R0003-DONA_01/ }))
    expect(screen.getAllByText('Already in Trapper').length).toBeGreaterThan(1) // the step's label, as well as the pill in the list
    expect(screen.getByText(/Deployment R0003-DONA_01 was already in Trapper\./)).toBeInTheDocument()
    expect(screen.getByText('120 images in 1 package.')).toBeInTheDocument()
    expect(screen.getByText('120 images sent')).toBeInTheDocument()
    expect(screen.getByText('What was set up in Trapper')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload more deployments' })).toBeInTheDocument()
  })

  it('shows how much has gone up while it does, and can be stopped', async () => {
    let finish: () => void = () => {}
    mockedApi.uploadDeployment.mockImplementation((_rp, _col, _id, _mode, onEvent) => new Promise<void>((resolve) => {
      onEvent({ type: 'step', step: 'upload', status: 'running', message: 'Uploading package 1 of 1…' })
      onEvent({ type: 'upload_progress', file: 'package_2_x_part001.zip', bytes: 5 * 1024 * 1024, total: 20 * 1024 * 1024 })
      finish = resolve
    }))
    await pickCollection()
    await proceedToStep3()

    expect(await screen.findByText('Sending the images…')).toBeInTheDocument()
    expect(screen.getByText(/5\.00 MB of 20\.0 MB/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Progress of the images sent' })).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByRole('progressbar', { name: 'Progress of R0003-DONA_01' })).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByText('0 of 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()

    finish()
  })

  it('a deployment that fails shows why, and the others go on', async () => {
    mockedApi.uploadDeployment.mockImplementation(async (_rp, _col, id, _mode, onEvent) => {
      if (id === 'R0003-DONA_01') throw new Error("Trapper has no research project 'DONA' — create it there first")
      STEP_EVENTS(id).forEach(onEvent)
    })
    await pickCollection()
    await proceedToStep3()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('1 deployment uploaded, 1 could not be uploaded')
    expect(screen.getByText(/Trapper has no research project 'DONA' — create it there first/)).toBeInTheDocument()
    expect(screen.getByText('Not uploaded')).toBeInTheDocument() // and the failed one is in the list, not apart
    expect(screen.getByRole('link', { name: 'Download report' })).toBeInTheDocument()
    expect(screen.getByText(/Last run/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /R0003-DONA_02/ })).toBeInTheDocument() // the other one went up
    expect(mockedApi.uploadDeployment).toHaveBeenCalledTimes(2)
  })

  it('reads the collections again once done, so what was uploaded shows as uploaded', async () => {
    await pickCollection()
    mockedApi.uploadCollections.mockResolvedValue({ results: COLLECTIONS.map((c) => c.name === 'R0003'
      ? { ...c, deployments: c.deployments.map((d) => (d.deployment_id === 'R0003-DONA_01' ? { ...d, uploaded_at: '2026-10-01T08:00:00+00:00' } : d)) } : c) })
    await proceedToStep3()

    await waitFor(() => expect(screen.getAllByText('Already in Trapper')).toHaveLength(2)) // 04, and now 01
    expect(mockedApi.uploadCollections).toHaveBeenCalledTimes(2)
  })

  it('lets the user upload more once done', async () => {
    await pickCollection()
    await proceedToStep3()
    await screen.findByText('Upload complete')

    await userEvent.click(screen.getByRole('button', { name: 'Upload more deployments' }))

    expect(screen.queryByText('Upload complete')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload to Trapper' })).not.toBeInTheDocument() // back at step 1
    expect(screen.getByRole('button', { name: 'Continue to step 2' })).toBeInTheDocument()
  })

  it('has no size of zips to set here: it is a setting of Trapper', async () => {
    await pickCollection()
    await proceedToStep3()
    await screen.findByText('Upload complete')
    expect(screen.queryByLabelText('Largest zip (MB)')).not.toBeInTheDocument()
  })

  it('changing the research project or the collection clears the previous upload', async () => {
    await pickCollection()
    await proceedToStep3()
    await screen.findByText('Upload complete')

    await userEvent.click(screen.getByLabelText('Collection'))
    await userEvent.click(await screen.findByRole('option', { name: /^R0001/ }))

    expect(screen.queryByText('Upload complete')).not.toBeInTheDocument()
    expect(await screen.findByRole('checkbox', { name: 'R0001-DONA_01' })).not.toBeChecked() // sent already
  })

  it('shows why the collections could not be read', async () => {
    mockedApi.uploadCollections.mockRejectedValue(new Error('The research project id can only have letters, digits…'))
    render(<UploadDeploymentPage />)
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))

    expect(await screen.findByText(/can only have letters, digits/)).toBeInTheDocument()
  })

  it('shuts step 1 and then step 2 once each is settled, with a pencil to open it again and a Back', async () => {
    await pickCollection('R0003', false, false)
    expect(screen.queryByRole('radio', { name: 'Upload to Trapper' })).not.toBeInTheDocument() // step 2 is locked
    await proceed()

    expect(screen.getByText(/DONA › R0003 · 2 deployments \(240 images\)/)).toBeInTheDocument()
    expect(await screen.findByRole('radio', { name: 'Upload to Trapper' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload to Trapper' })).not.toBeInTheDocument() // step 3 is not open yet

    await proceedToStep3() // the next step begins by itself
    expect(screen.getByRole('button', { name: 'Edit Choose what to do' })).toBeInTheDocument()
    expect(await screen.findByText('Upload complete')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Edit Choose what to do' }))
    expect(screen.queryByText('Upload complete')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.queryByRole('radio', { name: 'Upload to Trapper' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to step 2' })).toBeInTheDocument()
  })

  it('goes on from the prepared files to upload them as a fourth step, shutting the third', async () => {
    mockedApi.uploadDeployment.mockImplementation(async (_rp, _col, id, mode, onEvent) => {
      if (mode === 'generate') {
        onEvent({ type: 'done', mode: 'generate', collection: 'R0003', deployment_id: id, parts: 1, output_dir: '/out/R0003', files: ['a.zip', 'R0003_deployments.csv'], images: 120, file_sizes: { 'a.zip': 2048, 'R0003_deployments.csv': 100 } })
      } else {
        STEP_EVENTS(id).forEach(onEvent)
      }
    })
    await pickCollection('R0003', true, false)
    await userEvent.click(await screen.findByRole('radio', { name: 'Only prepare the files' }))
    await proceedToStep3()
    await screen.findByText('Files prepared')

    await userEvent.click(screen.getByRole('button', { name: 'Upload to Trapper' })) // opens step 4, which begins by itself

    expect(await screen.findByText('Upload complete')).toBeInTheDocument()
    expect(screen.getByText(/2 deployments prepared · 240 images/)).toBeInTheDocument() // step 3, shut with its summary
    expect(screen.getByRole('button', { name: 'Edit Prepare the files' })).toBeInTheDocument()
    expect(screen.queryByText('Files prepared')).not.toBeInTheDocument()
    expect(mockedApi.uploadDeployment.mock.calls.map((c) => c[3])).toEqual(['generate', 'generate', 'upload', 'upload'])
  })

  describe('deleting the package files once uploaded', () => {
    const DELETE = /Delete the package files once they are uploaded/

    it('is offered with the upload only, and is off unless ticked', async () => {
      await pickCollection()
      expect(screen.getByRole('checkbox', { name: DELETE })).not.toBeChecked()
      await userEvent.click(screen.getByRole('radio', { name: 'Only prepare the files' }))
      expect(screen.queryByRole('checkbox', { name: DELETE })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('radio', { name: 'Rehearse first (dry run)' }))
      expect(screen.queryByRole('checkbox', { name: DELETE })).not.toBeInTheDocument()
    })

    it('tells the upload to delete them when ticked, and says they were deleted', async () => {
      mockedApi.uploadDeployment.mockImplementation(async (_rp, _col, id, _mode, onEvent) => {
        STEP_EVENTS(id).slice(0, -1).forEach(onEvent)
        onEvent({ type: 'done', mode: 'upload', collection: 'R0003', deployment_id: id, parts: 1, images: 120, bytes: 10, files_deleted: true })
      })
      await pickCollection()
      await userEvent.click(screen.getByRole('checkbox', { name: DELETE }))
      await proceedToStep3()

      expect(await screen.findByText('Upload complete')).toBeInTheDocument()
      expect(screen.getByText(/The package files were deleted/)).toBeInTheDocument()
      expect(mockedApi.uploadDeployment.mock.calls.every((c) => c[7] === true)).toBe(true)
    })

    it('keeps them by default, and says where', async () => {
      mockedApi.uploadDeployment.mockImplementation(async (_rp, _col, id, _mode, onEvent) => {
        STEP_EVENTS(id).slice(0, -1).forEach(onEvent)
        onEvent({ type: 'done', mode: 'upload', collection: 'R0003', deployment_id: id, parts: 1, images: 120, bytes: 10, files_deleted: false, output_dir: '/data/packages/DONA/R0003', files: ['a.zip'] })
      })
      await pickCollection()
      await proceedToStep3()

      expect(await screen.findByText('Upload complete')).toBeInTheDocument()
      expect(screen.getByText(/The package files were kept/)).toBeInTheDocument()
      expect(screen.getByText('/data/packages/DONA/R0003')).toBeInTheDocument()
      expect(mockedApi.uploadDeployment.mock.calls.every((c) => c[7] === false)).toBe(true)
    })
  })

  it('runs a dry run, saying what would be done and changing nothing', async () => {
    mockedApi.uploadDeployment.mockImplementation(async (_rp, _col, id, _mode, onEvent) => {
      onEvent({ type: 'done', mode: 'dry_run', collection: 'R0003', deployment_id: id, parts: 3, would_create_location: true, would_create_deployment: false })
    })
    await pickCollection('R0003', true, false)
    await userEvent.click(await screen.findByRole('radio', { name: 'Rehearse first (dry run)' }))
    await proceedToStep3()

    await screen.findByText(/2 deployment\(s\) checked\./)
    expect(mockedApi.uploadDeployment.mock.calls.map((c) => c[3])).toEqual(['dry_run', 'dry_run'])
    expect(screen.getAllByText('The location would be created in Trapper.')).toHaveLength(2)
    expect(screen.getAllByText('The deployment is already in Trapper.')).toHaveLength(2)
    expect(screen.getAllByText('The images would go up in 3 package(s).')).toHaveLength(2)
  })

  it('only generates the files without a Trapper account, and can open their folder', async () => {
    mockedApi.trapperGetConfig.mockResolvedValue({ base_url: null, user_name: null, has_password: false })
    mockedApi.openFolder.mockResolvedValue({ opened: '/out/R0003' })
    mockedApi.uploadDeployment.mockImplementation(async (_rp, _col, id, _mode, onEvent) => {
      onEvent({ type: 'done', mode: 'generate', collection: 'R0003', deployment_id: id, parts: 1, output_dir: '/out/R0003', files: ['a_part001.zip', 'a_part001.yaml', 'R0003_deployments.csv'] })
    })
    await pickCollection('R0003', false)
    expect(await screen.findByRole('button', { name: 'Continue to step 2' })).toBeDisabled() // the yaml needs the classification project, which can't be listed with no account
    expect(mockedApi.uploadClassificationProjects).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Classification project'), '7')
    await proceed()
    await userEvent.click(await screen.findByRole('radio', { name: 'Only prepare the files' }))
    await proceedToStep3()

    await screen.findByText('Files prepared')
    expect(screen.queryByRole('heading', { name: 'Files ready' })).not.toBeInTheDocument()
    expect(mockedApi.uploadDeployment.mock.calls[0][3]).toBe('generate')
    expect(mockedApi.uploadDeployment.mock.calls[0][5]).toBe(7)
    expect(screen.getAllByText('R0003_deployments.csv').length).toBeGreaterThan(0)
    await userEvent.click(screen.getAllByRole('button', { name: 'Open folder' })[0])
    expect(mockedApi.openFolder).toHaveBeenCalledWith('/out/R0003')
  })

  it('starts from the research project and collection a finished import went into', async () => {
    render(<UploadDeploymentPage initial={{ researchProjectId: 'DONA', collection: 'R0003' }} />)

    expect(await screen.findByLabelText('Collection')).toHaveValue('R0003 · 4 deployments')
    expect(mockedApi.uploadCollections).toHaveBeenCalledWith('DONA')
    expect(screen.getByLabelText('Research project')).toHaveValue('DONA — Doñana')
    // what is left to send is ticked, as when the collection is picked by hand
    expect(await screen.findByRole('checkbox', { name: 'R0003-DONA_01' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'R0003-DONA_04' })).not.toBeChecked() // uploaded before
    expect(await screen.findByLabelText('Classification project')).toHaveValue('Doñana classification (#7)')
    await proceed()
    await proceedToStep3()
    expect(await screen.findByText('Upload complete')).toBeInTheDocument()
  })

  it('starts empty when it is not reached from an import', async () => {
    render(<UploadDeploymentPage />)
    expect(await screen.findByLabelText('Research project')).toHaveValue('')
    expect(mockedApi.uploadCollections).not.toHaveBeenCalled()
  })

  describe('the classification project', () => {
    it('is the only one the research project has, picked by itself and sent with the upload', async () => {
      await pickCollection()
      expect(await screen.findByLabelText('Classification project')).toHaveValue('Doñana classification (#7)')
      await proceedToStep3()
      await screen.findByText('Upload complete')
      expect(mockedApi.uploadClassificationProjects).toHaveBeenCalledWith('DONA')
      expect(mockedApi.uploadDeployment.mock.calls.map((c) => c[5])).toEqual([7, 7])
    })

    it('has to be picked when there are several, and holds the upload back until it is', async () => {
      mockedApi.uploadClassificationProjects.mockResolvedValue({ results: [
        { pk: 7, name: 'A', is_active: true }, { pk: 8, name: 'B', is_active: true },
      ] })
      await pickCollection('R0003', false)
      const field = await screen.findByLabelText('Classification project')
      expect(field).toHaveValue('')
      expect(screen.getByRole('button', { name: 'Continue to step 2' })).toBeDisabled()
      expect(screen.getByText(/has several: pick the one/)).toBeInTheDocument()

      await userEvent.click(field)
      await userEvent.click(await screen.findByRole('option', { name: 'B (#8)' }))
      await proceed()
      await proceedToStep3()
      await screen.findByText('Upload complete')
      expect(mockedApi.uploadDeployment.mock.calls[0][5]).toBe(8)
    })
  })

  describe('links to Trapper', () => {
    it('links the location, the deployment and the collection once they are in Trapper, to check them there', async () => {
      mockedApi.uploadDeployment.mockImplementation(async (_rp, _col, id, _mode, onEvent) => {
        onEvent({ type: 'step', step: 'location', status: 'done', message: 'Location DONA_01 created.', url: 'https://trapper.example.org/geomap/location/detail/12/' })
        onEvent({ type: 'step', step: 'deployment', status: 'done', message: `Deployment ${id} created.`, url: 'https://trapper.example.org/geomap/deployment/detail/47/' })
        onEvent({ type: 'step', step: 'package', status: 'done', message: 'Packed.' })
        onEvent({ type: 'step', step: 'wait', status: 'done', message: 'Collection R0003 is in Trapper.', url: 'https://trapper.example.org/storage/collection/detail/26/' })
        onEvent({ type: 'done', mode: 'upload', collection: 'R0003', deployment_id: id, parts: 1, images: 120, bytes: 1024 })
      })
      await pickCollection()
      await proceedToStep3()

      await screen.findByText('Upload complete')
      await userEvent.click(screen.getByRole('button', { name: /R0003-DONA_01/ }))
      const links = screen.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('target')])
      expect(links).toEqual(expect.arrayContaining([
        ['Open the location', 'https://trapper.example.org/geomap/location/detail/12/', '_blank'],
        ['Open the deployment', 'https://trapper.example.org/geomap/deployment/detail/47/', '_blank'],
        ['Open in Trapper↗', 'https://trapper.example.org/storage/collection/detail/26/', '_blank'],
      ]))
    })
  })

  describe('choosing the deployments', () => {
    it('selects all of them, or only the ones not uploaded yet, or none', async () => {
      await pickCollection()
      const ticked = () => ['01', '02', '03', '04'].filter((n) => (screen.getByRole('checkbox', { name: `R0003-DONA_${n}` }) as HTMLInputElement).checked)
      await screen.findByText(/^2 of 3 selected/) // 03 can't be uploaded at all

      await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
      expect(ticked()).toEqual(['01', '02', '04'])

      await userEvent.click(screen.getByRole('button', { name: 'Select the not uploaded' }))
      expect(ticked()).toEqual(['01', '02'])

      await userEvent.click(screen.getByRole('button', { name: 'Select none' }))
      expect(ticked()).toEqual([])
    })
  })

  describe('the access to what was chosen', () => {
    it('when the research project is not in Trapper: says so, offers to check again and to open Trapper, and holds the upload back', async () => {
      mockedApi.checkUploadSelection.mockResolvedValue({ checks: [
        { check: 'research_project', ok: false, message: "The research project DONA doesn't exist in Trapper yet." },
      ] })
      await pickCollection('R0003', false)

      expect(await screen.findByText(/doesn't exist in Trapper yet/)).toBeInTheDocument()
      expect(screen.getByText(/Research projects can’t be created from here/)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Open Trapper' })).toHaveAttribute('href', 'https://trapper.example.org')
      expect(screen.getByLabelText('Classification project')).toBeDisabled()
      expect(screen.getByText('Available once DONA is found in Trapper.')).toBeInTheDocument()
      await proceed()
      await proceedToStep3() // only rehearsing or sending is held back
      expect(screen.getByText('DONA isn’t in Trapper yet.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Upload to Trapper' })).toBeDisabled()

      mockedApi.checkUploadSelection.mockResolvedValue({ checks: [
        { check: 'research_project', ok: true, message: 'You have access to the research project DONA (#2) in Trapper.' },
      ] })
      await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
      expect((await screen.findAllByText('Found in Trapper')).length).toBeGreaterThan(0)
      expect(mockedApi.checkUploadSelection).toHaveBeenCalledTimes(2)
      await proceed()
      await proceedToStep3()
      expect(await screen.findByText('Upload complete')).toBeInTheDocument()
    })

    it('says both the research project and the collection are found in Trapper, once both are chosen', async () => {
      await pickCollection()

      const [project, collection] = await screen.findAllByText('Found in Trapper')
      expect(mockedApi.checkUploadSelection).toHaveBeenCalledWith('DONA', 'R0003')
      // each message sits under its own field
      expect(project.closest('div')).toContainElement(screen.getByLabelText('Research project'))
      expect(project.closest('div')).not.toContainElement(screen.getByLabelText('Collection'))
      expect(collection.closest('div')).toContainElement(screen.getByLabelText('Collection'))
    })

    it('says the collection is not in Trapper yet when the upload would create it', async () => {
      mockedApi.checkUploadSelection.mockResolvedValue({ checks: [
        { check: 'research_project', ok: true, message: 'You have access to the research project DONA (#2) in Trapper.' },
        { check: 'collection', ok: true, found: false, message: "You can read the collections of the research project; R0003 isn't in Trapper yet, so the upload creates it." },
      ] })
      await pickCollection()

      expect(await screen.findByText('Not in Trapper yet — the upload creates it')).toBeInTheDocument()
      expect(screen.getAllByText('Found in Trapper')).toHaveLength(2) // the research project and the classification project, not the collection
    })

    it('says so when the account has no access, and when it cannot be checked', async () => {
      mockedApi.checkUploadSelection.mockResolvedValueOnce({ checks: [
        { check: 'research_project', ok: false, message: 'Trapper has no research project DONA.' },
        { check: 'collection', ok: false, message: 'Not checked: the research project couldn\u2019t be found.' },
      ] })
      await pickCollection()
      expect(await screen.findByText(/Trapper has no research project DONA/)).toBeInTheDocument()
    })
  })
})
