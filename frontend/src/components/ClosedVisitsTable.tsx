import type { ClosedVisit, LocalLocation, SdCard } from '../types'
import { daysBetween, formatVisitWhen } from '../dateFormat'
import { PHASE_BADGE, PHASE_LABEL } from '../visitPhases'
import { useState } from 'react'
import { RowOptions } from './DashboardParts'
import IconButton, { ICON_PATHS } from './IconButton'
import LinkButton from './LinkButton'
import LocationDetails from './LocationDetails'
import SdCardDetails from './SdCardDetails'
import VisitDetails from './VisitDetails'
import PickTable, { Glyph, LabelFrame, PickedTick, type PickColumn, type PickMany } from './PickTable'

/** The key of a closed visit: where and when it was made. */
export const closedVisitKey = (c: ClosedVisit) => `${c.visit.location_id}|${c.visit.date}|${c.visit.time}`

/** Where the visit is in its life, as the dashboard of the visits says it: the card of a closed visit was collected, whatever else the visit stored. */
const stateOf = (c: ClosedVisit) => c.visit.state ?? 'collected'

/** The cells of a closed visit, as the table shows them — also what its search looks at. */
const cellsOf = (c: ClosedVisit): string[] => [
  c.visit.session, c.visit.location_id, formatVisitWhen(c.visit), PHASE_LABEL[stateOf(c)], c.visit.sd ?? '—', formatVisitWhen(c.end), c.end.num_photos != null ? String(c.end.num_photos) : '—',
]

const mono = 'px-4 py-3 font-mono'
const date = 'px-4 py-3 font-mono text-[11px] whitespace-nowrap text-zinc-600 dark:text-zinc-300'
/** The columns of the table; the site is a link to its details when there is a place to go to. */
const columnsOf = (onSite: (locationId: string) => void, onCard: (label: string) => void, onDetails: (visit: ClosedVisit) => void): PickColumn<ClosedVisit>[] => [
  { label: 'Revision', className: `${mono} font-semibold text-zinc-900 dark:text-zinc-200`, cell: (c) => cellsOf(c)[0] },
  { label: 'Location', className: mono, cell: (c) => {
    const site = cellsOf(c)[1]
    return <LinkButton title={`Show the details of the location ${site}`} className="font-mono" onClick={(e) => { e.stopPropagation(); onSite(site) }}>{site}</LinkButton>   // not a press on the row
  } },
  { label: 'Status', cell: (c) => <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${PHASE_BADGE[stateOf(c)]}`}>{cellsOf(c)[3]}</span> },
  { label: 'SD card', className: mono, cell: (c) => {
    const card = cellsOf(c)[4]
    return card === '—' ? card : <LinkButton title={`Show the details of the SD card ${card}`} className="font-mono" onClick={(e) => { e.stopPropagation(); onCard(card) }}>{card}</LinkButton>   // not a press on the row
  } },
  { label: 'Left on', className: date, cell: (c) => cellsOf(c)[2] },
  { label: 'Collected on', className: date, cell: (c) => cellsOf(c)[5] },
  { label: 'Photos', className: mono, cell: (c) => cellsOf(c)[6] },
  { label: 'Details', className: 'px-4 py-3 whitespace-nowrap', cell: (c) => (
    <span onClick={(e) => e.stopPropagation()}>{/* a press on the eye is not a press on the row */}
      <RowOptions label={`Options of the visit ${c.visit.session} to ${c.visit.location_id}`}>
        <IconButton compact label={`Show the details of the visit ${c.visit.session} to ${c.visit.location_id}`} title="Show the details of the visit" onClick={() => onDetails(c)} path={ICON_PATHS.view} />
      </RowOptions>
    </span>
  ) },
]

/** A closed visit as a label: its site and state, its revision and card, how long the camera was in the field between the day it left and the day it was collected, and its photos. */
function VisitLabel({ visit, picked, onPress }: { visit: ClosedVisit; picked: boolean; onPress: () => void }) {
  const [session, site, , status, card, collected, photos] = cellsOf(visit)
  const left = formatVisitWhen(visit.visit)
  const days = daysBetween(visit.visit.date, visit.end.date)
  return (
    <LabelFrame picked={picked} name={`the visit ${session} to ${site}`} onPress={onPress}>
      <span className="flex items-start justify-between gap-3">
        <span className="font-mono text-2xl font-bold text-zinc-900 dark:text-white">{site}</span>
        <span className="flex items-center gap-2">
          {picked && <PickedTick />}
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${PHASE_BADGE[stateOf(visit)]}`}>{status}</span>
        </span>
      </span>
      <span className="mt-1 block font-mono text-sm text-zinc-500 dark:text-zinc-400">{session}{card !== '—' ? ` · card ${card}` : ''}</span>
      <span className="my-4 flex items-center gap-3" aria-hidden={days === null ? true : undefined}>
        <span className="h-3 w-3 shrink-0 rounded-full border-2 border-zinc-400 dark:border-zinc-500" />
        <span className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
        {days !== null && <span className="text-sm text-zinc-500 dark:text-zinc-400">{days === 1 ? '1 day' : `${days} days`} in the field</span>}
        <span className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
        <span className="h-3 w-3 shrink-0 rounded-full bg-emerald-400" />
      </span>
      <span className="flex items-end justify-between gap-3 font-mono">
        <span>
          <span className="block text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Left on</span>
          <span className="block text-base font-semibold text-zinc-900 dark:text-white">{left}</span>
        </span>
        <span className="text-right">
          <span className="block text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Collected on</span>
          <span className="block text-base font-semibold text-zinc-900 dark:text-white">{collected}</span>
        </span>
      </span>
      <span className="mt-4 block border-t border-zinc-200 dark:border-zinc-700/70 pt-4 font-mono text-base">
        {photos !== '—'
          ? <span className="flex items-center gap-2 font-bold text-emerald-600 dark:text-emerald-400"><Glyph className="h-5 w-5"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.500" cy="10" r="1.500" /><path d="M21 16l-5-5-8 8" /></Glyph>{photos} photos</span>
          : <span className="text-sm text-zinc-500 dark:text-zinc-400">photos not counted</span>}
      </span>
    </LabelFrame>
  )
}

