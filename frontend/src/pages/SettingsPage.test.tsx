import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import SettingsPage from './SettingsPage'
import { APP_SETTINGS } from '../test/fixtures'
import { EMPTY_RESEARCH_PROJECT } from '../types'
import type { Camera, SdCard } from '../types'

vi.mock('../api', () => ({
  api: {
    listResearchProjects: vi.fn(), saveResearchProject: vi.fn(), updateResearchProject: vi.fn(), deleteResearchProject: vi.fn(), listLocalLocations: vi.fn(), listVisits: vi.fn(), deleteLocalLocation: vi.fn(), saveLocalLocation: vi.fn(), updateLocalLocation: vi.fn(), trapperResearchProjects: vi.fn(), trapperLocations: vi.fn(),
    getSettings: vi.fn(), saveSettings: vi.fn(), clearLog: vi.fn(), browseFolder: vi.fn(), trapperTestConnection: vi.fn(), epicollectTestConnection: vi.fn(),
    checkVersion: vi.fn(), checkForUpdate: vi.fn(), listReports: vi.fn(), deleteReport: vi.fn(), getReport: vi.fn(), reportUrl: (id: string, format: string) => `/api/reports/${id}/download?format=${format}`, configs: vi.fn(), addConfig: vi.fn(), activateConfig: vi.fn(), openConfigFolder: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.getSettings.mockResolvedValue(APP_SETTINGS)
  mockedApi.listResearchProjects.mockResolvedValue({ results: [DONA] })
  mockedApi.listLocalLocations.mockResolvedValue({ results: [] })
  mockedApi.saveSettings.mockImplementation(async (update) => ({
    GENERAL: { ...APP_SETTINGS.GENERAL, ...update.GENERAL },
    TRAPPER: { ...APP_SETTINGS.TRAPPER, enabled: update.TRAPPER.enabled, base_url: update.TRAPPER.base_url, user_name: update.TRAPPER.user_name, has_password: APP_SETTINGS.TRAPPER.has_password || !!update.TRAPPER.user_password },
    AGOUTI: { enabled: update.AGOUTI.enabled, base_url: update.AGOUTI.base_url, has_api_key: APP_SETTINGS.AGOUTI.has_api_key || !!update.AGOUTI.api_key, project_id: update.AGOUTI.project_id },
    EPICOLLECTCSV: update.EPICOLLECTCSV,
    EPICOLLECT5: { enabled: update.EPICOLLECT5.enabled, unmapped_to_comments: update.EPICOLLECT5.unmapped_to_comments, project_slug: update.EPICOLLECT5.project_slug, client_id: update.EPICOLLECT5.client_id, has_secret: APP_SETTINGS.EPICOLLECT5.has_secret || !!update.EPICOLLECT5.client_secret, mapping: update.EPICOLLECT5.mapping },
    DATA: { dir: update.DATA.dir ?? APP_SETTINGS.DATA.dir, collections_dir: update.DATA.collections_dir, reports_dir: update.DATA.reports_dir, packages_dir: update.DATA.packages_dir,
      default_collections_dir: APP_SETTINGS.DATA.default_collections_dir, default_reports_dir: APP_SETTINGS.DATA.default_reports_dir, default_packages_dir: APP_SETTINGS.DATA.default_packages_dir },
    VALIDATION: update.VALIDATION,
    POSTVALIDATION: update.POSTVALIDATION,
    PREPROCESSING: update.PREPROCESSING,
    FIELDWORK: update.FIELDWORK,
    FIELDLOG: update.FIELDLOG,
  }))
})

const section = (name: string) => userEvent.click(screen.getByRole('button', { name }))
// The entities are one section with a tab for each; the SD cards, the cameras and the locations are those of a research project.
const entity = async (tab: string) => { await section('Entities'); await userEvent.click(screen.getByRole('tab', { name: tab })) }
const pickProject = async (option = 'DONA — Doñana') => {
  await userEvent.click(await screen.findByLabelText('Research project'))
  await userEvent.click(await screen.findByRole('option', { name: option }))
}
const DONA = { ...EMPTY_RESEARCH_PROJECT, name: 'Doñana', acronym: 'DONA', trapper_pk: 2 }
/** Opens the settings of a check, behind its gear. */
const gear = (check: RegExp) => userEvent.click(screen.getByRole('button', { name: new RegExp(`^Configure .*${check.source}`) }))
const settingsOf = (check: RegExp) => within(screen.getByRole('group', { name: new RegExp(`${check.source}.* settings$`) }))

describe('SettingsPage', () => {
  it('shows one section at a time, from the sidebar: General, Trapper, Validation and Postvalidation', async () => {
    render(<SettingsPage onClose={vi.fn()} />)
    expect(await screen.findByRole('radio', { name: /Normal/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'page')

    await section('Uploader')
    expect(screen.getByLabelText('Web address')).toHaveValue('https://trapper.example.org')
    expect(screen.getByLabelText('Username')).toHaveValue('alice')
    expect(screen.getByText('Saved')).toBeInTheDocument() // a saved password is shown as kept, never its value
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.getByText(/the saved password is kept private/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Level')).not.toBeInTheDocument()

    await section('Validation')
    expect(screen.getByRole('switch', { name: /Corrupted images/ })).toBeChecked()
    await section('Postvalidation')
    await gear(/Image dates fit the deployment/)
    expect(screen.getByLabelText('Tolerance')).toHaveValue('1')
  })

  it('closes with Back', async () => {
    const onClose = vi.fn()
    render(<SettingsPage onClose={onClose} />)
    await screen.findByLabelText('Level')

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(onClose).toHaveBeenCalled()
  })

  describe('General', () => {
    it('shows the data folder — by default a folder named like the app in the documents folder — and what goes in it', async () => {
      render(<SettingsPage onClose={vi.fn()} />)

      expect(await screen.findByLabelText('Folder')).toHaveValue('/home/me/Documents/wildintel-uploader')
      expect(screen.getByText('Data folder')).toBeInTheDocument()
      expect(screen.getByText(/the collections, the reports and the packages. Each one has its own folder inside it/)).toBeInTheDocument()
    })

    it('changes the data folder by typing it, or with the native folder browser', async () => {
      mockedApi.browseFolder.mockResolvedValue({ path: '/data/images' })
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Folder')

      await userEvent.click(screen.getByRole('button', { name: 'Browse for the data folder' }))
      await waitFor(() => expect(screen.getByLabelText('Folder')).toHaveValue('/data/images'))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].DATA).toEqual({ dir: '/data/images', collections_dir: null, reports_dir: null, packages_dir: null })
    })

    it('goes back to the default with a blank folder', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Folder')

      await userEvent.click(screen.getByRole('button', { name: 'Use the default data folder' }))
      expect(screen.getByLabelText('Folder')).toHaveValue('')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].DATA).toEqual({ dir: null, collections_dir: null, reports_dir: null, packages_dir: null })
    })

    it('refuses a folder that is not an absolute path', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      const folder = await screen.findByLabelText('Folder')

      await userEvent.clear(folder)
      await userEvent.type(folder, 'images/here')

      expect(screen.getByText('An absolute path (or one starting with ~).')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(screen.getByTitle('Has an invalid value')).toBeInTheDocument()

      for (const good of ['/data/images', '~/images', 'C:\\Users\\me\\images', '\\\\server\\share\\images']) {
        await userEvent.clear(folder)
        await userEvent.paste(good)
        expect(screen.getByRole('button', { name: 'Save' }), good).toBeEnabled()
      }
    })

  it('has, in General, the option to show the welcome page — on by default — and saves it turned off', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      expect(screen.getByRole('switch', { name: 'Welcome page' })).toBeChecked()

      await userEvent.click(screen.getByRole('switch', { name: 'Welcome page' }))
      expect(screen.getByRole('switch', { name: 'Welcome page' })).not.toBeChecked()
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(mockedApi.saveSettings.mock.calls[0][0].GENERAL.show_welcome).toBe(false)
    })

  it('sets the log level, and shows where the log file is', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      expect(screen.getByText(APP_SETTINGS.GENERAL.log_file)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /download log/i })).toHaveAttribute('href', '/api/settings/log')

      await userEvent.click(screen.getByRole('radio', { name: /Everything/ }))
      expect(screen.getByRole('radio', { name: /Everything/ })).toHaveAttribute('aria-checked', 'true')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].GENERAL).toEqual({ log_level: 'DEBUG', workers: 4, default_research_project: null, show_welcome: true })
    })

    it('says when the environment overrides the log level', async () => {
      mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, GENERAL: { ...APP_SETTINGS.GENERAL, log_level_override: 'DEBUG' } })
      render(<SettingsPage onClose={vi.fn()} />)

      expect(await screen.findByText(/WILDINTEL_UPLOADER_WEB_LOG_LEVEL/)).toBeInTheDocument()
    })

    it('clears the log only once confirmed', async () => {
      mockedApi.clearLog.mockResolvedValue({ deleted: 2 })
      render(<SettingsPage onClose={vi.fn()} />)
      await userEvent.click(await screen.findByRole('button', { name: 'Clear log' }))
      expect(mockedApi.clearLog).not.toHaveBeenCalled()
      expect(screen.getByText(/can.t be undone/)).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByText(/can.t be undone/)).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Clear log' }))
      await userEvent.click(screen.getByRole('button', { name: /yes, clear it/i }))

      expect(mockedApi.clearLog).toHaveBeenCalledTimes(1)
      expect(await screen.findByText(/log cleared/i)).toBeInTheDocument()
    })
  })

  describe('Trapper', () => {
    it('is set up in the Uploader section, on the tab of the platform', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      expect(screen.queryByRole('button', { name: 'Trapper' })).not.toBeInTheDocument() // Trapper is not a section of its own
      await section('Uploader')

      expect(screen.getByRole('heading', { name: 'Uploader' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Trapper' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByLabelText('Web address')).toBeInTheDocument()
    })

    it('saves the server and the account, a blank password keeping the saved one', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Uploader')

      await userEvent.clear(screen.getByLabelText('Username'))
      await userEvent.type(screen.getByLabelText('Username'), 'bob')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].TRAPPER).toEqual({ enabled: true, base_url: 'https://trapper.example.org', user_name: 'bob', user_password: '', max_zip_mb: 500 })
      expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
    })

    it('sets the largest zip an upload makes, from 1 to 5000 MB', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Uploader')
      const field = screen.getByLabelText('Largest package')
      expect(field).toHaveValue('500')

      await userEvent.clear(field)
      await userEvent.type(field, '5001')
      expect(screen.getByText('A whole number from 1 to 5000.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

      await userEvent.clear(field)
      await userEvent.type(field, '250')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(mockedApi.saveSettings.mock.calls[0][0].TRAPPER.max_zip_mb).toBe(250)
    })

    it('never keeps the password in the form once saved', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Uploader')
      await userEvent.click(screen.getByRole('button', { name: 'Change' }))
      await userEvent.type(screen.getByLabelText('Password'), 'new-secret')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].TRAPPER.user_password).toBe('new-secret')
      await screen.findByText('Settings saved.')
      expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
      expect(screen.getByText('Saved')).toBeInTheDocument()
    })

    it('says there is no password saved yet', async () => {
      mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, TRAPPER: { enabled: true, base_url: null, user_name: null, has_password: false, max_zip_mb: 500 } })
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Uploader')

      expect(screen.getByText(/no password saved yet/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled() // nothing to connect with
    })

    it('tests the connection with what is typed, a blank password using the saved one', async () => {
      mockedApi.trapperTestConnection.mockResolvedValue({ ok: true, research_projects_count: 3 })
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Uploader')

      await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))

      expect(mockedApi.trapperTestConnection).toHaveBeenCalledWith({ url: 'https://trapper.example.org', username: 'alice', password: '' })
      expect(await screen.findByText('Connected as alice. 3 research projects available.')).toBeInTheDocument()
      expect(screen.getByText('Connected')).toBeInTheDocument() // beside the title too
    })

    it('says why the connection failed', async () => {
      mockedApi.trapperTestConnection.mockRejectedValue(new Error('Invalid credentials'))
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Uploader')
      await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))

      expect(await screen.findByText('Invalid credentials')).toBeInTheDocument()
    })
  })

  describe('Epicollect5 connection', () => {
    it('is set up in the Visit sources section, on the tab of the source: the WildINTEL Epicollect CSV first, then the connection to Epicollect5', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      expect(screen.queryByRole('button', { name: 'Epicollect' })).not.toBeInTheDocument() // Epicollect5 is not a section of its own
      expect(screen.queryByRole('button', { name: 'Field records' })).not.toBeInTheDocument() // nor are the field records
      await section('Visit sources')

      expect(screen.getByRole('heading', { name: 'Visit sources' })).toBeInTheDocument()
      expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['WildINTEL Epicollect CSV', 'Custom CSV', 'Epicollect'])
      expect(screen.getByRole('tab', { name: 'WildINTEL Epicollect CSV' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByText(/a visit happened when its entry was created/)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('tab', { name: 'Epicollect' }))
      expect(screen.getByRole('switch', { name: 'Use Epicollect' })).toBeInTheDocument()
    })

    it('is opened on Epicollect5 when a page asks for the Epicollect5 settings', async () => {
      render(<SettingsPage onClose={vi.fn()} initialSection="epicollect" />)

      expect(await screen.findByRole('tab', { name: 'Epicollect' })).toHaveAttribute('aria-selected', 'true')
    })

    it('tests the project with what is typed, and says what it found', async () => {
      mockedApi.epicollectTestConnection.mockResolvedValue({ ok: true, project: 'Doñana cameras', slug: 'donana', forms: 1, inputs: 5 })
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Visit sources'); await userEvent.click(screen.getByRole('tab', { name: 'Epicollect' }))
      await userEvent.type(screen.getByLabelText('Project name in its web address'), 'donana')
      await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))

      expect(mockedApi.epicollectTestConnection).toHaveBeenCalledWith({ project_slug: 'donana', client_id: '', client_secret: '' })
      expect(await screen.findByText('Connected — Doñana cameras: 5 input(s) in 1 form(s).')).toBeInTheDocument()
    })

    it('needs a project, and says why it failed', async () => {
      mockedApi.epicollectTestConnection.mockRejectedValue(new Error('Epicollect5 refused the client id and secret.'))
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Visit sources'); await userEvent.click(screen.getByRole('tab', { name: 'Epicollect' }))
      expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled()

      await userEvent.type(screen.getByLabelText('Project name in its web address'), 'donana')
      await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
      expect(await screen.findByText('Epicollect5 refused the client id and secret.')).toBeInTheDocument()
    })
  })

  describe('About the app', () => {
    it('shows the name and the version of the app, and the places to go for help', async () => {
      mockedApi.checkVersion.mockResolvedValue({ current: '0.1.0' })
      render(<SettingsPage onClose={vi.fn()} />)

      const about = within(await screen.findByRole('group', { name: 'About the app' }))
      expect(about.getByText('WildINTEL Uploader')).toBeInTheDocument()
      expect(await about.findByLabelText('Version')).toHaveTextContent('0.1.0')
      expect(about.getByRole('button', { name: 'Check for updates' })).toBeInTheDocument()
      expect(about.getByRole('link', { name: /Documentation/ })).toHaveAttribute('href', 'https://wildintelproject.github.io/wildintel-uploader/')
      expect(about.getByRole('link', { name: /^GitHub/ })).toHaveAttribute('href', 'https://github.com/wildintelproject/wildintel-uploader')
      expect(about.getByRole('link', { name: /What’s new/ })).toHaveAttribute('href', 'https://github.com/wildintelproject/wildintel-uploader/releases')
    })

    it('opens a GitHub issue that already says the version', async () => {
      mockedApi.checkVersion.mockResolvedValue({ current: '0.1.0' })
      render(<SettingsPage onClose={vi.fn()} />)

      const link = await screen.findByRole('link', { name: /Report a problem/ })
      await screen.findByLabelText('Version')
      const href = link.getAttribute('href') ?? ''
      expect(href.startsWith('https://github.com/wildintelproject/wildintel-uploader/issues/new?body=')).toBe(true)
      await waitFor(() => expect(decodeURIComponent(screen.getByRole('link', { name: /Report a problem/ }).getAttribute('href') ?? '')).toContain('**Version:** 0.1.0'))
    })

    it('says it is a development build instead of a version', async () => {
      mockedApi.checkVersion.mockResolvedValue({ current: 'dev' })
      render(<SettingsPage onClose={vi.fn()} />)

      expect(await screen.findByLabelText('Version')).toHaveTextContent('Development build')
    })
  })

  describe('Collections folder', () => {
    it('is blank by default, showing where the collections go, and is saved when typed', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      const box = await screen.findByLabelText('Collections folder')
      expect(box).toHaveValue('')
      expect(box).toHaveAttribute('placeholder', '/home/me/Documents/wildintel-uploader/collections')

      await userEvent.type(box, '/mnt/disk/collections')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(mockedApi.saveSettings).toHaveBeenCalled())
      expect(mockedApi.saveSettings.mock.calls[0][0].DATA).toEqual({ dir: '/home/me/Documents/wildintel-uploader', collections_dir: '/mnt/disk/collections', reports_dir: null, packages_dir: null })
    })

    it.each([['Reports folder', 'reports_dir', '/mnt/disk/reports', '/home/me/Documents/wildintel-uploader/reports'], ['Packages folder', 'packages_dir', '/mnt/disk/packages', '/home/me/Documents/wildintel-uploader/packages']] as const)(
      'has a %s beside it, blank by default and saved when typed', async (label, key, typed, placeholder) => {
        render(<SettingsPage onClose={vi.fn()} />)
        const box = await screen.findByLabelText(label)
        expect(box).toHaveValue('')
        expect(box).toHaveAttribute('placeholder', placeholder)

        await userEvent.type(box, typed)
        await userEvent.click(screen.getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(mockedApi.saveSettings).toHaveBeenCalled())
        expect(mockedApi.saveSettings.mock.calls[0][0].DATA[key]).toBe(typed)
      })

    it('has no folder for the sessions nor the logs: they live in the state folder', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Collections folder')
      expect(screen.queryByLabelText('Sessions folder')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Logs folder')).not.toBeInTheDocument()
    })

    it('must be an absolute path', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await userEvent.type(await screen.findByLabelText('Collections folder'), 'relative/collections')

      expect(screen.getByText('An absolute path (or one starting with ~).')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    })
  })

  describe('Epicollect5 switches', () => {
    it('turns the use of Epicollect5 and the unmapped answers into comments on, and saves them', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Visit sources'); await userEvent.click(screen.getByRole('tab', { name: 'Epicollect' }))
      const use = screen.getByRole('switch', { name: 'Use Epicollect' })
      const unmapped = screen.getByRole('switch', { name: /^Add answers with no place to go/ })
      expect(use).toHaveAttribute('aria-checked', 'false')
      expect(unmapped).toHaveAttribute('aria-checked', 'false')

      await userEvent.click(use)
      await userEvent.click(unmapped)
      await userEvent.click(screen.getByRole('button', { name: /^Save/ }))

      await waitFor(() => expect(mockedApi.saveSettings).toHaveBeenCalled())
      expect(mockedApi.saveSettings.mock.calls[0][0].EPICOLLECT5).toMatchObject({ enabled: true, unmapped_to_comments: true })
    })
  })

  describe('Parallel work', () => {
    it('shows how many images are worked on at once, and the CPUs of the machine', async () => {
      render(<SettingsPage onClose={vi.fn()} />)

      expect(await screen.findByLabelText('Images at once')).toHaveValue('4')
      expect(screen.getByText(/This computer has 8 CPUs/)).toBeInTheDocument()
    })

    it('saves the number of workers', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await userEvent.clear(await screen.findByLabelText('Images at once'))
      await userEvent.type(screen.getByLabelText('Images at once'), '6')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].GENERAL.workers).toBe(6)
    })

    it.each(['0', '65', '2.5', 'abc', ''])('marks %j workers as invalid, and cannot save', async (bad) => {
      render(<SettingsPage onClose={vi.fn()} />)
      await userEvent.clear(await screen.findByLabelText('Images at once'))
      if (bad) await userEvent.type(screen.getByLabelText('Images at once'), bad)

      expect(screen.getByText('A whole number from 1 to 64.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    })
  })

  describe('Validation', () => {
    const IMAGE_CHECKS = [
      'Corrupted images', 'Shooting order vs. filename sequence', 'Folder structure (subdirectories)',
      'Same camera (model and id) on every image', 'Required EXIF fields', 'Duplicate images',
    ]

    it('has one entry per check, each with a switch, all on by default', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Validation')

      for (const label of IMAGE_CHECKS) expect(screen.getByRole('switch', { name: new RegExp(label.replace(/[()]/g, '\\$&')) })).toBeChecked()
      expect(screen.getAllByRole('switch')).toHaveLength(6)
      expect(screen.queryAllByRole('button', { name: /^Configure/ })).toHaveLength(0) // none of them has anything to configure
    })

    it('turns checks off, and saves which are shown', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Validation')

      await userEvent.click(screen.getByRole('switch', { name: /Duplicate images/ }))
      await userEvent.click(screen.getByRole('switch', { name: /Required EXIF fields/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].VALIDATION).toEqual({
        corrupted: true, sequence: true, structure: true, camera: true, exif: false, duplicates: false,
      })
      await screen.findByText('Settings saved.')
      expect(screen.getByRole('switch', { name: /Duplicate images/ })).not.toBeChecked()
    })

    it('turns every check off, or on, at once', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Validation')

      expect(screen.getByText('6 of 6 checks are on')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Turn all off' }))
      for (const label of IMAGE_CHECKS) expect(screen.getByRole('switch', { name: new RegExp(label.replace(/[()]/g, '\\$&')) })).not.toBeChecked()
      await userEvent.click(screen.getByRole('button', { name: 'Turn all on' }))
      expect(screen.getAllByRole('switch').every((el) => el.getAttribute('aria-checked') === 'true')).toBe(true)
    })

    it('says what each check looks at', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Validation')

      expect(screen.getByText('Files with exactly the same content.')).toBeInTheDocument()
      expect(screen.getByText(/Capture date, camera model and camera id on every image/)).toBeInTheDocument()
    })
  })

  describe('Postvalidation', () => {
    const CHECKS = [
      /Deployment id format/, /starts with its collection/, /^Collection name/, /location is the one chosen/, /Image dates fit the deployment/, /Camera consistency/,
      /Number of images is like the previous revisions/, /Number of sequences is like the previous revisions/, /Length of the sequences is like the previous revisions/, /The SD card is the one the visit left/, /The photos are those the visit counted/,
    ]
    const open = async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Postvalidation')
    }

    it('has one entry per check, each with a switch, all on by default', async () => {
      await open()

      expect(screen.getAllByRole('switch')).toHaveLength(11)
      for (const label of CHECKS) expect(screen.getByRole('switch', { name: label })).toBeChecked()
    })

    it('puts a gear only on the checks that have something to configure', async () => {
      await open()

      const gears = screen.getAllByRole('button', { name: /^Configure/ }).map((b) => b.getAttribute('aria-label'))
      expect(gears).toEqual([
        'Configure Image dates fit the deployment', 'Configure Number of images is like the previous revisions',
        'Configure Number of sequences is like the previous revisions', 'Configure Length of the sequences is like the previous revisions',
      ])
      expect(screen.queryByLabelText('Tolerance')).not.toBeInTheDocument() // closed until the gear is pressed
    })

    it('turns every check off, or on, at once', async () => {
      await open()

      await userEvent.click(screen.getByRole('button', { name: 'Turn all off' }))
      expect(screen.getAllByRole('switch').every((el) => el.getAttribute('aria-checked') === 'false')).toBe(true)
      await userEvent.click(screen.getByRole('button', { name: 'Turn all on' }))
      expect(screen.getAllByRole('switch').every((el) => el.getAttribute('aria-checked') === 'true')).toBe(true)
    })

    it('opens and closes a check’s settings with its gear', async () => {
      await open()
      await gear(/Image dates fit the deployment/)

      expect(screen.getByLabelText('Tolerance')).toHaveValue('1')
      expect(screen.getByText(/wildintel-tools uses 1 hour/)).toBeInTheDocument()
      await gear(/Image dates fit the deployment/)
      expect(screen.queryByLabelText('Tolerance')).not.toBeInTheDocument()
    })

    it('turns checks off and changes the tolerance, and saves both', async () => {
      await open()

      await userEvent.click(screen.getByRole('switch', { name: /location is the one chosen/ }))
      await gear(/Image dates fit the deployment/)
      await userEvent.clear(screen.getByLabelText('Tolerance'))
      await userEvent.type(screen.getByLabelText('Tolerance'), '2.5')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].POSTVALIDATION).toEqual({
        deployment_id: true, collection_prefix: true, collection_name: true, location: false, time_range: true, camera: true,
        image_count: true, sequence_count: true, sequence_length: true, sd_card: true, photo_count: true, tolerance_hours: 2.5,
        sequence_gap_seconds: 60, min_revisions: 2, similarity_method: 'median',
        image_count_tolerance: 50, sequence_count_tolerance: 50, sequence_length_tolerance: 50,
      })
    })

    it.each(['', '-1', 'abc', '9000'])('marks the tolerance "%s" as invalid, and its section, and cannot save', async (bad) => {
      await open()
      await gear(/Image dates fit the deployment/)
      await userEvent.clear(screen.getByLabelText('Tolerance'))
      if (bad) await userEvent.type(screen.getByLabelText('Tolerance'), bad)

      expect(screen.getByText('A number from 0 to 8760.')).toBeInTheDocument()
      expect(screen.getByTitle('Has an invalid value')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

      await section('General') // still marked from another section
      expect(screen.getByTitle('Has an invalid value')).toBeInTheDocument()
      expect(screen.getByText(/fix the values marked in red/i)).toBeInTheDocument()
      await section('Postvalidation') // and the wrong settings are open, not hidden behind their gear
      expect(screen.getByLabelText('Tolerance')).toBeInTheDocument()
    })

    describe('the statistical checks', () => {
      const IMAGES = /Number of images/
      const SEQUENCES = /Number of sequences/
      const LENGTH = /Length of the sequences/

      it('say what a sequence is and what is similar, with the defaults', async () => {
        await open()
        await gear(IMAGES); await gear(SEQUENCES); await gear(LENGTH)

        expect(settingsOf(IMAGES).queryByLabelText('Sequence gap')).not.toBeInTheDocument() // counting images needs no sequences
        for (const check of [SEQUENCES, LENGTH]) expect(settingsOf(check).getByLabelText('Sequence gap')).toHaveValue('60')
        for (const check of [IMAGES, SEQUENCES, LENGTH]) {
          expect(settingsOf(check).getByLabelText('Compared with')).toHaveValue('median')
          expect(settingsOf(check).getByLabelText('Previous revisions needed')).toHaveValue('2')
        }
        expect(settingsOf(IMAGES).getByLabelText('Images — similar within')).toHaveValue('50')
        expect(settingsOf(SEQUENCES).getByLabelText('Sequences — similar within')).toHaveValue('50')
        expect(settingsOf(LENGTH).getByLabelText('Sequence length — similar within')).toHaveValue('50')
        expect(screen.getAllByText(/A new sequence starts when the gap to the previous image is at least the sequence gap/)).toHaveLength(2)
      })

      it('offer the four ways to compare', async () => {
        await open()
        await gear(IMAGES)

        const options = Array.from(settingsOf(IMAGES).getByLabelText('Compared with').querySelectorAll('option')).map((o) => [o.value, o.textContent])
        expect(options).toEqual([
          ['median', 'The median of the previous revisions'], ['mean', 'The mean of the previous revisions'],
          ['last', 'The last previous revision'], ['range', 'The range the previous revisions span'],
        ])
      })

      it('share the way of comparing, the revisions needed and the sequence gap', async () => {
        await open()
        await gear(SEQUENCES); await gear(LENGTH)
        await userEvent.selectOptions(settingsOf(SEQUENCES).getByLabelText('Compared with'), 'mean')
        await userEvent.clear(settingsOf(LENGTH).getByLabelText('Sequence gap'))
        await userEvent.type(settingsOf(LENGTH).getByLabelText('Sequence gap'), '120')

        expect(settingsOf(LENGTH).getByLabelText('Compared with')).toHaveValue('mean')
        expect(settingsOf(SEQUENCES).getByLabelText('Sequence gap')).toHaveValue('120')
      })

      it('are turned off like the other checks, and save their parameters', async () => {
        await open()
        await userEvent.click(screen.getByRole('switch', { name: SEQUENCES }))
        await gear(IMAGES); await gear(SEQUENCES); await gear(LENGTH)
        const type = async (check: RegExp, label: string, value: string) => {
          await userEvent.clear(settingsOf(check).getByLabelText(label))
          await userEvent.type(settingsOf(check).getByLabelText(label), value)
        }
        await type(SEQUENCES, 'Sequence gap', '90.5')
        await type(IMAGES, 'Previous revisions needed', '3')
        await userEvent.selectOptions(settingsOf(IMAGES).getByLabelText('Compared with'), 'range')
        await type(IMAGES, 'Images — similar within', '20')
        await type(SEQUENCES, 'Sequences — similar within', '35.5')
        await type(LENGTH, 'Sequence length — similar within', '0')
        await userEvent.click(screen.getByRole('button', { name: 'Save' }))

        expect(mockedApi.saveSettings.mock.calls[0][0].POSTVALIDATION).toEqual(expect.objectContaining({
          sequence_count: false, image_count: true, sequence_length: true,
          sequence_gap_seconds: 90.5, min_revisions: 3, similarity_method: 'range',
          image_count_tolerance: 20, sequence_count_tolerance: 35.5, sequence_length_tolerance: 0,
        }))
      })

      it.each([
        [IMAGES, 'Previous revisions needed', ['0', '51', '2.5', ''], 'A whole number from 1 to 50.'],
        [SEQUENCES, 'Sequence gap', ['0', '-1', '86401', 'abc', ''], 'A number from 0.001 to 86400.'],
        [IMAGES, 'Images — similar within', ['-1', '1001', ''], 'A number from 0 to 1000.'],
        [SEQUENCES, 'Sequences — similar within', ['-1', '1001', ''], 'A number from 0 to 1000.'],
        [LENGTH, 'Sequence length — similar within', ['-1', '1001', ''], 'A number from 0 to 1000.'],
      ])('mark an invalid %s, and its section, and cannot save', async (check, label, bads, message) => {
        await open()
        await gear(check)
        for (const bad of bads) {
          await userEvent.clear(settingsOf(check).getByLabelText(label))
          if (bad) await userEvent.type(settingsOf(check).getByLabelText(label), bad)
          expect(screen.getAllByText(message).length, `"${bad}"`).toBeGreaterThan(0) // a shared value shows its error in each check using it
          expect(screen.getByTitle('Has an invalid value')).toBeInTheDocument()
          expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
        }
      })
    })

    it('accepts a tolerance of zero', async () => {
      await open()
      await gear(/Image dates fit the deployment/)
      await userEvent.clear(screen.getByLabelText('Tolerance'))
      await userEvent.type(screen.getByLabelText('Tolerance'), '0')

      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    })
  })

  describe('Preprocessing', () => {
    it('is a section of its own, with the steps, the width, the authorship, the license and the dates', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Preprocessing')

      expect(screen.getByRole('button', { name: 'Preprocessing' })).toHaveAttribute('aria-current', 'page')
      for (const name of [/Rename the images/, /Resize the images/, /Add metadata/, /Ignore summer time/, /Convert the dates to UTC/]) {
        expect(screen.getByRole('checkbox', { name })).toBeChecked()
      }
      expect(screen.getByLabelText('Width')).toHaveValue('2400')
      expect(screen.getByLabelText('Owner')).toHaveValue('')
      expect(screen.getByLabelText('Publisher')).toHaveValue('')
      expect(screen.getByLabelText('Coverage')).toHaveValue('')
      expect(screen.getByLabelText('License')).toHaveValue('https://creativecommons.org/licenses/by-nc/4.0/')
      expect(screen.getByText(/wildintel-tools used 2400 pixels/)).toBeInTheDocument()
      expect(screen.getByText(/wildintel-tools used CC BY-NC 4.0/)).toBeInTheDocument()
    })

    it('saves the steps, the width, the authorship, the license and the dates', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Preprocessing')

      await userEvent.click(screen.getByRole('checkbox', { name: /Rename the images/ }))
      await userEvent.click(screen.getByRole('checkbox', { name: /Ignore summer time/ }))
      await userEvent.clear(screen.getByLabelText('Width'))
      await userEvent.type(screen.getByLabelText('Width'), '1600')
      await userEvent.type(screen.getByLabelText('Owner'), '  Universidad de Huelva ')
      await userEvent.type(screen.getByLabelText('Publisher'), 'WildINTEL')
      await userEvent.type(screen.getByLabelText('Coverage'), 'Doñana National Park')
      await userEvent.selectOptions(screen.getByLabelText('License'), 'CC BY')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].PREPROCESSING).toEqual({
        rename: false, resize: true, resize_width: 1600, metadata: true, owner: 'Universidad de Huelva', publisher: 'WildINTEL',
        coverage: 'Doñana National Park', license_url: 'https://creativecommons.org/licenses/by/4.0/', ignore_dst: false, convert_to_utc: true,
      })
      expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
    })

    describe('the open lists of institutions and areas', () => {
      const options = (container: HTMLElement, id: string) => Array.from(container.querySelectorAll(`datalist#${id} option`)).map((o) => (o as HTMLOptionElement).value)

      async function open() {
        const view = render(<SettingsPage onClose={vi.fn()} />)
        await screen.findByLabelText('Level')
        await section('Preprocessing')
        return view
      }

      it('suggest the institutions wildintel-publisher knows for the owner and the publisher, WildINTEL included', async () => {
        const { container } = await open()

        expect(screen.getByLabelText('Owner')).toHaveAttribute('list', 'entity-options')
        expect(screen.getByLabelText('Publisher')).toHaveAttribute('list', 'entity-options') // the same entities can be either
        expect(options(container, 'entity-options')).toEqual([
          'WildINTEL', 'Institute of Nature Conservation PAS', 'University of Huelva', 'University of South-Eastern Norway',
          'German Centre for Integrative Biodiversity Research', 'Spanish National Research Council', 'Massachusetts Institute of Technology',
          'Spanish Node of the Global Biodiversity Information Facility',
        ])
      })

      it('suggest the national parks for the coverage', async () => {
        const { container } = await open()

        expect(screen.getByLabelText('Coverage')).toHaveAttribute('list', 'coverage-options')
        expect(options(container, 'coverage-options')).toEqual([
          'Doñana National Park', 'Tatra National Park', 'Hardangervidda National Park', 'Lower Oder Valley National Park',
        ])
      })

      it('are open: a suggestion can be picked, and so can anything else typed', async () => {
        await open()

        for (const [label, value] of [['Owner', 'University of Huelva'], ['Publisher', 'A Local Wildlife Trust'], ['Coverage', 'Sierra de Cazorla']]) {
          await userEvent.clear(screen.getByLabelText(label))
          await userEvent.paste(value)
        }
        await userEvent.click(screen.getByRole('button', { name: 'Save' }))

        expect(mockedApi.saveSettings.mock.calls[0][0].PREPROCESSING).toEqual(expect.objectContaining({
          owner: 'University of Huelva', publisher: 'A Local Wildlife Trust', coverage: 'Sierra de Cazorla',
        }))
      })

      it('say they are open', async () => {
        await open()

        expect(screen.getByText(/the fields are open: type any other name/)).toBeInTheDocument()
        expect(screen.getByLabelText('Owner')).toHaveAttribute('placeholder', 'Pick an institution, or type any name')
        expect(screen.getByLabelText('Coverage')).toHaveAttribute('placeholder', 'Pick an area, or type any place')
      })

      it('never limit what is saved to the suggestions', async () => {
        await open()
        await userEvent.type(screen.getByLabelText('Owner'), 'Universidad')  // part of a suggestion, not one
        await userEvent.click(screen.getByRole('button', { name: 'Save' }))

        expect(mockedApi.saveSettings.mock.calls[0][0].PREPROCESSING.owner).toBe('Universidad')
      })
    })

    it.each(['', '99', '20001', 'abc', '2400.5'])('marks the width "%s" as invalid, and its section, and cannot save', async (bad) => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Preprocessing')
      await userEvent.clear(screen.getByLabelText('Width'))
      if (bad) await userEvent.type(screen.getByLabelText('Width'), bad)

      expect(screen.getByText('A whole number from 100 to 20000.')).toBeInTheDocument()
      expect(screen.getByTitle('Has an invalid value')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    })

    it('says a blank owner or publisher is written as Unknown, and a blank coverage falls back to the location', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Preprocessing')

      expect(screen.getByText(/blank owner or publisher is written as “Unknown”/)).toBeInTheDocument()
      expect(screen.getByText(/Left blank, the deployment.s location is used/)).toBeInTheDocument()
    })
  })

  it('saves every section at once', async () => {
    render(<SettingsPage onClose={vi.fn()} />)
    await screen.findByLabelText('Level')
    await userEvent.click(screen.getByRole('radio', { name: /Warnings/ }))
    await section('Uploader')
    await userEvent.clear(screen.getByLabelText('Web address'))
    await userEvent.type(screen.getByLabelText('Web address'), 'https://other.example.org')
    await section('Validation')
    await userEvent.click(screen.getByRole('switch', { name: /Duplicate images/ }))
    await section('Postvalidation')
    await userEvent.click(screen.getByRole('switch', { name: /Camera consistency/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockedApi.saveSettings).toHaveBeenCalledTimes(1)
    const update = mockedApi.saveSettings.mock.calls[0][0]
    expect(update.GENERAL).toEqual({ log_level: 'WARNING', workers: 4, default_research_project: null, show_welcome: true })
    expect(update.TRAPPER.base_url).toBe('https://other.example.org')
    expect(update.VALIDATION.duplicates).toBe(false)
    expect(update.POSTVALIDATION.camera).toBe(false)
  })

  it('shows the error when the settings cannot be saved', async () => {
    mockedApi.saveSettings.mockRejectedValue(new Error('DATA.dir: must be an absolute path'))
    render(<SettingsPage onClose={vi.fn()} />)
    await screen.findByLabelText('Level')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('DATA.dir: must be an absolute path')).toBeInTheDocument()
  })

  it('shows the error when the settings cannot be loaded', async () => {
    mockedApi.getSettings.mockRejectedValue(new Error('Backend not reachable'))
    render(<SettingsPage onClose={vi.fn()} />)

    expect(await screen.findByText('Backend not reachable')).toBeInTheDocument()
  })

  describe('Trappers', () => {
    const ANA = { username: 'ana', name: 'Ana Pérez', affiliation: 'University of Huelva', email: 'ana@uhu.es', status: 'active' as const }
    const LUIS = { username: 'luis', name: 'Luis', affiliation: null, email: null, status: 'active' as const }

    async function open(trappers: { username: string; name: string; affiliation: string | null; email?: string | null }[] = []) {
      mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, FIELDWORK: { ...APP_SETTINGS.FIELDWORK, trappers } })
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await entity('Trappers')
    }

    it('lists the trappers saved as cards: the username is the title, and the full name and where they work are under it', async () => {
      await open([ANA, LUIS])

      expect(screen.getByText('ana')).toBeInTheDocument()
      expect(screen.getByText('Ana Pérez · University of Huelva')).toBeInTheDocument()
      expect(screen.getByText('luis')).toBeInTheDocument()
      expect(screen.getByText('Luis')).toBeInTheDocument()
      expect(screen.queryByText('No affiliation')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Edit ana' })).toBeInTheDocument()
    })

    it('says when there are none yet', async () => {
      await open()

      expect(screen.getByText(/No trapper yet/)).toBeInTheDocument()
    })

    it('adds a trapper with +, names it in the window that opens, and saves it with the rest of the settings', async () => {
      await open([ANA])

      await userEvent.click(screen.getByRole('button', { name: 'Add trapper' }))
      const dialog = within(screen.getByRole('region', { name: 'Trapper' }))
      expect(dialog.getByRole('button', { name: 'Add' })).toBeDisabled()                         // the username and the full name are required
      await userEvent.type(dialog.getByLabelText('Username'), 'luis.gomez')
      await userEvent.type(dialog.getByLabelText('Full name'), 'Luis Gómez')
      await userEvent.type(dialog.getByLabelText('Affiliation'), 'CSIC')
      await userEvent.type(dialog.getByLabelText('Email'), 'luis@csic.es')
      await userEvent.click(dialog.getByRole('button', { name: 'Add' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].FIELDWORK.trappers).toEqual([ANA, { username: 'luis.gomez', name: 'Luis Gómez', affiliation: 'CSIC', email: 'luis@csic.es', status: 'active' }])
    })

    it('does not let a username have spaces or an email be one that is not', async () => {
      await open([ANA])

      await userEvent.click(screen.getByRole('button', { name: 'Add trapper' }))
      const dialog = within(screen.getByRole('region', { name: 'Trapper' }))
      await userEvent.type(dialog.getByLabelText('Username'), 'luis gomez')
      expect(dialog.getByText('Required, with no spaces.')).toBeInTheDocument()
      await userEvent.type(dialog.getByLabelText('Full name'), 'Luis Gómez')
      await userEvent.type(dialog.getByLabelText('Email'), 'luis')
      expect(dialog.getByText('Not an email address.')).toBeInTheDocument()
      expect(dialog.getByRole('button', { name: 'Add' })).toBeDisabled()
    })

    it('imports trappers from a CSV file — the new ones are added, one with the same username is updated, one with no username or no full name is left out — and saves them with the rest', async () => {
      await open([ANA])

      const file = new File(['username,name,affiliation,email\nANA,Ana Pérez,CSIC,\nluis,Luis,,luis@x.org\n,nobody,,\nmaria,,,\nmaria lopez,María López,,\n'], 'trappers.csv', { type: 'text/csv' })
      await userEvent.upload(screen.getByLabelText('Import Trappers from a CSV file'), file)

      expect(await screen.findByRole('status')).toHaveTextContent('1 added, 1 updated from the file')
      expect(screen.getByRole('status')).toHaveTextContent('Row 4: no username')
      expect(screen.getByRole('status')).toHaveTextContent('Row 5: no full name')
      expect(screen.getByRole('status')).toHaveTextContent('Row 6: username “maria lopez”')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(mockedApi.saveSettings.mock.calls[0][0].FIELDWORK.trappers).toEqual([
        { username: 'ANA', name: 'Ana Pérez', affiliation: 'CSIC', email: null, status: 'active' }, { username: 'luis', name: 'Luis', affiliation: null, email: 'luis@x.org', status: 'active' },
      ])
    })

    it('has no column for the username in a file: nothing is imported, and it says so', async () => {
      await open([ANA])

      const file = new File(['name,affiliation\nLuis,CSIC\n'], 'trappers.csv', { type: 'text/csv' })
      await userEvent.upload(screen.getByLabelText('Import Trappers from a CSV file'), file)

      expect(await screen.findByRole('status')).toHaveTextContent('The file has no column for the username')
    })

    it('gives a trapper a status picked from cards, with Required on the fields that are', async () => {
      await open([LUIS])

      await userEvent.click(screen.getByRole('button', { name: 'Edit luis' }))
      const page = within(screen.getByRole('region', { name: 'Trapper' }))
      expect(page.getAllByText('Required')).toHaveLength(2)             // the username and the full name
      expect(page.queryByText('Optional')).not.toBeInTheDocument() // only what is required says so
      expect(page.getByRole('radio', { name: /Active/ })).toHaveAttribute('aria-checked', 'true')
      await userEvent.click(page.getByRole('radio', { name: /Inactive/ }))
      await userEvent.click(page.getByRole('button', { name: 'Save changes' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].FIELDWORK.trappers).toEqual([expect.objectContaining({ username: 'luis', name: 'Luis', status: 'inactive' })])
    })

    it('takes the title of the page and the text over the list away while a trapper is added or edited', async () => {
      await open([LUIS])
      expect(screen.getByRole('heading', { name: 'Entities' })).toBeInTheDocument()
      expect(screen.getByText(/The people who go to the field/)).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Add trapper' }))
      expect(screen.queryByRole('heading', { name: 'Entities' })).not.toBeInTheDocument()
      expect(screen.queryByText(/The people who go to the field/)).not.toBeInTheDocument()

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument() // the one of the settings waits until the form is closed
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.getByRole('heading', { name: 'Entities' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    })

    it('exports the trappers to a CSV file, and has nothing to export when there are none', async () => {
      const created: Blob[] = []
      URL.createObjectURL = vi.fn((b: Blob) => { created.push(b); return 'blob:x' })
      URL.revokeObjectURL = vi.fn()
      await open([ANA, LUIS])

      await userEvent.click(screen.getByRole('button', { name: 'More' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Export CSV' }))

      expect(await created[0].text()).toBe('username,name,affiliation,email,status\r\nana,Ana Pérez,University of Huelva,ana@uhu.es,active\r\nluis,Luis,,,active\r\n')
    })

    it('has, in More, a CSV template with the columns that Import CSV reads and no rows — also when there are no trappers', async () => {
      const created: Blob[] = []
      URL.createObjectURL = vi.fn((b: Blob) => { created.push(b); return 'blob:x' })
      URL.revokeObjectURL = vi.fn()
      await open()                                                                       // none: Export CSV is not there to use, the template is

      await userEvent.click(screen.getByRole('button', { name: 'More' }))
      expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Import CSV', 'Export CSV', 'CSV template'])
      await userEvent.click(screen.getByRole('menuitem', { name: 'CSV template' }))

      expect(await created[0].text()).toBe('username,name,affiliation,email,status\r\n')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()                          // the menu shuts
    })

    it('has nothing to export when there are no trappers', async () => {
      await open()

      await userEvent.click(screen.getByRole('button', { name: 'More' }))
      expect(screen.getByRole('menuitem', { name: 'Export CSV' })).toBeDisabled()
    })

    it('edits a trapper with its gear, and removes it from the window', async () => {
      await open([ANA, LUIS])

      await userEvent.click(screen.getByRole('button', { name: 'Edit luis' }))
      await userEvent.type(within(screen.getByRole('region', { name: 'Trapper' })).getByLabelText('Affiliation'), 'IOP PAS')
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      expect(screen.getByText('Luis · IOP PAS')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Edit ana' }))
      await userEvent.click(screen.getByRole('button', { name: 'Delete trapper' }))
      expect(screen.queryByText('Ana Pérez · University of Huelva')).not.toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('does not let a trapper be done without a username or a full name, or with the username of another', async () => {
      await open([ANA, LUIS])

      await userEvent.click(screen.getByRole('button', { name: 'Edit luis' }))
      const name = screen.getByLabelText('Full name')
      await userEvent.clear(name)
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
      await userEvent.type(name, 'Luis')
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()

      const username = screen.getByLabelText('Username')
      await userEvent.clear(username)
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
      await userEvent.type(username, 'ANA')                                                    // the username of another, whatever its case: it is the account
      expect(screen.getByText('ANA is already in the list.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    })
  })

  describe('Roles', () => {
    it('gives a trapper a role of Camtrap DP in a research project, and keeps it', async () => {
      mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, FIELDWORK: { ...APP_SETTINGS.FIELDWORK, trappers: [{ username: 'ana', name: 'Ana Pérez', affiliation: null }] } })
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await entity('Roles')
      await pickProject()

      await userEvent.click(await screen.findByRole('button', { name: 'Add role' }))
      const dialog = within(screen.getByRole('region', { name: 'Role' }))
      await userEvent.click(dialog.getByRole('button', { name: 'Ana Pérez' }))
      expect(dialog.getByRole('button', { name: 'Contributor' })).toHaveAttribute('aria-pressed', 'true')
      await userEvent.click(dialog.getByRole('button', { name: 'Principal investigator' }))
      await userEvent.click(dialog.getByRole('button', { name: 'Add' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].FIELDWORK.roles).toEqual([{ research_project: 'DONA', trapper: 'Ana Pérez', role: 'principalInvestigator' }])
    })

    it('lets a trapper have several roles in a project, but not the same one twice', async () => {
      mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, FIELDWORK: { ...APP_SETTINGS.FIELDWORK, trappers: [{ username: 'ana', name: 'Ana Pérez', affiliation: null }], roles: [{ research_project: 'DONA', trapper: 'Ana Pérez', role: 'contact' }] } })
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await entity('Roles')
      await pickProject()

      await userEvent.click(await screen.findByRole('button', { name: 'Add role' }))
      const dialog = within(screen.getByRole('region', { name: 'Role' }))
      await userEvent.click(dialog.getByRole('button', { name: 'Ana Pérez' }))
      await userEvent.click(dialog.getByRole('button', { name: 'Contact' }))
      expect(dialog.getByText('This one is already in the list.')).toBeInTheDocument()
      expect(dialog.getByRole('button', { name: 'Add' })).toBeDisabled()
      await userEvent.click(dialog.getByRole('button', { name: 'Publisher' }))
      expect(dialog.getByRole('button', { name: 'Add' })).toBeEnabled()
    })
  })

  describe('SD cards', () => {
    const A12: SdCard = { label: 'A12', brand: 'SanDisk', capacity: '64 GB', in_service: '2026-03-01', research_project: 'DONA' }
    const B3: SdCard = { label: 'B3', brand: null, capacity: null, in_service: null, research_project: 'DONA' }

    async function open(sd_cards: SdCard[] = []) {
      mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, FIELDWORK: { ...APP_SETTINGS.FIELDWORK, sd_cards } })
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await entity('SD cards')
      await pickProject()
    }

    it('opens on the page of the research project a link of another page goes to', async () => {
      render(<SettingsPage onClose={vi.fn()} initialSection="projects" initialItem="DONA" />)

      const page = within(await screen.findByRole('region', { name: 'Research project' }))
      expect(page.getByText('This project comes from Trapper')).toBeInTheDocument()   // its page is open, not the list
      expect(page.getByText('Doñana')).toBeInTheDocument()
    })

    it('opens on the page of the card a link of another page goes to', async () => {
      mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, FIELDWORK: { ...APP_SETTINGS.FIELDWORK, sd_cards: [A12, B3] } })
      render(<SettingsPage onClose={vi.fn()} initialSection="sdcards" initialProject="DONA" initialItem="b3" />)

      expect(await screen.findByRole('region', { name: 'SD card' })).toBeInTheDocument()
      expect(screen.getByText('Edit B3')).toBeInTheDocument()
    })

    it('lists the cards with their brand, capacity and the day they were put into production', async () => {
      await open([A12, B3])

      expect(screen.getByText('A12')).toBeInTheDocument()
      expect(screen.getByText('SanDisk · 64 GB')).toBeInTheDocument()
      expect(await screen.findByText('In production since 1 Mar 2026 · No visits yet')).toBeInTheDocument()
    })

    it('says when there are none yet', async () => {
      await open()

      expect(screen.getByText('No SD card yet.')).toBeInTheDocument()
    })

    it('adds a card with its label, a brand picked from the suggestions, its capacity and a day, and saves it', async () => {
      await open()

      await userEvent.click(screen.getByRole('button', { name: 'Add SD card' }))
      const dialog = within(screen.getByRole('region', { name: 'SD card' }))
      await userEvent.clear(dialog.getByLabelText('Label'))
      await userEvent.type(dialog.getByLabelText('Label'), 'C7')
      await userEvent.click(dialog.getByRole('button', { name: 'Kingston' }))
      await userEvent.type(dialog.getByLabelText('Capacity'), '128 GB')
      expect(dialog.queryByLabelText('In production since')).not.toBeInTheDocument() // it is kept as the day it is created
      await userEvent.click(dialog.getByRole('button', { name: 'Add' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].FIELDWORK.sd_cards).toEqual([{ label: 'C7', brand: 'Kingston', capacity: '128 GB', in_service: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), research_project: 'DONA', status: 'ready', status_date: null, status_note: null }])
    })

    it('shows the QR code of an SD card in its page', async () => {
      await open([B3])

      await userEvent.click(screen.getByRole('button', { name: 'Edit B3' }))
      expect(screen.getByRole('img', { name: 'QR code of B3' }).querySelector('svg')).not.toBeNull()
      expect(screen.getByText('wildintel:sdcard:DONA:B3')).toBeInTheDocument()
    })

    it('offers the usual brands to pick, and keeps any other that is typed', async () => {
      await open([B3])

      await userEvent.click(screen.getByRole('button', { name: 'Edit B3' }))
      const brand = screen.getByLabelText('Brand')
      expect(within(screen.getByLabelText('Brand suggestions')).getAllByRole('button').map((o) => o.textContent)).toContain('SanDisk')

      await userEvent.type(brand, 'Acme Storage')
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].FIELDWORK.sd_cards).toEqual([{ ...B3, brand: 'Acme Storage' }])
    })

    it('needs a label, and a different one from the other cards', async () => {
      await open([A12, B3])

      await userEvent.click(screen.getByRole('button', { name: 'Edit B3' }))
      const label = screen.getByLabelText('Label')
      await userEvent.clear(label)
      expect(screen.queryByText('A label is required.')).not.toBeInTheDocument() // the label already says Required
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()

      await userEvent.type(label, 'A12')
      expect(screen.getByText('A12 is already in the list.')).toBeInTheDocument()
      await userEvent.clear(label)
      await userEvent.type(label, 'a12')                                                         // as written: a12 is another card than A12
      expect(screen.queryByText('a12 is already in the list.')).not.toBeInTheDocument()
    })
  })

  describe('Cameras', () => {
    async function open(cameras: Camera[] = []) {
      mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, FIELDWORK: { ...APP_SETTINGS.FIELDWORK, cameras } })
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await entity('Cameras')
      await pickProject()
    }

    it('lists the cameras with their model, and says when there are none', async () => {
      await open([{ label: 'P800HG08192031', camera_id: 'P800HG08192031', camera_model: 'Reconyx-PC800', in_service: '2025-11-12', research_project: 'DONA' }, { label: 'X1', camera_id: 'X1', camera_model: null, in_service: null, research_project: 'DONA' }])

      expect(screen.getByText('Reconyx-PC800 · P800HG08192031')).toBeInTheDocument() // the model and the serial number under the label
      expect(await screen.findByText('In production since 12 Nov 2025 · No visits yet')).toBeInTheDocument()
    })

    it('shows the QR code of a camera in its page — not when it is being added', async () => {
      await open([{ label: 'X1', camera_id: 'X1', camera_model: 'Reconyx-PC800', in_service: null, research_project: 'DONA' }])

      await userEvent.click(screen.getByRole('button', { name: 'Add camera' }))
      expect(screen.queryByRole('img', { name: /QR code of/ })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /Cancel/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Edit X1' }))
      expect(screen.getByRole('img', { name: 'QR code of X1' }).querySelector('svg')).not.toBeNull()
      expect(screen.getByText('wildintel:camera:DONA:X1')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Download QR code' })).toHaveAttribute('download', 'X1_qr.svg')
    })

    it('adds a camera by its id and model, and saves it', async () => {
      await open()
      expect(screen.getByText('No camera yet.')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Add camera' }))
      const dialog = within(screen.getByRole('region', { name: 'Camera' }))
      await userEvent.type(dialog.getByLabelText('Label'), 'North gate')
      await userEvent.type(dialog.getByLabelText('Camera id'), 'P800HG08192031')
      await userEvent.type(dialog.getByLabelText('Camera model'), 'Reconyx-PC800')
      await userEvent.click(within(dialog.getByRole('group', { name: 'Mobile connection' })).getByRole('button', { name: '4G' }))
      await userEvent.click(within(dialog.getByRole('group', { name: 'Power' })).getByRole('button', { name: 'Battery' }))
      await userEvent.click(within(dialog.getByRole('group', { name: 'The battery can be taken out' })).getByRole('button', { name: 'Yes' }))
      expect(dialog.queryByLabelText('In production since')).not.toBeInTheDocument() // it is kept as the day it is created
      await userEvent.click(dialog.getByRole('button', { name: 'Add' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].FIELDWORK.cameras).toEqual([{ label: 'North gate', camera_id: 'P800HG08192031', camera_model: 'Reconyx-PC800', connectivity: '4g', power_source: 'battery', battery_removable: 'yes', in_service: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), research_project: 'DONA', status: 'ready', status_date: null, status_note: null }])
    })

    it('gives a camera a status — and, once archived, the day, why and a comment — and says it on its card', async () => {
      await open([{ label: 'X1', camera_id: 'X1', camera_model: null, in_service: null, research_project: 'DONA', status: 'active' }])

      await userEvent.click(screen.getByRole('button', { name: 'Edit X1' }))
      const dialog = within(screen.getByRole('region', { name: 'Camera' }))
      expect(dialog.getByRole('radio', { name: /Active/ })).toHaveAttribute('aria-checked', 'true')
      expect(dialog.getAllByRole('radio').map((o) => o.textContent)).toEqual([
        'PlannedOnly in Settings: it is not in the app yet.', 'ReadyAvailable, not in the field yet. Offered when a visit is registered.', 'ActiveIn use in the field. Offered when a visit is registered.', 'ArchivedOut of use for good: lost, stolen, broken… It never goes back to ready or active.',
      ])
      expect(dialog.queryByLabelText('Status since')).not.toBeInTheDocument() // asked once it is archived
      await userEvent.click(dialog.getByRole('radio', { name: /Archived/ }))
      expect(dialog.getByRole('button', { name: 'Other' })).toHaveAttribute('aria-pressed', 'true') // the reason a new archive starts with
      await userEvent.click(dialog.getByRole('button', { name: 'Stolen' }))
      fireEvent.change(dialog.getByLabelText('Status since'), { target: { value: '2026-05-02' } })
      await userEvent.type(dialog.getByLabelText('Comment'), 'taken from the tree')
      await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }))

      expect(screen.getByText('Archived')).toHaveAttribute('title', 'since 2026-05-02 — taken from the tree')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(mockedApi.saveSettings.mock.calls[0][0].FIELDWORK.cameras).toEqual([
        { label: 'X1', camera_id: 'X1', camera_model: null, in_service: null, research_project: 'DONA', status: 'archived', archive_reason: 'stolen', status_date: '2026-05-02', status_note: 'taken from the tree' },
      ])
    })

    it('says how many visits a camera was used in, and does not let one that was used be deleted', async () => {
      const visit = (camera_id: string) => ({ project: 'DONA', camera_id })
      mockedApi.listResearchProjects.mockResolvedValue({ results: [DONA] })
      mockedApi.listVisits.mockResolvedValue({ results: [visit('X1'), visit('X1'), visit('x1')] } as never)   // x1 is not X1: as written
      await open([{ label: 'X1', camera_id: 'X1', camera_model: null, in_service: null, research_project: 'DONA' }, { label: 'X2', camera_id: 'X2', camera_model: null, in_service: null, research_project: 'DONA' }])

      expect(await screen.findByText('Used in 2 visits')).toBeInTheDocument()
      expect(screen.getByText('No visits yet')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Delete X1' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Delete X2' })).toBeEnabled()
      mockedApi.listVisits.mockReset()
    })

    it('deletes a camera from its page', async () => {
      await open([{ label: 'X1', camera_id: 'X1', camera_model: null, in_service: null, research_project: 'DONA' }])

      await userEvent.click(screen.getByRole('button', { name: 'Edit X1' }))
      await userEvent.click(screen.getByRole('button', { name: 'Delete camera' }))

      expect(screen.queryByText('X1')).not.toBeInTheDocument()
    })

    it('needs a label, and a different one from the other cameras — its serial number is optional', async () => {
      await open([{ label: 'X1', camera_id: 'X1', camera_model: null, in_service: null, research_project: 'DONA' }, { label: 'X2', camera_id: 'X2', camera_model: null, in_service: null, research_project: 'DONA' }])

      await userEvent.click(screen.getByRole('button', { name: 'Edit X2' }))
      const id = screen.getByLabelText('Label')
      await userEvent.clear(id)
      expect(screen.queryByText('A label is required.')).not.toBeInTheDocument() // the label already says Required
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()

      await userEvent.type(id, 'X1')
      expect(screen.getByText('X1 is already in the list.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    })
  })

  describe('Reports', () => {
    it('lists the reports of the validations, postvalidations, preprocessings and repairs, to download or delete', async () => {
      mockedApi.listReports.mockResolvedValue([
        { id: '20261006-153012_repair_R0003-DONA_01', kind: 'repair', title: 'Repair of R0003-DONA_01', created_at: '2026-10-06T15:30:12+00:00',
          source_dir: '/c/DONA/R0003/R0003-DONA_01', deployment_id: 'R0003-DONA_01', checked: 3, totals: { entries: 20, ok: 18, failed: 2, images_with_issues: 1 } },
      ])
      mockedApi.deleteReport.mockResolvedValue({ status: 'ok' })
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')

      await section('Reports')

      const report = await screen.findByRole('listitem', { name: 'Repair of R0003-DONA_01' })
      expect(report).toHaveTextContent('2 problem(s)')
      expect(within(report).getByRole('link', { name: 'CSV' })).toHaveAttribute('href', '/api/reports/20261006-153012_repair_R0003-DONA_01/download?format=csv')
      await userEvent.click(within(report).getByRole('button', { name: 'Delete' }))
      await userEvent.click(within(report).getByRole('button', { name: 'Delete it' }))
      expect(mockedApi.deleteReport).toHaveBeenCalledWith('20261006-153012_repair_R0003-DONA_01')
    })
  })

  describe('Config', () => {
    const DEFAULT = { id: 'default', name: 'Default config', path: '/home/me/.config/wildintel-uploader/settings.toml', active: true }
    const B = { id: 'b', name: 'b', path: '/home/me/.config/wildintel-uploader/configs/b.toml', active: false }

    beforeEach(() => {
      mockedApi.configs.mockResolvedValue([DEFAULT, B])
    })

    it('lists the settings files, the one in use marked', async () => {
      render(<SettingsPage onClose={() => {}} />)
      await section('Config')

      expect(await screen.findByText('Default config')).toBeInTheDocument()
      expect(screen.getByText('In use')).toBeInTheDocument()
      expect(screen.getByLabelText('b file location')).toHaveTextContent('/configs/b.toml')
      expect(screen.queryByRole('button', { name: 'Use Default config' })).not.toBeInTheDocument()
    })

    it('switches to another config and shows its settings', async () => {
      mockedApi.activateConfig.mockResolvedValue([{ ...DEFAULT, active: false }, { ...B, active: true }])
      render(<SettingsPage onClose={() => {}} />)
      await waitFor(() => expect(mockedApi.getSettings).toHaveBeenCalledTimes(1))
      await section('Config')
      mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, TRAPPER: { ...APP_SETTINGS.TRAPPER, user_name: 'bob@b.org' } })
      await userEvent.click(await screen.findByRole('button', { name: 'Use b' }))

      await waitFor(() => expect(mockedApi.activateConfig).toHaveBeenCalledWith('b'))
      await waitFor(() => expect(mockedApi.getSettings).toHaveBeenCalledTimes(2)) // the settings are read again
      await userEvent.click(screen.getByRole('button', { name: 'Uploader' }))
      expect(await screen.findByDisplayValue('bob@b.org')).toBeInTheDocument()
    })

    it('creates a config from a name, without activating it', async () => {
      const created = { id: 'project-c', name: 'project-c', path: '/x/configs/project-c.toml', active: false }
      mockedApi.addConfig.mockResolvedValue([DEFAULT, B, created])
      render(<SettingsPage onClose={() => {}} />)
      await section('Config')
      await userEvent.click(await screen.findByRole('button', { name: 'New config' }))
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
      await userEvent.type(screen.getByLabelText('Config name'), 'Project C')
      await userEvent.click(screen.getByRole('button', { name: 'Create' }))

      expect(mockedApi.addConfig).toHaveBeenCalledWith('Project C')
      expect(await screen.findByText('project-c')).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(mockedApi.activateConfig).not.toHaveBeenCalled()
    })

    it('says why a config could not be created and keeps the dialog open', async () => {
      mockedApi.addConfig.mockRejectedValue(new Error('A config needs a name with at least one letter or digit.'))
      render(<SettingsPage onClose={() => {}} />)
      await section('Config')
      await userEvent.click(await screen.findByRole('button', { name: 'New config' }))
      await userEvent.type(screen.getByLabelText('Config name'), '!!')
      await userEvent.click(screen.getByRole('button', { name: 'Create' }))

      expect(await screen.findByText(/at least one letter or digit/)).toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('opens a config’s folder and links to its file to download', async () => {
      mockedApi.openConfigFolder.mockResolvedValue({ ok: true })
      render(<SettingsPage onClose={() => {}} />)
      await section('Config')
      await userEvent.click(await screen.findByRole('button', { name: 'Open b folder' }))

      expect(mockedApi.openConfigFolder).toHaveBeenCalledWith('b')
      expect(screen.getByRole('link', { name: 'Download b' })).toHaveAttribute('href', '/api/settings/configs/b/download')
    })
  })

  describe('Update', () => {
    const CHECK = { current: '0.1.0', latest: '0.1.0', update_available: false, release_url: null, download_url: null, error: null }

    it('checks for updates and says when the app is up to date', async () => {
      mockedApi.checkForUpdate.mockResolvedValue(CHECK)
      render(<SettingsPage onClose={() => {}} />)

      await userEvent.click(await screen.findByRole('button', { name: 'Check for updates' }))

      expect(await screen.findByText(/up to date \(version 0\.1\.0\)/)).toBeInTheDocument()
    })

    it('offers the download when a newer version exists', async () => {
      mockedApi.checkForUpdate.mockResolvedValue({
        ...CHECK, latest: '0.2.0', update_available: true,
        release_url: 'https://github.com/x/releases/v0.2.0', download_url: 'https://dl/app-0.2.0-linux-x86_64.AppImage',
      })
      render(<SettingsPage onClose={() => {}} />)

      await userEvent.click(await screen.findByRole('button', { name: 'Check for updates' }))

      expect(await screen.findByRole('link', { name: 'Tap to download 0.2.0' })).toHaveAttribute('href', 'https://dl/app-0.2.0-linux-x86_64.AppImage')
    })

    it('offers a retry when the check fails, and recovers on the next try', async () => {
      mockedApi.checkForUpdate.mockResolvedValueOnce({ ...CHECK, latest: null, error: 'Could not check for updates: offline' })
      mockedApi.checkForUpdate.mockResolvedValueOnce(CHECK)
      render(<SettingsPage onClose={() => {}} />)

      await userEvent.click(await screen.findByRole('button', { name: 'Check for updates' }))
      expect(await screen.findByText(/offline/)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Tap to retry' }))

      expect(await screen.findByText(/up to date/)).toBeInTheDocument()
      expect(screen.queryByText(/offline/)).not.toBeInTheDocument()
    })
  })
})

describe('SettingsPage — Entities', () => {
  async function open(tab: string) {
    render(<SettingsPage onClose={vi.fn()} />)
    await screen.findByLabelText('Level')
    await entity(tab)
  }
  const file = (text: string) => new File([text], 'f.csv', { type: 'text/csv' })

  it('has a tab for the research projects, the trappers, their roles, the locations, the cameras and the SD cards, and takes the old sections to their tab', async () => {
    render(<SettingsPage onClose={vi.fn()} initialSection="sdcards" />)
    await screen.findByRole('tablist', { name: 'Entities' })

    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Research projects', 'Trappers', 'Roles', 'Locations', 'Cameras', 'SD cards'])
    expect(screen.getByRole('tab', { name: 'SD cards' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('button', { name: 'Trappers' })).not.toBeInTheDocument() // no longer a section of its own
  })

  describe('research projects', () => {
    it('lists those of the collections folder', async () => {
      await open('Research projects')

      expect(await screen.findByText('DONA')).toBeInTheDocument()
      expect(screen.getByText('Doñana')).toBeInTheDocument()
      expect(screen.getByText('From Trapper')).toBeInTheDocument()
    })

    it('adds one by hand — kept at once, not with Save — and refuses an acronym that is not one', async () => {
      mockedApi.saveResearchProject.mockImplementation(async (p) => p)
      await open('Research projects')

      await userEvent.click(screen.getByRole('button', { name: 'Add research project' }))
      const dialog = within(screen.getByRole('region', { name: 'Research project' }))
      await userEvent.type(dialog.getByLabelText('Acronym'), 'T!')
      expect(dialog.getByRole('button', { name: 'Add' })).toBeDisabled()
      await userEvent.clear(dialog.getByLabelText('Acronym'))
      await userEvent.type(dialog.getByLabelText('Acronym'), 'TATR')
      await userEvent.type(dialog.getByLabelText('Name'), 'Tatra')
      await userEvent.click(dialog.getByRole('button', { name: 'Add' }))

      await waitFor(() => expect(mockedApi.saveResearchProject).toHaveBeenCalledWith(expect.objectContaining({ acronym: 'TATR', name: 'Tatra', trapper_pk: null })))
      expect(mockedApi.saveSettings).not.toHaveBeenCalled()
    })

    it('only shows one taken from Trapper: no fields to change, a notice, and what belongs to it', async () => {
      await open('Research projects')

      await userEvent.click(await screen.findByRole('button', { name: 'View DONA' }))

      const page = within(screen.getByRole('region', { name: 'Research project' }))
      expect(page.getByText('This project comes from Trapper')).toBeInTheDocument()
      expect(page.queryByLabelText('Name')).not.toBeInTheDocument()
      expect(page.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
      expect(page.queryByRole('button', { name: 'Remove research project' })).not.toBeInTheDocument()
      expect(page.getByText('Doñana')).toBeInTheDocument()
      expect(page.getByText('Belongs to it')).toBeInTheDocument()
      await userEvent.click(page.getByRole('button', { name: 'Close' }))
      expect(screen.getByRole('button', { name: 'View DONA' })).toBeInTheDocument()
    })

    it('edits one with its gear — its status too, but not its acronym — and keeps it at once', async () => {
      mockedApi.listResearchProjects.mockResolvedValue({ results: [{ ...DONA, trapper_pk: null }] })
      mockedApi.updateResearchProject.mockResolvedValue({ ...DONA, status: 'finished' })
      await open('Research projects')

      await userEvent.click(await screen.findByRole('button', { name: 'Edit DONA' }))
      const dialog = within(screen.getByRole('region', { name: 'Research project' }))
      expect(dialog.getByLabelText('Acronym')).toBeDisabled()
      expect(dialog.getAllByRole('radio').map((o) => o.textContent)).toEqual(['PlannedIt is planned: only in Settings, to link entities to it.', 'ActiveIt is seen in the whole app.', 'FinishedClosed, but it can be reopened.', 'ArchivedClosed for good: it cannot be modified and never goes back.'])
      expect(dialog.getByRole('radio', { name: /Active/ })).toHaveAttribute('aria-checked', 'true')
      await userEvent.clear(dialog.getByLabelText('Name'))
      await userEvent.type(dialog.getByLabelText('Name'), 'Doñana NP')
      await userEvent.type(dialog.getByLabelText('Description'), 'Spring 2024')
      await userEvent.type(dialog.getByPlaceholderText('e.g. camera traps'), 'doñana{Enter}')
      await userEvent.type(dialog.getByPlaceholderText('e.g. camera traps'), 'camera traps')
      await userEvent.click(dialog.getByRole('button', { name: 'Add keyword' }))
      expect(dialog.getByRole('button', { name: 'Remove doñana' })).toBeInTheDocument()
      await userEvent.click(within(dialog.getByRole('group', { name: 'Sensor method' })).getByRole('button', { name: 'timeLapse' }))
      await userEvent.type(dialog.getByLabelText('Abstract'), 'Cameras in the park')
      await userEvent.click(dialog.getByRole('radio', { name: /Finished/ }))
      await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }))

      await waitFor(() => expect(mockedApi.updateResearchProject).toHaveBeenCalledWith('DONA', expect.objectContaining({
        name: 'Doñana NP', description: 'Spring 2024', keywords: 'doñana, camera traps', status: 'finished', sensor_method: 2, abstract: 'Cameras in the park',
      })))
      expect(mockedApi.saveSettings).not.toHaveBeenCalled()
    })

    it('deletes one after asking — and says why when it can not be', async () => {
      mockedApi.deleteResearchProject.mockRejectedValueOnce(new Error("The research project 'DONA' still holds R0001: it can't be deleted until those are removed."))
      mockedApi.deleteResearchProject.mockResolvedValueOnce({ deleted: 'DONA' })
      mockedApi.listResearchProjects.mockResolvedValue({ results: [{ ...DONA, trapper_pk: null }] })
      await open('Research projects')

      await userEvent.click(await screen.findByRole('button', { name: 'Edit DONA' }))
      await userEvent.click(screen.getByRole('button', { name: 'Remove research project' }))
      expect(mockedApi.deleteResearchProject).not.toHaveBeenCalled() // it is asked first
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(mockedApi.deleteResearchProject).not.toHaveBeenCalled()

      await userEvent.click(screen.getByRole('button', { name: 'Edit DONA' }))
      await userEvent.click(screen.getByRole('button', { name: 'Remove research project' }))
      await userEvent.click(screen.getByRole('button', { name: 'Delete DONA' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('still holds R0001')

      await userEvent.click(screen.getByRole('button', { name: 'Edit DONA' }))
      await userEvent.click(screen.getByRole('button', { name: 'Remove research project' }))
      await userEvent.click(screen.getByRole('button', { name: 'Delete DONA' }))
      await waitFor(() => expect(mockedApi.deleteResearchProject).toHaveBeenCalledTimes(2))
    })

    it('reads them from a CSV file, leaving out those that are there already and those that are not research projects', async () => {
      mockedApi.saveResearchProject.mockImplementation(async (p) => p)
      await open('Research projects')

      await userEvent.upload(screen.getByLabelText('Import Research projects from a CSV file'), file('acronym,name,description\nTATR,Tatra,Mountains\ndona,Doñana again,\nX,Too short,\n'))

      expect(await screen.findByRole('status')).toHaveTextContent('1 added, 1 already there.')
      expect(screen.getByRole('status')).toHaveTextContent('X: From 3 to 10 letters')
      expect(mockedApi.saveResearchProject).toHaveBeenCalledTimes(1)
      expect(mockedApi.saveResearchProject).toHaveBeenCalledWith(expect.objectContaining({ acronym: 'TATR', description: 'Mountains' }))
    })

    it('takes them from Trapper, those with an acronym that can be one', async () => {
      mockedApi.trapperResearchProjects.mockResolvedValue({ results: [{ pk: 5, name: 'Tatra', acronym: 'TATR' }, { pk: 6, name: 'No acronym', acronym: null }] })
      mockedApi.saveResearchProject.mockImplementation(async (p) => p)
      await open('Research projects')

      await userEvent.click(screen.getByRole('button', { name: 'Import from Trapper' }))
      const panel = within(await screen.findByRole('group', { name: 'Import research projects from Trapper' }))
      await userEvent.click(await panel.findByRole('checkbox', { name: /TATR — Tatra/ }))
      await userEvent.click(panel.getByRole('checkbox', { name: /No acronym/ }))
      await userEvent.click(panel.getByRole('button', { name: 'Add 2 research projects' }))

      expect(await panel.findByRole('status')).toHaveTextContent('1 added from Trapper.')
      expect(panel.getByRole('status')).toHaveTextContent('“No acronym” has no acronym')
      expect(mockedApi.saveResearchProject).toHaveBeenCalledWith(expect.objectContaining({ acronym: 'TATR', name: 'Tatra', trapper_pk: 5 }))
    })

    it('says why Trapper cannot be reached', async () => {
      mockedApi.trapperResearchProjects.mockRejectedValue(new Error('No Trapper account in the settings.'))
      await open('Research projects')

      await userEvent.click(screen.getByRole('button', { name: 'Import from Trapper' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('No Trapper account in the settings.')
    })
  })

  describe('locations', () => {
    const RIDGE = { location_id: 'DONA_01', name: 'Ridge', timezone: 'Europe/Madrid', ignore_dst: null, latitude: 37.1, longitude: -6.4, coordinate_uncertainty: null, trapper_pk: null }

    async function openLocations(locations = [RIDGE]) {
      mockedApi.listLocalLocations.mockResolvedValue({ results: locations })
      await open('Locations')
      expect(screen.getByText('Pick a research project to see its locations.')).toBeInTheDocument()
      await pickProject()
    }

    it('lists those of the research project picked, kept in the collections folder', async () => {
      await openLocations()

      expect(await screen.findByText('DONA_01')).toBeInTheDocument()
      expect(screen.getByText('Ridge')).toBeInTheDocument()
      expect(await screen.findByText('37.1, -6.4 · Europe/Madrid · No visits yet')).toBeInTheDocument()
      expect(mockedApi.listLocalLocations).toHaveBeenCalledWith('DONA')
    })

    it('warns with a red label, in its line and in its form, when the time zone of a location is not UTC — and not when it is', async () => {
      await openLocations([RIDGE, { ...RIDGE, location_id: 'DONA_02', name: 'Marsh', timezone: 'UTC' }])

      const ridge = (await screen.findByText('DONA_01')).closest('li, div[class*="rounded"]') as HTMLElement
      expect(within(ridge).getByText('Not UTC')).toHaveAttribute('title', 'The time zone is Europe/Madrid, not UTC')
      expect(screen.getAllByText('Not UTC')).toHaveLength(1)                       // the one in UTC has none
      await userEvent.click(screen.getByRole('button', { name: 'Edit DONA_01' }))
      expect(await screen.findAllByText('Not UTC')).not.toHaveLength(0)            // and its form says it in its header
    })

    it('adds one by hand, with its numbers as numbers, and will not let a wrong coordinate or timezone be done with', async () => {
      mockedApi.saveLocalLocation.mockImplementation(async (_rp, l) => l)
      await openLocations([])

      await userEvent.click(screen.getByRole('button', { name: 'Add location' }))
      const dialog = within(screen.getByRole('region', { name: 'Location' }))
      await userEvent.type(dialog.getByLabelText('Location id'), 'DONA_02')
      await userEvent.type(dialog.getByLabelText('Latitude'), '95')
      expect(dialog.getByText('A number from -90 to 90.')).toBeInTheDocument()
      expect(dialog.getByRole('button', { name: 'Add' })).toBeDisabled()
      await userEvent.clear(dialog.getByLabelText('Latitude'))
      await userEvent.type(dialog.getByLabelText('Latitude'), '37.01')
      await userEvent.type(dialog.getByLabelText('Longitude'), '-6.44')
      // it starts as UTC, and only a zone of the list can be picked
      expect(dialog.getByRole('combobox')).toHaveValue('UTC')
      await userEvent.type(dialog.getByRole('combobox'), 'Mars/Base')
      expect(dialog.getByText('No matches')).toBeInTheDocument()
      await userEvent.clear(dialog.getByRole('combobox'))
      await userEvent.type(dialog.getByRole('combobox'), 'Europe/Madrid')
      await userEvent.click(dialog.getByRole('option', { name: 'Europe/Madrid' }))
      await userEvent.click(dialog.getByLabelText('The cameras here ignore summer time'))
      await userEvent.click(dialog.getByRole('button', { name: 'Add' }))

      await waitFor(() => expect(mockedApi.saveLocalLocation).toHaveBeenCalledWith('DONA', {
        location_id: 'DONA_02', name: null, latitude: 37.01, longitude: -6.44, coordinate_uncertainty: null, timezone: 'Europe/Madrid', ignore_dst: true, in_service: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), trapper_pk: null, status: 'pending', status_date: null, status_note: null,
      }))
    })

    it('does not ask about summer time while the timezone is UTC, which has none, and turns it off when UTC is picked', async () => {
      mockedApi.saveLocalLocation.mockImplementation(async (_rp, l) => l)
      await openLocations([])

      await userEvent.click(screen.getByRole('button', { name: 'Add location' }))
      const dialog = within(screen.getByRole('region', { name: 'Location' }))
      await userEvent.type(dialog.getByLabelText('Location id'), 'DONA_02')
      await userEvent.type(dialog.getByLabelText('Latitude'), '37.01')
      await userEvent.type(dialog.getByLabelText('Longitude'), '-6.44')
      expect(dialog.getByRole('combobox')).toHaveValue('UTC')
      expect(dialog.getByLabelText('The cameras here ignore summer time')).toBeDisabled()
      expect(dialog.getByText('Summer time is not applied in UTC.')).toBeInTheDocument()

      await userEvent.clear(dialog.getByRole('combobox'))
      await userEvent.type(dialog.getByRole('combobox'), 'Europe/Madrid')
      await userEvent.click(dialog.getByRole('option', { name: 'Europe/Madrid' }))
      await userEvent.click(dialog.getByLabelText('The cameras here ignore summer time'))
      expect(dialog.getByLabelText('The cameras here ignore summer time')).toBeChecked()

      await userEvent.clear(dialog.getByRole('combobox'))
      await userEvent.type(dialog.getByRole('combobox'), 'UTC')
      await userEvent.click(dialog.getByRole('option', { name: 'UTC' }))
      expect(dialog.getByLabelText('The cameras here ignore summer time')).not.toBeChecked()
      await userEvent.click(dialog.getByRole('button', { name: 'Add' }))
      await waitFor(() => expect(mockedApi.saveLocalLocation).toHaveBeenCalledWith('DONA', expect.objectContaining({ timezone: 'UTC', ignore_dst: false })))
    })

    it('shows the QR code of a location in its page', async () => {
      await openLocations()

      await userEvent.click(await screen.findByRole('button', { name: 'Edit DONA_01' }))
      expect(screen.getByRole('img', { name: 'QR code of DONA_01' }).querySelector('svg')).not.toBeNull()
      expect(screen.getByText(/wildintel:location:.*:DONA_01/)).toBeInTheDocument()
    })

    it('deletes one after asking, from its page — and says why when it can not be', async () => {
      mockedApi.deleteLocalLocation.mockRejectedValueOnce(new Error("The location 'DONA_01' still has 1 visit: it can't be deleted — mark it as archived instead."))
      mockedApi.deleteLocalLocation.mockResolvedValueOnce({ deleted: 'DONA_01' })
      await openLocations()

      await userEvent.click(await screen.findByRole('button', { name: 'Edit DONA_01' }))
      await userEvent.click(screen.getByRole('button', { name: 'Delete location' }))
      expect(mockedApi.deleteLocalLocation).not.toHaveBeenCalled() // it is asked first
      await userEvent.click(screen.getByRole('button', { name: 'Delete DONA_01' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('still has 1 visit')

      await userEvent.click(screen.getByRole('button', { name: 'Delete location' }))
      await userEvent.click(screen.getByRole('button', { name: 'Delete DONA_01' }))
      await waitFor(() => expect(mockedApi.deleteLocalLocation).toHaveBeenCalledWith('DONA', 'DONA_01'))
    })

    it('edits one — but not its id — and keeps it at once', async () => {
      mockedApi.updateLocalLocation.mockResolvedValue(RIDGE)
      await openLocations()

      await userEvent.click(await screen.findByRole('button', { name: 'Edit DONA_01' }))
      const dialog = within(screen.getByRole('region', { name: 'Location' }))
      expect(dialog.getByLabelText('Location id')).toBeDisabled()
      expect(dialog.getByRole('combobox')).toBeDisabled() // set when the location was created
      expect(dialog.getByRole('switch', { name: 'The cameras here ignore summer time' })).toBeDisabled()
      await userEvent.clear(dialog.getByLabelText('Name'))
      await userEvent.type(dialog.getByLabelText('Name'), 'Ridge top')
      await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }))

      await waitFor(() => expect(mockedApi.updateLocalLocation).toHaveBeenCalledWith('DONA', 'DONA_01', expect.objectContaining({ name: 'Ridge top', latitude: 37.1 })))
      expect(mockedApi.updateLocalLocation.mock.calls[0][2]).not.toHaveProperty('timezone') // fixed when the location was created
      expect(mockedApi.updateLocalLocation.mock.calls[0][2]).not.toHaveProperty('ignore_dst')
    })

    it('reads them from a CSV file: new ones are added, one that is there is updated, a wrong value is left blank', async () => {
      mockedApi.saveLocalLocation.mockImplementation(async (_rp, l) => l)
      mockedApi.updateLocalLocation.mockResolvedValue(RIDGE)
      await openLocations()

      await userEvent.upload(await screen.findByLabelText('Import Locations of DONA from a CSV file'), file('location_id,name,latitude,longitude\nDONA_01,Ridge 2,37.2,-6.4\nDONA_03,New,95,-6.1\n'))

      expect(await screen.findByText(/1 added, 1 updated in DONA/)).toBeInTheDocument()
      expect(mockedApi.updateLocalLocation).toHaveBeenCalledWith('DONA', 'DONA_01', expect.objectContaining({ name: 'Ridge 2', latitude: 37.2 }))
      expect(mockedApi.saveLocalLocation).toHaveBeenCalledWith('DONA', expect.objectContaining({ location_id: 'DONA_03', latitude: null, longitude: -6.1 }))
      expect(screen.getByText(/latitude “95”/)).toBeInTheDocument()
    })

    it('takes them from the Trapper research project of the one picked, those with coordinates', async () => {
      mockedApi.trapperLocations.mockResolvedValue({ results: [
        { pk: 11, location_id: 'DONA_01', name: 'There already', timezone: null },
        { pk: 12, location_id: 'DONA_07', name: 'Marsh', timezone: 'Europe/Madrid', latitude: 37.3, longitude: -6.2 },
        { pk: 13, location_id: 'DONA_08', name: 'No GPS', timezone: null },
      ] })
      mockedApi.saveLocalLocation.mockImplementation(async (_rp, l) => l)
      await openLocations()

      await userEvent.click(screen.getByRole('button', { name: 'Import from Trapper' }))
      const panel = within(await screen.findByRole('group', { name: 'Import locations from Trapper' }))
      for (const name of [/DONA_01/, /DONA_07/, /DONA_08/]) await userEvent.click(await panel.findByRole('checkbox', { name }))
      await userEvent.click(panel.getByRole('button', { name: 'Add 3 locations' }))

      expect(await panel.findByRole('status')).toHaveTextContent('1 added from Trapper.')
      expect(panel.getByRole('status')).toHaveTextContent('DONA_01 is already there.')
      expect(panel.getByRole('status')).toHaveTextContent('“DONA_08” has no coordinates in Trapper')
      expect(mockedApi.trapperLocations).toHaveBeenCalledWith({}, 2)
      expect(mockedApi.saveLocalLocation).toHaveBeenCalledTimes(1)
      expect(mockedApi.saveLocalLocation).toHaveBeenCalledWith('DONA', expect.objectContaining({ location_id: 'DONA_07', latitude: 37.3, longitude: -6.2, timezone: 'Europe/Madrid', trapper_pk: 12, status: 'pending' }))
      expect(mockedApi.updateLocalLocation).not.toHaveBeenCalled()
    })

    it('cannot take them from Trapper for a research project that was not taken from there', async () => {
      mockedApi.listResearchProjects.mockResolvedValue({ results: [{ ...DONA, trapper_pk: null }] })
      await openLocations()

      await userEvent.click(screen.getByRole('button', { name: 'Import from Trapper' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('was not taken from Trapper')
    })
  })

  it('keeps the cameras and the SD cards by research project: those of another project, or of none, are not mixed up', async () => {
    const card = (label: string, research_project: string | null) => ({ label, brand: null, capacity: null, in_service: null, research_project })
    mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, FIELDWORK: { ...APP_SETTINGS.FIELDWORK, sd_cards: [card('A1', 'DONA'), card('B1', 'TATR'), card('F1', null)] } })
    await open('SD cards')

    await pickProject()
    expect(screen.getByText('A1')).toBeInTheDocument()
    expect(screen.queryByText('B1')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add SD card' }))
    await userEvent.type(within(screen.getByRole('region', { name: 'SD card' })).getByLabelText('Label'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockedApi.saveSettings.mock.calls[0][0].FIELDWORK.sd_cards.map((c) => [c.label, c.research_project])).toEqual([['B1', 'TATR'], ['F1', null], ['A1', 'DONA'], ['2', 'DONA']])
  })

  it('shows the cards of no project under their own choice', async () => {
    const card = (label: string, research_project: string | null) => ({ label, brand: null, capacity: null, in_service: null, research_project })
    mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, FIELDWORK: { ...APP_SETTINGS.FIELDWORK, sd_cards: [card('A1', 'DONA'), card('F1', null)] } })
    await open('SD cards')

    await pickProject('Not assigned to a project')

    expect(screen.getByText('F1')).toBeInTheDocument()
    expect(screen.queryByText('A1')).not.toBeInTheDocument()
  })
})


describe('SettingsPage — which sources and uploaders are used', () => {
  it('has a check to use each source of visits, and keeps it', async () => {
    render(<SettingsPage onClose={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Visit sources' }))

    expect(screen.queryByRole('tab', { name: 'WildINTEL Epicollect Legacy CSV' })).not.toBeInTheDocument() // the old form is not a source any more
    expect(screen.getByRole('switch', { name: 'Use WildINTEL Epicollect CSV' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'Epicollect' }))
    expect(screen.getByRole('switch', { name: 'Use Epicollect' })).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(screen.getByRole('switch', { name: 'Use Epicollect' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Custom CSV' }))
    expect(screen.queryByRole('switch')).not.toBeInTheDocument() // it is always offered: there is nothing to turn off
    await userEvent.click(screen.getByRole('tab', { name: 'WildINTEL Epicollect CSV' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Use WildINTEL Epicollect CSV' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedApi.saveSettings).toHaveBeenCalled())
    const sent = mockedApi.saveSettings.mock.calls[0][0]
    expect([sent.EPICOLLECT5.enabled, sent.EPICOLLECTCSV.enabled]).toEqual([true, false])
  })

  it('has a check to use each uploader, and the form of what an upload to Agouti needs, which is kept', async () => {
    render(<SettingsPage onClose={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Uploader' }))

    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Trapper', 'Agouti'])
    expect(screen.getByRole('switch', { name: 'Use Trapper' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'Agouti' }))
    expect(screen.getByRole('switch', { name: 'Use Agouti' })).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(screen.getByRole('switch', { name: 'Use Agouti' }))
    await userEvent.type(screen.getByLabelText('Agouti web address'), 'https://api.agouti.eu')
    await userEvent.type(screen.getByLabelText('API key'), 'secret-key')
    await userEvent.type(screen.getByLabelText('Agouti project id'), '42')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedApi.saveSettings).toHaveBeenCalled())
    expect(mockedApi.saveSettings.mock.calls[0][0].AGOUTI).toEqual({ enabled: true, base_url: 'https://api.agouti.eu', api_key: 'secret-key', project_id: '42' })
  })
})

describe('SettingsPage — WildINTEL Epicollect file', () => {
  it('says that a visit happened when its entry was created — in the tab of the source — and whether the logs keep the seconds, in General — and saves it', async () => {
    render(<SettingsPage onClose={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Visit sources' }))

    expect(screen.queryByLabelText('The time of a visit is')).not.toBeInTheDocument()   // the form has no date or time to choose from
    expect(screen.queryByLabelText('Column for Who went')).not.toBeInTheDocument() // the columns are found by their names: nothing to say
    await userEvent.click(screen.getByRole('button', { name: 'General' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Keep the seconds in the logs' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedApi.saveSettings).toHaveBeenCalled())
    expect(mockedApi.saveSettings.mock.calls[0][0].FIELDLOG).toEqual({ time_source: 'created_at', keep_seconds: true })
  })
})
