import type { ImageCheckProgress } from './api'

/** What a progress says, for the badge of the step that is running. */
export function describeImageCheckProgress(p: ImageCheckProgress | null): string {
  if (!p) return 'Checking…'
  const what = { cameras: 'Reading the cameras', dates: 'Reading the dates', corrupted: 'Looking for corrupted images' }[p.step]
  return p.step === 'cameras' ? `${what}…` : `${what}… ${p.done.toLocaleString('en-US')} of ${p.total.toLocaleString('en-US')}`
}
