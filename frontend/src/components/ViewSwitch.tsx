import type { ReactNode } from 'react'

/** A small icon of a label. */
export function Glyph({ children, className = 'h-4 w-4' }: { children: ReactNode; className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={`${className} shrink-0 fill-none stroke-current`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
}

export type View = 'table' | 'labels' | 'search' | 'map'

/** The buttons at the right of the toolbar that change the view: the table, the labels, the sites on a map, or only the search field — which picks from a list under it. */
export function ViewSwitch({ view, items, onChange, views = ['table', 'labels', 'search'] }: { view: View; items: string; onChange: (view: View) => void
  /** Which of the views it offers: all three when it is not said. */
  views?: View[] }) {
  const choices: { view: View; name: string; icon: ReactNode }[] = [
    { view: 'table', name: `Show the ${items} as a table`, icon: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /> },
    { view: 'labels', name: `Show the ${items} as labels`, icon: <><rect x="4" y="4" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" /></> },
    { view: 'map', name: `Show the ${items} on a map`, icon: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.400-6.500 11-6.500 11z" /><circle cx="12" cy="10" r="2.300" /></> },
    { view: 'search', name: 'Show only the search field', icon: <><rect x="3" y="7" width="18" height="10" rx="3" /><path d="M9 12h6" /></> },
  ]
  return (
    <div role="group" aria-label="View" className="inline-flex gap-1 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-1">
      {choices.filter((c) => views.includes(c.view)).map((c) => (
        <button key={c.view} type="button" aria-pressed={view === c.view} aria-label={c.name} title={c.name} onClick={() => onChange(c.view)}
                className={`rounded-lg p-2 transition-colors ${view === c.view ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300' : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
          <Glyph>{c.icon}</Glyph>
        </button>
      ))}
    </div>
  )
}

