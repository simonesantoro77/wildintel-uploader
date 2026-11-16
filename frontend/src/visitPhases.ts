import type { VisitState } from './types'

/** What a visit's state is called, wherever it is told: the visit dashboard, the closed visits. */
export const PHASE_LABEL: Record<VisitState, string> = { planned: 'Planned', deployed: 'Deployed', collected: 'Collected', stolen: 'Stolen', not_visited: 'Not visited', no_camera: 'No camera', unknown: 'Unknown' }

/** The colours of the pill of a state. */
export const PHASE_BADGE: Record<VisitState, string> = {
  planned: 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300',
  deployed: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300',
  collected: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  stolen: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  not_visited: 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200',
  no_camera: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
  unknown: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300',
}


/** The colour of a state on the map of the sites — its point, and the dot of its legend. */
export const PHASE_FILL: Record<VisitState, string> = {
  planned: 'fill-zinc-400 dark:fill-zinc-500',
  deployed: 'fill-amber-500',
  collected: 'fill-emerald-500',
  stolen: 'fill-red-500',
  not_visited: 'fill-slate-500',
  no_camera: 'fill-sky-500',
  unknown: 'fill-violet-500',
}
export const PHASE_DOT: Record<VisitState, string> = {
  planned: 'bg-zinc-400 dark:bg-zinc-500',
  deployed: 'bg-amber-500',
  collected: 'bg-emerald-500',
  stolen: 'bg-red-500',
  not_visited: 'bg-slate-500',
  no_camera: 'bg-sky-500',
  unknown: 'bg-violet-500',
}
