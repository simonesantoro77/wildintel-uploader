import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import LocationPicker from './LocationPicker'

vi.mock('../api', () => ({
  api: {
    listLocalLocations: vi.fn(),
    saveLocalLocation: vi.fn(),
    trapperGetConfig: vi.fn(),
    trapperTestConnection: vi.fn(),
    trapperResearchProjects: vi.fn(),
    trapperLocations: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)
const existing = {
  location_id: 'DONA_01', name: 'Existing', latitude: 37, longitude: -6,
  timezone: 'UTC', coordinate_uncertainty: null, trapper_pk: null, status: 'active' as const,
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedApi.listLocalLocations.mockResolvedValue({ results: [existing] })
  mockedApi.saveLocalLocation.mockImplementation(async (_project, location) => location)
  mockedApi.trapperGetConfig.mockResolvedValue({ base_url: 'https://trapper.example.org', user_name: 'alice', has_password: true })
  mockedApi.trapperTestConnection.mockResolvedValue({ ok: true, research_projects_count: 1 })
  mockedApi.trapperResearchProjects.mockResolvedValue({ results: [{ pk: 2, name: 'Doñana', acronym: 'DONA' }] })
  mockedApi.trapperLocations.mockResolvedValue({ results: [
    { pk: 11, location_id: 'dona_01', name: 'Already here', latitude: 37, longitude: -6, timezone: 'UTC' },
    { pk: 12, location_id: 'DONA_02', name: 'New', latitude: 37.2, longitude: -6.2, timezone: 'Europe/Madrid', ignore_dst: true },
    { pk: 13, location_id: 'DONA_03', name: 'New too', latitude: 37.3, longitude: -6.3, timezone: null },
    { pk: 14, location_id: 'DONA_04', name: 'No GPS', latitude: null, longitude: null, timezone: null },
  ] })
})

describe('LocationPicker imports from Trapper', () => {
  it('creates new locations pending and leaves an existing location unchanged', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<LocationPicker researchProjectId="DONA" trapperPk={2} value="" onSelect={onSelect} />)

    await user.click(await screen.findByRole('button', { name: /Add a new location/ }))
    await user.click(screen.getByRole('button', { name: /From Trapper/ }))
    for (const id of ['dona_01', 'DONA_02', 'DONA_03', 'DONA_04']) {
      await user.click(await screen.findByRole('checkbox', { name: new RegExp(id) }))
    }
    await user.click(screen.getByRole('button', { name: 'Add 4 locations' }))

    await waitFor(() => expect(mockedApi.saveLocalLocation).toHaveBeenCalledTimes(2))
    expect(mockedApi.saveLocalLocation).toHaveBeenNthCalledWith(1, 'DONA', {
      location_id: 'DONA_02', name: 'New', timezone: 'Europe/Madrid', ignore_dst: true, trapper_pk: 12,
      latitude: 37.2, longitude: -6.2, coordinate_uncertainty: null, status: 'pending',
    })
    expect(mockedApi.saveLocalLocation).toHaveBeenNthCalledWith(2, 'DONA', {
      location_id: 'DONA_03', name: 'New too', timezone: 'UTC', ignore_dst: false, trapper_pk: 13,
      latitude: 37.3, longitude: -6.3, coordinate_uncertainty: null, status: 'pending',
    })
    expect(onSelect).toHaveBeenCalledWith(existing)
    expect(await screen.findByText(/DONA_04.*has no coordinates/)).toBeInTheDocument()
  })

  it('selects a newly imported pending location when none already exists', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<LocationPicker researchProjectId="DONA" trapperPk={2} value="" onSelect={onSelect} />)

    await user.click(await screen.findByRole('button', { name: /Add a new location/ }))
    await user.click(screen.getByRole('button', { name: /From Trapper/ }))
    await user.click(await screen.findByRole('checkbox', { name: /DONA_02/ }))
    await user.click(screen.getByRole('button', { name: 'Add 1 location' }))

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ location_id: 'DONA_02', status: 'pending' })))
  })
})
