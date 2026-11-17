import { useEffect, useState } from 'react'
import { api } from '../api'
import { defaultResearchProject } from '../defaultResearchProject'
import type { LocalResearchProject } from '../types'

/** The research project the general settings say is the default — the active one — read again when the settings are closed, as it may have been changed. */
/** Said on the window when the header changes the default research project: the pages read it again. */
export const DEFAULT_PROJECT_CHANGED = 'wildintel:default-research-project'

export function useDefaultResearchProject(settingsOpen?: boolean): { project: LocalResearchProject | undefined; defaultAcronym: string | null; error: string | null } {
  const [project, setProject] = useState<LocalResearchProject | undefined>(undefined)
  const [defaultAcronym, setDefaultAcronym] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [changes, setChanges] = useState(0)
  useEffect(() => {
    const again = () => setChanges(n => n + 1)
    window.addEventListener(DEFAULT_PROJECT_CHANGED, again)
    return () => window.removeEventListener(DEFAULT_PROJECT_CHANGED, again)
  }, [])
  useEffect(() => {
    if (settingsOpen) return
    let cancelled = false
    void (async () => {
      const acronym = await defaultResearchProject()
      if (cancelled) return
      setDefaultAcronym(acronym)
      try {
        const { results } = await api.listResearchProjects()
        if (!cancelled) setProject(results.find((p) => p.acronym.toLowerCase() === acronym.toLowerCase()))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not read the research projects.')
      }
    })()
    return () => { cancelled = true }
  }, [settingsOpen, changes])
  return { project, defaultAcronym, error }
}

const GEAR = <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>

/** The card that says which research project the page is of — the default one: its label, its acronym and name, and the gear that goes to the settings where it is changed.
 * The same card in every page: `compact` is kept for the pages that said it, and changes nothing. */
export default function DefaultResearchProject({ project, defaultAcronym, onOpenSettings }: {
  project: LocalResearchProject | undefined; defaultAcronym: string | null; of?: string; onOpenSettings?: (section?: 'general') => void
  compact?: boolean
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/60 px-3 py-1.5 text-xs sm:min-w-[14rem]"
         title={onOpenSettings ? undefined : 'Change it in Settings › General.'}>
      <div className="flex min-w-0 flex-col">
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Research project</span>
        {project ? <span className="truncate font-bold text-zinc-900 dark:text-zinc-100"><span className="font-mono">{project.acronym}</span> <span className="font-normal text-zinc-500 dark:text-zinc-400">— {project.name}</span></span>
          : defaultAcronym === null ? <span className="text-zinc-500 dark:text-zinc-400">Reading the settings…</span>
          : defaultAcronym ? <span className="text-amber-700 dark:text-amber-400">The default research project, <span className="font-mono">{defaultAcronym}</span>, is not in the collections folder.</span>
          : <span className="text-amber-700 dark:text-amber-400">No default research project is set.</span>}
      </div>
      {onOpenSettings && (
        <button type="button" aria-label="Change it in the settings" title="Change it in the settings" onClick={() => onOpenSettings('general')}
                className="ml-auto rounded p-1.5 text-blue-600 dark:text-blue-400 hover:bg-zinc-100 dark:hover:bg-zinc-700/60 transition-colors">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{GEAR}</svg>
        </button>
      )}
    </div>
  )
}
