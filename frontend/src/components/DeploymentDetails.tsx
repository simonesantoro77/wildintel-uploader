import type { ReactNode } from 'react'
import { daysBetween, formatLocal } from '../dateFormat'
import { FEATURE_TYPE_OPTIONS, btnOutline } from '../pages/ImportDeploymentPage'
import type { DeploymentFields, FieldDeployment } from '../types'
import SidePanel from './SidePanel'
import { MENU_ICONS } from './TaskCard'

/** A labelled value: the label in small capitals, the value under it. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-zinc-900 dark:text-zinc-100 break-words">{children}</dd>
    </div>
  )
}

/** A card of the panel: its title in capitals with an icon in a colour, what it says of the deployment, and — at the right of the title — something short when there is. */
function Card({ title, tone, icon, aside, children }: { title: string; tone: string; icon: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/30 p-5">
      <h5 className="mb-4 flex items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-700 pb-3 text-xs font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-100">
        <span className="flex items-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 fill-none ${tone}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
          {title}
        </span>
        {aside && <span className="text-xs font-normal normal-case tracking-normal text-zinc-500 dark:text-zinc-400">{aside}</span>}
      </h5>
      {children}
    </section>
  )
}

const present = (v: unknown) => v !== null && v !== undefined && v !== ''
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

/** The mix of the two visits the app keeps as "Setup: … | Retrieval: …", told as who set it up and who retrieved it. */
function whoWent(setupBy: string | null | undefined): { setUp: string | null; retrieved: string | null } {
  const m = /^Setup: (.*?) \| Retrieval: (.*)$/.exec(setupBy ?? '')
  return m ? { setUp: m[1], retrieved: m[2] } : { setUp: setupBy ?? null, retrieved: null }
}

const pill = 'rounded-full px-2.5 py-0.5 text-xs font-semibold'

/** The icon of a deployment — the one of its menus. */
const DEPLOYMENT_ICON = <svg viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{MENU_ICONS.deployment}</svg>

/** Everything a created deployment says of itself — where, when, the camera and how it was put up, the site and the notes — in a panel at the right, as the details of an image are.
 * `fields` is none while they are being read, and null when they could not be. */
