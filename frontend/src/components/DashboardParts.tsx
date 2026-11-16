import { useEffect, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { btnOutline, btnPrimary } from '../pages/ImportDeploymentPage'
import { pageNumbers } from './CheckFailures'
import { Icon } from './Dashboard'
import RevisionSquares, { type RevisionSquare } from './RevisionSquares'

/** The pieces the dashboards of the visits, of the deployments and of the uploads share: the same header, the same help panel, the same cards and the same table. */

/** The button that folds a section away and brings it back: a chevron that points right when it is folded and down when it is open. */
export function FoldButton({ open, onToggle, name }: { open: boolean; onToggle: () => void; name: string }) {
  return (
    <button type="button" aria-expanded={open} aria-label={`${open ? 'Fold away' : 'Show'} ${name}`} title={`${open ? 'Fold away' : 'Show'} ${name}`} onClick={onToggle}
            className={`mr-1 rounded p-1 transition-colors ${open ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400'}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{open ? <path d="M6 9l6 6 6-6" /> : <path d="M9 6l6 6-6 6" />}</svg>
    </button>
  )
}

/** The head of a dashboard: its icon, its title and what it is, a line of buttons under them, and a card at the right — the research project. */
export function DashboardHeader({ icon, title, description, actions, aside }: { icon: ReactNode; title: string; description: ReactNode; actions?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/80 dark:bg-zinc-900/80 px-5 py-4 shadow-sm sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
            <Icon path={icon} className="h-6 w-6" />
          </span>
          <div>
            <h4 className="text-xl font-semibold leading-tight">{title}</h4>
            <p className="text-zinc-500 dark:text-zinc-400 text-sm">{description}</p>
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Dashboard actions">{actions}</div>}
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </header>
  )
}

/** The button of the header that opens the legend and the help. */
export function HelpButton({ onClick, expanded, label = 'Help & Legend' }: { onClick: () => void; expanded: boolean; label?: string }) {
  return (
    <button type="button" className={`${btnOutline} inline-flex items-center gap-2`} aria-haspopup="dialog" aria-expanded={expanded} onClick={onClick}>
      <Icon path={<><circle cx="12" cy="12" r="9" /><path d="M9.500 9a2.500 2.500 0 015 .5c0 1.500-2.500 2-2.500 3.500M12 17h.01" /></>} className="h-4 w-4" />
      {label}
    </button>
  )
}

/** The button of the header that downloads something. */
export function DownloadButton({ onClick, busy, title, children }: { onClick: () => void; busy: boolean; title: string; children: ReactNode }) {
  return (
    <button type="button" className={`${btnPrimary} inline-flex items-center gap-2`} disabled={busy} onClick={onClick} title={title}>
      <Icon path={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>} className="h-4 w-4" />
      {children}
    </button>
  )
}

/** The panel at the right with the legend and the help of a dashboard: it closes with its cross, the button at the foot, the background or Escape. */
export function HelpDrawer({ onClose, children, title = 'Dashboard legend & help' }: { onClose: () => void; children: ReactNode; title?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title.replace(' & ', ' and ')}>
      <button type="button" aria-label="Close the help" tabIndex={-1} className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col justify-between overflow-y-auto border-l border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 shadow-2xl">
        <div>
          <div className="mb-5 flex items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-700 pb-4">
            <h5 className="flex items-center gap-3 text-lg font-semibold">
              <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400"><Icon path={<><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></>} className="h-4 w-4" /></span>
              {title}
            </h5>
            <button type="button" aria-label="Close the help" className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={onClose}>
              <Icon path={<path d="M6 6l12 12M18 6L6 18" />} className="h-5 w-5" />
            </button>
          </div>
          <section aria-label="Legend" className="space-y-3 text-sm">{children}</section>
        </div>
        <div className="mt-6 border-t border-zinc-200 dark:border-zinc-700 pt-4 text-right">
          <button type="button" className={btnPrimary} onClick={onClose}>Got it, close</button>
        </div>
      </aside>
    </div>
  )
}

/** A card of the help panel: a title with its icon, and what it says. */
export function HelpCard({ title, tone, icon, children }: { title: string; tone: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4">
      <h6 className={`mb-1.5 flex items-center gap-2 font-semibold ${tone}`}><Icon path={icon} className="h-4 w-4" />{title}</h6>
      <div className="text-zinc-500 dark:text-zinc-400">{children}</div>
    </div>
  )
}

/** The icons of the cards of the help panel. */
export const HELP_ICONS = {
  progress: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  tags: <><path d="M20.600 13.400l-7.200 7.200a2 2 0 01-2.800 0L3 13V3h10l7.600 7.600a2 2 0 010 2.800z" /><path d="M7.500 7.500h.01" /></>,
  images: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.500" cy="10" r="1.500" /><path d="M21 16l-5-5-8 8" /></>,
  filter: <path d="M3 5h18l-7 8v6l-4-2v-4z" />,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></>,
}

/** The section of the revisions: its title with the chevron that folds it, and the squares — or only the title when it is folded. */
export function RevisionSelection({ open, onToggle, hint = 'Select one to filter the rows', all, revisions, value, onPick }: {
  open: boolean; onToggle: () => void; hint?: string
  all?: Omit<RevisionSquare, 'id'>; revisions: RevisionSquare[]; value: string; onPick: (id: string) => void
}) {
  const title = <><FoldButton open={open} onToggle={onToggle} name="the revision selection" /><span className="text-sm font-semibold text-zinc-900 dark:text-zinc-200">Revision selection</span>{' '}<span className="text-xs font-normal">({hint})</span></>
  return (
    <section aria-label="Revision" className="mb-6">
      {open
        ? <RevisionSquares description={title} all={all} revisions={revisions} value={value} onPick={onPick} />
        : <p className="flex items-center text-sm text-zinc-500 dark:text-zinc-400">{title}</p>}
    </section>
  )
}

/** The section of the status cards: its title with the chevron that folds it, what to do with the cards, and the cards — or only the title when it is folded. */
export function MetricsSection({ label, open, onToggle, hint, title = 'Status metrics & filters', children }: { label: string; open: boolean; onToggle: () => void; hint: string; title?: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="mb-5 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          <FoldButton open={open} onToggle={onToggle} name={title === 'Status metrics & filters' ? 'the status metrics' : `the ${title.replace(/ & filters$/, '').toLowerCase()}`} />{title}
        </span>
        {open && <span className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
      </div>
      {open && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{children}</div>}
    </section>
  )
}

/** The card of the progress: how much is done of all there is, with its bar. `segments` are the parts of the bar, as percentages and the classes of their colour. */
export function ProgressCard({ percent, done, total, segments, caption, barLabel, barMax, title = 'Progress' }: {
  percent: number; done: number; total: number; segments: { width: number; className: string }[]; caption: string; barLabel: string; barMax?: number; title?: string
}) {
  return (
    <div className="flex flex-col justify-between gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/50 p-3.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-zinc-500 dark:text-zinc-400">{title}</span>
        <span className="font-bold text-emerald-600 dark:text-emerald-400">{percent}%</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{done}</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">/ {total}</span>
      </div>
      <div role="progressbar" aria-label={barLabel} aria-valuemin={0} aria-valuemax={barMax ?? total} aria-valuenow={done} className="flex h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700/60">
        {segments.map((p, i) => <div key={i} className={p.className} style={{ width: `${p.width}%` }} />)}
      </div>
      <span className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">{caption}</span>
    </div>
  )
}

/** The panel that holds the search, the filters, the table and its foot, as one. */
export function TableCard({ label, children }: { label: string; children: ReactNode }) {
  return <section aria-label={label} className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl">{children}</section>
}

/** A choice of the toolbar of a table: a select with its options — `all` is the text of the one that keeps everything, none (null) when one of the options is always picked, as in Group by. */
export interface ToolbarChoice { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; all?: string | null }

/** The search of the table, a choice among a few of what to show (the status, the uploader), and the button that puts all the filters back. */
export function TableToolbar({ searchLabel, placeholder, text, onText, choice, extra, trailing, onReset, onSearchFocus, onSearchBlur, onSearchKeyDown }: {
  searchLabel: string; placeholder: string; text: string; onText: (text: string) => void
  /** One or several choices, each a select beside the others. */
  choice?: ToolbarChoice | ToolbarChoice[]
  /** Something more beside the choices, before the reset button — the buttons of the view, for one. */
  extra?: ReactNode
  /** Something at the right of the reset button — the button that changes the view, for one. */
  trailing?: ReactNode
  onReset: () => void
  /** What the search field does when it takes the focus, loses it or has a key pressed — to open a list under it, for one. */
  onSearchFocus?: () => void; onSearchBlur?: () => void; onSearchKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void
}) {
  const choices = choice === undefined ? [] : Array.isArray(choice) ? choice : [choice]
  return (
    <div role="search" className="flex flex-col items-stretch justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 p-4 md:flex-row md:items-center">
      <div className="relative min-w-[14rem] flex-1">
        <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400"><Icon path={<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>} className="h-3.5 w-3.5" /></span>
        <input aria-label={searchLabel} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700/80 bg-white dark:bg-zinc-950 py-2 pl-9 pr-8 text-xs text-zinc-900 dark:text-zinc-200 placeholder-zinc-500 transition focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder={placeholder} value={text} onChange={(e) => onText(e.target.value)} onFocus={onSearchFocus} onBlur={onSearchBlur} onKeyDown={onSearchKeyDown} />
        {text && (
          <button type="button" aria-label="Clear the search" className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" onClick={() => onText('')}>
            <Icon path={<path d="M6 6l12 12M18 6L6 18" />} className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        {choices.map((c) => (
          <label key={c.label} className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">{c.label}
            <select aria-label={c.label} className="cursor-pointer rounded-xl border border-zinc-300 dark:border-zinc-700/80 bg-white dark:bg-zinc-950 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" value={c.value} onChange={(e) => c.onChange(e.target.value)}>
              {c.all !== null && <option value="">{c.all ?? 'All'}</option>}
              {c.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        ))}
        {extra}
        <button type="button" title="Reset the filters" aria-label="Reset the filters" className="flex items-center gap-1 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 transition hover:bg-zinc-200 dark:hover:bg-zinc-700" onClick={onReset}>
          <Icon path={<><path d="M21 12a9 9 0 11-3-6.700" /><path d="M21 4v5h-5" /></>} className="h-3 w-3" />
          <span className="hidden sm:inline">Reset</span>
        </button>
        {trailing}
      </div>
    </div>
  )
}

/** The line under the search that says which filters are on, and how many of the rows match. */
export function ActiveFilters({ filters, summary }: { filters: { label: string; tone: 'blue' | 'green' }[]; summary: string }) {
  return (
    <div aria-label="Active filters" className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800 bg-blue-50/60 dark:bg-blue-950/20 px-4 py-2 text-xs text-blue-700 dark:text-blue-300">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Active filters:</span>
        {filters.map((f) => (
          <span key={f.label} className={f.tone === 'blue'
            ? 'rounded-md border border-blue-300/60 dark:border-blue-700/50 bg-blue-100 dark:bg-blue-900/50 px-2 py-0.5 text-[11px] text-blue-800 dark:text-blue-200'
            : 'rounded-md border border-emerald-300/60 dark:border-emerald-700/50 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300'}>{f.label}</span>
        ))}
      </div>
      <span className="font-normal text-zinc-500 dark:text-zinc-400">{summary}</span>
    </div>
  )
}

/** The foot of the table: which rows are shown and the pages. */
export function TableFooter({ from, to, total, noun, page, pages, onPage }: { from: number; to: number; total: number; noun: string; page: number; pages: number; onPage: (page: number) => void }) {
  const flat = 'rounded bg-zinc-200 dark:bg-zinc-800 px-2.5 py-1 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
      <span role="status">Showing {from}–{to} of {total} {noun}</span>
      {pages > 1 && <nav className="flex items-center gap-2" aria-label="Pages">
        <button type="button" className={flat} aria-label="Previous page" disabled={page === 1} onClick={() => onPage(page - 1)}>‹ Prev</button>
        {pageNumbers(page, pages).map((n, i) => n === null
          ? <span key={`gap${i}`} className="px-1 text-zinc-400">…</span>
          : <button key={n} type="button" aria-label={`Page ${n}`} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}
                    className={`rounded px-2.5 py-0.5 ${n === page ? 'border border-blue-500/30 bg-blue-600/20 text-blue-700 dark:text-blue-300' : 'border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800'}`}>{n}</button>)}
        <button type="button" className={flat} aria-label="Next page" disabled={page === pages} onClick={() => onPage(page + 1)}>Next ›</button>
      </nav>}
    </div>
  )
}

/** The classes of the table of a dashboard. */
export const TABLE = {
  table: 'w-full border-collapse text-sm',
  head: 'border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100/80 dark:bg-zinc-950/60 text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400',
  th: 'px-4 py-3 text-left font-semibold',
  body: 'divide-y divide-zinc-200 dark:divide-zinc-800/60 font-medium',
  cell: 'px-4 py-3',
  row: (selected: boolean) => `transition-colors ${selected ? 'bg-blue-50/70 dark:bg-zinc-800/50' : 'hover:bg-zinc-100/70 dark:hover:bg-zinc-800/60'}`,
}

/** The first column of a row: the chevron that opens its details — right when they are closed, down when they are open — and the mark of the selected row. */
export function ChevronCell({ open, label, onToggle, available = true }: { open: boolean; label: string; onToggle: () => void; available?: boolean }) {
  return (
    <td className={`w-10 border-l-2 px-2 py-3 text-center print:hidden ${open ? 'border-l-blue-500' : 'border-l-transparent'}`}>
      {available && (
        <button type="button" aria-label={`${open ? 'Hide' : 'Show'} ${label}`} aria-expanded={open} title="Toggle the details" onClick={onToggle}
                className={`rounded p-1 transition-colors ${open ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400'}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{open ? <path d="M6 9l6 6 6-6" /> : <path d="M9 6l6 6-6 6" />}</svg>
        </button>
      )}
    </td>
  )
}

/** The group of small buttons of a row, one beside the other in a box of their own. */
export function RowOptions({ label, children }: { label: string; children: ReactNode }) {
  return <div className="ml-auto inline-flex items-center gap-0.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-950/70 p-1" role="group" aria-label={label}>{children}</div>
}

/** The row under a row that is open: its details, in a card. */
export function DetailsRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr className="border-b border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-950/70">
      <td colSpan={colSpan} className="p-4 pl-12">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/90 p-4 shadow-inner">{children}</div>
      </td>
    </tr>
  )
}

/** One line of the details: the name at the left and the value at the right. */
export function DetailLine({ name, children, kind = 'plain' }: { name: string; children: ReactNode; kind?: 'plain' | 'mono' | 'good' }) {
  const value = {
    plain: 'text-right font-semibold text-zinc-900 dark:text-zinc-200',
    mono: 'text-right font-mono break-all text-zinc-700 dark:text-zinc-300',
    good: 'rounded border border-emerald-300/60 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 text-right font-semibold text-emerald-700 dark:text-emerald-400',
  }[kind]
  return (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800/80 pb-1.5">
      <dt className="font-medium text-zinc-500 dark:text-zinc-400">{name}</dt>
      <dd className={value}>{children}</dd>
    </div>
  )
}
