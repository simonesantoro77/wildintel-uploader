import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import { working } from '../researchProjects'
import type { LocalResearchProject } from '../types'
import { DEFAULT_PROJECT_CHANGED } from '../components/DefaultResearchProject'

interface Props {
  /** Goes on with what there is: the menu, or the runs that were left unfinished. */
  onStart: () => void
  /** Starts a research project: the initial setup. */
  onNewProject: () => void
}

const ICONS: Record<string, ReactNode> = {
  visits: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />,
  deployment: <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>,
  session: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  upload: <><path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9" /><path d="M12 12v9M8 16l4-4 4 4" /></>,
}

const TASKS = [
  { icon: 'visits', title: 'Manage visits', description: 'Register who visited each camera trap, when and what was done, and look at the visit book.' },
  { icon: 'deployment', title: 'Manage deployments', description: 'Import the images of a deployment, see how far the deployments are, or compare them with the previous revisions.' },
  { icon: 'upload', title: 'Manage uploads', description: 'Send a deployment to a repository, or see how far the uploads are.' },
]

/** Where the app stands: the Trapper it is connected to, the research project that comes filled in and the research projects there are — none until it is known,
 * and an empty failure when it cannot be told. */
function useStanding() {
  const [host, setHost] = useState<string | null>(null)
  const [project, setProject] = useState<string | null>(null)
  const [projects, setProjects] = useState<LocalResearchProject[] | 'unknown' | null>(null)
  useEffect(() => {
    let alive = true
    Promise.resolve().then(() => api.listResearchProjects()).then((r) => { if (alive) setProjects(r.results) }).catch(() => { if (alive) setProjects('unknown') })
    Promise.resolve().then(() => api.getSettings()).then((s) => { if (alive) setProject(s?.GENERAL?.default_research_project?.trim() || null) }).catch(() => {})
    Promise.resolve().then(() => api.trapperTestConnection({})).then(async () => {
      const cfg = await api.trapperGetConfig()
      if (alive && cfg.base_url) setHost(new URL(cfg.base_url).host)
    }).catch(() => {})
    return () => { alive = false }
  }, [])
  return { host, project, setProject, projects }
}

export default function WelcomePage({ onStart, onNewProject }: Props) {
  const { host, project, setProject, projects } = useStanding()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === 'Escape') setOpen(false); return }
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [open])
  /** Picks the research project to go on with: it is the default one from then on, as in the header. */
  async function choose(acronym: string) {
    setError(null)
    if (acronym.toLowerCase() !== (project ?? '').toLowerCase()) {
      try { await api.setDefaultResearchProject(acronym) } catch (e) { setError(e instanceof Error ? e.message : 'The research project could not be changed.'); return }
      setProject(acronym)
      window.dispatchEvent(new Event(DEFAULT_PROJECT_CHANGED))
    }
    setOpen(false)
  }
  const arrow = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
  const primary = 'px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-base flex items-center gap-2'
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 flex flex-col items-center" style={{ minHeight: 'calc(100vh - 56px)' }}>
      <img src="/logo.svg" alt="" aria-hidden="true" width={64} height={64} className="mb-3 h-16 w-16 rounded-2xl" />
      <h1 className="text-2xl font-bold mb-2 text-center">WildINTEL Uploader</h1>
      <p className="text-zinc-500 dark:text-zinc-400 mb-8 text-base text-center max-w-[480px]">
        Bring camera-trap images from a memory card into the WildINTEL project, organized and registered in Trapper.
      </p>
      <ul className="w-full max-w-[460px] list-none p-0 m-0 space-y-4 text-left">
        {TASKS.map((t) => (
          <li key={t.title} className="flex items-start gap-3 text-sm text-zinc-500 dark:text-zinc-400">
            <span className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-300">
              <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[t.icon]}</svg>
            </span>
            <span><strong className="font-semibold text-zinc-900 dark:text-zinc-100">{t.title}</strong> — {t.description}</span>
          </li>
        ))}
      </ul>
      <div className="mt-8 flex min-h-[2.75rem] flex-wrap items-start justify-center gap-4">
        {projects === null ? null : projects !== 'unknown' && projects.length > 0 ? (
          <>
            {/* there is a research project: to go on with it — or with another, picked from the list — and to start a new one */}
            <div ref={box} className="relative">
              <div className="flex items-stretch rounded-xl bg-blue-600 text-white">
                <button type="button" aria-label={project ? `Continue with ${project}` : 'Continue'} className="flex items-center gap-2 rounded-l-xl px-6 py-3 text-base font-medium transition-colors hover:bg-blue-700" onClick={onStart}>
                  {project ? `Continue with ${project}` : 'Continue'}{arrow}
                </button>
                <span aria-hidden="true" className="my-2 w-px bg-white/30" />
                <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label="Pick the research project" title="Pick the research project" className="flex items-center rounded-r-xl px-4 transition-colors hover:bg-blue-700" onClick={() => setOpen((o) => !o)}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                </button>
              </div>
              {open && (
                <ul role="listbox" aria-label="Research projects" className="absolute left-0 z-30 mt-2 min-w-[20rem] overflow-hidden rounded-xl border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 p-1.5 text-left shadow-xl">
                  {working(projects, project).map((p) => {
                    const selected = p.acronym.toLowerCase() === (project ?? '').toLowerCase()
                    return (
                      <li key={p.acronym} role="option" aria-selected={selected} tabIndex={0} onClick={() => void choose(p.acronym)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void choose(p.acronym) } }}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-base hover:bg-zinc-100 dark:hover:bg-zinc-800 ${selected ? 'bg-sky-50 dark:bg-sky-950/40' : ''}`}>
                        <span aria-hidden="true" className="w-4 text-sky-500">{selected ? '✓' : ''}</span>
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">{p.acronym}</span>
                        {selected
                          ? <span className="ml-auto rounded-full bg-zinc-200 dark:bg-zinc-700 px-3 py-0.5 text-sm text-zinc-600 dark:text-zinc-300">Default</span>
                          : <span className="ml-auto truncate pl-6 text-sm text-zinc-500 dark:text-zinc-400">{p.name}</span>}
                      </li>
                    )
                  })}
                  {error && <li role="alert" className="px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</li>}
                </ul>
              )}
            </div>
            <button type="button" className="flex items-center gap-2 rounded-xl border border-zinc-300 dark:border-zinc-600 px-6 py-3 text-base text-zinc-800 dark:text-zinc-100 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={onNewProject}>
              <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>Create a new research project
            </button>
          </>
        ) : (
          // none: there is nothing to work on, so the first thing is the initial setup — and when it cannot be told, the app finds out
          <button type="button" className={primary} onClick={projects !== 'unknown' ? onNewProject : onStart}>Get started{arrow}</button>
        )}
      </div>
      {(host || project) && (
        <p role="status" className="mt-6 inline-flex items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 px-4 py-1.5 text-xs text-zinc-600 dark:text-zinc-400">
          {host && <><span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Connected to {host}</>}
          {host && project && <span aria-hidden="true">·</span>}
          {project && <>Default project {project}</>}
        </p>
      )}
    </div>
  )
}
