import { renderWithHeader } from '../test/renderWithHeader'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupManifest, BackupProjectInfo, BackupRead } from '../types'

vi.mock('../api', () => ({
  api: {
    listResearchProjects: vi.fn(), getSettings: vi.fn(), backupProjectInfo: vi.fn(), browseFolder: vi.fn(), backupCreate: vi.fn(), backupPickFile: vi.fn(), backupRead: vi.fn(), backupRestore: vi.fn(), openFolder: vi.fn(), backupDownloadUrl: vi.fn((name: string) => `/api/backup/download/${name}`),
  },
}))
import { api } from '../api'
import BackupPage from './BackupPage'

const mocked = vi.mocked(api)
const INFO: BackupProjectInfo = {
  research_project_id: 'DONA', locations: 3, cameras: 2, sd_cards: 4, visits: 12,
  collections: [
    { name: 'R0002', deployments: [{ id: 'R0002-DONA_01', files: 5, bytes: 3000, images: 3, image_bytes: 2500 }] },
    { name: 'R0001', deployments: [{ id: 'R0001-DONA_01', files: 5, bytes: 2000, images: 3, image_bytes: 1500 }, { id: 'R0001-DONA_02', files: 2, bytes: 100, images: 0, image_bytes: 0 }] },
  ],
}
const MANIFEST: BackupManifest = {
  format: 'wildintel-uploader-backup', version: 1, app_version: '1.2.3', created_at: '2026-10-29T10:30:00+00:00',
  scope: { settings: true, research_project: 'DONA', project_files: true, visits: true, images: true, deployments: [{ id: 'R0001-DONA_01', collection: 'R0001', files: 4, images: true }, { id: 'R0001-DONA_02', collection: 'R0001', files: 2, images: false }] },
  counts: { locations: 3, cameras: 2, sd_cards: 4, visits: 12 }, secrets_included: false,
}
const READ: BackupRead = { manifest: MANIFEST, here: { project: true, deployments: { 'R0001-DONA_01': true, 'R0001-DONA_02': false }, visits: { in_backup: 12, already: 10 } }, has_images: { 'R0001-DONA_01': true, 'R0001-DONA_02': false } }

beforeEach(() => {
  vi.clearAllMocks()
  mocked.listResearchProjects.mockResolvedValue({ results: [{ name: 'Doñana', acronym: 'DONA' }, { name: 'Tatra', acronym: 'TATR' }] } as never)
  mocked.getSettings.mockResolvedValue({ GENERAL: { default_research_project: 'DONA' } } as never)
  mocked.backupProjectInfo.mockResolvedValue(INFO)
})

