import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { api } from '../api'
import EpicollectMapping from './EpicollectMapping'
import type { EpicollectForm } from '../types'

vi.mock('../api', () => ({ api: { epicollectForm: vi.fn() } }))

const FORM: EpicollectForm = {
  project: { name: 'Doñana cameras', slug: 'donana-cameras' },
  inputs: [
    { ref: 'f_loc', label: 'Location', type: 'text', form: 'Visit', group: null, branch: null, options: [] },
    { ref: 'f_start', label: 'Start date', type: 'date', form: 'Visit', group: null, branch: null, options: [] },
    { ref: 'f_end', label: 'End date', type: 'date', form: 'Visit', group: null, branch: null, options: [] },
    { ref: 'f_model', label: 'Camera model', type: 'text', form: 'Visit', group: 'Camera', branch: null, options: [] },
    { ref: 'f_height', label: 'Height', type: 'integer', form: 'Visit', group: 'Camera', branch: null, options: [] },
  ],
}

/** The mapping as the settings page holds it. */
function Host({ initial = {}, projectSaved = true, unsavedProject = false, onChange }: { initial?: Record<string, string>; projectSaved?: boolean; unsavedProject?: boolean; onChange?: (m: Record<string, string>) => void }) {
  const [mapping, setMapping] = useState(initial)
  return <EpicollectMapping mapping={mapping} onChange={(m) => { setMapping(m); onChange?.(m) }} projectSaved={projectSaved} unsavedProject={unsavedProject} />
}

const field = (label: string) => screen.getByLabelText(`Epicollect5 input for ${label}`) as HTMLSelectElement

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.epicollectForm).mockResolvedValue(FORM)
})

describe('EpicollectMapping', () => {
  it('lists every field of a deployment by group, each with the inputs of the form that can fill it', async () => {
    render(<Host />)

    expect(await screen.findByText(/5 inputs to choose from/)).toBeInTheDocument()
    for (const group of ['Where', 'Period', 'Camera', 'Site', 'Grouping and notes']) expect(screen.getByRole('region', { name: group })).toBeInTheDocument()
    const dateOptions = Array.from(field('Start date').options).map((o) => o.textContent)
    expect(dateOptions).toEqual(['— Not mapped —', 'Location — text', 'Start date — date', 'End date — date', 'Camera model — text'])
    const heightOptions = Array.from(field('Camera height (m)').options).map((o) => o.textContent)
    expect(heightOptions).toContain('Height — whole number')
    expect(heightOptions).not.toContain('Start date — date')
    expect(screen.getByText('0 of 23 fields mapped. What is not mapped is filled in by hand, as now.')).toBeInTheDocument()
  })

  it('maps a field to an input, and clears it', async () => {
    const onChange = vi.fn()
    render(<Host onChange={onChange} />)
    await screen.findByText(/5 inputs/)

    await userEvent.selectOptions(field('Start date'), 'f_start')
    expect(onChange).toHaveBeenLastCalledWith({ start_date: 'f_start' })
    expect(screen.getByText(/1 of 23 fields mapped/)).toBeInTheDocument()

    await userEvent.selectOptions(field('Start date'), '')
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('suggests a mapping from the names of the inputs, and clears it all', async () => {
    const onChange = vi.fn()
    render(<Host onChange={onChange} />)
    await screen.findByText(/5 inputs/)

    await userEvent.click(screen.getByRole('button', { name: 'Suggest a mapping' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ start_date: 'f_start', end_date: 'f_end', camera_model: 'f_model', location_id: 'f_loc' }))
    expect(field('Start date').value).toBe('f_start')

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('says when a mapped input is not in the form any more', async () => {
    render(<Host initial={{ habitat: 'gone' }} />)

    expect(await screen.findByText(/That input is not in the form any more/)).toBeInTheDocument()
    expect(field('Habitat').value).toBe('gone')
  })

  it('says when the input mapped cannot fill the field', async () => {
    render(<Host initial={{ start_date: 'f_height' }} />)

    expect(await screen.findByText(/A whole number input can’t fill this field/)).toBeInTheDocument()
  })

  it('does not read the form without a project saved, and says to save one', () => {
    render(<Host projectSaved={false} />)

    expect(screen.getByText(/There is no Epicollect5 project saved yet/)).toBeInTheDocument()
    expect(api.epicollectForm).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Suggest a mapping' })).toBeDisabled()
  })

  it('says why the form could not be read, and reads it again on request', async () => {
    vi.mocked(api.epicollectForm).mockRejectedValueOnce(new Error('Could not reach Epicollect5: no route'))
    render(<Host />)

    expect(await screen.findByText('Could not reach Epicollect5: no route')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reload the form' }))
    await waitFor(() => expect(screen.getByText(/5 inputs to choose from/)).toBeInTheDocument())
    expect(screen.queryByText(/no route/)).not.toBeInTheDocument()
  })

  it('warns that the form shown is the one of what is saved when the project was edited', async () => {
    render(<Host unsavedProject />)

    expect(await screen.findByText(/changed and not saved yet/)).toBeInTheDocument()
  })
})
