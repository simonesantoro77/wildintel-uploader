import type { ReactNode } from 'react'
import { btnOutline } from '../pages/ImportDeploymentPage'
import type { SdCard } from '../types'
import { DetailLine } from './DashboardParts'
import { formatDay } from '../dateFormat'
import SidePanel from './SidePanel'
import StatusHistory from './StatusHistory'

const STATUS: Record<string, string> = { planned: 'Planned', ready: 'Ready', active: 'Active', archived: 'Archived' }

/** The SD card that stands in the entities of the settings. */
const CARD_ICON = (
  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h7l4 4v14H7z" /><path d="M10 7v3M13 7v3" /></svg>
)

/** What an SD card says, as lines: only those it has something for. */
function linesOf(c: SdCard): [string, ReactNode][] {
  const lines: [string, ReactNode | null | undefined | false][] = [
    ['Brand', c.brand],
    ['Capacity', c.capacity],
    ['Status', c.status && `${STATUS[c.status] ?? c.status}${c.status_date ? ` since ${formatDay(c.status_date)}` : ''}`],
    ['Why it was archived', c.status === 'archived' && c.archive_reason],
    ['Note on the status', c.status_note],
    ['In production since', c.in_service && formatDay(c.in_service)],
    ['Research project', c.research_project],
  ]
  return lines.filter((x): x is [string, ReactNode] => x[1] !== null && x[1] !== undefined && x[1] !== false && x[1] !== '')
}

/** The data of an SD card in a panel at the right. `card` is none when it is not one of the research project's SD cards (yet). */
export default function SdCardDetails({ label, card, onClose, onOpenInSettings }: { label: string; card: SdCard | undefined; onClose: () => void; onOpenInSettings?: () => void }) {
  return (
    <SidePanel label={`Details of the SD card ${label}`} title={label} icon={CARD_ICON} subtitle={card ? [card.brand, card.capacity].filter(Boolean).join(' ') || undefined : undefined} onClose={onClose}>
      <section aria-label="The SD card" className="mt-6">
        {card ? (
          <dl className="space-y-2 text-sm">
            {linesOf(card).map(([name, value]) => <DetailLine key={name} name={name} kind="mono">{value}</DetailLine>)}
          </dl>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">The SD card {label} is not one of the SD cards of this research project yet.</p>
        )}
      </section>
      {card && <StatusHistory researchProject={card.research_project} kind="sd_cards" name={label} />}
      {onOpenInSettings && card && (
        <div className="mt-6 border-t border-zinc-200 dark:border-zinc-700 pt-4">
          <button type="button" className={btnOutline} onClick={onOpenInSettings}>Open it in the settings</button>
        </div>
      )}
    </SidePanel>
  )
}