/** The closed visits in the table of a dashboard, or as labels: pressing one picks its visit, and pressing it again lets it go. `visits` are those to show, newest first. */
export default function ClosedVisitsTable({ visits, selectedKey = '', onSelect, many, locations, onOpenSite, sdCards, onOpenSdCard, filters, total }: {
  visits: ClosedVisit[]; selectedKey?: string; onSelect?: (visit: ClosedVisit | undefined) => void
  /** Several can be picked, not one: each row has its box. */
  many?: PickMany<ClosedVisit>
  /** The locations of the research project: the site of a row opens its data in a panel. */
  locations?: LocalLocation[]
  /** Goes to a location in the settings — a button of its panel — when it is given. */
  onOpenSite?: (locationId: string) => void
  /** The SD cards of the research project: the card of a row opens its data in a panel, with a way on to the settings when `onOpenSdCard` is given. */
  sdCards?: SdCard[]
  onOpenSdCard?: (label: string) => void
  /** The filters already applied to `visits` (the revision picked), and how many closed visits there were before them — told in the line of the active filters. */
  filters?: { label: string; tone: 'blue' | 'green' }[]
  total?: number
}) {
  const [details, setDetails] = useState<ClosedVisit | null>(null)
  const [site, setSite] = useState<string | null>(null)
  const [card, setCard] = useState<string | null>(null)
  return (
    <>
    <PickTable items={visits} keyOf={closedVisitKey} selectedKey={selectedKey} onSelect={onSelect} many={many} columns={columnsOf(setSite, setCard, setDetails)} searchText={(c) => cellsOf(c).join(' ')}
      renderLabel={(c, picked, press) => <VisitLabel visit={c} picked={picked} onPress={press} />}
      names={{ table: 'Closed visits', search: 'Filter the closed visits', items: 'visits', pick: (c) => `the visit ${c.visit.session} to ${c.visit.location_id}`, pickPlaceholder: 'Select a visit…' }}
      optionLabel={(c) => { const [session, site, left, status, card, collected, photos] = cellsOf(c); return `${left} · ${site} · ${session} · ${status}${card !== '—' ? ` · card ${card}` : ''} · collected on ${collected}${photos !== '—' ? ` (${photos} photos)` : ''}` }}
      searchPlaceholder="Search by revision, location, status, SD card…" empty="No closed visit matches." filters={filters} total={total} />
    {details && <VisitDetails closed={details} onClose={() => setDetails(null)} />}
    {card && <SdCardDetails label={card} card={sdCards?.find((c) => c.label === card)} onClose={() => setCard(null)}
      onOpenInSettings={onOpenSdCard ? () => { setCard(null); onOpenSdCard(card) } : undefined} />}
    {site && <LocationDetails site={site} location={locations?.find((l) => l.location_id.toLowerCase() === site.toLowerCase())} onClose={() => setSite(null)}
      onOpenInSettings={onOpenSite ? () => { setSite(null); onOpenSite(site) } : undefined} />}
    </>
  )
}
