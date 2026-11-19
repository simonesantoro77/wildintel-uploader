import type { ReactNode } from 'react'
import { btnOutline } from '../pages/ImportDeploymentPage'
import type { LocalLocation } from '../types'
import { DetailLine } from './DashboardParts'
import LocationMap from './LocationMap'
import { formatDay } from '../dateFormat'
import SidePanel from './SidePanel'
import { isUtcZone } from '../deploymentValidation'

const STATUS: Record<string, string> = { planned: 'Planned', ready: 'Ready', active: 'Active', archived: 'Archived' }

/** What a location says, as lines: only those it has something for. */
function linesOf(l: LocalLocation): [string, ReactNode][] {
  const lines: [string, ReactNode | null | undefined | false][] = [
    ['Latitude', l.latitude],
    ['Longitude', l.longitude],
    ['Coordinate uncertainty', l.coordinate_uncertainty != null && `${l.coordinate_uncertainty} m`],
    ['Timezone', l.timezone && <>{l.timezone}{l.ignore_dst === true ? ' · cameras ignore summer time' : l.ignore_dst === false ? ' · cameras follow summer time' : ''}{!isUtcZone(l.timezone) && <span title={`The time zone is ${l.timezone}, not UTC`} className="ml-2 inline-flex items-center rounded-md bg-red-100 dark:bg-red-900/40 px-2 py-0.5 text-xs font-medium text-red-800 dark:text-red-300">Not UTC</span>}</>],
    ['Status', l.status && `${STATUS[l.status] ?? l.status}${l.status_date ? ` since ${formatDay(l.status_date)}` : ''}`],
    ['Note on the status', l.status_note],
    ['In production since', l.in_service && formatDay(l.in_service)],
    ['From Trapper', l.trapper_pk != null && 'Yes'],
  ]
  return lines.filter((x): x is [string, ReactNode] => x[1] !== null && x[1] !== undefined && x[1] !== false && x[1] !== '')
}

/** The pin that stands for a location in the entities of the settings. */
const PIN_ICON = (
  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></svg>
)

/** The data of a location in a panel at the right. `location` is none when the site is not one of the project's locations yet. */
export default function LocationDetails({ site, location, onClose, onOpenInSettings }: { site: string; location: LocalLocation | undefined; onClose: () => void; onOpenInSettings?: () => void }) {
  return (
    <SidePanel label={`Details of the location ${site}`} title={site} icon={PIN_ICON} subtitle={location?.name ?? undefined} onClose={onClose}>
      <section aria-label="The location" className="mt-6">
        {location?.latitude != null && location.longitude != null && (
          <div className="mb-5 h-64">
            <LocationMap latitude={String(location.latitude)} longitude={String(location.longitude)} onChange={() => {}} disabled />
          </div>
        )}
        {location ? (
          <dl className="space-y-2 text-sm">
            {linesOf(location).map(([name, value]) => <DetailLine key={name} name={name} kind="mono">{value}</DetailLine>)}
          </dl>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{site} is not one of the locations of this research project yet.</p>
        )}
      </section>
      {onOpenInSettings && location && (
        <div className="mt-6 border-t border-zinc-200 dark:border-zinc-700 pt-4">
          <button type="button" className={btnOutline} onClick={onOpenInSettings}>Open it in the settings</button>
        </div>
      )}
    </SidePanel>
  )
}
