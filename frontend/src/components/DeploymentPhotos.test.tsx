import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', () => ({ api: { deploymentPhotos: vi.fn(), deploymentPhotoUrl: vi.fn((_p: string, _c: string, _d: string, name: string, size: string) => `/photo/${name}?${size}`) } }))
import { api } from '../api'
import DeploymentPhotos from './DeploymentPhotos'

const PHOTOS = Array.from({ length: 10 }, (_, i) => ({ name: `R0001-DONA_01__${i + 1}.JPEG`, taken: `2026-10-25T00:0${i}:00` }))

describe('DeploymentPhotos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.deploymentPhotos).mockResolvedValue({ photos: PHOTOS })
  })

  it('lists the photos in a table as the dashboards do — paged, searchable — and opens one big, with the ones before and after it', async () => {
    render(<DeploymentPhotos researchProjectId="DONA" collection="R0001" deploymentId="R0001-DONA_01" timezone="Europe/Madrid" onClose={vi.fn()} />)

    const table = await screen.findByRole('table', { name: 'Images' })
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(8)
    expect(screen.getByText('10 images')).toBeInTheDocument()
    expect(within(table).getAllByText('25 Oct 2026, 00:00 (Europe/Madrid)').length).toBeGreaterThan(0)
    expect(screen.getByRole('status')).toHaveTextContent('Showing 1–8 of 10 images')

    await userEvent.type(screen.getByLabelText('Search the images'), '__10')
    expect(within(screen.getByRole('table', { name: 'Images' })).getAllByRole('row').slice(1)).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Open the image R0001-DONA_01__10.JPEG' }))
    expect(screen.getByAltText('R0001-DONA_01__10.JPEG')).toHaveAttribute('src', '/photo/R0001-DONA_01__10.JPEG?large')
    expect(screen.getByText('10 of 10')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Previous image' }))
    expect(screen.getByText('9 of 10')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to the images' }))
    expect(screen.getByRole('table', { name: 'Images' })).toBeInTheDocument()
  })

  it('says so when the deployment has no photos in its folder, or they cannot be read', async () => {
    vi.mocked(api.deploymentPhotos).mockResolvedValueOnce({ photos: [] })
    const { unmount } = render(<DeploymentPhotos researchProjectId="DONA" collection="R0001" deploymentId="R0001-DONA_01" onClose={vi.fn()} />)
    expect(await screen.findByText('This deployment has no images in its folder.')).toBeInTheDocument()
    unmount()
    vi.mocked(api.deploymentPhotos).mockRejectedValueOnce(new Error('The deployment is not in the collections folder.'))
    render(<DeploymentPhotos researchProjectId="DONA" collection="R0001" deploymentId="R0001-DONA_01" onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('not in the collections folder')
  })
})
