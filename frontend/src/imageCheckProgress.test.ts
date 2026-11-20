import { describe, expect, it } from 'vitest'
import { describeImageCheckProgress } from './imageCheckProgress'

describe('describeImageCheckProgress', () => {
  it('says only that it checks before anything is told', () => {
    expect(describeImageCheckProgress(null)).toBe('Checking…')
  })
  it('counts the images of the steps that go image by image', () => {
    expect(describeImageCheckProgress({ type: 'progress', step: 'corrupted', done: 1200, total: 3828 })).toBe('Looking for corrupted images… 1,200 of 3,828')
    expect(describeImageCheckProgress({ type: 'progress', step: 'dates', done: 5, total: 10 })).toBe('Reading the dates… 5 of 10')
  })
  it('does not count the cameras, which are read all at once', () => {
    expect(describeImageCheckProgress({ type: 'progress', step: 'cameras', done: 0, total: 3828 })).toBe('Reading the cameras…')
  })
})