export default function DeploymentDetails({ deployment: d, fields, creation, uploaded, onClose, onOpen }: {
  deployment: FieldDeployment; fields: DeploymentFields | null | 'error' | undefined; creation: 'planned' | 'created' | 'not_created'; uploaded: boolean; onClose: () => void
  /** Goes to the deployment in the dashboard of the deployments: a button under the cards, when it is given. */
  onOpen?: () => void
}) {
  const f = fields && fields !== 'error' ? fields : null
  const days = f?.start_date && f.end_date ? daysBetween(f.start_date, f.end_date) : null
  const who = whoWent(f?.setup_by)
  const feature = FEATURE_TYPE_OPTIONS.find((o) => o.value === f?.feature_type)?.label
  const notes = (f?.comments ?? '').split(' | ').map((n) => n.trim()).filter(Boolean)
  const subtitle = (
    <span className="flex flex-wrap items-center gap-2">
      <span className={`${pill} ${creation === 'created' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : creation === 'planned' ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300' : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'}`}>{creation === 'created' ? 'Created' : creation === 'planned' ? 'Planned' : 'Not created'}</span>
      <span className={`${pill} ${uploaded ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300'}`}>{uploaded ? 'Uploaded' : 'Not uploaded'}</span>
      {(d.card || d.photos_counted != null || d.card_full) && <span className="text-sm text-zinc-500 dark:text-zinc-400">{[d.card && `SD ${d.card}`, d.card_full ? 'Card full' : d.photos_counted != null && `${d.photos_counted} photos`].filter(Boolean).join(' · ')}</span>}
    </span>
  )
  return (
    <SidePanel label={`Details of the deployment ${d.deployment_id}`} title={d.deployment_id} icon={DEPLOYMENT_ICON} subtitle={subtitle} onClose={onClose}>
      {fields === undefined ? <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">Reading the deployment…</p>
        : !f ? <p role="alert" className="mt-6 text-sm text-amber-700 dark:text-amber-400">The details of this deployment could not be read from the collections folder.</p>
        : (
          <>
            <Card title="Location" tone="stroke-blue-400" icon={<><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></>}>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Field label="Location">{f.location_id}</Field>
                {present(f.location_name) && <Field label="Location name">{f.location_name}</Field>}
                {present(f.latitude) && present(f.longitude) && <Field label="Coordinates">{f.latitude}, {f.longitude}</Field>}
                {present(f.coordinate_uncertainty) && <Field label="Uncertainty">± {f.coordinate_uncertainty} m</Field>}
              </dl>
            </Card>
            <Card title="Period" tone="stroke-violet-400" icon={<><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>} aside={days !== null ? `${days === 1 ? '1 day' : `${days} days`} in the field` : undefined}>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Field label="Start">{formatLocal(f.start_date, d.timezone)}</Field>
                {present(f.end_date) && <Field label="End">{formatLocal(f.end_date, d.timezone)}</Field>}
                {present(who.setUp) && <Field label="Set up by">{who.setUp}</Field>}
                {present(who.retrieved) && <Field label="Retrieved by">{who.retrieved}</Field>}
              </dl>
            </Card>
            {[f.camera_id, f.camera_model, f.camera_interval, f.detection_distance].some(present) && (
              <Card title="Camera" tone="stroke-sky-400" icon={<><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></>}>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                  {present(f.camera_id) && <Field label="Camera id">{f.camera_id}</Field>}
                  {present(f.camera_model) && <Field label="Model">{f.camera_model}</Field>}
                  {present(f.camera_interval) && <Field label="Delay">{f.camera_interval} s</Field>}
                  {present(f.detection_distance) && <Field label="Detection distance">{f.detection_distance} m</Field>}
                </dl>
              </Card>
            )}
            {[f.camera_height, f.camera_depth, f.camera_tilt, f.camera_heading].some(present) && (
              <Card title="Placement" tone="stroke-emerald-400" icon={<><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5 13 13l-4.500 2.500L11 11z" /></>}>
                <dl className="grid grid-cols-3 gap-x-6 gap-y-4">
                  {present(f.camera_height) && <Field label="Height">{f.camera_height} m</Field>}
                  {present(f.camera_depth) && <Field label="Depth">{f.camera_depth} m</Field>}
                  {present(f.camera_tilt) && <Field label="Tilt">{f.camera_tilt}°</Field>}
                  {present(f.camera_heading) && <Field label="Heading">{f.camera_heading}° ({COMPASS[Math.round(Number(f.camera_heading) / 45) % 8]})</Field>}
                </dl>
              </Card>
            )}
            {[feature, f.habitat, f.bait_use, f.timestamp_issues].some(present) && (
              <Card title="Site" tone="stroke-orange-400" icon={<><path d="M11 20A7 7 0 0 1 9.800 6.100C15.500 5 17 4.500 19 2c1 2 2 4.200 2 8 0 5.500-4.800 10-10 10z" /><path d="M2 21c0-3 1.850-5.360 5.080-6C9.500 14.520 12 13 13 12" /></>}>
                <dl className="grid grid-cols-3 gap-x-6 gap-y-4">
                  {present(feature) && <Field label="Feature type">{feature}</Field>}
                  {present(f.habitat) && <Field label="Habitat">{f.habitat}</Field>}
                  {present(f.bait_use) && <Field label="Bait use">{f.bait_use ? 'Yes' : 'No'}</Field>}
                  {present(f.timestamp_issues) && <Field label="Photo dates may be wrong">{f.timestamp_issues ? 'Yes' : 'No'}</Field>}
                </dl>
              </Card>
            )}
            {notes.length > 0 && (
              <Card title="Notes" tone="stroke-orange-400" icon={<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z M8 9h8M8 13h5" />}>
                <ul className="space-y-2 font-mono text-sm text-zinc-900 dark:text-zinc-100">
                  {notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </Card>
            )}
          </>
        )}
      {onOpen && <div className="mt-6 border-t border-zinc-200 dark:border-zinc-700 pt-4"><button type="button" className={btnOutline} onClick={onOpen}>Open it in the deployments dashboard <span aria-hidden="true">→</span></button></div>}
    </SidePanel>
  )
}
