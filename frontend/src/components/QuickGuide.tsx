import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { LineIcon } from './TaskCard'

const COMPASS = <><circle cx="12" cy="12" r="9" /><path d="m15.500 8.500-2 5-5 2 2-5z" /></>
const DATABASE = <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.700 3.600 3 8 3s8-1.300 8-3V5" /><path d="M4 11v6c0 1.700 3.600 3 8 3s8-1.300 8-3v-6" /></>

/** The steps of the work from the first: the research project, and then the three of the menu. */
const STEPS: { badge: ReactNode; title: string; text: string }[] = [
  { badge: 'project', title: 'Create a research project', text: 'Define trappers, sites, cameras and SD cards once, or switch anytime from the top bar.' },
  { badge: '1', title: 'Register visits', text: 'Log field visits (who, when, site, actions) by hand or from your field CSV.' },
  { badge: '2', title: 'Create deployments', text: 'Pair closed visits with SD card photos to validate, rename and structure them in Camtrap DP.' },
  { badge: '3', title: 'Upload deployment', text: 'Send curated local deployments to your remote repository (e.g., TRAPPER).' },
]

/** The button of the title of the menu that opens the quick guide. */
export function QuickGuideButton({ onClick, expanded }: { onClick: () => void; expanded: boolean }) {
  return (
    <button type="button" aria-haspopup="dialog" aria-expanded={expanded} onClick={onClick}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-600 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800">
      <LineIcon size={16}>{COMPASS}</LineIcon>Quick guide
    </button>
  )
}

/** The panel at the right with the work from end to end: the research project and the three steps, on a line. It closes with its cross, the background or Escape. */
export default function QuickGuide({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Quick guide">
      <button type="button" aria-label="Close the guide" tabIndex={-1} className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-sm flex-col overflow-y-auto border-l border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"><LineIcon size={20}>{COMPASS}</LineIcon></span>
            <div>
              <h2 className="text-lg font-semibold leading-tight">Quick guide</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">End-to-end workflow</p>
            </div>
          </div>
          <button type="button" aria-label="Close the quick guide" className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={onClose}>
            <LineIcon size={20}><path d="M6 6l12 12M18 6L6 18" /></LineIcon>
          </button>
        </div>
        <ol className="relative space-y-6">
          <span aria-hidden="true" className="absolute bottom-6 left-[19px] top-6 w-px bg-zinc-300 dark:bg-zinc-700" />
          {STEPS.map((s) => (
            <li key={s.title} className="relative flex items-start gap-4">
              {s.badge === 'project'
                ? <span aria-hidden="true" className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><LineIcon size={20}>{DATABASE}</LineIcon></span>
                : <span aria-hidden="true" className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">{s.badge}</span></span>}
              <div>
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{s.title}</h3>
                <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-8 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300">
          Monitor progress in <strong className="font-semibold text-zinc-900 dark:text-zinc-100">Dashboards</strong> or fix dates &amp; local files in <strong className="font-semibold text-zinc-900 dark:text-zinc-100">Utils</strong>.
        </p>
      </aside>
    </div>
  )
}
