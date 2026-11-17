import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import Navbar from '../components/Navbar'
import { TrailProvider } from '../components/Trail'

/** Renders a page under the header of the application, which says the path to it. */
export function renderWithHeader(page: ReactElement, onMenu: () => void = () => {}) {
  return render(
    <TrailProvider onMenu={onMenu}>
      <Navbar version={null} onHome={() => {}} onOpenSettings={() => {}} settingsOpen={false} />
      {page}
    </TrailProvider>,
  )
}