describe('BackupPage', () => {
  it('has the header of the other pages and first asks whether to make a backup or to restore one', async () => {
    const onBack = vi.fn()
    renderWithHeader(<BackupPage onBack={onBack} />)

    expect(screen.getByRole('navigation', { name: 'You are here' })).toHaveTextContent('Menu›Utilities›Backup and restore')
    expect(screen.getByRole('radio', { name: 'Make a backup' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Restore a backup' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Utilities' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('asks for the research project and what of it to back up — the visits, the deployments, and whether the images go — and makes the backup', async () => {
    mocked.backupCreate.mockImplementation(async (_request, onEvent) => {
      onEvent({ type: 'file', index: 1, total: 2, name: 'manifest.json' })
      onEvent({ type: 'done', path: '/tmp/wildintel-backup_DONA_20261030.zip', bytes: 4096, files: 2, manifest: MANIFEST, download: 'wildintel-backup_DONA_20261030-101500.zip' })
    })
    render(<BackupPage onBack={vi.fn()} />)

    await userEvent.click(screen.getByRole('radio', { name: 'Make a backup' }))
    expect(await screen.findByText('3 locations · 2 cameras · 4 SD cards')).toBeInTheDocument()   // the research project of the settings comes chosen
    expect(screen.getByText('12 visits')).toBeInTheDocument()

    const revisions = screen.getByRole('table', { name: 'Revisions' })
    expect(screen.queryByRole('table', { name: 'Deployments' })).not.toBeInTheDocument()            // no revision is picked: no deployments to choose among
    await userEvent.click(within(revisions).getByRole('checkbox', { name: 'Revision R0001' }))      // the revision: its deployments can be chosen, all of them at first
    const deployments = screen.getByRole('table', { name: 'Deployments' })
    expect(within(deployments).getByRole('checkbox', { name: 'R0001-DONA_01' })).toBeChecked()
    expect(within(deployments).getByRole('checkbox', { name: 'R0001-DONA_02' })).toBeChecked()
    expect(within(deployments).queryByRole('checkbox', { name: 'R0002-DONA_01' })).not.toBeInTheDocument()   // of the revisions picked only
    await userEvent.click(within(deployments).getByRole('checkbox', { name: 'R0001-DONA_02' }))   // one of them is left out
    const images = screen.getByRole('switch', { name: 'Include the images of the deployments' })
    expect(images).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/its images \(.+\) stay out/)).toBeInTheDocument()
    await userEvent.click(images)
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }))

    // the step says what is going to be done, and the button makes it: no folder is asked, the browser downloads the file
    const summary = within(screen.getByRole('region', { name: 'What the backup will hold' }))
    expect(summary.getByText(/The global settings/)).toBeInTheDocument()
    expect(summary.getByText(/The list of visits of/)).toHaveTextContent('(12)')
    expect(summary.getByText(/1 deployment of/)).toHaveTextContent('with their images')
    expect(screen.queryByRole('button', { name: 'Browse…' })).not.toBeInTheDocument()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()                          // on the left of the button that makes it
    await userEvent.click(screen.getByRole('button', { name: 'Make the backup' }))

    await waitFor(() => expect(mocked.backupCreate).toHaveBeenCalled())
    expect(mocked.backupCreate.mock.calls[0][0]).toEqual({ settings: true, research_project_id: 'DONA', project_files: true, visits: true, deployments: ['R0001-DONA_01'], images: true })
    await screen.findByText(/Backup made — 4 KB/)
    const done = screen.getAllByRole('status').find((e) => /Backup made/.test(e.textContent ?? ''))!
    expect(done).toHaveTextContent('Backup made — 4 KB')
    expect(done).toHaveTextContent('Your browser is downloading it: wildintel-backup_DONA_20261030-101500.zip')
    expect(click).toHaveBeenCalledTimes(1)                                                          // the browser is asked for the file
    click.mockRestore()
    expect(done).toHaveTextContent('2 deployments of DONA, with their images')   // as the manifest the server answers says
  })

  it('can back up the settings alone, with no research project, and has nothing to continue with when nothing is chosen', async () => {
    mocked.getSettings.mockResolvedValue({ GENERAL: { default_research_project: null } } as never)
    render(<BackupPage onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Make a backup' }))

    expect(screen.getByRole('button', { name: /Continue/ })).toBeEnabled()    // the settings are chosen to start with
    await userEvent.click(screen.getByRole('checkbox', { name: /The global settings/ }))
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
    expect(mocked.backupProjectInfo).not.toHaveBeenCalled()
  })

  it('reads a backup, says what it holds and what is already here, and restores what is picked — without replacing unless it is asked to', async () => {
    mocked.backupPickFile.mockResolvedValue({ path: '/backups/b.zip' })
    mocked.backupRead.mockResolvedValue(READ)
    mocked.backupRestore.mockImplementation(async (_request, onEvent) => {
      onEvent({ type: 'done', manifest: MANIFEST, summary: { settings: true, project_files: { locations: { added: 1, replaced: 0, kept: 2 } }, visits: { added: 2, replaced: 0, kept: 10 }, deployments: { restored: ['R0001-DONA_02'], skipped: ['R0001-DONA_01'] }, files: 2 } })
    })
    render(<BackupPage onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Restore a backup' }))
    await userEvent.click(screen.getByRole('button', { name: 'Choose the backup…' }))

    expect(await screen.findByText(/Made on 29 Oct 2026, 11:30 \(Europe\/Madrid\), by version 1\.2\.3/)).toBeInTheDocument()
    expect(screen.getByText('The global settings (without passwords)')).toBeInTheDocument()
    expect(screen.getByText('10 of 12 already here')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /R0001-DONA_01/ }).closest('label')).toHaveTextContent('already here')
    expect(screen.getByText(/Off: what is already here is left as it is/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(mocked.backupRestore).toHaveBeenCalled())
    expect(mocked.backupRestore.mock.calls[0][0]).toEqual({ path: '/backups/b.zip', settings: true, project_files: true, visits: true, deployments: ['R0001-DONA_01', 'R0001-DONA_02'], images: true, replace: false })
    const done = await screen.findByRole('status')
    expect(done).toHaveTextContent('Locations: 1 added, 0 replaced, 2 kept')
    expect(done).toHaveTextContent('Visits: 2 added, 0 replaced, 10 kept')
    expect(done).toHaveTextContent('Deployments: 1 restored, 1 left as they were (R0001-DONA_01)')
  })

  it('replaces what is there only when the switch is on', async () => {
    mocked.backupPickFile.mockResolvedValue({ path: '/backups/b.zip' })
    mocked.backupRead.mockResolvedValue(READ)
    mocked.backupRestore.mockResolvedValue(undefined)
    render(<BackupPage onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Restore a backup' }))
    await userEvent.click(screen.getByRole('button', { name: 'Choose the backup…' }))
    await userEvent.click(await screen.findByRole('switch', { name: 'Replace what is already here' }))
    expect(screen.getByText(/What is archived stays archived/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(mocked.backupRestore).toHaveBeenCalled())
    expect(mocked.backupRestore.mock.calls[0][0].replace).toBe(true)
  })

  it('says why a file is not a backup', async () => {
    mocked.backupPickFile.mockResolvedValue({ path: '/x.zip' })
    mocked.backupRead.mockRejectedValue(new Error('That .zip is not a backup of this app: it has no manifest.'))
    render(<BackupPage onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Restore a backup' }))
    await userEvent.click(screen.getByRole('button', { name: 'Choose the backup…' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('has no manifest')
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument()
  })
})
