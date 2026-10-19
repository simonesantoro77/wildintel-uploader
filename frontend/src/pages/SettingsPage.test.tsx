import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import SettingsPage from './SettingsPage'
import { APP_SETTINGS } from '../test/fixtures'

vi.mock('../api', () => ({
  api: {
    getSettings: vi.fn(), saveSettings: vi.fn(), clearLog: vi.fn(), browseFolder: vi.fn(), trapperTestConnection: vi.fn(), epicollectTestConnection: vi.fn(),
    checkForUpdate: vi.fn(), listReports: vi.fn(), deleteReport: vi.fn(), getReport: vi.fn(), reportUrl: (id: string, format: string) => `/api/reports/${id}/download?format=${format}`, configs: vi.fn(), addConfig: vi.fn(), activateConfig: vi.fn(), openConfigFolder: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.getSettings.mockResolvedValue(APP_SETTINGS)
  mockedApi.saveSettings.mockImplementation(async (update) => ({
    GENERAL: { ...APP_SETTINGS.GENERAL, ...update.GENERAL },
    TRAPPER: { ...APP_SETTINGS.TRAPPER, base_url: update.TRAPPER.base_url, user_name: update.TRAPPER.user_name, has_password: APP_SETTINGS.TRAPPER.has_password || !!update.TRAPPER.user_password },
    EPICOLLECT5: { project_slug: update.EPICOLLECT5.project_slug, client_id: update.EPICOLLECT5.client_id, has_secret: APP_SETTINGS.EPICOLLECT5.has_secret || !!update.EPICOLLECT5.client_secret, mapping: update.EPICOLLECT5.mapping },
    DATA: { dir: update.DATA.dir ?? APP_SETTINGS.DATA.dir },
    VALIDATION: update.VALIDATION,
    POSTVALIDATION: update.POSTVALIDATION,
    PREPROCESSING: update.PREPROCESSING,
  }))
})

const section = (name: string) => userEvent.click(screen.getByRole('button', { name }))
/** Opens the settings of a check, behind its gear. */
const gear = (check: RegExp) => userEvent.click(screen.getByRole('button', { name: new RegExp(`^Configure .*${check.source}`) }))
const settingsOf = (check: RegExp) => within(screen.getByRole('group', { name: new RegExp(`${check.source}.* settings$`) }))

describe('SettingsPage', () => {
  it('shows one section at a time, from the sidebar: General, Trapper, Validation and Postvalidation', async () => {
    render(<SettingsPage onClose={vi.fn()} />)
    expect(await screen.findByLabelText('Level')).toHaveValue('INFO')
    expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'page')

    await section('Trapper')
    expect(screen.getByLabelText('URL')).toHaveValue('https://trapper.example.org')
    expect(screen.getByLabelText('Username')).toHaveValue('alice')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.getByText(/a password is saved — leave it blank to keep it/i)).toBeInTheDocument()
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
    it('shows the folder the images are kept in — by default a folder named like the app in the documents folder', async () => {
      render(<SettingsPage onClose={vi.fn()} />)

      expect(await screen.findByLabelText('Folder')).toHaveValue('/home/me/Documents/wildintel-uploader')
      expect(screen.getByText(/collections\/<research project>\/<R0003>\/<deployment>/)).toBeInTheDocument()
    })

    it('changes the images folder by typing it, or with the native folder browser', async () => {
      mockedApi.browseFolder.mockResolvedValue({ path: '/data/images' })
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Folder')

      await userEvent.click(screen.getByRole('button', { name: 'Browse…' }))
      await waitFor(() => expect(screen.getByLabelText('Folder')).toHaveValue('/data/images'))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].DATA).toEqual({ dir: '/data/images' })
    })

    it('goes back to the default with a blank folder', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Folder')

      await userEvent.click(screen.getByRole('button', { name: 'Use the default' }))
      expect(screen.getByLabelText('Folder')).toHaveValue('')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].DATA).toEqual({ dir: null })
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

    it('sets the log level, and shows where the log file is', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      const level = await screen.findByLabelText('Level')
      expect(screen.getByText(APP_SETTINGS.GENERAL.log_file)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /download log/i })).toHaveAttribute('href', '/api/settings/log')

      await userEvent.selectOptions(level, 'DEBUG')
      expect(screen.getByText(/each image scanned and copied/i)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].GENERAL).toEqual({ log_level: 'DEBUG', workers: 4 })
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
    it('saves the server and the account, a blank password keeping the saved one', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Trapper')

      await userEvent.clear(screen.getByLabelText('Username'))
      await userEvent.type(screen.getByLabelText('Username'), 'bob')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].TRAPPER).toEqual({ base_url: 'https://trapper.example.org', user_name: 'bob', user_password: '', max_zip_mb: 500 })
      expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
    })

    it('sets the largest zip an upload makes, from 1 to 5000 MB', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Trapper')
      const field = screen.getByLabelText('Largest zip')
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
      await section('Trapper')
      await userEvent.type(screen.getByLabelText('Password'), 'new-secret')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].TRAPPER.user_password).toBe('new-secret')
      await screen.findByText('Settings saved.')
      expect(screen.getByLabelText('Password')).toHaveValue('')
    })

    it('says there is no password saved yet', async () => {
      mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, TRAPPER: { base_url: null, user_name: null, has_password: false, max_zip_mb: 500 } })
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Trapper')

      expect(screen.getByText(/no password saved yet/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled() // nothing to connect with
    })

    it('tests the connection with what is typed, a blank password using the saved one', async () => {
      mockedApi.trapperTestConnection.mockResolvedValue({ ok: true, research_projects_count: 3 })
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Trapper')

      await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))

      expect(mockedApi.trapperTestConnection).toHaveBeenCalledWith({ url: 'https://trapper.example.org', username: 'alice', password: '' })
      expect(await screen.findByText('Connected — 3 research project(s) available.')).toBeInTheDocument()
    })

    it('says why the connection failed', async () => {
      mockedApi.trapperTestConnection.mockRejectedValue(new Error('Invalid credentials'))
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Trapper')
      await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))

      expect(await screen.findByText('Invalid credentials')).toBeInTheDocument()
    })
  })

  describe('Epicollect5 connection', () => {
    it('tests the project with what is typed, and says what it found', async () => {
      mockedApi.epicollectTestConnection.mockResolvedValue({ ok: true, project: 'Doñana cameras', slug: 'donana', forms: 1, inputs: 5 })
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Epicollect5')
      await userEvent.type(screen.getByLabelText('Slug'), 'donana')
      await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))

      expect(mockedApi.epicollectTestConnection).toHaveBeenCalledWith({ project_slug: 'donana', client_id: '', client_secret: '' })
      expect(await screen.findByText('Connected — Doñana cameras: 5 input(s) in 1 form(s).')).toBeInTheDocument()
    })

    it('needs a project, and says why it failed', async () => {
      mockedApi.epicollectTestConnection.mockRejectedValue(new Error('Epicollect5 refused the client id and secret.'))
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Epicollect5')
      expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled()

      await userEvent.type(screen.getByLabelText('Slug'), 'donana')
      await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
      expect(await screen.findByText('Epicollect5 refused the client id and secret.')).toBeInTheDocument()
    })
  })

  describe('Parallel work', () => {
    it('shows how many images are worked on at once, and the CPUs of the machine', async () => {
      render(<SettingsPage onClose={vi.fn()} />)

      expect(await screen.findByLabelText('Workers')).toHaveValue('4')
      expect(screen.getByText(/This machine has 8 CPUs/)).toBeInTheDocument()
    })

    it('saves the number of workers', async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await userEvent.clear(await screen.findByLabelText('Workers'))
      await userEvent.type(screen.getByLabelText('Workers'), '6')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockedApi.saveSettings.mock.calls[0][0].GENERAL.workers).toBe(6)
    })

    it.each(['0', '65', '2.5', 'abc', ''])('marks %j workers as invalid, and cannot save', async (bad) => {
      render(<SettingsPage onClose={vi.fn()} />)
      await userEvent.clear(await screen.findByLabelText('Workers'))
      if (bad) await userEvent.type(screen.getByLabelText('Workers'), bad)

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
      /Number of images is like the previous revisions/, /Number of sequences is like the previous revisions/, /Length of the sequences is like the previous revisions/,
    ]
    const open = async () => {
      render(<SettingsPage onClose={vi.fn()} />)
      await screen.findByLabelText('Level')
      await section('Postvalidation')
    }

    it('has one entry per check, each with a switch, all on by default', async () => {
      await open()

      expect(screen.getAllByRole('switch')).toHaveLength(9)
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
        image_count: true, sequence_count: true, sequence_length: true, tolerance_hours: 2.5,
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
    await userEvent.selectOptions(screen.getByLabelText('Level'), 'WARNING')
    await section('Trapper')
    await userEvent.clear(screen.getByLabelText('URL'))
    await userEvent.type(screen.getByLabelText('URL'), 'https://other.example.org')
    await section('Validation')
    await userEvent.click(screen.getByRole('switch', { name: /Duplicate images/ }))
    await section('Postvalidation')
    await userEvent.click(screen.getByRole('switch', { name: /Camera consistency/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockedApi.saveSettings).toHaveBeenCalledTimes(1)
    const update = mockedApi.saveSettings.mock.calls[0][0]
    expect(update.GENERAL).toEqual({ log_level: 'WARNING', workers: 4 })
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
      expect(screen.getByText('ACTIVE')).toBeInTheDocument()
      expect(screen.getByLabelText('b file location')).toHaveTextContent('/configs/b.toml')
      expect(screen.queryByRole('button', { name: 'Activate Default config' })).not.toBeInTheDocument()
    })

    it('switches to another config and shows its settings', async () => {
      mockedApi.activateConfig.mockResolvedValue([{ ...DEFAULT, active: false }, { ...B, active: true }])
      render(<SettingsPage onClose={() => {}} />)
      await waitFor(() => expect(mockedApi.getSettings).toHaveBeenCalledTimes(1))
      await section('Config')
      mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, TRAPPER: { ...APP_SETTINGS.TRAPPER, user_name: 'bob@b.org' } })
      await userEvent.click(await screen.findByRole('button', { name: 'Activate b' }))

      await waitFor(() => expect(mockedApi.activateConfig).toHaveBeenCalledWith('b'))
      await waitFor(() => expect(mockedApi.getSettings).toHaveBeenCalledTimes(2)) // the settings are read again
      await userEvent.click(screen.getByRole('button', { name: 'Trapper' }))
      expect(await screen.findByDisplayValue('bob@b.org')).toBeInTheDocument()
    })

    it('creates a config from a name, without activating it', async () => {
      const created = { id: 'project-c', name: 'project-c', path: '/x/configs/project-c.toml', active: false }
      mockedApi.addConfig.mockResolvedValue([DEFAULT, B, created])
      render(<SettingsPage onClose={() => {}} />)
      await section('Config')
      await userEvent.click(await screen.findByRole('button', { name: 'Add config' }))
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
      await userEvent.click(await screen.findByRole('button', { name: 'Add config' }))
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

      await userEvent.click(await screen.findByRole('button', { name: 'Check updates' }))

      expect(await screen.findByText(/up to date \(version 0\.1\.0\)/)).toBeInTheDocument()
    })

    it('offers the download when a newer version exists', async () => {
      mockedApi.checkForUpdate.mockResolvedValue({
        ...CHECK, latest: '0.2.0', update_available: true,
        release_url: 'https://github.com/x/releases/v0.2.0', download_url: 'https://dl/app-0.2.0-linux-x86_64.AppImage',
      })
      render(<SettingsPage onClose={() => {}} />)

      await userEvent.click(await screen.findByRole('button', { name: 'Check updates' }))

      expect(await screen.findByRole('link', { name: 'Tap to download 0.2.0' })).toHaveAttribute('href', 'https://dl/app-0.2.0-linux-x86_64.AppImage')
    })

    it('offers a retry when the check fails, and recovers on the next try', async () => {
      mockedApi.checkForUpdate.mockResolvedValueOnce({ ...CHECK, latest: null, error: 'Could not check for updates: offline' })
      mockedApi.checkForUpdate.mockResolvedValueOnce(CHECK)
      render(<SettingsPage onClose={() => {}} />)

      await userEvent.click(await screen.findByRole('button', { name: 'Check updates' }))
      expect(await screen.findByText(/offline/)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Tap to retry' }))

      expect(await screen.findByText(/up to date/)).toBeInTheDocument()
      expect(screen.queryByText(/offline/)).not.toBeInTheDocument()
    })
  })
})
