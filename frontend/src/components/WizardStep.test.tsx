import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import WizardStep from './WizardStep'

function Two() {
  const [done, setDone] = useState(false)
  return (
    <>
      <WizardStep n={1} title="First" description="" status={done ? 'done' : 'open'} canEdit onEdit={() => setDone(false)}>
        <button type="button" onClick={() => setDone(true)}>Next</button>
      </WizardStep>
      <WizardStep n={2} title="Second" description="" status={done ? 'open' : 'locked'} canEdit onEdit={() => {}}>
        <label>Name<input /></label>
        <button type="button">Review</button>
      </WizardStep>
    </>
  )
}

describe('WizardStep', () => {
  it('moves the focus to the first control of the step that opens when the button that was pressed goes with its step', async () => {
    render(<Two />)
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByLabelText('Name')).toHaveFocus()   // and not the button at the end of the page
  })
})
