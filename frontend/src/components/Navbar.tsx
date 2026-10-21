import { useEffect, useState } from 'react'

interface Props {
  version: string | null
  /** Goes back to the menu. */
  onHome: () => void
  onOpenSettings: () => void
  settingsOpen: boolean
}

/** The published documentation (docs/, see mkdocs.yml's site_url). */
export const DOCS_URL = 'https://wildintelproject.github.io/wildintel-uploader/'

/** The project on GitHub (see mkdocs.yml's repo_url). */
export const REPO_URL = 'https://github.com/wildintelproject/wildintel-uploader'

const btnOutline = 'px-3 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors'

export default function Navbar({ version, onHome, onOpenSettings, settingsOpen }: Props) {
  const [dark, setDark] = useState(true)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  return (
    <nav className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <div className="max-w-screen-2xl mx-auto px-4 h-14 flex items-center">
        <button type="button" className="flex items-center rounded hover:opacity-80 transition-opacity" title="Go to the menu" onClick={onHome}>
          <span className="font-bold text-zinc-900 dark:text-zinc-100 text-base">
            📤 WildINTEL Uploader
          </span>
          {version && (
            <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500 font-mono">
              v{version}
            </span>
          )}
        </button>

        <div className="ml-auto flex items-center gap-2">
          <a
            className={`${btnOutline} no-underline`}
            href={DOCS_URL} target="_blank" rel="noopener noreferrer"
            title="User and developer documentation"
          >
            ? Help
          </a>
          <button
            className={`${btnOutline} ${settingsOpen ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
            title="Settings" aria-label="Settings" aria-pressed={settingsOpen}
            onClick={onOpenSettings}
          >
            ⚙️
          </button>
          <button
            className={btnOutline}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setDark(d => !d)}
          >
            {dark ? '☀️' : '🌙'}
          </button>
        </div>
      </div>
    </nav>
  )
}
