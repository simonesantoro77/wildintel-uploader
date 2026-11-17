/** Where the cameras and the SD cards are, worked out from the visits kept: a camera put up at a site is there until a visit takes it away
 * (a Desinstallation) or finds it stolen; a card left in a camera is there until a visit collects it (a Revision, a Desinstallation, or a
 * stolen camera, which takes its card). So an Installation of a camera, or the leaving of a card, can be told when the camera or the card
 * is somewhere else. */
import type { SdCard, StoredVisit } from './types'
import type { Visit } from './pages/VisitsPage'

/** Where a camera or a card is, and since when. */
export interface Whereabouts { site: string; date: string }

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()
const stamp = (v: { date: string; time: string }) => `${v.date}T${v.time}`

/** The visits before a moment, oldest first. */
function before(visits: StoredVisit[], when: string): StoredVisit[] {
  return visits.filter((v) => stamp(v) < when).sort((a, b) => stamp(a).localeCompare(stamp(b)))
}

const takesAway = (v: StoredVisit) => v.actions.includes('Desinstallation') || v.actions.includes('Stolen')
const notRevised = (v: StoredVisit) => ['not revised', 'no revisada', 'no revisado'].includes((v.camera_status ?? '').trim().toLowerCase())
const collectsCard = (v: StoredVisit) => takesAway(v) || (v.actions.includes('Revision') && !notRevised(v))

/** The site a camera is put up at on a given moment — null when it is nowhere: never put up, uninstalled or stolen. */
export function cameraAt(visits: StoredVisit[], cameraId: string, when: string): Whereabouts | null {
  let at: Whereabouts | null = null
  for (const v of before(visits, when)) {
    if (!same(v.camera_id, cameraId)) continue
    if (takesAway(v)) at = null
    else if (v.actions.includes('Installation') || v.actions.includes('Revision')) at = { site: v.location_id, date: v.date }
  }
  return at
}

/** The camera that is put up at a site on a given moment — null when none is known: nothing was installed there, or it was taken away or stolen. */
export function cameraAtSite(visits: StoredVisit[], site: string, when: string): { camera: string; date: string; session: string } | null {
  let at: { camera: string; date: string; session: string } | null = null
  for (const v of before(visits, when)) {
    if (!same(v.location_id, site)) continue
    if (takesAway(v)) at = null
    // what a visit leaves is the camera it puts up, or — a Revision that does not take it away — the one that was there; a replacement takes one away and puts another up
    if ((v.actions.includes('Installation') || (v.actions.includes('Revision') && !takesAway(v))) && v.camera_id) at = { camera: v.camera_id, date: v.date, session: v.session }
  }
  return at
}

/** The site whose camera holds a card on a given moment — null when it is in none: never left, or collected. */
export function cardAt(visits: StoredVisit[], label: string, when: string): Whereabouts | null {
  const inSite = new Map<string, { label: string; date: string; site: string }>()
  for (const v of before(visits, when)) {
    const site = v.location_id.toLowerCase()
    if (collectsCard(v)) inSite.delete(site)
    if (v.sd && (v.actions.includes('Installation') || v.actions.includes('Revision'))) inSite.set(site, { label: v.sd, date: v.date, site: v.location_id })
  }
  for (const card of inSite.values()) if (same(card.label, label)) return { site: card.site, date: card.date }
  return null
}

/** The card the camera at a site holds on a given moment — null when it holds none: never left, or collected. */
export function cardAtSite(visits: StoredVisit[], site: string, when: string): { label: string; date: string } | null {
  let at: { label: string; date: string } | null = null
  for (const v of before(visits, when)) {
    if (!same(v.location_id, site)) continue
    if (collectsCard(v)) at = null
    if (v.sd && (v.actions.includes('Installation') || v.actions.includes('Revision'))) at = { label: v.sd, date: v.date }
  }
  return at
}

/** What the card checks need besides the visits: the cards of the settings (to know which are archived, and since when) and the revision the visit belongs to. */
export interface CardOptions { cards?: SdCard[]; session?: string }

/** Why a visit cannot leave a card in the camera — nothing when it can, or when it leaves none. A card cannot be left when it is archived (from the day it was),
 * when it is in the camera of another site, when it is the one the visit collects, or when it was collected by a visit of the same revision. */
export function cardBlock(kept: StoredVisit[], label: string, visit: Visit, options: CardOptions = {}): string | undefined {
  const card = label.trim()
  const installs = visit.actions.includes('Installation')
  const revises = visit.actions.includes('Revision')
  if (!(installs || revises) || !card) return undefined
  const when = visit.when || '9999-12-31T23:59:59'
  const site = visit.site.trim()
  const collects = revises || visit.actions.includes('Desinstallation') || visit.actions.includes('Stolen')

  const settings = options.cards?.find((c) => same(c.label, card))
  if (settings?.status === 'archived' && (!settings.status_date || settings.status_date <= when.slice(0, 10))) {
    return `SD card ${card} is not available${settings.status_date ? ` since ${settings.status_date}` : ''}: it is archived${settings.archive_reason ? ` (${settings.archive_reason})` : ''}.`
  }
  const there = cardAt(kept, card, when)
  if (there && collects && same(there.site, site)) return `SD card ${card} is the one this visit collects (left on ${there.date}): the card left in the camera has to be another.`
  if (there) return `SD card ${card} is in the camera at ${there.site} (left on ${there.date}): it has to be collected before it is left here.`
  if (options.session) {
    const taken = kept.find((w) => w.session === options.session && collectsCard(w) && same(cardAtSite(kept, w.location_id, stamp(w))?.label, card))
    if (taken) return `SD card ${card} was collected at ${taken.location_id} in this revision (${options.session}): it cannot be left again in the same revision.`
  }
  return undefined
}

