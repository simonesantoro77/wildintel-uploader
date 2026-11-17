import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from './Dashboard'
import LanguageButton from './LanguageButton'
import { useCurrentTrail } from './Trail'

interface Props {
  version: string | null
  /** Goes back to the welcome screen. */
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
  const { t } = useTranslation()
  const trail = useCurrentTrail()
  const [dark, setDark] = useState(true)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  return (
    <nav className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 print:hidden">
      <div className="max-w-screen-2xl mx-auto px-4 py-2 flex items-center gap-3">
        <button type="button" aria-label={t('navbar.home')} title={t('navbar.home')} onClick={onHome}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 hover:opacity-80 transition-opacity">
          <Icon className="h-6 w-6" path={<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.450 5.110 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.450-6.890A2 2 0 0 0 16.760 4H7.240a2 2 0 0 0-1.790 1.110z" /></>} />
        </button>
        <div className="min-w-0 flex-1 flex flex-col justify-center gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-bold text-zinc-900 dark:text-zinc-100 text-lg leading-tight">WildINTEL Uploader</span>
            {version && (
              <span className="rounded-full bg-cyan-100 dark:bg-cyan-950 px-2 py-0.5 text-xs font-mono text-cyan-700 dark:text-cyan-300">v{version}</span>
            )}
          </div>
          {trail && (
            <nav aria-label="You are here" className="flex min-w-0 items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
              {trail.steps.map((step, i) => {
                const last = i === trail.steps.length - 1
                return (
                  <span key={step.label} className="flex shrink-0 items-center gap-1.5">
                    {i > 0 && <span aria-hidden="true">›</span>}
                    {last
                      ? (
                        <span aria-current="page" className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 dark:border-emerald-500/50 bg-emerald-100 dark:bg-emerald-950/60 px-3 py-1 font-medium text-zinc-900 dark:text-zinc-100">
                          {step.icon && <Icon path={step.icon} className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
                          {step.label}
                        </span>
                      )
                      : step.onClick
                        ? <button type="button" className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={step.onClick}>{step.label}</button>
                        : <span>{step.label}</span>}
                  </span>
                )
              })}
              {trail.description && <span className="hidden min-w-0 truncate lg:inline" title={trail.description}>— {trail.description}</span>}
            </nav>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <a
            className={`${btnOutline} no-underline`}
            href={DOCS_URL} target="_blank" rel="noopener noreferrer"
            title={t('navbar.helpTitle')}
          >
            ? {t('navbar.help')}
          </a>
          <LanguageButton />
          <button
            className={`${btnOutline} ${settingsOpen ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
            title={t('navbar.settings')} aria-label={t('navbar.settings')} aria-pressed={settingsOpen}
            onClick={onOpenSettings}
          >
            ⚙️
          </button>
          <button
            className={btnOutline}
            title={dark ? t('navbar.toLight') : t('navbar.toDark')}
            onClick={() => setDark(d => !d)}
          >
            {dark ? '☀️' : '🌙'}
          </button>
        </div>
      </div>
    </nav>
  )
}
