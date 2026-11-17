import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'

interface Props { onStart: () => void }

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

/** Where the app stands: the Trapper it is connected to and the research project that comes filled in. */
function useStanding() {
  const [host, setHost] = useState<string | null>(null)
  const [project, setProject] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    Promise.resolve().then(() => api.getSettings()).then((s) => { if (alive) setProject(s?.GENERAL?.default_research_project?.trim() || null) }).catch(() => {})
    Promise.resolve().then(() => api.trapperTestConnection({})).then(async () => {
      const cfg = await api.trapperGetConfig()
      if (alive && cfg.base_url) setHost(new URL(cfg.base_url).host)
    }).catch(() => {})
    return () => { alive = false }
  }, [])
  return { host, project }
}

export default function WelcomePage({ onStart }: Props) {
  const { host, project } = useStanding()
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 flex flex-col items-center" style={{ minHeight: 'calc(100vh - 56px)' }}>
      <span aria-hidden="true" className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
        <svg viewBox="0 0 24 24" className="h-9 w-9 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.450 5.110 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.450-6.890A2 2 0 0 0 16.760 4H7.240a2 2 0 0 0-1.790 1.110z" /></svg>
      </span>
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
      <button type="button" className="mt-8 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-base flex items-center gap-2" onClick={onStart}>
        Get started
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
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
