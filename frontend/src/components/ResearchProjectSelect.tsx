import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { LocalResearchProject } from '../types'
import { DEFAULT_PROJECT_CHANGED, useDefaultResearchProject } from './DefaultResearchProject'

/** The research project the application works on — the default one —, in the header: it says which, and lists the ones defined to change it. */
export default function ResearchProjectSelect({ settingsOpen, onCreate }: { settingsOpen?: boolean
  /** Creates a new research project: the Initial setup of the utilities. The last option of the list, when it is given. */
  onCreate?: () => void }) {
  const { project, defaultAcronym } = useDefaultResearchProject(settingsOpen)
  const [projects, setProjects] = useState<LocalResearchProject[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    api.listResearchProjects().then(r => { if (!cancelled) setProjects(r.results) }).catch(() => { if (!cancelled) setProjects([]) })
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === 'Escape') setOpen(false); return }
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      cancelled = true
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  async function choose(acronym: string) {
    setError(null)
    if (acronym.toLowerCase() === (project?.acronym ?? defaultAcronym ?? '').toLowerCase()) { setOpen(false); return }
    try {
      await api.setDefaultResearchProject(acronym)
      window.dispatchEvent(new Event(DEFAULT_PROJECT_CHANGED))
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The research project could not be changed.')
    }
  }

  const current = project?.acronym ?? defaultAcronym
  return (
    <div ref={box} className="relative">
      <button
        type="button" aria-haspopup="listbox" aria-expanded={open} aria-label="Default research project" title="Change the research project"
        onClick={() => setOpen(o => !o)}
        className="flex max-w-[32rem] items-center gap-2 px-3 py-1.5 text-sm uppercase border border-zinc-300 dark:border-zinc-600 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-emerald-600 dark:stroke-emerald-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.700 3.600 3 8 3s8-1.300 8-3V5" /><path d="M4 11v6c0 1.700 3.600 3 8 3s8-1.300 8-3v-6" />
        </svg>
        <span className="truncate">
          {current
            ? <>Research project: <span className="font-semibold text-zinc-900 dark:text-zinc-100">{project?.acronym ?? current}</span>{project ? <> — {project.name}</> : <span className="normal-case text-amber-700 dark:text-amber-400"> (not in the collections folder)</span>}</>
            : defaultAcronym === null ? 'Reading the settings…' : <span className="text-amber-700 dark:text-amber-400">No research project</span>}
        </span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <ul role="listbox" aria-label="Research projects" className="absolute right-0 z-30 mt-1 min-w-full max-h-72 overflow-y-auto rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 py-1 shadow-lg">
          {projects.length === 0 && <li className="px-3 py-1.5 text-sm text-zinc-500 dark:text-zinc-400">No research projects defined.</li>}
          {projects.map(p => {
            const selected = p.acronym.toLowerCase() === (current ?? '').toLowerCase()
            return (
              <li key={p.acronym} role="option" aria-selected={selected} tabIndex={0}
                  className={`cursor-pointer whitespace-nowrap px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${selected ? 'font-semibold' : ''}`}
                  onClick={() => void choose(p.acronym)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void choose(p.acronym) } }}>
                {selected ? '✓ ' : ''}<span className="font-mono">{p.acronym}</span> — {p.name}
              </li>
            )
          })}
          {error && <li role="alert" className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400">{error}</li>}
          {onCreate && (
            <li role="presentation" className="mt-1 border-t border-zinc-200 dark:border-zinc-700 pt-1">
              <button type="button" onClick={() => { setOpen(false); onCreate() }}
                      className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-sm font-medium text-emerald-700 dark:text-emerald-300 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                Create a new research project
                <svg aria-hidden="true" viewBox="0 0 24 24" className="ml-auto h-4 w-4 shrink-0 fill-none stroke-zinc-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
