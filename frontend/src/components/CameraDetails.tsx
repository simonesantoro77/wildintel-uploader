import type { ReactNode } from 'react'
import { btnOutline } from '../pages/ImportDeploymentPage'
import type { Camera } from '../types'
import { DetailLine } from './DashboardParts'
import { formatDay } from '../dateFormat'
import SidePanel from './SidePanel'

const STATUS: Record<string, string> = { planned: 'Planned', ready: 'Ready', active: 'Active', archived: 'Archived' }
const CONNECTIVITY: Record<string, string> = { none: 'None', '4g': '4G', '5g': '5G' }
const POWER: Record<string, string> = { cells: 'Cells (AA, AAA…)', battery: 'Battery' }

/** The camera that stands in the entities of the settings. */
const CAMERA_ICON = (
  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><circle cx="12" cy="13" r="3.5" /></svg>
)

/** What a camera says, as lines: only those it has something for. */
function linesOf(c: Camera): [string, ReactNode][] {
  const lines: [string, ReactNode | null | undefined | false][] = [
    ['Serial number', c.camera_id],
    ['Model', c.camera_model],
    ['Status', c.status && `${STATUS[c.status] ?? c.status}${c.status_date ? ` since ${formatDay(c.status_date)}` : ''}`],
    ['Why it was archived', c.status === 'archived' && c.archive_reason],
    ['Note on the status', c.status_note],
    ['Connectivity', c.connectivity && (CONNECTIVITY[c.connectivity] ?? c.connectivity)],
    ['Power source', c.power_source && (POWER[c.power_source] ?? c.power_source)],
    ['Battery can be taken out', c.battery_removable && (c.battery_removable === 'yes' ? 'Yes' : 'No')],
    ['In production since', c.in_service && formatDay(c.in_service)],
    ['Research project', c.research_project],
  ]
  return lines.filter((x): x is [string, ReactNode] => x[1] !== null && x[1] !== undefined && x[1] !== false && x[1] !== '')
}

/** The data of a camera in a panel at the right. `camera` is none when it is not one of the research project's cameras (yet): `name` is what the visit called it. */
export default function CameraDetails({ name, camera, onClose, onOpenInSettings }: { name: string; camera: Camera | undefined; onClose: () => void; onOpenInSettings?: () => void }) {
  const title = camera?.label || name
  return (
    <SidePanel label={`Details of the camera ${title}`} title={title} icon={CAMERA_ICON} subtitle={camera?.camera_model || undefined} onClose={onClose}>
      <section aria-label="The camera" className="mt-6">
        {camera ? (
          <dl className="space-y-2 text-sm">
            {linesOf(camera).map(([label, value]) => <DetailLine key={label} name={label} kind="mono">{value}</DetailLine>)}
          </dl>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">The camera {name} is not one of the cameras of this research project yet.</p>
        )}
      </section>
      {onOpenInSettings && camera && (
        <div className="mt-6 border-t border-zinc-200 dark:border-zinc-700 pt-4">
          <button type="button" className={btnOutline} onClick={onOpenInSettings}>Open it in the settings</button>
        </div>
      )}
    </SidePanel>
  )
}
