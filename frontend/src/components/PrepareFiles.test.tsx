import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FilesReady, PreparingFiles, formatBytes, formatDuration } from './PrepareFiles'
import type { PrepareItem } from './PrepareFiles'

const done: PrepareItem = {
  id: 'R0001-DONA_0006', images: 3000, state: 'done', step: 3, packed: 3000,
  files: [{ name: 'a.zip', bytes: 2_000_000_000 }, { name: 'a.yaml', bytes: 300_000 }, { name: 'R0001_deployments.csv', bytes: 2048 }],
}
const working: PrepareItem = { id: 'R0001-DONA_0007', images: 2412, state: 'working', step: 2, packed: 1204, files: [] }

describe('formatBytes and formatDuration', () => {
  it('write sizes and times the way they are read', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3.02 * 1024 ** 3)).toBe('3.02 GB')
    expect(formatDuration(252_000)).toBe('4 min 12 s')
    expect(formatDuration(9_000)).toBe('9 s')
  })
})

describe('PreparingFiles', () => {
  it('shows the step, the images packed and the overall progress, and can be stopped', async () => {
    const onStop = vi.fn()
    render(<PreparingFiles items={[done, working]} startedAt={Date.now()} onStop={onStop} />)

    expect(screen.getByText('Writing the files…')).toBeInTheDocument()
    expect(screen.getByText('Packing the images · 1,204 of 2,412')).toBeInTheDocument()
    expect(screen.getByText('4,204 of 5,412 images in total')).toBeInTheDocument()
    expect(screen.getByText('78%')).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(screen.getByText('Step 2 of 3 · Packing the images')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalled()
  })
})

describe('FilesReady', () => {
  it('sums up what was written, and lists each deployment’s files', async () => {
    const onUpload = vi.fn()
    render(<FilesReady collection="R0001" items={[done]} outputDir="/out/R0001" startedAt={0} finishedAt={252_000} onOpenFolder={() => {}} onBack={() => {}} onUpload={onUpload} />)

    expect(screen.getByText('Files prepared')).toBeInTheDocument()
    expect(screen.getByText(/took 4 min 12 s/)).toBeInTheDocument()
    expect(screen.getByText('/out/R0001')).toBeInTheDocument()
    expect(screen.getByText('List of deployments in R0001')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /R0001-DONA_0006/ }))
    expect(screen.getByText('a.zip')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Upload to Trapper' }))
    expect(onUpload).toHaveBeenCalled()
  })

  it('says which deployments failed', () => {
    const failed: PrepareItem = { ...working, state: 'failed', error: 'Stopped.' }
    render(<FilesReady collection="R0001" items={[done, failed]} outputDir="/out/R0001" startedAt={0} finishedAt={1000} onOpenFolder={() => {}} onBack={() => {}} />)

    expect(screen.getByRole('alert')).toHaveTextContent('1 deployment could not be prepared')
    expect(screen.getByRole('alert')).toHaveTextContent('R0001-DONA_0007: Stopped.')
  })
})