/** What stops a visit being kept for where its camera or its card is: the camera put up while it is somewhere else, a card left in a camera
 * while it is in another one — or the very one the visit collects. Nothing is said while the visit does not say which. */
export function availabilityErrors(kept: StoredVisit[], visit: Visit, options: CardOptions = {}): { camera?: string; sd?: string } {
  const errors: { camera?: string; sd?: string } = {}
  const when = visit.when || '9999-12-31T23:59:59'
  const site = visit.site.trim()
  const installs = visit.actions.includes('Installation')
  const revises = visit.actions.includes('Revision')
  const collects = revises || visit.actions.includes('Desinstallation') || visit.actions.includes('Stolen')

  const camera = visit.details.camera_id
  // A visit that does not put a camera up — a Revision, a Desinstallation, a Stolen camera — is of the camera that is at the site.
  if (camera && !installs && collects) {
    const there = cameraAtSite(kept, site, when)
    if (there && !same(there.camera, camera)) {
      errors.camera = `The camera at ${site} is ${there.camera} (since ${there.date}): a ${visit.actions.join(' + ')} is of that camera. If it was replaced, add an Installation to the visit.`
    }
  }
  if (installs && camera) {
    const there = cameraAt(kept, camera, when)
    // A visit that also revises may find the camera in the very site it puts it up at.
    if (there && !(revises && same(there.site, site))) {
      errors.camera = same(there.site, site)
        ? `Camera ${camera} is already installed here (since ${there.date}): it has to be uninstalled first.`
        : `Camera ${camera} is installed at ${there.site} (since ${there.date}): it has to be uninstalled there before it is installed here.`
    }
  }

  const sd = cardBlock(kept, visit.sd, visit, options)
  if (sd) errors.sd = sd
  return errors
}

const revisionNumber = (session: string | undefined) => {
  const m = /\d+/.exec(session ?? '')
  return m ? Number(m[0]) : null
}

/** The revision the next visit to a site belongs to — worked out from where the revisions are, not from how many visits the site has had: the latest revision when the site has
 * no visit in it (it is still planned there), and the one after it when it has — the sites not visited in the latest one are then marked as not visited, to finish it. R0001 with no
 * visits. `latest` is the latest revision there is, and `starts` whether the visit starts a new one. */
export function nextRevision(visits: StoredVisit[], site: string): { session: string; latest: number | null; starts: boolean } {
  const numbers = visits.map((v) => revisionNumber(v.session)).filter((n): n is number => n !== null)
  if (numbers.length === 0) return { session: 'R0001', latest: null, starts: false }
  const latest = Math.max(...numbers)
  const there = visits.some((v) => revisionNumber(v.session) === latest && same(v.location_id, site))
  const number = there ? latest + 1 : latest
  return { session: `R${String(number).padStart(4, '0')}`, latest, starts: there }
}

/** Why a revision cannot start: the one before it is not finished. A revision is one visit to each of the locations that are not archived when it
 * starts (the day of its first visit; an archived one with no day is archived for good). The first revision of the visits has none before it. */
export function unfinishedRevision(number: number, visits: StoredVisit[], locations: { location_id: string; status?: string; status_date?: string | null }[], day = ''): { message: string; previous: string; missing: string[] } | null {
  const numbers = visits.map((v) => revisionNumber(v.session)).filter((n): n is number => n !== null)
  const previous = number - 1
  if (numbers.length === 0 || previous < Math.min(...numbers)) return null
  const of = visits.filter((v) => revisionNumber(v.session) === previous)
  const start = of.length ? of.map((v) => v.date).sort()[0] : day
  const visited = new Set(of.map((v) => v.location_id.toLowerCase()))
  // the revision in which a site starts, where a visit says so: the revisions before it do not wait for a visit to it
  const starts = new Map<string, number>()
  for (const v of visits) {
    const n = revisionNumber(v.session)
    if (n !== null && (v.actions as string[]).includes('SiteStart')) starts.set(v.location_id.toLowerCase(), Math.min(n, starts.get(v.location_id.toLowerCase()) ?? n))
  }
  const withVisits = new Set(visits.map((v) => v.location_id.toLowerCase()))
  const missing = locations
    .filter((l) => l.status !== 'planned' && !(l.status === 'archived' && (!l.status_date || l.status_date <= start))
      && (starts.get(l.location_id.toLowerCase()) ?? 0) <= previous            // a site that starts after this revision is not waited for in it
      && (l.status !== 'pending' || withVisits.has(l.location_id.toLowerCase())))  // a pending site has not started: until a visit to it is known it is not waited for
    .map((l) => l.location_id).filter((id) => !visited.has(id.toLowerCase())).sort()
  if (missing.length === 0) return null
  const name = (n: number) => `R${String(n).padStart(4, '0')}`
  return { message: `${name(number)} cannot start: ${name(previous)} is not finished, ${missing.length} location(s) still to be visited in it: ${missing.join(', ')}.`, previous: name(previous), missing }
}
