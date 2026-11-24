import QrCode, { qrPayload } from '../components/QrCode'
import LocationMap from '../components/LocationMap'
import TimezoneCombobox from '../components/TimezoneCombobox'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import CheckboxList from '../components/CheckboxList'
import Combobox from '../components/Combobox'
import { download, itemsToCsv, readItems } from '../csvFile'
import { defaultResearchProject } from '../defaultResearchProject'
import { ANIMAL_TYPES_OPTIONS, BAIT_USE_OPTIONS, NO_CREDENTIALS, SAMPLING_DESIGN_OPTIONS, SENSOR_METHOD_OPTIONS } from './ImportDeploymentPage'
import { DOCS_URL, REPO_URL } from '../components/Navbar'
import { COVERAGE_AREAS, ENTITIES, SD_CARD_BRANDS, SD_CARD_CAPACITIES } from '../entities'
import Notice from '../components/Notice'
import { UPLOAD_DESTINATIONS, type UploadDestinationId } from '../uploadDestinations'
import { VISIT_SOURCES, type VisitSourceId } from '../visitSources'
import ReportsList from '../components/ReportsList'
import { isUtcZone, isValidTimezone } from '../deploymentValidation'
import { EMPTY_RESEARCH_PROJECT } from '../types'
import type { Location, LocationStatus, ResearchProject, ResearchProjectStatus } from '../types'
import type { AppSettings, AppSettingsUpdate, ConfigInfo, DeploymentCheck, ImageCheck, Camera, LocalLocation, LocalResearchProject, LogLevel, SdCard, SimilarityMethod, StoredVisit, Trapper, TrapperRole, TrapperRoleName, UpdateCheck } from '../types'

const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400'
const btnPrimary = 'px-6 py-2.5 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
const btnSoft = 'inline-flex items-center px-4 py-2 text-sm rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50'

/** The same limits the backend enforces (config.py). */
const TOLERANCE = { min: 0, max: 8760, decimal: true }
const RESIZE_WIDTH = { min: 100, max: 20000 }
const SEQUENCE_GAP = { min: 0.001, max: 86400, decimal: true }
const MIN_REVISIONS = { min: 1, max: 50 }
const SIMILARITY_TOLERANCE = { min: 0, max: 1000, decimal: true }
const WORKERS = { min: 1, max: 64 }
const MAX_ZIP_MB = { min: 1, max: 5000 }

type Limits = { min: number; max: number; decimal?: boolean }

// ── Icons (24×24, stroke — lucide's shapes) ─────────────────────────────

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

const MapPinIcon = () => (<Icon size={18}><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></Icon>)
const CompassIcon = () => (<Icon size={18}><circle cx="12" cy="12" r="10" /><path d="M16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3z" /></Icon>)
const ClockIcon = () => (<Icon size={18}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></Icon>)
const ActivityIcon = () => (<Icon size={18}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></Icon>)
const PencilIcon = () => (<Icon size={16}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></Icon>)
const TrashIcon = () => (<Icon size={16}><path d="M3 6h18" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></Icon>)
const EyeIcon = () => (<Icon size={16}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Icon>)
const LockIcon = () => (<Icon size={12}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Icon>)
const SearchIcon = () => (<Icon size={16}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></Icon>)
const ChevronDownIcon = () => (<Icon size={14}><path d="M6 9l6 6 6-6" /></Icon>)
const PlusIcon = () => (<Icon size={16}><path d="M12 5v14M5 12h14" /></Icon>)

const CameraIcon = () => (
  <Icon>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </Icon>
)
const UploadIcon = () => (
  <Icon><path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9" /><path d="M12 12v9M8 16l4-4 4 4" /></Icon>
)
const SlidersIcon = () => (
  <Icon>
    <path d="M4 21v-7" /><path d="M4 10V3" /><path d="M12 21v-9" /><path d="M12 8V3" />
    <path d="M20 21v-5" /><path d="M20 12V3" /><path d="M2 14h4" /><path d="M10 8h4" /><path d="M18 16h4" />
  </Icon>
)
const CheckIcon = () => (
  <Icon>
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </Icon>
)
const ShieldIcon = () => (
  <Icon>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
)
const ImageIcon = () => (
  <Icon>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="m21 15-5-5L5 21" />
  </Icon>
)
const SdCardIcon = () => (
  <Icon>
    <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
    <path d="M8 6v3M11 6v3M14 7v2" />
  </Icon>
)
const PinIcon = () => (
  <Icon>
    <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" />
    <circle cx="12" cy="10" r="3" />
  </Icon>
)
const ReportIcon = () => (
  <Icon>
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path d="M8 16h.01" />
  </Icon>
)
const UsersIcon = () => (
  <Icon>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Icon>
)
const FileIcon = () => (
  <Icon>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M16 13H8" /><path d="M16 17H8" />
  </Icon>
)
const FolderIcon = () => (
  <Icon>
    <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
  </Icon>
)
const DownloadIcon = () => (
  <Icon>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" /><path d="M12 15V3" />
  </Icon>
)
const GearIcon = () => (
  <Icon>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
)
const BackIcon = () => (
  <Icon>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </Icon>
)

// ── The form's own state ────────────────────────────────────────────────

/** Every field as typed — the tolerance can be briefly empty or invalid. */
interface Draft {
  /** Field records: when a visit happened, the seconds of the logs, and the columns of the file of the field app. */
  fieldlogKeepSeconds: boolean
  logLevel: LogLevel
  workers: string
  /** The acronym of the research project that comes filled in; blank for none. */
  defaultResearchProject: string
  /** Whether the welcome page is shown when the app opens. */
  showWelcome: boolean
  dataDir: string
  collectionsDir: string
  reportsDir: string
  packagesDir: string
  /** Which of the sources of visits and of the places to upload to are used. */
  wildintelNewEnabled: boolean
  trapperEnabled: boolean
  agoutiEnabled: boolean
  agoutiUrl: string
  agoutiKey: string
  agoutiProject: string
  trapperUrl: string
  maxZipMb: string
  trapperUser: string
  trapperPassword: string
  epicollectEnabled: boolean
  epicollectUnmappedToComments: boolean
  epicollectSlug: string
  epicollectClientId: string
  epicollectClientSecret: string
  epicollectMapping: Record<string, string>
  validation: AppSettings['VALIDATION']
  postvalidation: Record<DeploymentCheck, boolean>
  toleranceHours: string
  sequenceGap: string
  minRevisions: string
  similarityMethod: SimilarityMethod
  imageTolerance: string
  sequenceCountTolerance: string
  sequenceLengthTolerance: string
  rename: boolean
  resize: boolean
  resizeWidth: string
  metadata: boolean
  owner: string
  publisher: string
  coverage: string
  licenseUrl: string
  ignoreDst: boolean
  convertToUtc: boolean
  trappers: Trapper[]
  sdCards: SdCard[]
  roles: TrapperRole[]
  cameras: Camera[]
}

/** A location of the settings as it is edited: every field a text, as it is typed. */
interface LocationDraft {
  location_id: string
  status: string | null
  status_date: string | null
  status_note: string | null
  name: string | null
  latitude: string | null
  longitude: string | null
  coordinate_uncertainty: string | null
  timezone: string | null
  /** 'yes' when its cameras ignore summer time. */
  ignore_dst: string | null
  in_service: string | null
}
/** Today, as YYYY-MM-DD in the local time: what "in production since" starts as. */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

const text = (n: number | null) => (n === null ? null : String(n))

function toDraft(s: AppSettings): Draft {
  const post = s.POSTVALIDATION
  const checks = {
    deployment_id: post.deployment_id, collection_prefix: post.collection_prefix, collection_name: post.collection_name,
    location: post.location, time_range: post.time_range, camera: post.camera,
    image_count: post.image_count, sequence_count: post.sequence_count, sequence_length: post.sequence_length,
    sd_card: post.sd_card, photo_count: post.photo_count,
  }
  return {
    fieldlogKeepSeconds: s.FIELDLOG.keep_seconds,
    logLevel: s.GENERAL.log_level,
    workers: String(s.GENERAL.workers),
    defaultResearchProject: s.GENERAL.default_research_project ?? '',
    showWelcome: s.GENERAL.show_welcome ?? true,
    dataDir: s.DATA.dir,
    collectionsDir: s.DATA.collections_dir ?? '',
    reportsDir: s.DATA.reports_dir ?? '',
    packagesDir: s.DATA.packages_dir ?? '',
    wildintelNewEnabled: s.EPICOLLECTCSV?.enabled ?? true, trapperEnabled: s.TRAPPER.enabled ?? true,
    agoutiEnabled: s.AGOUTI?.enabled ?? false, agoutiUrl: s.AGOUTI?.base_url ?? '', agoutiKey: '', agoutiProject: s.AGOUTI?.project_id ?? '',
    trapperUrl: s.TRAPPER.base_url ?? '',
    maxZipMb: String(s.TRAPPER.max_zip_mb),
    trapperUser: s.TRAPPER.user_name ?? '',
    trapperPassword: '',
    epicollectEnabled: s.EPICOLLECT5.enabled,
    epicollectUnmappedToComments: s.EPICOLLECT5.unmapped_to_comments,
    epicollectSlug: s.EPICOLLECT5.project_slug ?? '',
    epicollectClientId: s.EPICOLLECT5.client_id ?? '',
    epicollectClientSecret: '',
    epicollectMapping: { ...s.EPICOLLECT5.mapping },
    validation: { ...s.VALIDATION },
    postvalidation: checks,
    toleranceHours: String(post.tolerance_hours),
    sequenceGap: String(post.sequence_gap_seconds),
    minRevisions: String(post.min_revisions),
    similarityMethod: post.similarity_method,
    imageTolerance: String(post.image_count_tolerance),
    sequenceCountTolerance: String(post.sequence_count_tolerance),
    sequenceLengthTolerance: String(post.sequence_length_tolerance),
    rename: s.PREPROCESSING.rename,
    resize: s.PREPROCESSING.resize,
    resizeWidth: String(s.PREPROCESSING.resize_width),
    metadata: s.PREPROCESSING.metadata,
    owner: s.PREPROCESSING.owner,
    publisher: s.PREPROCESSING.publisher,
    coverage: s.PREPROCESSING.coverage,
    licenseUrl: s.PREPROCESSING.license_url,
    ignoreDst: s.PREPROCESSING.ignore_dst,
    convertToUtc: s.PREPROCESSING.convert_to_utc,
    trappers: s.FIELDWORK.trappers.map((t) => ({ ...t })),
    sdCards: s.FIELDWORK.sd_cards.map((c) => ({ ...c })),
    roles: (s.FIELDWORK.roles ?? []).map((r) => ({ ...r })),
    cameras: s.FIELDWORK.cameras.map((c) => ({ ...c })),
  }
}

function numberIn(value: string, { min, max, decimal }: Limits): number | null {
  const pattern = decimal ? /^\d+(\.\d+)?$/ : /^\d+$/
  return pattern.test(value.trim()) && Number(value) >= min && Number(value) <= max ? Number(value) : null
}

/** An absolute path — "/…", "~…", "C:\…" or a network share — as the backend requires. */
function isAbsolutePath(path: string): boolean {
  return /^(\/|~|[A-Za-z]:[\\/]|\\\\)/.test(path.trim())
}

function sectionValid(d: Draft, id: SectionId): boolean {
  if (id === 'general') return (d.dataDir.trim() === '' || isAbsolutePath(d.dataDir)) && FOLDERS.every(({ draftKey }) => d[draftKey].trim() === '' || isAbsolutePath(d[draftKey])) && numberIn(d.workers, WORKERS) !== null
  if (id === 'postvalidation') {
    return numberIn(d.toleranceHours, TOLERANCE) !== null && numberIn(d.sequenceGap, SEQUENCE_GAP) !== null
      && numberIn(d.minRevisions, MIN_REVISIONS) !== null
      && [d.imageTolerance, d.sequenceCountTolerance, d.sequenceLengthTolerance].every((t) => numberIn(t, SIMILARITY_TOLERANCE) !== null)
  }
  if (id === 'preprocessing') return numberIn(d.resizeWidth, RESIZE_WIDTH) !== null
  if (id === 'uploader') return numberIn(d.maxZipMb, MAX_ZIP_MB) !== null
  return true
}

function toUpdate(d: Draft): AppSettingsUpdate | null {
  if (!SECTIONS.every((s) => sectionValid(d, s.id))) return null
  return {
    GENERAL: { log_level: d.logLevel, workers: Number(d.workers), default_research_project: d.defaultResearchProject.trim() || null, show_welcome: d.showWelcome },
    TRAPPER: { enabled: d.trapperEnabled, base_url: d.trapperUrl.trim() || null, user_name: d.trapperUser.trim() || null, user_password: d.trapperPassword, max_zip_mb: Number(d.maxZipMb) },
    EPICOLLECT5: { enabled: d.epicollectEnabled, unmapped_to_comments: d.epicollectUnmappedToComments, project_slug: d.epicollectSlug.trim() || null, client_id: d.epicollectClientId.trim() || null, client_secret: d.epicollectClientSecret, mapping: d.epicollectMapping },
    AGOUTI: { enabled: d.agoutiEnabled, base_url: d.agoutiUrl.trim() || null, api_key: d.agoutiKey, project_id: d.agoutiProject.trim() || null },
    EPICOLLECTCSV: { enabled: d.wildintelNewEnabled },
    DATA: { dir: d.dataDir.trim() || null, collections_dir: d.collectionsDir.trim() || null, reports_dir: d.reportsDir.trim() || null, packages_dir: d.packagesDir.trim() || null },
    VALIDATION: d.validation,
    POSTVALIDATION: {
      ...d.postvalidation, tolerance_hours: Number(d.toleranceHours), sequence_gap_seconds: Number(d.sequenceGap),
      min_revisions: Number(d.minRevisions), similarity_method: d.similarityMethod, image_count_tolerance: Number(d.imageTolerance),
      sequence_count_tolerance: Number(d.sequenceCountTolerance), sequence_length_tolerance: Number(d.sequenceLengthTolerance),
    },
    PREPROCESSING: {
      rename: d.rename, resize: d.resize, resize_width: Number(d.resizeWidth), metadata: d.metadata,
      owner: d.owner.trim(), publisher: d.publisher.trim(), coverage: d.coverage.trim(), license_url: d.licenseUrl.trim(),
      ignore_dst: d.ignoreDst, convert_to_utc: d.convertToUtc,
    },
    FIELDWORK: {
      trappers: d.trappers, sd_cards: d.sdCards, cameras: d.cameras, roles: d.roles,
    },
    FIELDLOG: {
      time_source: 'created_at', keep_seconds: d.fieldlogKeepSeconds,
    },
  }
}

// ── Layout pieces ───────────────────────────────────────────────────────

/** The folders of the app that can be put somewhere of their own; blank, each is a folder inside the data folder. */
const FOLDERS: { draftKey: 'collectionsDir' | 'reportsDir' | 'packagesDir'; label: string; description: string; hint: string; dialog: string }[] = [
  { draftKey: 'collectionsDir', label: 'Collections folder', dialog: 'Select the folder to keep the collections in',
    description: 'The images of each deployment.',
    hint: 'Empty: inside the data folder.' },
  { draftKey: 'reportsDir', label: 'Reports folder', dialog: 'Select the folder to keep the reports in',
    description: 'The reports of the checks and of the preparation.',
    hint: 'Empty: inside the data folder.' },
  { draftKey: 'packagesDir', label: 'Packages folder', dialog: 'Select the folder to keep the packages in',
    description: 'The files prepared to upload to TRAPPER.',
    hint: 'Empty: inside the data folder.' },
]

type SectionId = 'general' | 'uploader' | 'sources' | 'validation' | 'postvalidation' | 'preprocessing' | 'entities' | 'reports' | 'config'

/** The lists of the entities, each with its own tab. The sections of the settings that used to be one each open the entities on their tab. */
type EntityTab = 'projects' | 'trappers' | 'roles' | 'locations' | 'cameras' | 'sdcards'
const ENTITY_SECTIONS: Record<string, EntityTab> = { projects: 'projects', trappers: 'trappers', roles: 'roles', sdcards: 'sdcards', cameras: 'cameras', locations: 'locations' }

/** The platforms a deployment can be uploaded to, each set up in the Uploader section. */

const SECTIONS: { id: SectionId; label: string; icon: () => ReactNode }[] = [
  { id: 'general', label: 'General', icon: SlidersIcon },
  { id: 'uploader', label: 'Uploader', icon: UploadIcon },
  { id: 'sources', label: 'Visit sources', icon: FileIcon },
  { id: 'validation', label: 'Validation', icon: CheckIcon },
  { id: 'postvalidation', label: 'Postvalidation', icon: ShieldIcon },
  { id: 'preprocessing', label: 'Preprocessing', icon: ImageIcon },
  { id: 'entities', label: 'Entities', icon: UsersIcon },
  { id: 'reports', label: 'Reports', icon: ReportIcon },
  { id: 'config', label: 'Config', icon: FileIcon },
]

/** One setting: its name and what it does on the left, its controls on the
 * right — stacked on narrow screens. */
function Row({ label, description, children }: { label: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[13rem_1fr] gap-x-10 gap-y-3 py-5">
      <div className="md:text-right">
        <div className="text-base text-zinc-800 dark:text-zinc-200">{label}</div>
        {description && <p className={`${hintClass} mt-1 leading-relaxed`}>{description}</p>}
      </div>
      <div className="space-y-3 min-w-0">{children}</div>
    </div>
  )
}

/** A card of settings kept in blocks, each with its title and what it is for. */
function SettingsCard({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 divide-y divide-zinc-200 dark:divide-zinc-800">{children}</div>
}
function CardBlock({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="px-6 py-5 space-y-4">
      <div>
        <h5 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h5>
        {description && <p className={`${hintClass} mt-1 leading-relaxed max-w-prose`}>{description}</p>}
      </div>
      {children}
    </section>
  )
}

/** A field with its label above it, outside the box, as the account of Trapper is asked. */
function PlainField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">{label}</span>
      {children}
      {hint && <p className={hintClass}>{hint}</p>}
    </div>
  )
}

/** A filled, rounded field with its label inside, above the value. */
function BoxField({ label, error, children }: { label: string; error?: string | null; children: ReactNode }) {
  return (
    <div>
      <label className={[
        'block rounded-xl px-4 py-2 bg-zinc-100 dark:bg-zinc-800 border transition-colors',
        'focus-within:border-blue-500',
        error ? 'border-red-500' : 'border-transparent',
      ].join(' ')}>
        <span className="block text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
        {children}
      </label>
      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1 px-1">{error}</p>}
    </div>
  )
}

const boxInput = 'block w-full bg-transparent text-base text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none py-0.5'

function TextBox({ label, value, onChange, type = 'text', placeholder, mono, error, list, disabled }: {
  disabled?: boolean
  label: string; value: string; onChange: (v: string) => void; type?: 'text' | 'password'; placeholder?: string; mono?: boolean; error?: string | null
  /** The id of a <datalist> of suggestions: pick one, or type anything. */
  list?: string
}) {
  return (
    <BoxField label={label} error={error}>
      <input
        type={type} className={`${boxInput} ${mono ? 'font-mono text-sm' : ''}`} value={value} placeholder={placeholder} aria-label={label} list={list} disabled={disabled}
        aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)} autoComplete={type === 'password' ? 'new-password' : 'off'}
      />
    </BoxField>
  )
}

function NumberBox({ label, value, limits, onChange, unit }: {
  label: string; value: string; limits: Limits; onChange: (v: string) => void; unit?: string
}) {
  const invalid = numberIn(value, limits) === null
  return (
    <BoxField label={label} error={invalid ? `${limits.decimal ? 'A number' : 'A whole number'} from ${limits.min} to ${limits.max}.` : null}>
      <span className="flex items-baseline gap-2">
        <input
          className={boxInput} inputMode={limits.decimal ? 'decimal' : 'numeric'} value={value} aria-invalid={invalid} aria-label={label}
          onChange={(e) => onChange(e.target.value)}
        />
        {unit && <span className={hintClass}>{unit}</span>}
      </span>
    </BoxField>
  )
}

const LOG_LEVELS: { value: LogLevel; label: string; hint: string }[] = [
  { value: 'ERROR', label: 'Errors only', hint: 'Only what goes wrong.' },
  { value: 'WARNING', label: 'Warnings', hint: 'Problems and things worth checking.' },
  { value: 'INFO', label: 'Normal', hint: 'What WildINTEL Uploader does: each scan, check and import started and finished.' },
  { value: 'DEBUG', label: 'Everything', hint: 'For tracking a problem down. Makes the file bigger.' },
]

/** A filled, rounded select with its label inside — like BoxField. */
function SelectBox<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void
}) {
  return (
    <BoxField label={label}>
      <select className={`${boxInput} cursor-pointer`} value={value} aria-label={label} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </BoxField>
  )
}

/** The licenses the images can be shared under. What is written into each image is the URL. */
const LICENSES: { value: string; label: string; description: string }[] = [
  { value: 'https://creativecommons.org/publicdomain/zero/1.0/', label: 'CC0',
    description: 'Data are made available for any use without restriction or particular requirements on the part of users.' },
  { value: 'https://creativecommons.org/licenses/by/4.0/', label: 'CC BY',
    description: 'Data are made available for any use provided that attribution is appropriately given for the sources of data used, in the manner specified by the owner.' },
  { value: 'https://creativecommons.org/licenses/by-nc/4.0/', label: 'CC BY-NC',
    description: 'Data are made available for any use provided that attribution is appropriately given and provided the use is not for commercial purposes.' },
]

function CheckOption({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer py-1">
      <input
        type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="w-5 h-5 mt-0.5 rounded-md accent-blue-600 cursor-pointer shrink-0"
      />
      <span>
        <span className="block text-base text-zinc-800 dark:text-zinc-200">{label}</span>
        {hint && <span className={`block ${hintClass}`}>{hint}</span>}
      </span>
    </label>
  )
}

const btnOutline = 'px-3 h-10 flex items-center text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
const iconBtn = 'w-10 h-10 shrink-0 flex items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors'

/** One check as an entry of its own: its name and what it looks at, a switch to turn it on or off at once, and — only when
 * it has something to configure — a gear that opens its settings. An entry whose settings are wrong opens them by itself. */
function CheckEntry({ label, hint, enabled, onToggle, settings, invalid }: {
  label: string; hint: string; enabled: boolean; onToggle: (v: boolean) => void; settings?: ReactNode; invalid?: boolean
}) {
  const [open, setOpen] = useState(false)
  const shown = open || Boolean(invalid)
  return (
    <div className={`rounded-xl bg-zinc-100 dark:bg-zinc-800 border ${invalid ? 'border-red-500' : 'border-transparent'}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className={`text-base ${enabled ? 'text-zinc-800 dark:text-zinc-200' : 'text-zinc-500 dark:text-zinc-400'}`}>{label}</p>
          <p className={hintClass}>{hint}</p>
        </div>
        {settings !== undefined && (
          <button type="button" className={`${iconBtn} ${shown ? 'bg-zinc-200 dark:bg-zinc-700' : ''}`} aria-label={`Configure ${label}`} aria-expanded={shown}
                  title="Its settings" onClick={() => setOpen((o) => !o)}>
            <GearIcon />
          </button>
        )}
        <button type="button" role="switch" aria-checked={enabled} aria-label={label} onClick={() => onToggle(!enabled)}
                className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${enabled ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600'}`}>
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>
      {settings !== undefined && shown && (
        <div role="group" aria-label={`${label} settings`} className="px-4 pb-4 pt-3 space-y-3 border-t border-zinc-200 dark:border-zinc-700">{settings}</div>
      )}
    </div>
  )
}

/** Turns every check of a section on or off in one go. */
function AllChecksButtons({ on, total, onAll }: { on: number; total: number; onAll: (on: boolean) => void }) {
  const all = on === total
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 px-5 py-4">
      <p role="status" className="text-base text-zinc-600 dark:text-zinc-400">{on} of {total} checks are on</p>
      <button type="button" className={btnOutline} onClick={() => onAll(!all)}>{all ? 'Turn all off' : 'Turn all on'}</button>
    </div>
  )
}

/** The checks the wizard can show, with what each one looks at. */
const IMAGE_CHECKS: { key: ImageCheck; label: string; hint: string }[] = [
  { key: 'corrupted', label: 'Corrupted images', hint: 'Files that fail to open and decode.' },
  { key: 'sequence', label: 'Shooting order vs. filename sequence', hint: 'A higher-numbered file dated earlier than a lower-numbered one — a clock reset, or cards mixed.' },
  { key: 'structure', label: 'Folder structure (subdirectories)', hint: 'Images spread over subfolders instead of one flat folder.' },
  { key: 'camera', label: 'Same camera (model and id) on every image', hint: 'More than one camera among the images. Reads the serial number with ExifTool when it is installed.' },
  { key: 'exif', label: 'Required EXIF fields', hint: 'Capture date, camera model and camera id on every image.' },
  { key: 'duplicates', label: 'Duplicate images', hint: 'Files with exactly the same content.' },
]

const DEPLOYMENT_CHECKS: { key: DeploymentCheck; label: string; hint: string }[] = [
  { key: 'deployment_id', label: 'Deployment id format', hint: 'R + four digits, a hyphen, the location id and an optional _suffix — R0033-DONA_01.' },
  { key: 'collection_prefix', label: 'Deployment id starts with its collection', hint: 'R0003-… goes in the collection R0003.' },
  { key: 'collection_name', label: 'Collection name', hint: 'R + four digits, optionally _suffix — R0033.' },
  { key: 'location', label: "Deployment id's location is the one chosen", hint: 'The part after the hyphen is the location picked as where the images were taken.' },
  { key: 'time_range', label: 'Image dates fit the deployment', hint: 'The first image at the start, the last at the end and the rest in between — each within the tolerance (see its settings).' },
  { key: 'camera', label: 'Camera consistency', hint: 'The camera declared for the deployment is the one in the images.' },
  { key: 'image_count', label: 'Number of images is like the previous revisions', hint: 'Compared with the earlier revisions of the same location — a camera that fired nonstop, or died early.' },
  { key: 'sequence_count', label: 'Number of sequences is like the previous revisions', hint: 'How many sequences there are, with a sequence as defined in its settings.' },
  { key: 'sequence_length', label: 'Length of the sequences is like the previous revisions', hint: 'How many images a sequence has, on average.' },
  { key: 'sd_card', label: 'The SD card is the one the visit left', hint: 'The card the images come from is the one the visit of the deployment left in the camera. Only for a deployment of a visit.' },
  { key: 'photo_count', label: 'The images are those the visit counted', hint: 'The folder has as many images as the visit counted on the card when it collected it. Only for a deployment of a visit.' },
]

const SIMILARITY_METHODS: { value: SimilarityMethod; label: string }[] = [
  { value: 'median', label: 'The median of the previous revisions' },
  { value: 'mean', label: 'The mean of the previous revisions' },
  { value: 'last', label: 'The last previous revision' },
  { value: 'range', label: 'The range the previous revisions span' },
]

// ── The page ────────────────────────────────────────────────────────────

const btnDanger = 'inline-flex items-center px-4 py-2 text-sm rounded-xl bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/70 transition-colors'

/** A window over the page, closed by a click outside it. */
function DialogShell({ label, title, onClose, children }: { label: string; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}
           className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-6 space-y-4">
        <h5 className="text-lg font-semibold">{title}</h5>
        {children}
      </div>
    </div>
  )
}

const ChevronLeftIcon = () => (<Icon size={14}><path d="M15 18l-6-6 6-6" /></Icon>)

/** Creating or editing an entity: a page of its own, in place of its list — with the way back over it, its fields, and Cancel and Save at the foot. */
function FormPage({ region, backLabel, onBack, title, badges = [], children, onCancel, onSave, saveLabel = 'Save changes', saveDisabled = false, onRemove, removeLabel, readOnly = false, notice }: {
  region: string; backLabel: string; onBack: () => void; title: string; badges?: BadgeSpec[]; children: ReactNode
  onCancel: () => void; onSave: () => void; saveLabel?: string; saveDisabled?: boolean
  /** Without it the entity cannot be removed from here. */
  onRemove?: () => void; removeLabel?: string
  /** Only to be seen: the fields are locked, and there is nothing to save or remove. */
  readOnly?: boolean
  /** What is said over the fields — that it comes from Trapper, say. */
  notice?: ReactNode
}) {
  return (
    <section aria-label={region} className="max-w-xl space-y-5">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"><ChevronLeftIcon />{backLabel}</button>
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{title}</h4>
        {badges.map((b) => <Badge key={b.text} {...b} />)}
      </div>
      {notice}
      <fieldset disabled={readOnly} className="space-y-4 border-0 p-0 m-0 min-w-0">{children}</fieldset>
      <div className="flex items-center justify-between gap-2 pt-4 border-t border-zinc-200 dark:border-zinc-800">
        {onRemove && !readOnly ? <button type="button" className={btnDanger} onClick={onRemove}>{removeLabel}</button> : <span />}
        <div className="flex items-center gap-2">
          <button type="button" className={btnOutline} onClick={onCancel}>{readOnly ? 'Close' : 'Cancel'}</button>
          {!readOnly && <button type="button" className={btnPrimary} disabled={saveDisabled} onClick={onSave}>{saveLabel}</button>}
        </div>
      </div>
    </section>
  )
}

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'zinc'
interface BadgeSpec { text: string; tone: Tone; lock?: boolean; hint?: string }
const TONES: Record<Tone, string> = {
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  zinc: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300',
}
const STATUS_TONES: Record<string, Tone> = { active: 'green', ready: 'blue', planned: 'amber', finished: 'zinc', inactive: 'zinc', archived: 'zinc', stolen: 'red', lost: 'red', broken: 'red' }
/** The badge of a status — what day it began and why are in its tooltip. */
const statusBadge = (status: string | null | undefined, date?: string | null, note?: string | null): BadgeSpec => ({
  text: STATUS_LABELS[status ?? 'active'] ?? String(status), tone: STATUS_TONES[status ?? 'active'] ?? 'zinc',
  hint: [date && `since ${date}`, note].filter(Boolean).join(' — ') || undefined,
})
/** Where a research project or a location came from: Trapper's are read-only here. */
/** The warning of a site whose time zone is not UTC: a red label, as the ones of the state of a visit. */
const notUtcBadge = (timezone: string | null | undefined): BadgeSpec[] => (timezone && !isUtcZone(timezone) ? [{ text: 'Not UTC', tone: 'red', hint: `The time zone is ${timezone}, not UTC` }] : [])
const originBadge = (trapperPk: number | null | undefined): BadgeSpec => (trapperPk != null ? { text: 'From TRAPPER', tone: 'blue', lock: true } : { text: 'Created here', tone: 'zinc' })

function Badge({ text, tone, lock, hint }: BadgeSpec) {
  return (
    <span title={hint} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${TONES[tone]}`}>{lock && <LockIcon />}{text}</span>
  )
}

/** One entry of a list of entities: its id, its badges, what it is and what it holds, and the buttons that view or edit it, or delete it. */
function ItemCard({ icon, plain = false, dim = false, title, badges = [], subtitle, meta, editLabel, onEdit, readOnly = false, onDelete, deleteLabel, deleteDisabled = false }: {
  title: string; badges?: BadgeSpec[]; subtitle?: string; meta?: string; editLabel: string; onEdit: () => void
  /** One that can only be seen: its button says View. */
  readOnly?: boolean
  /** The tile at its left that says what kind of entity it is. */
  icon?: ReactNode
  /** A name that is not an id: written as text, not as code. */
  plain?: boolean
  /** One that is no longer in use: its tile is dimmed. */
  dim?: boolean
  onDelete?: () => void; deleteLabel?: string
  /** One that is in use is kept: its button is there but cannot be pressed. */
  deleteDisabled?: boolean
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60">
      {icon && <span className={`w-10 h-10 shrink-0 flex items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 ${dim ? 'opacity-50' : ''}`} aria-hidden="true">{icon}</span>}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`${plain ? '' : 'font-mono '}text-base font-semibold truncate`}>{title}</p>
          {badges.map((b) => <Badge key={b.text} {...b} />)}
        </div>
        {subtitle && <p className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{subtitle}</p>}
        {meta && <p className={`${hintClass} truncate`}>{meta}</p>}
      </div>
      <button type="button" className={`${btnOutline} gap-2`} aria-label={readOnly ? `View ${title}` : editLabel} onClick={onEdit}>
        {readOnly ? <EyeIcon /> : <PencilIcon />}{readOnly ? 'View' : 'Edit'}
      </button>
      {onDelete && (
        <button type="button" aria-label={deleteLabel ?? `Delete ${title}`} title={deleteDisabled ? 'It has visits: mark it as archived instead' : 'Delete'} onClick={onDelete} disabled={deleteDisabled}
                className="w-10 h-10 shrink-0 flex items-center justify-center rounded-xl border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors disabled:opacity-40 disabled:hover:bg-transparent">
          <TrashIcon />
        </button>
      )}
    </div>
  )
}

/** The line over a list of entities: its name and how many there are, and to import from Trapper, from or to a CSV file (under More), or add one. */
function EntityHeader({ heading, count, noun, onFile, onExport, onTemplate, exportDisabled, onTrapper, onAdd, addDisabled }: {
  heading: string; count: number; noun: string; onFile: (file: File | undefined) => void; onExport: () => void; exportDisabled: boolean
  /** Downloads the CSV template: the columns that Import CSV reads, with no rows. */
  onTemplate: () => void
  /** Without it there is no button to import from Trapper. */
  onTrapper?: () => void; onAdd: () => void; addDisabled?: boolean
}) {
  const [menu, setMenu] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
      <h4 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{heading} <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400 align-middle">{count}</span></h4>
      <div className="flex flex-wrap items-center gap-2">
        {onTrapper && <button type="button" className={btnOutline} onClick={onTrapper} disabled={addDisabled}>Import from TRAPPER</button>}
        <div className="relative">
          <button type="button" className={`${btnOutline} gap-2`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} onBlur={() => setTimeout(() => setMenu(false), 150)}>
            More<ChevronDownIcon />
          </button>
          {menu && (
            <div role="menu" className="absolute right-0 z-20 mt-1 min-w-40 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg py-1">
              <button type="button" role="menuitem" disabled={addDisabled} className="block w-full text-left px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-40"
                      onMouseDown={(e) => e.preventDefault()} onClick={() => { input.current?.click(); setMenu(false) }}>Import CSV</button>
              <button type="button" role="menuitem" disabled={exportDisabled} className="block w-full text-left px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-40"
                      onMouseDown={(e) => e.preventDefault()} onClick={() => { onExport(); setMenu(false) }}>Export CSV</button>
              <button type="button" role="menuitem" className="block w-full text-left px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700"
                      onMouseDown={(e) => e.preventDefault()} onClick={() => { onTemplate(); setMenu(false) }}>CSV template</button>
            </div>
          )}
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label={`Import ${heading} from a CSV file`} disabled={addDisabled} tabIndex={-1}
                 onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        <button type="button" className={`${btnPrimary} inline-flex items-center gap-2`} aria-label={`Add ${noun}`} onClick={onAdd} disabled={addDisabled}><PlusIcon />New {noun}</button>
      </div>
    </div>
  )
}

/** A status picked from cards, each with what it means. */
function StatusChoice({ options, value, onChange }: { options: { value: string; label: string; hint: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <span id="status-choice" className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100"><ActivityIcon />Status</span>
      <div role="radiogroup" aria-labelledby="status-choice" className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
                  className={`text-left rounded-xl px-4 py-3 border transition-colors ${value === o.value ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}>
            <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">{o.label}</span>
            <span className={`block ${hintClass}`}>{o.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

const PROJECT_STATUSES = [
  { value: 'planned', label: 'Planned', hint: 'It is planned: only in Settings, to link entities to it.' },
  { value: 'active', label: 'Active', hint: 'It is seen in the whole app.' },
  { value: 'finished', label: 'Finished', hint: 'Closed, but it can be reopened.' },
  { value: 'archived', label: 'Archived', hint: 'Closed for good: it cannot be modified and never goes back.' },
]
const fieldBox = 'block w-full rounded-xl px-4 py-3 bg-zinc-100 dark:bg-zinc-800 border border-transparent focus:border-blue-500 text-base text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none transition-colors disabled:opacity-60'

/** A field of a form under its label, which says whether it is required, with what to write under it. */
function LabelledField({ label, required, hint, error, htmlFor, children }: { label: string; required?: boolean; hint?: string; error?: string | null; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {label}{required && <span className="ml-2 text-[11px] font-normal uppercase tracking-wide text-red-600 dark:text-red-400">Required</span>}
      </label>
      {children}
      {error && !/^(Required|An? .+ is required)\.?$/.test(error) ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : hint && <p className={hintClass}>{hint}</p>}
    </div>
  )
}

/** A card of a form of the settings: an icon, a title and a paragraph on what goes in it. */
function ProjectSection({ icon, title, hint, spacious = false, children }: { icon?: ReactNode; title?: string; hint?: string; spacious?: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-5 ${spacious ? 'space-y-8' : 'space-y-4'}`}>
      {title && <div><h5 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{icon}{title}</h5>{hint && <p className={hintClass}>{hint}</p>}</div>}
      {children}
    </div>
  )
}

/** A choice among Trapper's options, as the buttons the other forms use. */
function ProjectChoice({ label, hint, options, value, onChange }: { label: string; hint: string; options: { value: string; label: string }[]; value: number; onChange: (v: number) => void }) {
  return (
    <LabelledField label={label} hint={hint}>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={String(value) === o.value} onClick={() => onChange(Number(o.value))}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${String(value) === o.value ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>{o.label}</button>
        ))}
      </div>
    </LabelledField>
  )
}

/** Adding or editing a research project: its acronym, name and description, its keywords as tags, and its status as a choice of three. */
function ProjectForm({ item, others, isNew, onChange, onClose, onDone, doneLabel, onRemove }: {
  item: ProjectDraft; others: string[]; isNew: boolean; onChange: (patch: Partial<ProjectDraft>) => void; onClose: () => void; onDone: () => void; doneLabel: string; onRemove?: () => void
}) {
  const [word, setWord] = useState('')
  const keywords = (item.keywords ?? '').split(',').map((k) => k.trim()).filter(Boolean)
  const setKeywords = (list: string[]) => onChange({ keywords: list.length ? list.join(', ') : null })
  const addWord = () => {
    const w = word.trim()
    if (w && !keywords.some((k) => k.toLowerCase() === w.toLowerCase())) setKeywords([...keywords, w])
    setWord('')
  }
  const acronym = item.acronym.trim()
  const acronymError = isNew ? (PROJECT_FIELDS[0].validate!(acronym) ?? (others.some((o) => o.toLowerCase() === acronym.toLowerCase()) ? `${acronym} is already in the list.` : null)) : null
  const nameError = (item.name ?? '').trim() ? null : 'A name is required.'
  const status = item.status ?? 'active'
  return (
    <FormPage
      region="Research project" backLabel="Research projects" onBack={onClose} title={isNew ? 'New research project' : `Edit ${acronym}`}
      onCancel={onClose} onSave={onDone} saveLabel={doneLabel} saveDisabled={!!acronymError || !!nameError} onRemove={onRemove} removeLabel="Remove research project"
    >
      <ProjectSection icon={<FolderIcon />} title="Which project is it?" hint="Its acronym, which names its folder, its name, and a few words about it.">
      <LabelledField label="Acronym" required htmlFor="rp-acronym" hint="3 to 10 characters: letters, numbers, _ . or -. It is also the name of the project’s folder." error={acronymError && acronym ? acronymError : null}>
        <input id="rp-acronym" aria-label="Acronym" className={fieldBox} value={item.acronym} disabled={!isNew} placeholder="e.g. DONA" autoComplete="off" onChange={(e) => onChange({ acronym: e.target.value })} />
      </LabelledField>
      <LabelledField label="Name" required htmlFor="rp-name">
        <input id="rp-name" aria-label="Name" className={fieldBox} value={item.name ?? ''} autoComplete="off" onChange={(e) => onChange({ name: e.target.value })} />
      </LabelledField>
      <LabelledField label="Description" htmlFor="rp-description">
        <textarea id="rp-description" aria-label="Description" rows={3} className={`${fieldBox} resize-y`} value={item.description ?? ''} onChange={(e) => onChange({ description: e.target.value || null })} />
      </LabelledField>
      <LabelledField label="Keywords" htmlFor="rp-keyword" hint="Press Enter or Add after each one.">
        {keywords.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Keywords">
            {keywords.map((k) => (
              <li key={k} className="inline-flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-full text-sm bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100">
                {k}
                <button type="button" aria-label={`Remove ${k}`} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => setKeywords(keywords.filter((x) => x !== k))}>×</button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <input id="rp-keyword" aria-label="New keyword" className={fieldBox} value={word} placeholder="e.g. camera traps" autoComplete="off" onChange={(e) => setWord(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addWord() } }} />
          <button type="button" aria-label="Add keyword" className={`${btnOutline} h-12 shrink-0`} onClick={addWord}>Add</button>
        </div>
      </LabelledField>
      </ProjectSection>
      <ProjectSection spacious icon={<SlidersIcon />} title="How was it done?" hint="The design of the study, as TRAPPER asks for it. It goes into the metadata of the deployments.">
        <ProjectChoice label="Sampling design" hint="How the places of the cameras were chosen." options={SAMPLING_DESIGN_OPTIONS} value={item.sampling_design} onChange={(v) => onChange({ sampling_design: v })} />
        <ProjectChoice label="Sensor method" hint="What makes the camera take a picture." options={SENSOR_METHOD_OPTIONS} value={item.sensor_method} onChange={(v) => onChange({ sensor_method: v })} />
        <ProjectChoice label="Animal types" hint="Whether the animals are marked, so they can be told apart." options={ANIMAL_TYPES_OPTIONS} value={item.animal_types} onChange={(v) => onChange({ animal_types: v })} />
        <ProjectChoice label="Bait use" hint="What was used to attract the animals, if anything." options={BAIT_USE_OPTIONS} value={item.bait_use} onChange={(v) => onChange({ bait_use: v })} />
        <LabelledField label="Event interval" htmlFor="rp-interval" hint="The minutes between two pictures that still belong to the same event. 0 if it does not apply.">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <input id="rp-interval" aria-label="Event interval" type="number" min={0} step={1} className={`${fieldBox} pr-28 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`} value={item.event_interval} onChange={(e) => onChange({ event_interval: e.target.value })} />
              <span className="absolute inset-y-0 right-4 flex items-center text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">minutes</span>
            </div>
            {([['Decrease the event interval', '−', -1], ['Increase the event interval', '+', 1]] as const).map(([name, sign, step]) => (
              <button key={name} type="button" aria-label={name} disabled={step < 0 && (Number(item.event_interval) || 0) <= 0}
                      onClick={() => onChange({ event_interval: String(Math.max(0, (Number(item.event_interval) || 0) + step)) })}
                      className="h-12 w-12 shrink-0 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-lg text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 transition-colors">{sign}</button>
            ))}
          </div>
        </LabelledField>
      </ProjectSection>
      <ProjectSection icon={<FileIcon />} title="What is it about?" hint="The abstract and the methods of the study, free text of up to 2000 characters each.">
        <LabelledField label="Abstract" htmlFor="rp-abstract">
          <textarea id="rp-abstract" aria-label="Abstract" rows={4} maxLength={2000} className={`${fieldBox} resize-y`} value={item.abstract ?? ''} onChange={(e) => onChange({ abstract: e.target.value || null })} />
        </LabelledField>
        <LabelledField label="Methods" htmlFor="rp-methods">
          <textarea id="rp-methods" aria-label="Methods" rows={4} maxLength={2000} className={`${fieldBox} resize-y`} value={item.methods ?? ''} onChange={(e) => onChange({ methods: e.target.value || null })} />
        </LabelledField>
      </ProjectSection>
      <ProjectSection>
        <StatusChoice options={PROJECT_STATUSES} value={status} onChange={(v) => onChange({ status: v })} />
      </ProjectSection>
    </FormPage>
  )
}

/** What a research project or a location taken from Trapper says over its page: it can only be seen here. */
function TrapperNotice({ noun, href }: { noun: string; href?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200">
      <div className="flex items-start gap-3 min-w-0">
        <span className="mt-0.5 shrink-0"><LockIcon /></span>
        <div className="min-w-0">
          <p className="font-semibold">This {noun} comes from TRAPPER</p>
          <p className="text-sm opacity-90">It can’t be edited here. Change it in TRAPPER, then import it again.</p>
        </div>
      </div>
      {href && <a href={href} target="_blank" rel="noreferrer" className={btnOutline}>Open in TRAPPER</a>}
    </div>
  )
}

/** A text that filters the list under it. */
function SearchBox({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 px-4 h-11 mb-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 text-zinc-500">
      <SearchIcon />
      <input type="search" aria-label={label} placeholder={label} value={value} onChange={(e) => onChange(e.target.value)}
             className="flex-1 bg-transparent outline-none text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500" />
    </div>
  )
}

/** Whether a search finds an entity: every word of it is somewhere in what the entity says. */
const matches = (search: string, ...texts: (string | null | undefined)[]) => {
  const hay = texts.join(' ').toLowerCase()
  return search.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))
}

/** A field of an item of a card list: the first of them names the item — it is required, and no two items have the same. */
interface ItemField<T> {
  key: keyof T & string; label: string; placeholder?: string; hint?: string
  /** A text (the default), a day, or a text that suggests values — as a research project is picked from a list, but any other can be typed. */
  /** Beside the fields of its section, a column of its own — a map, say. */
  sectionAside?: (item: T, change: (patch: Partial<T>) => void) => ReactNode
  /** An icon beside the title of its section. */
  sectionIcon?: ReactNode
  /** Has to be given, though it is not the first field. */
  required?: boolean
  /** In a CSV file: a row that lacks it, or has it wrong, is left out and said — as the form would not let the item be done. */
  strict?: boolean
  kind?: 'text' | 'date' | 'suggest' | 'bool' | 'select' | 'timezone'
  /** The choices of a select that no one can pick: only what the app does puts an item there — a visit that puts a camera up makes its site active. One it is in already stays. */
  byAppOnly?: string[]
  /** What is wrong with a value, if anything: it is said under the field, and the item cannot be done with until it is put right. */
  validate?: (value: string) => string | null
  suggestions?: string[]
  /** In a styled form: the card it is kept in, under this title (what follows with no title goes in the same one), and what is said under it. */
  section?: string; sectionHint?: string
  /** In a styled form: it shares its line with the next one that also is half. */
  half?: boolean
  /** When it does not apply to the item as it is — what is said, if it does not —: it is off, and cannot be turned on. */
  off?: (item: T) => string | null
  /** What else changes when this one gets a value — summer time is none in UTC. */
  alsoSets?: (value: string) => Partial<T>
  /** It is set when the item is created and cannot be changed afterwards: its box is shown, but disabled, when the item is edited. */
  fixed?: boolean
  /** In a styled form: what its number is measured in, said at the end of the box. */
  unit?: string
  /** What a 'select' offers, the first being what a new item starts with. */
  options?: { value: string; label: string; hint?: string }[]
  /** A 'select' that is not the status: what it says while nothing is chosen. */
  fallback?: string
}

/** A field of an item as the text it is — nothing when it is left blank. */
function textOf<T extends object>(item: T, key: keyof T & string): string {
  return String((item as Record<string, unknown>)[key] ?? '')
}

/** A text that suggests values as it is typed, from a list that filters — pick one, or type any other. */
function SuggestBox({ label, value, onChange, suggestions, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; suggestions: string[]; placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const needle = value.trim().toLowerCase()
  const shown = suggestions.filter((o) => !needle || o.toLowerCase().includes(needle))
  return (
    <div className="relative">
      <BoxField label={label}>
        <input
          role="combobox" aria-expanded={open} aria-autocomplete="list" aria-label={label} autoComplete="off" className={boxInput} value={value} placeholder={placeholder}
          onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onBlur={() => setOpen(false)} onChange={(e) => { onChange(e.target.value); setOpen(true) }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
        />
      </BoxField>
      {open && shown.length > 0 && (
        <ul role="listbox" aria-label={`${label} suggestions`}
            className="absolute z-10 mt-1 w-full max-h-52 overflow-y-auto rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg">
          {shown.map((o) => (
            <li key={o} role="option" aria-selected={o === value}
                className="px-4 py-2 text-sm cursor-pointer text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                onMouseDown={(e) => { e.preventDefault(); onChange(o); setOpen(false) }}>{o}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DateBox({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <BoxField label={label}>
      <input type="date" aria-label={label} className={`${boxInput} [color-scheme:light] dark:[color-scheme:dark]`} value={value} onChange={(e) => onChange(e.target.value)} />
    </BoxField>
  )
}

function ItemForm<T extends object>({ same, caseSensitive = false, noun, backLabel, fields, item, others, isNew, onChange, onRemove, onClose, onDone, doneLabel = 'Save changes', lockFirst = false, badges, readOnly = false, notice, extraRows = [], styled = false, qr, confirmArchive = false }: {
  /** When two items are the same one, if it is not that they have the same first field. */
  same?: (a: T, b: T) => boolean
  /** Two names that differ only in case are two items (an SD card `7b` and `7B`, two cameras, two people): the sites and the research projects are read whatever their case. */
  caseSensitive?: boolean
  noun: string; backLabel: string; fields: ItemField<T>[]; item: T; others: T[]; isNew: boolean; onChange: (patch: Partial<T>) => void; onClose: () => void
  /** Without it the item cannot be removed from here. */
  onRemove?: () => void
  onDone: () => void
  doneLabel?: string
  /** What names the item cannot be changed. */
  lockFirst?: boolean
  badges?: BadgeSpec[]
  /** One that can only be seen — as what comes from Trapper. */
  readOnly?: boolean
  notice?: ReactNode
  /** Fields under their labels that say whether they are required, and a status picked from cards. */
  styled?: boolean
  /** Rows a read-only view says after the fields: what it is that cannot be a field, such as what belongs to it. */
  extraRows?: { label: string; value: string }[]
  /** What its QR code says, shown over the fields once it is added. */
  qr?: string
  /** Archiving is for good: to archive what was not archived, its name is typed again. */
  confirmArchive?: boolean
}) {
  const [first] = fields
  const name = textOf(item, first.key).trim()
  const statusKey = fields.find((f) => f.kind === 'select' && f.key === 'status')?.key
  const [wasArchived] = useState(statusKey ? textOf(item, statusKey) === 'archived' : false)
  const [wasStatus] = useState(statusKey ? textOf(item, statusKey) : '')
  const [typed, setTyped] = useState('')
  const archiving = confirmArchive && !isNew && !wasArchived && !!statusKey && textOf(item, statusKey) === 'archived'
  const unconfirmed = archiving && typed.trim() !== name
  const error = !name ? `A ${first.label.toLowerCase()} is required.` : others.some((o) => (same ? same(o, item) : (caseSensitive ? textOf(o, first.key).trim() === name : textOf(o, first.key).trim().toLowerCase() === name.toLowerCase()))) ? (same ? 'This one is already in the list.' : `${name} is already in the list.`) : null
  const fieldError = (f: ItemField<T>, i: number) => (i === 0 ? error : null) ?? f.validate?.(textOf(item, f.key).trim()) ?? null
  const invalid = fields.some((f, i) => !!fieldError(f, i)) || unconfirmed
  const Noun = noun[0].toUpperCase() + noun.slice(1)
  return (
    <FormPage
      region={Noun} backLabel={backLabel} onBack={onClose} title={isNew ? `New ${noun}` : readOnly ? name : `Edit ${name}`} badges={badges} readOnly={readOnly} notice={notice}
      onCancel={onClose} onSave={onDone} saveLabel={doneLabel} saveDisabled={invalid} onRemove={onRemove} removeLabel={styled ? `Delete ${noun}` : `Remove ${noun}`}
    >
      {!isNew && qr && <QrCode value={qr} label={name} />}
      {readOnly ? (
        <dl className="rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800">
          {[...fields.filter((f, i) => i > 0 && f.key !== 'status').map((f) => {
            const v = textOf(item, f.key)
            return { label: f.label, value: f.kind === 'select' ? (f.options?.find((o) => o.value === v)?.label ?? v) : f.kind === 'bool' ? (v ? 'Yes' : 'No') : v, empty: f.kind === 'bool' ? '' : 'None' }
          }), ...extraRows.map((x) => ({ ...x, empty: '' }))].map((row) => (
            <div key={row.label} className="grid grid-cols-[10rem_1fr] gap-4 px-5 py-3 text-sm">
              <dt className="text-zinc-500 dark:text-zinc-400">{row.label}</dt>
              <dd className={row.value ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}>{row.value || row.empty}</dd>
            </div>
          ))}
        </dl>
      ) : styled ? (() => {
        const change = (f: ItemField<T>, i: number) => (v: string) => onChange({ [f.key]: i === 0 ? v : (v || null), ...f.alsoSets?.(v) } as Partial<T>)
        const choice = fields.findIndex((f) => f.kind === 'select' && f.key === 'status')
        const stateOf = choice >= 0 ? textOf(item, fields[choice].key) || fields[choice].options?.[0]?.value || '' : ''
        // The day and the reason of a status are asked once it is not the active one.
        const ofStatus = (f: ItemField<T>) => f.key === 'status_date' || f.key === 'status_note' || f.key === 'archive_reason'
        const control = (f: ItemField<T>, i: number) => {
          const value = textOf(item, f.key)
          const label = (child: ReactNode) => (
            <LabelledField key={f.key} label={f.label} required={i === 0 || f.required} hint={f.hint} error={fieldError(f, i)} htmlFor={`item-${f.key}`}>{child}</LabelledField>
          )
          if (f.kind === 'bool') {
            const notApplied = f.off?.(item) ?? null   // it does not apply: it is off, and cannot be turned on
            const on = value !== '' && !notApplied
            return (
              <div key={f.key} className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-3">
                <div><p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{f.label}</p>{notApplied ? <p className={hintClass}>{notApplied}</p> : f.hint && <p className={hintClass}>{f.hint}</p>}</div>
                <button type="button" role="switch" aria-checked={on} aria-label={f.label} disabled={(Boolean(f.fixed) && !isNew) || Boolean(notApplied)} onClick={() => change(f, i)(value ? '' : 'yes')}
                        className={`relative w-11 h-6 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            )
          }
          if (f.kind === 'select') {
            // a choice among a few, shown as buttons (the status is the one that has cards of its own)
            const picked = value || f.fallback || ''
            return label(
              <div className="flex flex-wrap gap-2" role="group" aria-label={f.label}>
                {(f.options ?? []).map((o) => (
                  <button key={o.value} type="button" aria-pressed={picked === o.value} onClick={() => change(f, i)(o.value)}
                          disabled={!!f.byAppOnly?.includes(o.value) && wasStatus !== o.value} title={f.byAppOnly?.includes(o.value) && wasStatus !== o.value ? 'Only a visit does this: an Installation makes a location active.' : undefined}
                          className={`px-3 py-1.5 rounded-full text-sm border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${picked === o.value ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>{o.label}</button>
                ))}
              </div>,
            )
          }
          if (f.kind === 'timezone') {
            return label(<TimezoneCombobox id={`item-${f.key}`} value={value} invalid={!!fieldError(f, i)} disabled={Boolean(f.fixed) && !isNew} onChange={change(f, i)} />)
          }
          if (f.kind === 'date') {
            return label(<input id={`item-${f.key}`} type="date" aria-label={f.label} className={`${fieldBox} sm:max-w-60 [color-scheme:light] dark:[color-scheme:dark]`} value={value} onChange={(e) => change(f, i)(e.target.value)} />)
          }
          const input = (
            <input id={`item-${f.key}`} aria-label={f.label} className={`${fieldBox} ${f.unit ? 'pr-20' : ''}`} value={value} placeholder={f.placeholder} autoComplete="off" disabled={(lockFirst && i === 0) || (Boolean(f.fixed) && !isNew)}
                   onChange={(e) => change(f, i)(e.target.value)} />
          )
          return label(
            <>
              {f.unit ? <div className="relative">{input}<span className="absolute inset-y-0 right-4 flex items-center text-sm text-zinc-500 dark:text-zinc-400">{f.unit}</span></div> : input}
              {f.kind === 'suggest' && (
                <div className="flex flex-wrap gap-2 pt-1" aria-label={`${f.label} suggestions`}>
                  {(f.suggestions ?? []).map((o) => (
                    <button key={o} type="button" onClick={() => change(f, i)(o)}
                            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${value === o ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>{o}</button>
                  ))}
                </div>
              )}
            </>,
          )
        }
        // Consecutive "half" fields share a line.
        const lines = (list: { f: ItemField<T>; i: number }[]) => {
          const out: ReactNode[] = []
          for (let k = 0; k < list.length; k++) {
            const { f, i } = list[k]
            if (f.half && list[k + 1]?.f.half) { out.push(<div key={f.key} className="grid grid-cols-1 sm:grid-cols-2 gap-4">{control(f, i)}{control(list[k + 1].f, list[k + 1].i)}</div>); k++ } else out.push(control(f, i))
          }
          return out
        }
        const card = 'rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-5 space-y-4'
        const groups: { title?: string; hint?: string; icon?: ReactNode; aside?: ReactNode; fields: { f: ItemField<T>; i: number }[] }[] = []
        fields.forEach((f, i) => {
          if ((f.kind === 'select' && f.key === 'status') || ofStatus(f)) return
          const last = groups[groups.length - 1]
          if (last && (f.section === undefined || f.section === last.title)) last.fields.push({ f, i })
          else groups.push({ title: f.section, hint: f.sectionHint, icon: f.sectionIcon, aside: f.sectionAside?.(item, onChange), fields: [{ f, i }] })
        })
        return (
          <>
            {groups.map((g, k) => (
              <div key={k} className={card}>
                {g.title && <div><h5 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{g.icon}{g.title}</h5>{g.hint && <p className={hintClass}>{g.hint}</p>}</div>}
                {g.aside ? <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div className="space-y-4">{lines(g.fields)}</div><div className="min-h-56">{g.aside}</div></div> : lines(g.fields)}
              </div>
            ))}
            {choice >= 0 && (
              <div className={card}>
                <StatusChoice options={(fields[choice].options ?? []).map((o) => ({ ...o, hint: o.hint ?? '' }))} value={stateOf} onChange={change(fields[choice], choice)} />
                {stateOf !== 'active' && stateOf !== 'ready' && lines(fields.map((f, i) => ({ f, i })).filter(({ f }) => ofStatus(f)))}
                {archiving && (
                  <LabelledField label={`Type the ${first.label.toLowerCase()} to archive it`} required hint={`Archiving is for good. Write ${name} to confirm.`} htmlFor="archive-confirm">
                    <input id="archive-confirm" aria-label={`Confirm the ${first.label.toLowerCase()}`} className={fieldBox} value={typed} placeholder={name} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
                  </LabelledField>
                )}
              </div>
            )}
          </>
        )
      })() : fields.map((f, i) => (
        <div key={f.key}>
          {(() => {
            const change = (v: string) => onChange({ [f.key]: i === 0 ? v : (v || null), ...f.alsoSets?.(v) } as Partial<T>)
            return f.kind === 'bool' ? (
                <label className="flex items-center gap-3 px-1 py-2 text-sm text-zinc-800 dark:text-zinc-200 cursor-pointer">
                  <input type="checkbox" checked={textOf(item, f.key) !== '' && !f.off?.(item)} disabled={(Boolean(f.fixed) && !isNew) || Boolean(f.off?.(item))} onChange={(e) => change(e.target.checked ? 'yes' : '')} />
                  {f.label}
                </label>
              )
              : f.kind === 'select' ? <SelectBox label={f.label} value={textOf(item, f.key) || f.options?.[0]?.value || ''} onChange={change} options={f.options ?? []} />
              : f.kind === 'date' ? <DateBox label={f.label} value={textOf(item, f.key)} onChange={change} />
              : f.kind === 'suggest' ? <SuggestBox label={f.label} value={textOf(item, f.key)} onChange={change} suggestions={f.suggestions ?? []} placeholder={f.placeholder} />
              : <TextBox label={f.label} value={textOf(item, f.key)} placeholder={f.placeholder} error={fieldError(f, i)} onChange={change} disabled={(lockFirst && i === 0) || (Boolean(f.fixed) && !isNew)} />
          })()}
          {f.hint && <p className={`${hintClass} px-1 mt-1`}>{f.hint}</p>}
        </div>
      ))}
    </FormPage>
  )
}

/** A list kept in the settings: a card for each, with the way to edit it or delete it, and to add one. Adding or editing is a page of its own, kept with Done. */
function ItemsEditor<T extends object>({ same, caseSensitive = false, heading, noun, items, onChange, blank, fields, subtitle, empty, fileName, badges, onDetail, icon, styled, searchLabel, canDelete, plain, dim, meta, readOnly, notice, footnote, qr, openItem }: {
  /** What the QR code of an item says, shown on its page. */
  qr?: (item: T) => string | undefined
  /** When two items are the same one, if it is not that they have the same first field. */
  same?: (a: T, b: T) => boolean
  /** Two names that differ only in case are two items. */
  caseSensitive?: boolean
  heading: string; noun: string; items: T[]; onChange: (v: T[]) => void
  /** What an item is when it is added, before it is edited. */
  blank: T
  fields: ItemField<T>[]
  /** What goes under the name on the card. */
  subtitle: (item: T) => string
  empty: string
  /** The name of the file the list is exported to, without the extension. */
  fileName: string
  /** The tile at the left of each card. */
  icon?: ReactNode | ((item: T) => ReactNode)
  /** Names written as text, not as code. */
  plain?: boolean
  /** Whether an item is no longer in use. */
  dim?: (item: T) => boolean
  /** What goes under the subtitle, small. */
  meta?: (item: T) => string | undefined
  /** An item that can only be seen: its button says View, it cannot be deleted. */
  readOnly?: (item: T) => boolean
  /** What its page says over the fields. */
  notice?: (item: T) => ReactNode
  /** A line of explanation under the list. */
  footnote?: ReactNode
  /** Its form is the one with the fields under their labels and the status as cards. */
  styled?: boolean
  /** What the search box says. */
  searchLabel?: string
  /** Whether an item can be deleted: one that is used cannot. */
  canDelete?: (item: T) => boolean
  /** What the card says of an item besides its name — its status, say. */
  badges?: (item: T) => BadgeSpec[]
  /** Told whether a page of an item is open, which takes the place of the list and of what is over it. */
  onDetail?: (open: boolean) => void
  /** The item (by its name) whose page opens at once — what a link from another page goes to. */
  openItem?: string
}) {
  // The item being added (index null) or edited, as it is changed: it is kept with Done and dropped with Cancel.
  const [editing, setEditing] = useState<{ index: number | null; item: T } | null>(null)
  const key = fields[0].key
  const [search, setSearch] = useState('')
  const opened = useRef(false)
  useEffect(() => {
    if (!openItem || opened.current) return
    const index = items.findIndex((it) => textOf(it, key).toLowerCase() === openItem.toLowerCase())
    if (index >= 0) { opened.current = true; setEditing({ index, item: items[index] }) }
  }, [openItem, items]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onDetail?.(editing !== null) }, [editing !== null]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDetail?.(false), []) // eslint-disable-line react-hooks/exhaustive-deps

  // What reading a CSV file gave: its items join the list (one with the same name replaces that of the list), and what was left out is said.
  const [imported, setImported] = useState<{ added: number; updated: number; problems: string[] } | null>(null)

  async function importFile(file: File | undefined) {
    if (!file) return
    const { items: read, problems } = readItems<T>(await file.text(), fields, blank, noun)
    const next = [...items]
    let added = 0
    let updated = 0
    for (const item of read) {
      const same = next.findIndex((it) => (caseSensitive ? textOf(it, key).trim() === textOf(item, key).trim() : textOf(it, key).toLowerCase() === textOf(item, key).toLowerCase()))
      if (same >= 0) { next[same] = item; updated++ } else { next.push(item); added++ }
    }
    if (added + updated > 0) onChange(next)
    setImported({ added, updated, problems })
  }

  if (editing) {
    const done = () => {
      onChange(editing.index === null ? [...items, editing.item] : items.map((it, i) => (i === editing.index ? editing.item : it)))
      setEditing(null)
    }
    // what is read-only is what was kept: an item that is being archived is still being edited
    const kept = editing.index === null ? editing.item : items[editing.index]
    return (
      <ItemForm
        same={same} caseSensitive={caseSensitive} noun={noun} backLabel={heading} fields={fields} item={editing.item} others={items.filter((_, i) => i !== editing.index)} isNew={editing.index === null}
        onChange={(patch) => setEditing((e) => (e ? { ...e, item: { ...e.item, ...patch } } : e))}
        onRemove={editing.index === null ? undefined : () => { onChange(items.filter((_, i) => i !== editing.index)); setEditing(null) }}
        onClose={() => setEditing(null)} onDone={done} doneLabel={styled ? (editing.index === null ? 'Add' : 'Save changes') : 'Done'} badges={badges?.(editing.item)} styled={styled} qr={qr?.(editing.item)} readOnly={readOnly?.(kept)} notice={notice?.(kept)}
      />
    )
  }

  const shown = items.map((item, index) => ({ item, index })).filter(({ item }) => matches(search, textOf(item, key), subtitle(item)))
  return (
    <div>
      <EntityHeader
        heading={heading} count={items.length} noun={noun} onFile={(f) => void importFile(f)} exportDisabled={items.length === 0}
        onExport={() => download(`${fileName}.csv`, itemsToCsv(items, fields))} onTemplate={() => download(`${fileName}_template.csv`, itemsToCsv<T>([], fields))}
        onAdd={() => setEditing({ index: null, item: blank })}
      />
      {imported && (
        <div role="status" className="mb-3 text-sm">
          <p className="text-emerald-700 dark:text-emerald-400">
            {imported.added} added, {imported.updated} updated from the file — save the settings to keep them.
          </p>
          {imported.problems.length > 0 && <ul className="list-disc pl-5 text-amber-700 dark:text-amber-400">{imported.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>
      )}
      <SearchBox label={searchLabel ?? `Search ${heading.toLowerCase()}`} value={search} onChange={setSearch} />
      <div className="space-y-3">
        {items.length === 0 && <p className={hintClass}>{empty}</p>}
        {items.length > 0 && shown.length === 0 && <p className={hintClass}>Nothing matches “{search}”.</p>}
        {shown.map(({ item, index }) => (
          <ItemCard
            key={index} icon={typeof icon === 'function' ? icon(item) : icon} plain={plain} dim={dim?.(item)} title={textOf(item, key)} badges={badges?.(item)} subtitle={subtitle(item)} meta={meta?.(item)} readOnly={readOnly?.(item)} editLabel={`Edit ${textOf(item, key)}`} onEdit={() => setEditing({ index, item })}
            onDelete={readOnly?.(item) ? undefined : () => onChange(items.filter((_, i) => i !== index))} deleteDisabled={canDelete ? !canDelete(item) : false} deleteLabel={`Delete ${textOf(item, key)}`}
          />
        ))}
      </div>
      {footnote && <p className={`${hintClass} mt-4 max-w-prose`}>{footnote}</p>}
    </div>
  )
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', ready: 'Ready', active: 'Active', inactive: 'Inactive', archived: 'Archived', stolen: 'Stolen', lost: 'Lost', broken: 'Broken', planned: 'Planned', finished: 'Finished',
}
const STATUS_HINTS: Record<string, string> = {
  pending: 'In WildINTEL Uploader, not started yet.', ready: 'Available.', active: 'In use.', inactive: 'Not going to the field.', archived: 'No longer used.', stolen: 'Taken away.', lost: 'Can not be found.', broken: 'Does not work.', planned: 'Not started yet.', finished: 'No more fieldwork.',
}
const statusOptions = (...values: string[]) => values.map((value) => ({ value, label: STATUS_LABELS[value], hint: STATUS_HINTS[value] }))
/** The status of an item, then — for what can stop being used — the day it did and why. */
const statusFields = <T extends object>(values: string[], withDetails: boolean, hints: Record<string, string> = {}, withReason = false, byAppOnly: string[] = []): ItemField<T>[] => [
  { key: 'status' as keyof T & string, label: 'Status', kind: 'select', byAppOnly, options: statusOptions(...values).map((o) => ({ ...o, hint: hints[o.value] ?? o.hint })), hint: 'Only an active one is offered when a visit is registered.' },
  ...(withDetails ? [
    { key: 'status_date' as keyof T & string, label: 'Status since', kind: 'date' as const, hint: 'The day it stopped being active.' },
    ...(withReason ? [{ key: 'archive_reason' as keyof T & string, label: 'Reason', kind: 'select' as const, fallback: 'other', options: ARCHIVE_REASONS }] : []),
    { key: 'status_note' as keyof T & string, label: withReason ? 'Comment' : 'Status note', placeholder: 'e.g. stolen in the visit R0004' },
  ] : []),
]

const GEAR_STATUSES = ['planned', 'ready', 'active', 'archived']
const ARCHIVE_REASONS = [{ value: 'lost', label: 'Lost' }, { value: 'stolen', label: 'Stolen' }, { value: 'broken', label: 'Broken' }, { value: 'other', label: 'Other' }]
const GEAR_HINTS = { planned: 'Only in Settings: it is not in WildINTEL Uploader yet.', ready: 'Available, not in the field yet. Offered when a visit is registered.', active: 'In use in the field. Offered when a visit is registered.', archived: 'Out of use for good: lost, stolen, broken… It never goes back to ready or active.' }

const numberRange = (min: number, max: number) => (v: string) => (v === '' || (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max) ? null : `A number from ${min} to ${max}.`)
/** A number that has to be given: the coordinates of a location. */
const requiredNumberRange = (min: number, max: number) => (v: string) => (v === '' ? 'Required.' : numberRange(min, max)(v))

/** The fields of a location of the settings, the first naming it. */
const LOCATION_FIELDS: ItemField<LocationDraft>[] = [
  { key: 'location_id', label: 'Location id', placeholder: 'e.g. DONA_0001', hint: 'Unique within this research project. It is how visits refer to this place.', section: 'Which place is it?', sectionIcon: <MapPinIcon />, sectionHint: 'The name the location is known by. Visits and deployments refer to it by its id.' },
  { key: 'name', label: 'Name', placeholder: 'e.g. Doñana site 1' },
  { key: 'latitude', label: 'Latitude', required: true, placeholder: 'e.g. 37.0123', section: 'Where is it?', sectionIcon: <CompassIcon />, sectionAside: (l, change) => <LocationMap latitude={l.latitude} longitude={l.longitude} onChange={(latitude, longitude) => change({ latitude, longitude })} />, sectionHint: 'Decimal degrees (WGS84), like 37.0123 and -6.4412. Both are required.', validate: requiredNumberRange(-90, 90) },
  { key: 'longitude', label: 'Longitude', required: true, placeholder: 'e.g. -6.4412', validate: requiredNumberRange(-180, 180) },
  { key: 'coordinate_uncertainty', label: 'Coordinate uncertainty', placeholder: 'e.g. 100', unit: 'metres', hint: 'How far off the position could be.', validate: (v) => (v === '' || (/^\d+$/.test(v) && Number(v) >= 1) ? null : 'A whole number, 1 or more.') },
  { key: 'timezone', label: 'Time zone', required: true, placeholder: 'e.g. Europe/Madrid', section: 'Time', sectionIcon: <ClockIcon />, sectionHint: 'The time zone the location is in, and whether its cameras follow summer time. Every visit and deployment here is read with them.', kind: 'timezone', fixed: true, alsoSets: (v) => (isUtcZone(v) ? { ignore_dst: null } : {}), hint: "The location's own time zone, required. Every visit and deployment here is read in it, so it cannot be changed once the location is created.", validate: (v) => (!v ? 'Required.' : isValidTimezone(v) ? null : 'Not a known IANA time zone (e.g. Europe/Madrid).') },
  { key: 'ignore_dst', label: 'The cameras here ignore summer time', kind: 'bool', fixed: true, off: (l) => (isUtcZone(l.timezone ?? '') ? 'Summer time is not applied in UTC.' : null), hint: 'Turn it on if their clocks stay the same all year; off, they follow summer time. Like the time zone, it cannot be changed once the location is created.' },
  ...statusFields<LocationDraft>(['planned', 'pending', 'ready', 'active', 'archived'], true, { planned: 'Only in Settings: it is not in WildINTEL Uploader yet.', pending: 'In WildINTEL Uploader, waiting to start: its first visit starts it. It is not waited for in the revisions before.', ready: 'It has started and has no camera yet: a visit that says Location start makes it so.', active: 'It has a camera: a visit makes it so.', archived: 'Out of use for good: it never goes back.' }, false, ['active']),
]

/** What a research project is when it is added by hand, or read from a CSV file: its acronym and name, and the fields free text. */
interface ProjectDraft {
  acronym: string; name: string | null; description: string | null; keywords: string | null; status: string | null
  /** Trapper's option numbers of its "Add research project" form. */
  sampling_design: number; sensor_method: number; animal_types: number; bait_use: number
  /** A whole number of minutes, as it is typed. */
  event_interval: string
  abstract: string | null; methods: string | null
}
const BLANK_PROJECT: ProjectDraft = { acronym: '', name: null, description: null, keywords: null, status: 'active', sampling_design: 1, sensor_method: 1, animal_types: 1, bait_use: 1, event_interval: '0', abstract: null, methods: null }
/** What a research project of the settings says of how it was done and what it is about. */
const projectDraftOf = (p: LocalResearchProject): ProjectDraft => ({
  acronym: p.acronym, name: p.name, description: p.description || null, keywords: p.keywords || null, status: p.status ?? 'active',
  sampling_design: p.sampling_design, sensor_method: p.sensor_method, animal_types: p.animal_types, bait_use: p.bait_use, event_interval: String(p.event_interval ?? 0),
  abstract: p.abstract || null, methods: p.methods || null,
})
/** What is kept of a project when it is saved, besides its acronym. */
const projectFields = (p: ProjectDraft) => ({
  name: (p.name ?? '').trim(), description: p.description ?? '', keywords: p.keywords ?? '', status: (p.status ?? 'active') as ResearchProjectStatus,
  sampling_design: p.sampling_design, sensor_method: p.sensor_method, animal_types: p.animal_types, bait_use: p.bait_use, event_interval: Number(p.event_interval) || 0,
  abstract: p.abstract ?? '', methods: p.methods ?? '',
})
const PROJECT_FIELDS: ItemField<ProjectDraft>[] = [
  { key: 'acronym', label: 'Acronym', placeholder: 'e.g. DONA', hint: 'From 3 to 10 letters, digits, _, . or -; it names the research project’s folder.',
    validate: (v) => (/^[0-9A-Za-z][0-9A-Za-z_.-]{2,9}$/.test(v) ? null : 'From 3 to 10 letters, digits, _, . or -.') },
  { key: 'name', label: 'Name', validate: (v) => (v ? null : 'A name is required.') },
  { key: 'description', label: 'Description' },
  { key: 'keywords', label: 'Keywords' },
  ...statusFields<ProjectDraft>(['planned', 'active', 'finished', 'archived'], false, { planned: 'It is planned: only in Settings, to link entities to it.', active: 'It is seen in the whole app.', finished: 'Closed, but it can be reopened.', archived: 'Closed for good: it cannot be modified and never goes back.' }),
]

const locationDraft = (l: LocalLocation): LocationDraft => ({
  location_id: l.location_id, name: l.name, latitude: text(l.latitude), longitude: text(l.longitude),
  coordinate_uncertainty: text(l.coordinate_uncertainty), timezone: l.timezone, ignore_dst: l.ignore_dst ? 'yes' : null, in_service: l.in_service ?? null,
  status: l.status ?? 'active', status_date: l.status_date ?? null, status_note: l.status_note ?? null,
})
const BLANK_LOCATION: LocationDraft = { location_id: '', name: null, latitude: null, longitude: null, coordinate_uncertainty: null, timezone: 'UTC', ignore_dst: null, in_service: null, status: 'pending', status_date: null, status_note: null }
const numberOrNull = (t: string | null) => (t === null ? null : Number(t))
/** What can change of a location kept: its time zone and its summer-time setting are fixed when it is created, so they are not sent. */
const locationChanges = ({ timezone, ignore_dst, ...rest }: ReturnType<typeof locationFields>) => { void timezone; void ignore_dst; return rest }
/** The fields of a location as they are kept — the numbers as numbers. */
const locationFields = (d: LocationDraft) => ({
  name: d.name, latitude: numberOrNull(d.latitude), longitude: numberOrNull(d.longitude), coordinate_uncertainty: numberOrNull(d.coordinate_uncertainty),
  timezone: d.timezone, ignore_dst: d.ignore_dst === 'yes' && !isUtcZone(d.timezone ?? ''), in_service: d.in_service,
  status: (d.status ?? 'active') as LocationStatus, status_date: d.status_date, status_note: d.status_note,
})

const NOT_ASSIGNED = '__none__'

/** What importing gave — and what was left out. */
function ImportResult({ message, problems }: { message: string; problems: string[] }) {
  return (
    <div role="status" className="mb-3 text-sm">
      <p className="text-emerald-700 dark:text-emerald-400">{message}</p>
      {problems.length > 0 && <ul className="list-disc pl-5 text-amber-700 dark:text-amber-400">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
    </div>
  )
}

/** Picks what to import from Trapper — with the account of the settings — from a list that filters as you type. */
function TrapperPanel<T>({ noun, load, keyOf, labelOf, onAdd, onClose }: {
  noun: string; load: () => Promise<T[]>; keyOf: (t: T) => string; labelOf: (t: T) => string
  /** Keeps the ones picked; says how many were kept and what was left out. */
  onAdd: (chosen: T[]) => Promise<{ added: number; problems: string[] }>; onClose: () => void
}) {
  const [items, setItems] = useState<T[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ added: number; problems: string[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(load)
      .then((found) => { if (!cancelled) setItems(found) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not reach TRAPPER.') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function add() {
    setBusy(true)
    try {
      setDone(await onAdd((items ?? []).filter((t) => chosen.includes(keyOf(t)))))
      setChosen([])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4" role="group" aria-label={`Import ${noun}s from TRAPPER`}>
      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-3">Import {noun}s from TRAPPER</p>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
      {!error && items === null && <p className={hintClass}>Connecting to TRAPPER…</p>}
      {items !== null && (
        <CheckboxList
          filterLabel={`Filter TRAPPER ${noun}s`} emptyText={`TRAPPER has no ${noun}s to offer.`} disabled={busy}
          options={items.map((t) => ({ value: keyOf(t), label: labelOf(t) }))} selected={chosen} onChange={setChosen}
        />
      )}
      {done && <div className="mt-3"><ImportResult message={`${done.added} added from TRAPPER.`} problems={done.problems} /></div>}
      <div className="flex items-center gap-3 mt-3">
        <button type="button" className={btnPrimary} disabled={chosen.length === 0 || busy} onClick={() => void add()}>
          Add {chosen.length} {noun}{chosen.length === 1 ? '' : 's'}
        </button>
        <button type="button" className={btnOutline} onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

/** The research projects of the collections folder: listed, added by hand, read from a CSV file or taken from Trapper. They are kept as they are added. */
function ProjectsTab({ projects, onChanged, onDetail, owned, openItem }: {
  projects: LocalResearchProject[]; onChanged: () => void; onDetail?: (open: boolean) => void
  /** The acronym of the research project whose page opens at once (a link from another page). */
  openItem?: string
  /** How many cameras and SD cards each research project has. */
  owned?: (acronym: string) => { cameras: number; sdCards: number }
}) {
  const [adding, setAdding] = useState<ProjectDraft | null>(null)
  // The one being edited, and the one about to be deleted (it is asked first: its locations and visits go with it).
  const [editing, setEditing] = useState<ProjectDraft | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [trapper, setTrapper] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ message: string; problems: string[] } | null>(null)
  const [search, setSearch] = useState('')
  // For a project taken from Trapper, which can only be seen: where Trapper is, and how many locations it has.
  const [seen, setSeen] = useState<{ base: string | null; locations: number | null }>({ base: null, locations: null })
  // The research project asked for (a link from another page) is opened once, when the list has been read.
  const openedItem = useRef(false)
  useEffect(() => {
    if (!openItem || openedItem.current) return
    const found = projects.find((p) => p.acronym.toLowerCase() === openItem.toLowerCase())
    if (found) { openedItem.current = true; setEditing(projectDraftOf(found)) }
  }, [openItem, projects]) // eslint-disable-line react-hooks/exhaustive-deps
  const viewing = editing ? projects.find((p) => p.acronym === editing.acronym && p.trapper_pk != null) : undefined
  useEffect(() => {
    if (!viewing) return
    setSeen({ base: null, locations: null })
    Promise.resolve().then(() => api.getSettings()).then((s) => setSeen((x) => ({ ...x, base: s?.TRAPPER?.base_url ?? null }))).catch(() => {})
    Promise.resolve().then(() => api.listLocalLocations(viewing.acronym)).then(({ results }) => setSeen((x) => ({ ...x, locations: results.length }))).catch(() => {})
  }, [viewing?.acronym]) // eslint-disable-line react-hooks/exhaustive-deps
  const formOpen = adding !== null || editing !== null
  useEffect(() => { onDetail?.(formOpen) }, [formOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDetail?.(false), []) // eslint-disable-line react-hooks/exhaustive-deps

  const keep = (p: ProjectDraft, trapperPk: number | null = null) =>
    api.saveResearchProject({ ...EMPTY_RESEARCH_PROJECT, ...projectFields(p), acronym: p.acronym.trim(), trapper_pk: trapperPk })

  async function addByHand() {
    if (!adding) return
    setError(null)
    try { await keep(adding); setAdding(null); onChanged() } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the research project.') }
  }

  async function saveEdit() {
    if (!editing) return
    setError(null)
    try {
      await api.updateResearchProject(editing.acronym, projectFields(editing))
      setEditing(null); onChanged()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the research project.') }
  }

  async function confirmDelete() {
    if (!deleting) return
    setError(null)
    try { await api.deleteResearchProject(deleting); setDeleting(null); onChanged() } catch (e) { setDeleting(null); setError(e instanceof Error ? e.message : 'Could not delete the research project.') }
  }

  async function importFile(file: File | undefined) {
    if (!file) return
    setError(null)
    const { items, problems } = readItems<ProjectDraft>(await file.text(), PROJECT_FIELDS, BLANK_PROJECT, 'research project')
    let added = 0
    let there = 0
    for (const item of items) {
      if (projects.some((p) => p.acronym.toLowerCase() === item.acronym.toLowerCase())) { there++; continue }
      const wrong = PROJECT_FIELDS.map((f) => f.validate?.(String(item[f.key] ?? ''))).find(Boolean)
      if (wrong) { problems.push(`${item.acronym}: ${wrong}`); continue }
      try { await keep(item); added++ } catch (e) { problems.push(`${item.acronym}: ${e instanceof Error ? e.message : 'could not be saved.'}`) }
    }
    setResult({ message: `${added} added${there ? `, ${there} already there` : ''}.`, problems })
    if (added) onChanged()
  }

  const editingProject = editing ? projects.find((p) => p.acronym === editing.acronym) : undefined
  if (adding || editing) {
    return (
      <div className="space-y-3">
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {adding ? (
          <ProjectForm
            item={adding} others={projects.map((p) => p.acronym)} isNew doneLabel="Add"
            onChange={(patch) => setAdding((a) => (a ? { ...a, ...patch } : a))} onClose={() => { setAdding(null); setError(null) }} onDone={() => void addByHand()}
          />
        ) : editing && editingProject?.trapper_pk == null ? (
          <ProjectForm
            item={editing} others={[]} isNew={false} doneLabel="Save changes"
            onChange={(patch) => setEditing((e) => (e ? { ...e, ...patch } : e))} onClose={() => { setEditing(null); setError(null) }} onDone={() => void saveEdit()}
            onRemove={() => { setDeleting(editing.acronym); setEditing(null) }}
          />
        ) : editing && (
          <ItemForm<ProjectDraft>
            noun="research project" backLabel="Research projects" fields={PROJECT_FIELDS} item={editing} others={[]} isNew={false} lockFirst
            badges={[statusBadge(editing.status), originBadge(editingProject?.trapper_pk)]} readOnly={editingProject?.trapper_pk != null || editingProject?.status === 'archived'}
            notice={editingProject?.status === 'archived' ? <p className="text-sm text-zinc-500 dark:text-zinc-400">This research project is archived: it can no longer be modified.</p> : editingProject?.trapper_pk != null ? <TrapperNotice noun="project" href={seen.base ? `${seen.base.replace(/\/+$/, '')}/research/project/detail/${editingProject.trapper_pk}/` : undefined} /> : undefined}
            extraRows={editingProject?.trapper_pk != null ? [{ label: 'Belongs to it', value: [seen.locations != null && `${seen.locations} location${seen.locations === 1 ? '' : 's'}`, owned && `${owned(editingProject.acronym).cameras} cameras`, owned && `${owned(editingProject.acronym).sdCards} SD cards`].filter(Boolean).join(' · ') }] : []}
            onChange={(patch) => setEditing((e) => (e ? { ...e, ...patch } : e))} onClose={() => { setEditing(null); setError(null) }} onDone={() => void saveEdit()} doneLabel="Save"
            onRemove={() => { setDeleting(editing.acronym); setEditing(null) }}
          />
        )}
      </div>
    )
  }

  const shown = projects.filter((p) => matches(search, p.acronym, p.name))
  return (
    <div>
      <EntityHeader
        heading="Research projects" count={projects.length} noun="research project" onFile={(f) => void importFile(f)} exportDisabled={projects.length === 0} onTrapper={() => setTrapper(true)}
        onExport={() => download('research_projects.csv', itemsToCsv<ProjectDraft>(projects.map((p) => ({ acronym: p.acronym, name: p.name, description: p.description, keywords: p.keywords, status: p.status ?? 'active' })) as ProjectDraft[], PROJECT_FIELDS))}
        onTemplate={() => download('research_projects_template.csv', itemsToCsv<ProjectDraft>([], PROJECT_FIELDS))}
        onAdd={() => setAdding({ ...BLANK_PROJECT })}
      />
      {error && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {result && <ImportResult message={result.message} problems={result.problems} />}
      <SearchBox label="Search research projects" value={search} onChange={setSearch} />
      {trapper && (
        <TrapperPanel<ResearchProject>
          noun="research project" onClose={() => setTrapper(false)} keyOf={(p) => String(p.pk)} labelOf={(p) => (p.acronym ? `${p.acronym} — ${p.name}` : p.name)}
          load={async () => (await api.trapperResearchProjects(NO_CREDENTIALS)).results}
          onAdd={async (chosen) => {
            const problems: string[] = []
            let added = 0
            for (const t of chosen) {
              const acronym = (t.acronym ?? '').trim()
              if (!PROJECT_FIELDS[0].validate!(acronym)) {
                if (projects.some((p) => p.acronym.toLowerCase() === acronym.toLowerCase())) { problems.push(`${acronym} is already there.`); continue }
                try { await keep({ ...BLANK_PROJECT, acronym, name: t.name }, t.pk); added++ } catch (e) { problems.push(`${acronym}: ${e instanceof Error ? e.message : 'could not be saved.'}`) }
              } else problems.push(`“${t.name}” has no acronym of 3 to 10 characters in TRAPPER: add it by hand instead.`)
            }
            if (added) onChanged()
            return { added, problems }
          }}
        />
      )}
      <div className="space-y-3">
        {projects.length === 0 && <p className={hintClass}>No research project yet — add the first one, or take them from TRAPPER.</p>}
        {projects.length > 0 && shown.length === 0 && <p className={hintClass}>Nothing matches “{search}”.</p>}
        {shown.map((p) => (
          <ItemCard key={p.acronym} icon={<ReportIcon />} title={p.acronym} badges={[statusBadge(p.status), originBadge(p.trapper_pk)]} subtitle={p.name} readOnly={p.trapper_pk != null}
                    editLabel={`Edit ${p.acronym}`} onEdit={() => setEditing(projectDraftOf(p))} />
        ))}
      </div>
      {deleting && (
        <DialogShell label="Delete research project" title={`Delete ${deleting}?`} onClose={() => setDeleting(null)}>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Its locations and its visits are deleted with it. A research project that still holds collections, deployments or images is not deleted — they have to go first.
          </p>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-800">
            <button type="button" className={btnOutline} onClick={() => setDeleting(null)}>Cancel</button>
            <button type="button" className={btnDanger} onClick={() => void confirmDelete()}>Delete {deleting}</button>
          </div>
        </DialogShell>
      )}
    </div>
  )
}

/** The locations of one research project, kept in its folder of the collections folder: listed, added, edited, read from a CSV file or taken from Trapper. */
function LocationsTab({ project, onDetail, used, openItem }: { project: LocalResearchProject; onDetail?: (open: boolean) => void; used?: (locationId: string) => number | undefined; openItem?: string }) {
  const [locations, setLocations] = useState<LocalLocation[]>([])
  const [editing, setEditing] = useState<{ item: LocationDraft; isNew: boolean } | null>(null)
  const [trapper, setTrapper] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ message: string; problems: string[] } | null>(null)
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  useEffect(() => { onDetail?.(editing !== null) }, [editing !== null]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDetail?.(false), []) // eslint-disable-line react-hooks/exhaustive-deps

  const load = () => { Promise.resolve().then(() => api.listLocalLocations(project.acronym)).then(({ results }) => setLocations(results)).catch((e) => setError(e instanceof Error ? e.message : 'Could not read the locations.')) }
  useEffect(() => { setLocations([]); setError(null); setResult(null); setTrapper(false); load() }, [project.acronym]) // eslint-disable-line react-hooks/exhaustive-deps

  const there = (id: string) => locations.find((l) => l.location_id.toLowerCase() === id.toLowerCase())
  // The location asked for (a link from another page) is opened once, when the list has been read.
  const openedItem = useRef(false)
  useEffect(() => {
    if (!openItem || openedItem.current) return
    const found = there(openItem)
    if (found) { openedItem.current = true; setEditing({ item: locationDraft(found), isNew: false }) }
  }, [openItem, locations]) // eslint-disable-line react-hooks/exhaustive-deps
  const keep = (d: LocationDraft, trapperPk: number | null = null) => api.saveLocalLocation(project.acronym, { location_id: d.location_id.trim(), ...locationFields(d), trapper_pk: trapperPk })

  async function done() {
    if (!editing) return
    setError(null)
    try {
      if (editing.isNew) await keep(editing.item)
      else await api.updateLocalLocation(project.acronym, editing.item.location_id, locationChanges(locationFields(editing.item)))
      setEditing(null); load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the location.') }
  }

  async function confirmDelete() {
    if (!deleting) return
    setError(null)
    try { await api.deleteLocalLocation(project.acronym, deleting); setDeleting(null); setEditing(null); load() } catch (e) { setDeleting(null); setError(e instanceof Error ? e.message : 'Could not delete the location.') }
  }

  async function importFile(file: File | undefined) {
    if (!file) return
    setError(null)
    const { items, problems } = readItems<LocationDraft>(await file.text(), LOCATION_FIELDS, BLANK_LOCATION, 'location')
    let added = 0
    let updated = 0
    for (const item of items) {
      try {
        if (there(item.location_id)) { await api.updateLocalLocation(project.acronym, there(item.location_id)!.location_id, locationChanges(locationFields(item))); updated++ } else { await keep(item); added++ }
      } catch (e) { problems.push(`${item.location_id}: ${e instanceof Error ? e.message : 'could not be saved.'}`) }
    }
    setResult({ message: `${added} added, ${updated} updated in ${project.acronym}.`, problems })
    if (added || updated) load()
  }

  const where = (l: LocationDraft) => [l.latitude && l.longitude && `${l.latitude}, ${l.longitude}`, l.timezone].filter(Boolean).join(' · ')
  const meta = (l: LocationDraft) => [where(l), usedIn(used?.(l.location_id)), l.status && l.status !== 'active' && l.status !== 'ready' && l.status_date && `${STATUS_LABELS[l.status] ?? l.status} since ${fmtDay(l.status_date)}`].filter(Boolean).join(' · ') || undefined

  const deleteDialog = deleting && (
      <DialogShell label="Delete location" title={`Delete ${deleting}?`} onClose={() => setDeleting(null)}>
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-800">
          <button type="button" className={btnOutline} onClick={() => setDeleting(null)}>Cancel</button>
          <button type="button" className={btnDanger} onClick={() => void confirmDelete()}>Delete {deleting}</button>
        </div>
      </DialogShell>
  )

  if (editing) {
    const stored = editing.isNew ? undefined : locations.find((l) => l.location_id === editing.item.location_id)
    return (
      <div className="space-y-3">
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <ItemForm<LocationDraft>
          noun="location" styled qr={editing.isNew ? undefined : qrPayload('location', project.acronym, editing.item.location_id)} backLabel={`Locations of ${project.acronym}`} fields={LOCATION_FIELDS} item={editing.item} others={editing.isNew ? locations.map(locationDraft) : []} isNew={editing.isNew} lockFirst={!editing.isNew} confirmArchive
          badges={editing.isNew ? undefined : [...notUtcBadge(editing.item.timezone), ...unusualStatus(editing.item), ...(stored?.trapper_pk != null ? [originBadge(stored.trapper_pk)] : [])]} readOnly={stored?.trapper_pk != null || stored?.status === 'archived'}
          notice={stored?.trapper_pk != null ? <TrapperNotice noun="location" /> : stored?.status === 'archived' ? <Notice kind="info">This location is archived for good: it never goes back to active, and it can no longer be changed.</Notice> : undefined}
          onChange={(patch) => setEditing((e) => (e ? { ...e, item: { ...e.item, ...patch } } : e))} onClose={() => { setEditing(null); setError(null) }} onDone={() => void done()} doneLabel={editing.isNew ? 'Add' : 'Save changes'}
          onRemove={editing.isNew ? undefined : () => setDeleting(editing.item.location_id)}
        />
        {deleteDialog}
      </div>
    )
  }

  const shown = locations.filter((l) => matches(search, l.location_id, l.name, l.timezone))
  return (
    <div>
      <EntityHeader
        heading={`Locations of ${project.acronym}`} count={locations.length} noun="location" onFile={(f) => void importFile(f)} exportDisabled={locations.length === 0} onTrapper={() => setTrapper(true)}
        onExport={() => download(`${project.acronym}_locations.csv`, itemsToCsv(locations.map(locationDraft), LOCATION_FIELDS))}
        onTemplate={() => download(`${project.acronym}_locations_template.csv`, itemsToCsv<LocationDraft>([], LOCATION_FIELDS))}
        onAdd={() => setEditing({ item: { ...BLANK_LOCATION, in_service: today() }, isNew: true })}
      />
      {error && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {result && <ImportResult message={result.message} problems={result.problems} />}
      <SearchBox label="Search by id, name or time zone" value={search} onChange={setSearch} />
      {trapper && (
        <TrapperPanel<Location>
          noun="location" onClose={() => setTrapper(false)} keyOf={(l) => String(l.pk)} labelOf={(l) => `${l.location_id}${l.name ? ` — ${l.name}` : ''}`}
          load={async () => {
            if (project.trapper_pk == null) throw new Error(`${project.acronym} was not taken from TRAPPER, so there are no locations of it to import. Add the research project from TRAPPER first.`)
            return (await api.trapperLocations(NO_CREDENTIALS, project.trapper_pk)).results
          }}
          onAdd={async (chosen) => {
            const problems: string[] = []
            let added = 0
            for (const t of chosen) {
              if (there(t.location_id)) { problems.push(`${t.location_id} is already there.`); continue }
              if (t.latitude == null || t.longitude == null) { problems.push(`“${t.location_id}” has no coordinates in TRAPPER, and a deployment needs them. Add it by hand instead.`); continue }
              try {
                await keep({ ...BLANK_LOCATION, in_service: today(), location_id: t.location_id, name: t.name, latitude: String(t.latitude), longitude: String(t.longitude), timezone: t.timezone && isValidTimezone(t.timezone) ? t.timezone : null, ignore_dst: t.ignore_dst ? 'yes' : null }, t.pk)
                added++
              } catch (e) { problems.push(`“${t.location_id}”: ${e instanceof Error ? e.message : 'could not be saved.'}`) }
            }
            if (added) load()
            return { added, problems }
          }}
        />
      )}
      <div className="space-y-3">
        {locations.length === 0 && <p className={hintClass}>{project.acronym} has no locations yet.</p>}
        {locations.length > 0 && shown.length === 0 && <p className={hintClass}>Nothing matches “{search}”.</p>}
        {shown.map((l) => (
          <ItemCard key={l.location_id} icon={<PinIcon />} title={l.location_id} badges={[...notUtcBadge(l.timezone), ...unusualStatus(l), ...(l.trapper_pk != null ? [originBadge(l.trapper_pk)] : [])]} subtitle={l.name ?? ''} meta={meta(locationDraft(l))} readOnly={l.trapper_pk != null || l.status === 'archived'} editLabel={`Edit ${l.location_id}`}
                    onEdit={() => setEditing({ item: locationDraft(l), isNew: false })}
                    onDelete={l.trapper_pk != null ? undefined : () => setDeleting(l.location_id)} deleteDisabled={used?.(l.location_id) ? used(l.location_id)! > 0 : false} />
        ))}
      </div>
      <p className={`${hintClass} mt-4 max-w-prose`}>
        Locations that come from TRAPPER are read-only here. Change them in TRAPPER and import them again. A location that already has visits can't be deleted; mark it as archived instead and it stops being offered for new visits.
      </p>
      {deleteDialog}
    </div>
  )
}

/** A day as it is read in a list: 12 Mar 2024. */
const fmtDay = (day: string | null | undefined) => {
  const d = day ? new Date(`${day}T00:00:00Z`) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : (day ?? '')
}
/** How many visits an item was used in, as it is said under it — nothing while they are not known. */
const usedIn = (n: number | undefined) => (n === undefined ? undefined : n === 0 ? 'No visits yet' : `Used in ${n} visit${n === 1 ? '' : 's'}`)
/** What a camera or an SD card says of itself under its name: since when it is in production, where it was used, and what became of it. */
const gearMeta = (item: { in_service?: string | null; status?: string; status_date?: string | null }, used: number | undefined) =>
  [item.in_service && `In production since ${fmtDay(item.in_service)}`, usedIn(used), item.status && item.status !== 'active' && item.status !== 'ready' && item.status_date && `${STATUS_LABELS[item.status] ?? item.status} since ${fmtDay(item.status_date)}`].filter(Boolean).join(' · ') || undefined
/** A badge only for what is not the usual: a status other than active. */
const ROLE_LABELS: Record<TrapperRoleName, string> = { contact: 'Contact', principalInvestigator: 'Principal investigator', rightsHolder: 'Rights holder', publisher: 'Publisher', contributor: 'Contributor' }
const ROLE_HINTS: Record<string, string> = { contact: 'Who to ask about the data.', principalInvestigator: 'Leads the research.', rightsHolder: 'Owns the rights on the data.', publisher: 'Makes the data available.', contributor: 'Takes part in the work.' }
const unusualStatus = (item: { status?: string | null; status_date?: string | null; status_note?: string | null }): BadgeSpec[] => (item.status && item.status !== 'active' && item.status !== 'ready' ? [statusBadge(item.status, item.status_date, item.status_note)] : [])

/** The letters in the tile of a person: the first of the first and of the last name. */
const initialsOf = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase()
}

/** Research projects, trappers, locations, cameras and SD cards: a settings screen of their own. The trappers are the project's own people
 * but can be in several; the locations, the cameras and the SD cards belong each to a research project. */
function EntitiesSection({ trappers, roles, cameras, sdCards, onTrappers, onRoles, onCameras, onSdCards, initialTab, initialProject, initialItem, onDetail }: {
  trappers: Trapper[]; roles: TrapperRole[]; cameras: Camera[]; sdCards: SdCard[]
  onRoles: (v: TrapperRole[]) => void
  onTrappers: (v: Trapper[]) => void; onCameras: (v: Camera[]) => void; onSdCards: (v: SdCard[]) => void
  initialTab: EntityTab
  initialProject?: string
  /** The SD card or camera whose page opens at once. */
  initialItem?: string
  /** Told whether a form is open in place of a list, which takes the title of the page away too. */
  onDetail?: (open: boolean) => void
}) {
  const [tab, setTab] = useState<EntityTab>(initialTab)
  // A form open in place of a list takes the place of what is over it too.
  const [detail, setDetail] = useState(false)
  useEffect(() => { onDetail?.(detail) }, [detail]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDetail?.(false), []) // eslint-disable-line react-hooks/exhaustive-deps
  // The visits of every research project — read when a list is shown, to say how many each of its items was used in.
  const [visits, setVisits] = useState<{ project: string; visit: StoredVisit }[] | null>(null)
  const [projects, setProjects] = useState<LocalResearchProject[]>([])
  const [projectId, setProjectId] = useState(initialProject ?? '')
  // Opened on no research project in particular, the default one of the general settings is the one shown.
  const defaultApplied = useRef(false)
  const loadProjects = () => {
    Promise.resolve().then(() => api.listResearchProjects()).then(async ({ results }) => {
      setProjects(results)
      if (initialProject || defaultApplied.current) return
      defaultApplied.current = true
      const wanted = await defaultResearchProject()
      const found = results.find((p) => p.acronym.toLowerCase() === wanted.toLowerCase())
      if (wanted && found) setProjectId((current) => current || found.acronym)
    }).catch(() => {})
  }
  useEffect(loadProjects, [])

  const project = projects.find((p) => p.acronym === projectId)
  useEffect(() => {
    if (tab === 'projects' || detail || projects.length === 0) return
    let cancelled = false
    Promise.all(projects.map((p) => Promise.resolve().then(() => api.listVisits(p.acronym)).then((r) => r.results.map((visit) => ({ project: p.acronym, visit }))).catch(() => [])))
      .then((all) => { if (!cancelled) setVisits(all.flat()) })
    return () => { cancelled = true }
  }, [tab, detail, projects])
  /** How many visits match — not known until they are read. */
  const countVisits = (match: (v: StoredVisit, project: string) => boolean) => (visits ? visits.filter((x) => match(x.visit, x.project)).length : undefined)
  const same = (a: string | null | undefined, b: string) => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase()
  // a camera, an SD card or a person is the same one only when written the same: 7b and 7B are two
  const sameName = (a: string | null | undefined, b: string) => (a ?? '').trim() === b.trim()
  // A visit keeps the serial number of its camera, or its label when it has none.
  const usesCamera = (visitCamera: string | null | undefined, c: Camera) => sameName(visitCamera, c.camera_id || c.label)
  const inProject = (project: string) => owner === null || project.toLowerCase() === owner.toLowerCase()
  const TAB_INTRO: Record<EntityTab, string> = {
    projects: 'The research projects the field work belongs to. Each one keeps its own locations, cameras and SD cards.',
    trappers: 'The trappers who go to the field — one can be in several research projects. When a visit is registered, they are the ones to pick as who went.',
    roles: 'What each trapper is in a research project, with the roles of the contributors of Camtrap DP. They go into the metadata of the datasets.',
    locations: 'The places where cameras are set up. Each research project has its own locations, cameras and SD cards.',
    cameras: 'The camera traps. Each one is called by its label, so no two of a project have the same; its serial number is kept when it is known.',
    sdcards: 'The SD cards used to collect images. Each research project keeps its own.',
  }
  const tabs: { id: EntityTab; label: string }[] = [
    { id: 'projects', label: 'Research projects' }, { id: 'trappers', label: 'Trappers' }, { id: 'roles', label: 'Roles' }, { id: 'locations', label: 'Locations' },
    { id: 'cameras', label: 'Cameras' }, { id: 'sdcards', label: 'SD cards' },
  ]
  // A role follows its trapper when it is renamed, and goes with it when it is deleted.
  const changeTrappers = (next: Trapper[]) => {
    const gone = trappers.filter((t) => !next.some((n) => n.name === t.name))
    const added = next.filter((n) => !trappers.some((t) => t.name === n.name))
    const renamed = new Map<string, string>()
    if (gone.length === 1 && added.length === 1) renamed.set(gone[0].name, added[0].name)
    onTrappers(next)
    if (gone.length > 0) onRoles(roles.filter((r) => !gone.some((g) => g.name === r.trapper) || renamed.has(r.trapper)).map((r) => (renamed.has(r.trapper) ? { ...r, trapper: renamed.get(r.trapper)! } : r)))
  }
  const belongs = (rp: string | null) => (projectId === NOT_ASSIGNED ? !rp : !!project && (rp ?? '').toLowerCase() === project.acronym.toLowerCase())
  const owner = projectId === NOT_ASSIGNED ? null : project?.acronym ?? null

  return (
    <div className={`${detail ? 'pb-5' : 'py-5'} space-y-5`}>
      {!detail && <p className={`${hintClass} leading-relaxed max-w-prose`}>{TAB_INTRO[tab]}</p>}
      {!detail && <div role="tablist" aria-label="Entities" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                  className={`px-4 py-2 rounded-xl text-sm transition-colors ${tab === t.id ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}>
            {t.label}
          </button>
        ))}
      </div>}

      {!detail && (tab === 'roles' || tab === 'locations' || tab === 'cameras' || tab === 'sdcards') && (
        <div className="max-w-md">
          <label className={`${hintClass} block mb-1`} htmlFor="entities-project">Research project</label>
          <Combobox
            id="entities-project" value={projectId} onChange={setProjectId}
            options={[...(tab === 'locations' || tab === 'roles' ? [] : [{ value: NOT_ASSIGNED, label: 'Not assigned to a project' }]), ...projects.map((p) => ({ value: p.acronym, label: `${p.acronym} — ${p.name}` }))]}
            placeholder={projects.length === 0 ? 'No research projects yet' : 'Select a research project…'} clearLabel="Clear research project"
          />
          <p className={`${hintClass} mt-2`}>Roles, locations, cameras and SD cards belong to one research project. Changing it here changes all four tabs.</p>
        </div>
      )}

      {tab === 'projects' && <ProjectsTab projects={projects} onChanged={loadProjects} onDetail={setDetail} openItem={initialItem}
        owned={(a) => ({ cameras: cameras.filter((c) => (c.research_project ?? '').toLowerCase() === a.toLowerCase()).length, sdCards: sdCards.filter((c) => (c.research_project ?? '').toLowerCase() === a.toLowerCase()).length })} />}

      {tab === 'roles' && (
        <ItemsEditor<TrapperRole>
          heading={`Roles${owner ? ` in ${owner}` : ''}`} noun="role" fileName={`${owner ?? 'unassigned'}_roles`} styled plain onDetail={setDetail}
          items={roles.filter((r) => !!project && r.research_project.toLowerCase() === project.acronym.toLowerCase())}
          onChange={(v) => onRoles([...roles.filter((r) => !project || r.research_project.toLowerCase() !== project.acronym.toLowerCase()), ...v.map((r) => ({ ...r, research_project: project?.acronym ?? r.research_project }))])}
          icon={(r) => initialsOf(r.trapper)} same={(a, b) => same(a.trapper, b.trapper) && a.role === b.role}
          blank={{ research_project: owner ?? '', trapper: '', role: 'contributor' }}
          subtitle={(r) => ROLE_LABELS[r.role] ?? r.role}
          footnote="A trapper can have several roles in a research project: add one for each. Deleting a trapper deletes its roles."
          empty={project ? 'No role yet in this research project.' : 'Select a research project to see its roles.'} searchLabel="Search by trapper or role"
          fields={[
            { key: 'trapper', label: 'Trapper', placeholder: 'Pick or type a trapper', suggestions: trappers.map((t) => t.name), kind: 'suggest', required: true, section: 'Who is it?', sectionIcon: <UsersIcon />, sectionHint: 'The trapper that has the role, from the list of trappers.',
              validate: (v) => (trappers.some((t) => t.name === v) ? null : 'Pick one of the trappers.') },
            { key: 'role', label: 'Role', kind: 'select', required: true, options: Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label, hint: ROLE_HINTS[value] })), hint: 'The role of the contributor in Camtrap DP.', section: 'What does it do?', sectionIcon: <ShieldIcon />, sectionHint: 'The part this trapper takes in the research project.' },
          ]}
        />
      )}

      {tab === 'trappers' && (
        <ItemsEditor<Trapper>
          heading="Trappers" noun="trapper" fileName="trappers" styled plain onDetail={setDetail} items={trappers} onChange={changeTrappers}
          icon={(t) => initialsOf(t.name)} dim={(t) => t.status === 'inactive' || t.status === 'archived'} readOnly={(t) => t.trapper_pk != null || t.status === 'archived'}
          notice={(t) => (t.trapper_pk != null ? <TrapperNotice noun="trapper" /> : undefined)}
          blank={{ username: '', name: '', affiliation: null, email: null, status: 'active' }}
          badges={(t) => [...(t.status === 'inactive' || t.status === 'archived' ? [statusBadge(t.status)] : []), ...(t.trapper_pk != null ? [originBadge(t.trapper_pk)] : [])]}
          subtitle={(t) => [t.name, t.affiliation].filter(Boolean).join(' · ')}
          meta={(t) => usedIn(countVisits((v) => (v.trappers ?? '').split(',').some((n) => sameName(n, t.name))))}
          footnote="Trappers that come from TRAPPER are read-only here. Change them in TRAPPER and import them again. If someone no longer goes to the field, mark them as inactive instead of deleting them."
          empty="No trapper yet — a visit will have none to pick as who went."
          searchLabel="Search by username, name or affiliation"
          fields={[
            { key: 'username', label: 'Username', placeholder: 'e.g. ana.perez', hint: 'What the trapper is called in WildINTEL Uploader: required, with no spaces, and no two trappers have the same.', section: 'Who is it?', sectionIcon: <UsersIcon />,
              sectionHint: 'The username tells one trapper from another; the full name is how a visit says who went to the field. Where they work and how to write to them are optional.',
              strict: true, validate: (v) => (/^\S+$/.test(v) ? null : 'Required, with no spaces.') },
            { key: 'name', label: 'Full name', required: true, strict: true, placeholder: 'e.g. Ana Pérez', hint: 'The name of the trapper, as it should be on a visit.', validate: (v) => (v ? null : 'A full name is required.') },
            { key: 'affiliation', label: 'Affiliation', placeholder: 'e.g. University of Huelva', hint: 'Where the trapper works. Free text.' },
            { key: 'email', label: 'Email', placeholder: 'e.g. ana@example.org', hint: 'How to write to them. Optional.', validate: (v) => (v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : 'Not an email address.') },
            ...statusFields<Trapper>(['active', 'inactive', 'archived'], false, { active: 'Offered when a visit is registered.', inactive: 'Not offered when a visit is registered. It can be active again.', archived: 'Out of use for good: never offered again, and it never goes back. Past visits keep their name.' })]}
        />
      )}

      {tab === 'locations' && (project ? <LocationsTab project={project} onDetail={setDetail} openItem={initialItem} used={(id) => countVisits((v, p) => same(p, project.acronym) && same(v.location_id, id))} /> : <p className={hintClass}>Pick a research project to see its locations.</p>)}

      {tab === 'sdcards' && (!projectId ? <p className={hintClass}>Pick a research project to see its SD cards.</p> : (
        <ItemsEditor<SdCard> caseSensitive openItem={initialItem}
          heading={`SD cards${owner ? ` of ${owner}` : ' of no project'}`} qr={(c) => (c.label ? qrPayload('sdcard', owner, c.label) : undefined)} noun="SD card" fileName={`${owner ?? 'unassigned'}_sd_cards`} icon={<SdCardIcon />} onDetail={setDetail} styled
          items={sdCards.filter((c) => belongs(c.research_project))}
          onChange={(v) => onSdCards([...sdCards.filter((c) => !belongs(c.research_project)), ...v.map((c) => ({ ...c, research_project: owner }))])}
          blank={{ label: '', brand: null, capacity: null, in_service: today(), research_project: owner, status: 'ready', status_date: null, status_note: null }}
          badges={unusualStatus} readOnly={(c) => c.status === 'archived'} notice={(c) => (c.status === 'archived' ? <Notice kind="info">This one is archived for good: it never goes back to active, and it can no longer be changed.</Notice> : undefined)} subtitle={(c) => [c.brand, c.capacity].filter(Boolean).join(' · ')}
          meta={(c) => gearMeta(c, countVisits((v, p) => inProject(p) && sameName(v.sd, c.label)))}
          canDelete={(c) => countVisits((v, p) => inProject(p) && sameName(v.sd, c.label)) === 0}
          footnote="An SD card that already has visits can't be deleted; mark it as archived instead and it stops being offered for new visits."
          empty="No SD card yet." searchLabel="Search by label, brand or size"
          fields={[
            { key: 'label', label: 'Label', placeholder: 'e.g. SD-014', hint: 'The number or the label written on the card.', section: 'Which card is it?', sectionIcon: <SdCardIcon />, sectionHint: 'The label written on the card, and optionally who makes it and how much it holds. Visits refer to the card by its label.' },
            { key: 'brand', label: 'Brand', kind: 'suggest', suggestions: SD_CARD_BRANDS, placeholder: 'e.g. SanDisk', hint: 'Who makes it. The usual ones are suggested, but any other can be typed.' },
            { key: 'capacity', label: 'Capacity', kind: 'suggest', suggestions: SD_CARD_CAPACITIES, placeholder: 'e.g. 64 GB', hint: 'What is written on the card. The usual ones are suggested, but any other can be typed.' },
            ...statusFields<SdCard>(GEAR_STATUSES, true, GEAR_HINTS, true, ['active']),
          ]}
        />
      ))}

      {tab === 'cameras' && (!projectId ? <p className={hintClass}>Pick a research project to see its cameras.</p> : (
        <ItemsEditor<Camera> caseSensitive openItem={initialItem}
          heading={`Cameras${owner ? ` of ${owner}` : ' of no project'}`} qr={(c) => (c.label ? qrPayload('camera', owner, c.label) : undefined)} noun="camera" fileName={`${owner ?? 'unassigned'}_cameras`} icon={<CameraIcon />} onDetail={setDetail} styled
          items={cameras.filter((c) => belongs(c.research_project))}
          onChange={(v) => onCameras([...cameras.filter((c) => !belongs(c.research_project)), ...v.map((c) => ({ ...c, research_project: owner }))])}
          blank={{ label: '', camera_id: null, camera_model: null, connectivity: null, power_source: null, battery_removable: null, in_service: today(), research_project: owner, status: 'ready', status_date: null, status_note: null }}
          badges={unusualStatus} readOnly={(c) => c.status === 'archived'} notice={(c) => (c.status === 'archived' ? <Notice kind="info">This one is archived for good: it never goes back to active, and it can no longer be changed.</Notice> : undefined)} subtitle={(c) => [c.camera_model, c.camera_id].filter(Boolean).join(' · ')}
          meta={(c) => gearMeta(c, countVisits((v, p) => inProject(p) && usesCamera(v.camera_id, c)))}
          canDelete={(c) => countVisits((v, p) => inProject(p) && usesCamera(v.camera_id, c)) === 0}
          footnote="A camera that already has visits can't be deleted; mark it as archived instead and it stops being offered for new visits."
          empty="No camera yet." searchLabel="Search by label, serial number or model"
          fields={[
            { key: 'label', label: 'Label', placeholder: 'e.g. CAM-014', hint: 'What the camera is called in the field. No two cameras in a project have the same.', section: 'Which camera is it?', sectionIcon: <CameraIcon />, sectionHint: 'What the camera is called in the field, its serial number and its model. Visits refer to the camera by its label.' },
            { key: 'camera_id', label: 'Camera id', placeholder: 'e.g. P800HG08192031', hint: "The camera's serial number, if it is known." },
            { key: 'camera_model', label: 'Camera model', placeholder: 'e.g. Reconyx-PC800', hint: 'Manufacturer and model, written as manufacturer-model.' },
            { key: 'connectivity', label: 'Mobile connection', kind: 'select', options: [{ value: 'none', label: 'None' }, { value: '4g', label: '4G' }, { value: '5g', label: '5G' }], section: 'How is it connected and powered?', sectionHint: 'Whether the camera sends its images through the mobile network, and what it runs on: cells or a battery.', hint: 'The network the camera sends its images through; none when it does not.' },
            { key: 'power_source', label: 'Power', kind: 'select', options: [{ value: 'cells', label: 'Cells', hint: 'AA, AAA… the ones that are changed.' }, { value: 'battery', label: 'Battery' }], hint: 'What the camera runs on: cells (AA, AAA…) or a battery.' },
            { key: 'battery_removable', label: 'The battery can be taken out', kind: 'select', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], hint: 'Only said of a battery: cells are always taken out to be changed.' },
            ...statusFields<Camera>(GEAR_STATUSES, true, GEAR_HINTS, true, ['active']),
          ]}
        />
      ))}
    </div>
  )
}

interface Props {
  onClose: () => void
  /** The section to open on; the general one when left out. */
  initialSection?: SectionId | 'epicollect' | 'projects' | 'trappers' | 'sdcards' | 'cameras' | 'locations'
  /** The research project the entities are shown for, when opened on its locations. */
  initialProject?: string
  /** The SD card or the camera (by its label) whose page opens at once, on its tab. */
  initialItem?: string
}

type UpdateState =
  | { kind: 'idle' } | { kind: 'checking' } | { kind: 'error'; message: string } | { kind: 'result'; check: UpdateCheck }

/** One button that walks through the update check: "Check updates" → (if a newer
 * release exists) "Tap to download vX" → or "Tap to retry" when it couldn't tell. */
function UpdateCheckButton() {
  const [state, setState] = useState<UpdateState>({ kind: 'idle' })

  async function check() {
    setState({ kind: 'checking' })
    try {
      const result = await api.checkForUpdate()
      setState(result.error ? { kind: 'error', message: result.error } : { kind: 'result', check: result })
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'Could not check for updates.' })
    }
  }

  const result = state.kind === 'result' ? state.check : null
  const buttonClass = `${btnSoft} inline-flex items-center gap-2 justify-center`
  return (
    <>
      {result?.update_available ? (
        <a href={result.download_url ?? result.release_url ?? '#'} target="_blank" rel="noreferrer" className={`${buttonClass} no-underline`}>
          <RefreshIcon />Tap to download {result.latest}
        </a>
      ) : (
        <button type="button" className={buttonClass} disabled={state.kind === 'checking'} onClick={check}>
          <RefreshIcon spinning={state.kind === 'checking'} />{state.kind === 'checking' ? 'Checking…' : state.kind === 'error' ? 'Tap to retry' : 'Check for updates'}
        </button>
      )}
      {state.kind === 'error' && <p className="text-xs text-red-600 dark:text-red-400 px-1">{state.message}</p>}
      {result && !result.update_available && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400 px-1" role="status">
          {result.current === 'dev' ? 'This is a development build — updates aren’t checked.' : `You’re up to date (version ${result.current}).`}
        </p>
      )}
      {result?.update_available && (
        <p className={`${hintClass} px-1`} role="status">Version {result.latest} is available — you have {result.current}.</p>
      )}
    </>
  )
}

function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 fill-none stroke-current ${spinning ? 'animate-spin' : ''}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-15.5-6.2L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 15.5 6.2L21 16" /><path d="M16 16h5v5" />
    </svg>
  )
}

const LINK_ICONS: Record<string, ReactNode> = {
  bug: <><path d="m8 2 1.9 1.9" /><path d="M14.1 3.9 16 2" /><path d="M9 7.1V6a3 3 0 0 1 6 0v1.1" /><path d="M12 20a6 6 0 0 1-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3a6 6 0 0 1-6 6Z" /><path d="M12 20v-9" /><path d="M6.5 13H2" /><path d="M17.5 13H22" /><path d="M3 21c0-2.1 1.7-3.9 3.8-4" /><path d="M20.2 17c2.1.1 3.8 1.9 3.8 4" /></>,
  book: <><path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" /></>,
  code: <><path d="m16 18 6-6-6-6" /><path d="m8 6-6 6 6 6" /></>,
  notes: <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><line x1="16" x2="8" y1="13" y2="13" /><line x1="16" x2="8" y1="17" y2="17" /></>,
}

/** The app, its version and the places to go for help: the update check on the left, the links on the right. */
/** A setting that is turned on or off, in a card of its own: what it does is said under its title. */
function ToggleCard({ title, description, checked, onChange }: { title: string; description: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 px-6 py-5">
      <div className="min-w-0">
        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
        <p className={`${hintClass} mt-1 leading-relaxed max-w-prose`}>{description}</p>
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={title} onClick={() => onChange(!checked)}
              className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  )
}

/** A card of settings of its own, with its title and what it is for. */
function GroupCard({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 px-6 py-5 space-y-4">
      <div>
        <h5 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h5>
        {description && <p className={`${hintClass} mt-1 leading-relaxed max-w-prose`}>{description}</p>}
      </div>
      {children}
    </section>
  )
}

/** A folder of the settings: where it is, or that the default is used, with the way to choose another or to go back to the default. */
function FolderField({ label, inputLabel, description, value, placeholder, error, browsing, browseLabel, defaultLabel, hint, onChange, onBrowse }: {
  label: string; inputLabel: string; description: string; value: string; placeholder?: string; error: string | null; browsing: boolean
  browseLabel: string; defaultLabel: string; hint: string; onChange: (v: string) => void; onBrowse: () => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h6 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{label}</h6>
        {value === '' && <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">Default</span>}
      </div>
      <p className={`${hintClass} max-w-prose`}>{description}</p>
      <TextBox label={inputLabel} value={value} onChange={onChange} mono error={error} placeholder={placeholder} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnOutline} aria-label={browseLabel} disabled={browsing} onClick={onBrowse}>{browsing ? 'Browsing…' : 'Choose folder…'}</button>
        <button type="button" className={btnOutline} aria-label={defaultLabel} onClick={() => onChange('')} disabled={value === ''}>Use the default</button>
      </div>
      <p className={hintClass}>{hint}</p>
    </div>
  )
}

function AboutBlock() {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => api.checkVersion()).then((v) => { if (!cancelled) setVersion(v.current) }).catch(() => { /* the version is just not shown */ })
    return () => { cancelled = true }
  }, [])
  const shownVersion = version === null ? null : version === 'dev' ? 'Development build' : version
  const issue = `${REPO_URL}/issues/new?body=${encodeURIComponent(
    `**Version:** ${version ?? 'unknown'}\n**Browser:** ${navigator.userAgent}\n\n**What happened?**\n\n**What did you expect?**\n\n**How to reproduce it**\n1. \n\n_Attach the log file (Settings › General › Log file) if you can._\n`,
  )}`
  const links = [
    { icon: 'bug', title: 'Report a problem', subtitle: 'Opens a GitHub issue directly filled in', href: issue },
    { icon: 'book', title: 'Documentation', subtitle: 'The user manual', href: DOCS_URL },
    { icon: 'code', title: 'GitHub', subtitle: 'Source code', href: REPO_URL },
    { icon: 'notes', title: 'What’s new', subtitle: 'Release notes', href: `${REPO_URL}/releases` },
  ]
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-6" aria-label="About WildINTEL Uploader" role="group">
      <div>
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white text-2xl">⇪</span>
          <div>
            <h4 className="text-2xl font-semibold leading-tight">WildINTEL Uploader</h4>
            {shownVersion && <p className="text-sm text-zinc-500 dark:text-zinc-400" aria-label="Version">{version && version !== 'dev' ? `Version ${version}` : shownVersion}</p>}
          </div>
        </div>
        <div className="mt-5 space-y-2"><UpdateCheckButton /></div>
      </div>
      <ul className="grid grid-cols-2 gap-3">
        {links.map((l) => (
          <li key={l.title}>
            <a href={l.href} target="_blank" rel="noreferrer"
               className="flex h-full items-start gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-3 no-underline text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 transition-colors">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current text-zinc-600 dark:text-zinc-300" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{LINK_ICONS[l.icon]}</svg>
              <span>
                <span className="block text-sm font-semibold leading-tight">{l.title}</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">{l.subtitle}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The settings files — the active one is what the app reads and saves; "+"
 * creates another from the default values. */
function ConfigsEditor({ onSwitched, onError }: { onSwitched: () => void; onError: (message: string) => void }) {
  const [configs, setConfigs] = useState<ConfigInfo[] | null>(null)
  const [adding, setAdding] = useState<{ name: string; error?: string } | null>(null)
  const fail = (e: unknown, fallback: string) => onError(e instanceof Error ? e.message : fallback)

  useEffect(() => {
    api.configs().then(setConfigs).catch((e) => fail(e, 'Could not load the configs.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function create() {
    if (!adding?.name.trim()) return
    try {
      setConfigs(await api.addConfig(adding.name))
      setAdding(null)
    } catch (e) {
      setAdding({ ...adding, error: e instanceof Error ? e.message : 'Could not create the config.' })
    }
  }

  async function activate(id: string) {
    try {
      setConfigs(await api.activateConfig(id))
      onSwitched()
    } catch (e) {
      fail(e, 'Could not switch config.')
    }
  }

  return (
    <div className="space-y-5 pt-3">
      <p className={`${hintClass} leading-relaxed max-w-prose`}>
        A config is a saved set of all your settings: the folders, the TRAPPER account, the checks and the preparation of images.
        The active one is what WildINTEL Uploader reads and saves. You can keep several, for example one per TRAPPER account, and switch between them.
      </p>
      <Notice kind="warning">These files keep your passwords as plain text. Don't share a config file with anyone, and don't upload it anywhere.</Notice>
      <div className="flex items-center justify-between gap-4">
        <h5 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Your configs <span className="ml-1 text-sm font-normal text-zinc-500 dark:text-zinc-400">{configs?.length ?? 0}</span></h5>
        <button type="button" className={`${btnPrimary} inline-flex items-center gap-2`} aria-label="New config" onClick={() => setAdding({ name: '' })}>
          <span aria-hidden="true" className="text-lg leading-none">+</span> New config
        </button>
      </div>
      <div className="space-y-3">
        {configs?.map((c, i) => (
          <div key={c.id} className={`flex items-center gap-4 px-5 py-4 rounded-2xl border ${c.active ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60'}`}>
            <span className={`w-10 h-10 flex items-center justify-center rounded-full text-sm font-semibold shrink-0 ${c.active ? 'bg-blue-600 text-white' : 'bg-zinc-200 dark:bg-zinc-700'}`} aria-hidden="true">#{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-base font-semibold truncate">{c.name}</p>
                {c.active && <span className="text-xs px-2 py-0.5 rounded-md font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">In use</span>}
              </div>
              <p className={`${hintClass} font-mono break-all`} aria-label={`${c.name} file location`}>{c.path}</p>
            </div>
            {!c.active && <button type="button" className={btnOutline} aria-label={`Use ${c.name}`} onClick={() => activate(c.id)}>Use this one</button>}
            <button type="button" className={iconBtn} aria-label={`Open ${c.name} folder`} title="Open the folder containing the config file"
                    onClick={() => api.openConfigFolder(c.id).catch((e) => fail(e, 'Could not open the folder.'))}>
              <FolderIcon />
            </button>
            <a href={`/api/settings/configs/${encodeURIComponent(c.id)}/download`} download aria-label={`Download ${c.name}`}
               title="Download the config file" className={iconBtn}>
              <DownloadIcon />
            </a>
          </div>
        ))}
      </div>
      <p className={hintClass}>The default config can't be deleted. To delete the one in use, switch to another first. Switching takes effect straight away.</p>
      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAdding(null)}>
          <div role="dialog" aria-modal="true" aria-label="New config"
               className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-6 space-y-4"
               onClick={(e) => e.stopPropagation()}>
            <h5 className="text-lg font-semibold">New config</h5>
            <BoxField label="Name" error={adding.error ?? null}>
              <input className={boxInput} aria-label="Config name" autoFocus value={adding.name}
                     onChange={(e) => setAdding({ name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') create() }} />
            </BoxField>
            <p className={hintClass}>It names the file, so keep it short.</p>
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-800">
              <button type="button" className={btnSoft} onClick={() => setAdding(null)}>Cancel</button>
              <button type="button" className={btnPrimary} disabled={!adding.name.trim()} onClick={create}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Edits the app's own settings.toml, one section at a time: the folder the
 * images are kept in and the log, the Trapper account, which validation
 * and postvalidation checks the wizard shows, and how the images are preprocessed. One Save saves every section. */
export default function SettingsPage({ onClose, initialSection, initialProject, initialItem }: Props) {
  const [uploadDestination, setUploadDestination] = useState<UploadDestinationId>('trapper')
  const [visitSource, setVisitSource] = useState<VisitSourceId>(initialSection === ('epicollect' as string) ? 'epicollect' : 'wildintel-new')
  const [section, setSection] = useState<SectionId>(initialSection && initialSection in ENTITY_SECTIONS ? 'entities' : initialSection === ('epicollect' as string) ? 'sources' : (initialSection as SectionId | undefined) ?? 'general')
  const [saved, setSaved] = useState<AppSettings | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string }>({ kind: 'idle' })
  const [clearLog, setClearLog] = useState<{ kind: 'idle' | 'confirming' | 'clearing' | 'cleared' | 'error'; message?: string }>({ kind: 'idle' })
  const [conn, setConn] = useState<{ kind: 'idle' | 'testing' | 'ok' | 'error'; message?: string }>({ kind: 'idle' })
  // A saved password is shown as kept, and only asked for again when it is to be replaced.
  const [changingPassword, setChangingPassword] = useState(false)
  const [changingKey, setChangingKey] = useState(false)
  const [changingSecret, setChangingSecret] = useState(false)
  const [epiConn, setEpiConn] = useState<{ kind: 'idle' | 'testing' | 'ok' | 'error'; message?: string }>({ kind: 'idle' })
  const [browsing, setBrowsing] = useState(false)
  // The research projects the default one is picked from.
  const [projectChoices, setProjectChoices] = useState<LocalResearchProject[]>([])
  useEffect(() => {
    if (section !== 'general') return
    Promise.resolve().then(() => api.listResearchProjects()).then(({ results }) => setProjectChoices(results)).catch(() => {})
  }, [section])

  // Also called after switching config, which discards whatever wasn't saved.
  function reloadSettings() {
    api.getSettings()
      .then((s) => { setSaved(s); setDraft(toDraft(s)); setStatus({ kind: 'idle' }) })
      .catch((e) => setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load the settings.' }))
  }

  useEffect(reloadSettings, [])

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    if (key === 'trapperUrl' || key === 'trapperUser' || key === 'trapperPassword') setConn({ kind: 'idle' })
    setDraft((d) => (d && { ...d, [key]: value }))
    setStatus({ kind: 'idle' })
  }

  const update = draft && toUpdate(draft)

  /** The settings of a postvalidation check, if it has any — what its gear opens. The sequence gap, the way of comparing and
   * the revisions needed are shared by the statistical checks, so changing them in one changes them in all. */
  function checkSettings(key: DeploymentCheck): ReactNode | undefined {
    if (!draft) return undefined
    if (key === 'time_range') {
      return (
        <>
          <NumberBox label="Tolerance" value={draft.toleranceHours} limits={TOLERANCE} onChange={(v) => set('toleranceHours', v)} unit="hours" />
          <p className={`${hintClass} px-1`}>The leeway around the deployment&rsquo;s start and end. wildintel-tools uses 1 hour.</p>
        </>
      )
    }
    const own = {
      image_count: ['Images — similar within', draft.imageTolerance, 'imageTolerance', '% of what it is compared with'],
      sequence_count: ['Sequences — similar within', draft.sequenceCountTolerance, 'sequenceCountTolerance', '%'],
      sequence_length: ['Sequence length — similar within', draft.sequenceLengthTolerance, 'sequenceLengthTolerance', '%'],
    } as const
    if (!(key in own)) return undefined
    const [label, value, field, unit] = own[key as keyof typeof own]
    return (
      <>
        {key !== 'image_count' && (
          <NumberBox label="Sequence gap" value={draft.sequenceGap} limits={SEQUENCE_GAP} onChange={(v) => set('sequenceGap', v)} unit="seconds" />
        )}
        <SelectBox label="Compared with" value={draft.similarityMethod} options={SIMILARITY_METHODS} onChange={(v) => set('similarityMethod', v)} />
        <NumberBox label="Previous revisions needed" value={draft.minRevisions} limits={MIN_REVISIONS} onChange={(v) => set('minRevisions', v)} unit="fewer and the check is skipped" />
        <NumberBox label={label} value={value} limits={SIMILARITY_TOLERANCE} onChange={(v) => set(field, v)} unit={unit} />
        <p className={`${hintClass} px-1`}>
          {key !== 'image_count' && 'A new sequence starts when the gap to the previous image is at least the sequence gap. '}
          What is compared with and the revisions needed are shared by the three statistical checks.
        </p>
      </>
    )
  }

  /** Whether a check's settings hold something wrong — so its entry shows them. */
  function checkSettingsInvalid(key: DeploymentCheck): boolean {
    if (!draft) return false
    const bad = (value: string, limits: Limits) => numberIn(value, limits) === null
    if (key === 'time_range') return bad(draft.toleranceHours, TOLERANCE)
    if (key === 'image_count') return bad(draft.minRevisions, MIN_REVISIONS) || bad(draft.imageTolerance, SIMILARITY_TOLERANCE)
    if (key === 'sequence_count') return bad(draft.sequenceGap, SEQUENCE_GAP) || bad(draft.minRevisions, MIN_REVISIONS) || bad(draft.sequenceCountTolerance, SIMILARITY_TOLERANCE)
    if (key === 'sequence_length') return bad(draft.sequenceGap, SEQUENCE_GAP) || bad(draft.minRevisions, MIN_REVISIONS) || bad(draft.sequenceLengthTolerance, SIMILARITY_TOLERANCE)
    return false
  }

  async function handleSave() {
    if (!update) return
    setStatus({ kind: 'saving' })
    try {
      const result = await api.saveSettings(update)
      setSaved(result)
      setDraft(toDraft(result))
      setChangingPassword(false)
      setChangingSecret(false)
      setStatus({ kind: 'saved' })
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Could not save the settings.' })
    }
  }

  async function handleClearLog() {
    setClearLog({ kind: 'clearing' })
    try {
      await api.clearLog()
      setClearLog({ kind: 'cleared' })
    } catch (e) {
      setClearLog({ kind: 'error', message: e instanceof Error ? e.message : 'Could not clear the log.' })
    }
  }

  async function handleBrowse(field: 'dataDir' | (typeof FOLDERS)[number]['draftKey'] = 'dataDir') {
    setBrowsing(true)
    try {
      const { path } = await api.browseFolder(field === 'dataDir' ? 'Select the data folder' : FOLDERS.find((f) => f.draftKey === field)!.dialog)
      if (path) set(field, path)
    } catch {
      // No native dialog here (a server without a display): the path can still be typed.
    } finally {
      setBrowsing(false)
    }
  }

  async function handleTestConnection() {
    if (!draft) return
    setConn({ kind: 'testing' })
    try {
      // A blank password falls back to the saved one, as when saving.
      const result = await api.trapperTestConnection({ url: draft.trapperUrl.trim(), username: draft.trapperUser.trim(), password: draft.trapperPassword })
      const n = result.research_projects_count
      setConn({ kind: 'ok', message: `Connected as ${draft.trapperUser.trim()}. ${n} research project${n === 1 ? '' : 's'} available.` })
    } catch (e) {
      setConn({ kind: 'error', message: e instanceof Error ? e.message : 'Could not connect to TRAPPER.' })
    }
  }

  async function handleTestEpicollect() {
    if (!draft) return
    setEpiConn({ kind: 'testing' })
    try {
      // A blank secret falls back to the saved one of the same client, as when saving.
      const r = await api.epicollectTestConnection({ project_slug: draft.epicollectSlug.trim(), client_id: draft.epicollectClientId.trim(), client_secret: draft.epicollectClientSecret })
      setEpiConn({ kind: 'ok', message: `Connected — ${r.project || r.slug}: ${r.inputs} input(s) in ${r.forms} form(s).` })
    } catch (e) {
      setEpiConn({ kind: 'error', message: e instanceof Error ? e.message : 'Could not connect to Epicollect5.' })
    }
  }

  const current = SECTIONS.find((s) => s.id === section)!
  const [entityDetail, setEntityDetail] = useState(false)
  const dataDirError = draft && draft.dataDir.trim() !== '' && !isAbsolutePath(draft.dataDir) ? 'An absolute path (or one starting with ~).' : null
  const canTest = draft !== null && draft.trapperUrl.trim() !== '' && draft.trapperUser.trim() !== '' && (draft.trapperPassword !== '' || saved?.TRAPPER.has_password === true)

  return (
    <div className="mx-auto px-4 py-6 flex flex-col md:flex-row gap-6" style={{ maxWidth: 1000 }}>
      {/* Sidebar */}
      <nav className="md:w-56 shrink-0 md:border-r border-zinc-200 dark:border-zinc-800 md:pr-5" aria-label="Settings sections">
        <button
          type="button" onClick={onClose}
          className="flex items-center gap-2 px-3 py-2 mb-3 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          <BackIcon />Back
        </button>
        <ul className="flex md:flex-col gap-2 overflow-x-auto">
          {SECTIONS.map(({ id, label, icon: SectionIcon }) => {
            const active = id === section
            const invalid = draft !== null && !sectionValid(draft, id)
            return (
              <li key={id} className="shrink-0">
                <button
                  type="button" onClick={() => setSection(id)} aria-current={active ? 'page' : undefined}
                  className={[
                    'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base transition-colors',
                    active ? 'bg-blue-600 text-white' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800',
                  ].join(' ')}
                >
                  <SectionIcon />
                  <span>{label}</span>
                  {invalid && <span className="ml-auto w-2 h-2 rounded-full bg-red-500" title="Has an invalid value" />}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Section */}
      <div className="flex-1 min-w-0">
        {!(section === 'entities' && entityDetail) && (
          <div className="flex items-center gap-3 mb-2">
            <h4 className="text-2xl font-semibold">{current.label}</h4>
            {section === 'uploader' && conn.kind === 'ok' && <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Connected</span>}
          </div>
        )}

        {!draft && status.kind !== 'error' && <p className="text-sm text-zinc-500 dark:text-zinc-400 py-5">Loading…</p>}

        {draft && saved && section === 'general' && (
          <div className="space-y-5 pt-5">
            <AboutBlock />
            <GroupCard title="Where files are kept" description="The data folder holds everything. Choose a folder below only to keep a part elsewhere, for example on another disk.">
              <div className="space-y-6">
                <FolderField
                  label="Data folder" inputLabel="Folder" description="Where WildINTEL Uploader keeps everything it makes."
                  value={draft.dataDir} error={dataDirError} browsing={browsing} browseLabel="Browse for the data folder" defaultLabel="Use the default data folder"
                  hint="Default: a folder named after WildINTEL Uploader in your Documents folder. The folders below, when empty, move with it." onChange={(v) => set('dataDir', v)} onBrowse={() => handleBrowse('dataDir')}
                />
                {FOLDERS.map(({ draftKey, label, description, hint }) => {
                  const error = draft[draftKey].trim() !== '' && !isAbsolutePath(draft[draftKey]) ? 'An absolute path (or one starting with ~).' : null
                  const defaultKey = draftKey.replace('Dir', '') as 'collections' | 'reports' | 'packages'
                  return (
                    <FolderField
                      key={draftKey} label={label} inputLabel={label} description={description} value={draft[draftKey]} placeholder={draft.dataDir.trim() ? `${draft.dataDir.trim().replace(/[\\/]+$/, '')}${draft.dataDir.includes('\\') && !draft.dataDir.includes('/') ? '\\' : '/'}${defaultKey}` : saved.DATA[`default_${defaultKey}_dir`]} error={error} browsing={browsing}
                      browseLabel={`Browse for the ${defaultKey} folder`} defaultLabel={`Use the default ${defaultKey} folder`} hint={hint} onChange={(v) => set(draftKey, v)} onBrowse={() => handleBrowse(draftKey)}
                    />
                  )
                })}
              </div>
            </GroupCard>
            <GroupCard title="Default research project" description="Filled in for you whenever a research project is asked for, such as when a visit is registered or a deployment imported. You can still change it each time.">
              <label className="sr-only" htmlFor="default-research-project">Default research project</label>
              <Combobox
                id="default-research-project" value={draft.defaultResearchProject} onChange={(v) => set('defaultResearchProject', v)}
                options={projectChoices.map((p) => ({ value: p.acronym, label: `${p.acronym} — ${p.name}` }))}
                placeholder={projectChoices.length === 0 ? 'No research projects yet' : 'None — pick one each time'} clearLabel="Clear the default research project"
              />
            </GroupCard>
            <ToggleCard title="Welcome page" checked={draft.showWelcome} onChange={(v) => set('showWelcome', v)}
                        description="Shown when WildINTEL Uploader opens, to say what it does. Turn it off to open straight on the menu — the tick of the welcome page does the same." />
            <GroupCard title="Parallel work" description="How many images are checked or prepared at the same time. More at once finishes sooner, up to what this computer can do.">
              <div className="max-w-xs"><NumberBox label="Images at once" value={draft.workers} limits={WORKERS} onChange={(v) => set('workers', v)} unit="at once" /></div>
              <p className={hintClass}>
                This computer has {saved.GENERAL.cpu_count} CPU{saved.GENERAL.cpu_count === 1 ? '' : 's'}. The default is the CPUs it has, up to 4;
                with a hard disk or a network drive, more may not help, as the files are read slower than they are worked on.
              </p>
            </GroupCard>
            <GroupCard title="Activity log" description="WildINTEL Uploader writes down what it does, so a problem can be tracked down. Raise the detail only while you look for one, then lower it again. It applies right away.">
              <div role="radiogroup" aria-label="Level" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {LOG_LEVELS.map((l) => (
                  <button key={l.value} type="button" role="radio" aria-checked={draft.logLevel === l.value} onClick={() => set('logLevel', l.value)}
                          className={`text-left rounded-xl px-4 py-3 border transition-colors ${draft.logLevel === l.value ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
                    <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">{l.label}</span>
                    <span className={`block ${hintClass}`}>{l.hint}</span>
                  </button>
                ))}
              </div>
              {saved.GENERAL.log_level_override && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  The environment variable <span className="font-mono">WILDINTEL_UPLOADER_WEB_LOG_LEVEL</span> sets it
                  to <strong>{saved.GENERAL.log_level_override}</strong> for now — it wins over this setting.
                </p>
              )}
              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
                <div>
                  <h6 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Log file</h6>
                  <p className={hintClass}>Rotated at 5 MB, keeping the last 5. Attach it to a bug report.</p>
                </div>
                <BoxField label="Location">
                  <span className="block font-mono text-sm text-zinc-900 dark:text-zinc-100 break-all py-0.5">{saved.GENERAL.log_file}</span>
                </BoxField>
              <div className="flex flex-wrap gap-2">
                <a href="/api/settings/log" download className={btnSoft}>Download log</a>
                {clearLog.kind !== 'confirming' && (
                  <button
                    type="button" disabled={clearLog.kind === 'clearing'} onClick={() => setClearLog({ kind: 'confirming' })}
                    className="inline-flex items-center px-4 py-2 text-sm rounded-xl bg-zinc-100 dark:bg-zinc-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors disabled:opacity-50"
                  >
                    {clearLog.kind === 'clearing' ? 'Clearing…' : 'Clear log'}
                  </button>
                )}
              </div>
              {clearLog.kind === 'confirming' && (
                <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-zinc-700 dark:text-zinc-300">
                  <p>Delete the log file and its older copies? This can&rsquo;t be undone — download it first if you need it.</p>
                  <div className="flex gap-2 mt-2">
                    <button type="button" onClick={handleClearLog} className="px-4 py-1.5 rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors">
                      Yes, clear it
                    </button>
                    <button type="button" onClick={() => setClearLog({ kind: 'idle' })} className="px-4 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {clearLog.kind === 'cleared' && <p className="text-xs text-emerald-700 dark:text-emerald-400 px-1">Log cleared — a new one starts now.</p>}
              {clearLog.kind === 'error' && <p className="text-xs text-red-600 dark:text-red-400 px-1">{clearLog.message}</p>}
              </div>
            </GroupCard>
            <ToggleCard title="Keep the seconds in the logs" checked={draft.fieldlogKeepSeconds} onChange={(v) => set('fieldlogKeepSeconds', v)}
                        description="The start and the end of the deployments written in the FileTimestampLog and the FieldworkLog. Turned off, they are cut to the minute." />
          </div>
        )}

        {draft && saved && section === 'uploader' && (
          <div className="space-y-5 pt-5">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">The platforms a deployment can be uploaded to. Pick one to set it up. TRAPPER is the only one for now; others may come in a future version.</p>
          <div role="tablist" aria-label="Upload destinations" className="flex flex-wrap gap-2">
            {UPLOAD_DESTINATIONS.map((d) => (
              <button key={d.id} type="button" role="tab" aria-selected={uploadDestination === d.id} onClick={() => setUploadDestination(d.id)}
                      className={`inline-flex items-center gap-2 px-4 h-10 rounded-lg border text-sm font-medium ${uploadDestination === d.id ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300'}`}>
                {d.label}
                <span aria-hidden="true" title={(d.id === 'trapper' ? draft.trapperEnabled : draft.agoutiEnabled) ? 'Used' : 'Not used'} className={`h-2 w-2 rounded-full ${(d.id === 'trapper' ? draft.trapperEnabled : draft.agoutiEnabled) ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
              </button>
            ))}
          </div>
          {uploadDestination === 'trapper' && (
          <>
          <ToggleCard title="Use TRAPPER" checked={draft.trapperEnabled} onChange={(v) => set('trapperEnabled', v)}
                      description="Offers TRAPPER as a place to upload deployments to. Turned off, it is not offered, and its uploads are not shown in the uploads dashboard." />
          <SettingsCard>
            <CardBlock title="Server" description="The TRAPPER website you work with. Research projects and locations come from it, and deployments are uploaded to it.">
              <PlainField label="Web address">
                <input aria-label="Web address" className={`${fieldBox} font-mono text-sm`} value={draft.trapperUrl} placeholder="https://trapper.example.org" autoComplete="off" onChange={(e) => set('trapperUrl', e.target.value)} />
              </PlainField>
            </CardBlock>
            <CardBlock title="Account" description="The account WildINTEL Uploader uses in TRAPPER. It needs permission to read projects and upload deployments.">
              <PlainField label="Username">
                <input aria-label="Username" className={fieldBox} value={draft.trapperUser} autoComplete="off" onChange={(e) => set('trapperUser', e.target.value)} />
              </PlainField>
              <PlainField label="Password" hint={saved.TRAPPER.has_password ? (changingPassword ? 'Leave it blank to keep the saved password.' : 'The saved password is kept private. Press Change to replace it.') : 'No password saved yet.'}>
                {saved.TRAPPER.has_password && !changingPassword ? (
                  <div className="flex items-center gap-3">
                    <div className={`${fieldBox} flex items-center justify-between`} aria-label="Saved password">
                      <span aria-hidden="true" className="tracking-widest text-zinc-500">••••••••</span>
                      <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Saved</span>
                    </div>
                    <button type="button" className={`${btnOutline} h-12 shrink-0`} onClick={() => setChangingPassword(true)}>Change</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <input aria-label="Password" type="password" className={fieldBox} value={draft.trapperPassword} autoComplete="new-password" onChange={(e) => set('trapperPassword', e.target.value)} />
                    {saved.TRAPPER.has_password && <button type="button" className={`${btnOutline} h-12 shrink-0`} onClick={() => { set('trapperPassword', ''); setChangingPassword(false) }}>Keep it</button>}
                  </div>
                )}
              </PlainField>
              <div className="flex flex-wrap items-center gap-4">
                <button type="button" className={`${btnOutline} gap-2`} disabled={!canTest || conn.kind === 'testing'} onClick={handleTestConnection}>
                  {conn.kind === 'testing' ? <span className="animate-spin inline-flex" aria-hidden="true"><Icon size={16}><path d="M21 12a9 9 0 1 1-6.2-8.55" /></Icon></span> : <Icon size={16}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></Icon>}
                  {conn.kind === 'testing' ? 'Testing…' : 'Test connection'}
                </button>
                {conn.kind === 'ok' && (
                  <span role="status" className="inline-flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"><Icon size={16}><circle cx="12" cy="12" r="10" /><path d="M8 12l3 3 5-6" /></Icon>{conn.message}</span>
                )}
                {conn.kind === 'error' && (
                  <span role="alert" className="inline-flex items-center gap-2 text-sm text-red-600 dark:text-red-400"><Icon size={16}><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></Icon>{conn.message}</span>
                )}
              </div>
            </CardBlock>
            <CardBlock title="Uploading deployments" description="The images of a deployment are sent in several packages, none bigger than this. Smaller packages are quicker to retry if the connection drops.">
              <div className="max-w-60"><PlainField label="Largest package"><NumberBox label="Largest package" value={draft.maxZipMb} limits={MAX_ZIP_MB} onChange={(v) => set('maxZipMb', v)} unit="MB" /></PlainField></div>
            </CardBlock>
          </SettingsCard>
          </>
          )}
          {uploadDestination === 'agouti' && (
          <>
          <ToggleCard title="Use Agouti" checked={draft.agoutiEnabled} onChange={(v) => set('agoutiEnabled', v)}
                      description="Offers Agouti as a place to upload deployments to. Nothing is uploaded to Agouti yet: this keeps what an upload will need." />
          <SettingsCard>
            <CardBlock title="Server" description="Agouti's API. Its address is the one Agouti publishes.">
              <PlainField label="Web address" hint="Usually https://api.agouti.eu">
                <input aria-label="Agouti web address" className={`${fieldBox} font-mono text-sm`} value={draft.agoutiUrl} placeholder="https://api.agouti.eu" autoComplete="off" onChange={(e) => set('agoutiUrl', e.target.value)} />
              </PlainField>
            </CardBlock>
            <CardBlock title="Access" description="Agouti's support gives an API key to those who ask for it. It is sent with every request.">
              <PlainField label="API key" hint={saved.AGOUTI?.has_api_key ? (changingKey ? 'Leave it blank to keep the saved key.' : 'The saved key is kept private. Press Change to replace it.') : 'No key saved yet.'}>
                {saved.AGOUTI?.has_api_key && !changingKey ? (
                  <div className="flex items-center gap-3">
                    <div className={`${fieldBox} flex items-center justify-between`} aria-label="Saved API key">
                      <span aria-hidden="true" className="tracking-widest text-zinc-500">••••••••</span>
                      <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Saved</span>
                    </div>
                    <button type="button" className={`${btnOutline} h-12 shrink-0`} onClick={() => setChangingKey(true)}>Change</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <input aria-label="API key" type="password" className={fieldBox} value={draft.agoutiKey} autoComplete="new-password" onChange={(e) => set('agoutiKey', e.target.value)} />
                    {saved.AGOUTI?.has_api_key && <button type="button" className={`${btnOutline} h-12 shrink-0`} onClick={() => { set('agoutiKey', ''); setChangingKey(false) }}>Keep it</button>}
                  </div>
                )}
              </PlainField>
            </CardBlock>
            <CardBlock title="Project" description="The Agouti project the deployments are uploaded to.">
              <PlainField label="Project id" hint="The number of the project in Agouti.">
                <input aria-label="Agouti project id" className={`${fieldBox} font-mono text-sm`} value={draft.agoutiProject} autoComplete="off" onChange={(e) => set('agoutiProject', e.target.value)} />
              </PlainField>
            </CardBlock>
          </SettingsCard>
          </>
          )}
          </div>
        )}

        {draft && saved && section === 'sources' && (
          <div className="space-y-5 pt-5">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Where the visits can be loaded from, besides entering them by hand. Pick one to set it up.</p>
            <div role="tablist" aria-label="Visit sources" className="flex flex-wrap gap-2">
              {VISIT_SOURCES.map((d) => {
                const used = d.id === 'wildintel-new' ? draft.wildintelNewEnabled : d.id === 'epicollect' ? draft.epicollectEnabled : true
                return (
                  <button key={d.id} type="button" role="tab" aria-selected={visitSource === d.id} onClick={() => setVisitSource(d.id)}
                          className={`inline-flex items-center gap-2 px-4 h-10 rounded-lg border text-sm font-medium ${visitSource === d.id ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300'}`}>
                    {d.label}
                    <span aria-hidden="true" title={used ? 'Used' : 'Not used'} className={`h-2 w-2 rounded-full ${used ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
                  </button>
                )
              })}
            </div>
            {visitSource === 'wildintel-new' && (
              <div className="space-y-5">
                <ToggleCard title="Use WildINTEL Epicollect CSV" checked={draft.wildintelNewEnabled} onChange={(v) => set('wildintelNewEnabled', v)}
                            description="Offers, in Register the visits, the file downloaded from the WildINTEL field form in Epicollect5." />
                <p className="text-sm text-zinc-500 dark:text-zinc-400">The columns of the form are recognised by themselves. The date and time of a visit are when its entry was created on the phone, in UTC.</p>
              </div>
            )}
            {visitSource === 'csv' && (
              <div className="space-y-5">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Always offered in Register the visits. Nothing to set up here: you say which column is which each time you load a file.</p>
              </div>
            )}
            {visitSource === 'epicollect' && (
              <div className="space-y-5">
              <ToggleCard title="Use the Epicollect5 connection" checked={draft.epicollectEnabled} onChange={(v) => set('epicollectEnabled', v)}
                              description="Lets WildINTEL Uploader download the entries of an Epicollect5 project by itself, instead of you downloading the CSV (in Register the visits › Custom CSV), and read the details of a deployment when it is imported." />
              <SettingsCard>
                <CardBlock title="Project" description="The Epicollect5 project the information is imported from.">
                  <PlainField label="Project name in its web address" hint={`It is the last part of the project's address: five.epicollect.net/project/${draft.epicollectSlug.trim() || 'my-project'}`}>
                    <input aria-label="Project name in its web address" className={`${fieldBox} font-mono text-sm`} value={draft.epicollectSlug} placeholder="my-camera-trap-project" autoComplete="off" onChange={(e) => set('epicollectSlug', e.target.value)} />
                  </PlainField>
                </CardBlock>
                <CardBlock
                  title="Access"
                  description={<>Only private projects need it. Create the access at <a href="https://developers.epicollect.net" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">developers.epicollect.net</a> and paste its id and secret here.</>}
                >
                  <PlainField label="Client id">
                    <input aria-label="Client id" className={`${fieldBox} font-mono text-sm`} value={draft.epicollectClientId} autoComplete="off" onChange={(e) => set('epicollectClientId', e.target.value)} />
                  </PlainField>
                  <PlainField label="Client secret" hint={saved.EPICOLLECT5.has_secret ? (changingSecret ? 'Leave it blank to keep the saved secret.' : 'The saved secret is kept private. Press Change to replace it.') : 'No secret saved yet.'}>
                    {saved.EPICOLLECT5.has_secret && !changingSecret ? (
                      <div className="flex items-center gap-3">
                        <div className={`${fieldBox} flex items-center justify-between`} aria-label="Saved secret">
                          <span aria-hidden="true" className="tracking-widest text-zinc-500">••••••••</span>
                          <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Saved</span>
                        </div>
                        <button type="button" className={`${btnOutline} h-12 shrink-0`} onClick={() => setChangingSecret(true)}>Change</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <input aria-label="Client secret" type="password" className={fieldBox} value={draft.epicollectClientSecret} autoComplete="new-password" onChange={(e) => set('epicollectClientSecret', e.target.value)} />
                        {saved.EPICOLLECT5.has_secret && <button type="button" className={`${btnOutline} h-12 shrink-0`} onClick={() => { set('epicollectClientSecret', ''); setChangingSecret(false) }}>Keep it</button>}
                      </div>
                    )}
                  </PlainField>
                  <div className="flex flex-wrap items-center gap-4">
                    <button type="button" className={`${btnOutline} gap-2`} disabled={!draft.epicollectSlug.trim() || epiConn.kind === 'testing'} onClick={handleTestEpicollect}>
                      {epiConn.kind === 'testing' ? <span className="animate-spin inline-flex" aria-hidden="true"><Icon size={16}><path d="M21 12a9 9 0 1 1-6.2-8.55" /></Icon></span> : <Icon size={16}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></Icon>}
                      {epiConn.kind === 'testing' ? 'Testing…' : 'Test connection'}
                    </button>
                    {epiConn.kind === 'ok' && <span role="status" className="inline-flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"><Icon size={16}><circle cx="12" cy="12" r="10" /><path d="M8 12l3 3 5-6" /></Icon>{epiConn.message}</span>}
                    {epiConn.kind === 'error' && <span role="alert" className="inline-flex items-center gap-2 text-sm text-red-600 dark:text-red-400"><Icon size={16}><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></Icon>{epiConn.message}</span>}
                  </div>
                </CardBlock>
              </SettingsCard>
              <ToggleCard title="Add answers with no place to go to the comments" checked={draft.epicollectUnmappedToComments} onChange={(v) => set('epicollectUnmappedToComments', v)}
                          description="An entry may answer questions that no field of a deployment is matched to. Each one is added as a line, “question: answer”, after the comments of the entry. Images are left out." />
              </div>
            )}
          </div>
        )}
        {draft && saved && section === 'validation' && (
          <div className="py-5 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <p className={`${hintClass} leading-relaxed max-w-prose`}>
                The checks of the &ldquo;Validate folder contents&rdquo; step. They look at the images alone, without knowing the deployment.
                One that is turned off is neither shown nor run.
              </p>
            </div>
            <AllChecksButtons on={IMAGE_CHECKS.filter((c) => draft.validation[c.key]).length} total={IMAGE_CHECKS.length}
                              onAll={(on) => set('validation', Object.fromEntries(IMAGE_CHECKS.map((c) => [c.key, on])) as typeof draft.validation)} />
            <div className="space-y-3">
              {IMAGE_CHECKS.map(({ key, label, hint }) => (
                <CheckEntry key={key} label={label} hint={hint} enabled={draft.validation[key]}
                            onToggle={(v) => set('validation', { ...draft.validation, [key]: v })} />
              ))}
            </div>
          </div>
        )}

        {draft && saved && section === 'postvalidation' && (
          <div className="py-5 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <p className={`${hintClass} leading-relaxed max-w-prose`}>
                Once the deployment&rsquo;s details are known: its names and dates, and the images against them. One that is turned off is
                neither shown nor run. The gear opens the settings of the checks that have any — the wizard uses them as they are here.
              </p>
            </div>
            <AllChecksButtons on={DEPLOYMENT_CHECKS.filter((c) => draft.postvalidation[c.key]).length} total={DEPLOYMENT_CHECKS.length}
                              onAll={(on) => set('postvalidation', Object.fromEntries(DEPLOYMENT_CHECKS.map((c) => [c.key, on])) as typeof draft.postvalidation)} />
            <div className="space-y-3">
              {DEPLOYMENT_CHECKS.map(({ key, label, hint }) => (
                <CheckEntry key={key} label={label} hint={hint} enabled={draft.postvalidation[key]}
                            onToggle={(v) => set('postvalidation', { ...draft.postvalidation, [key]: v })}
                            settings={checkSettings(key)} invalid={checkSettingsInvalid(key)} />
              ))}
            </div>
          </div>
        )}

        {draft && saved && section === 'preprocessing' && (
          <div className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
            <Row
              label="Steps"
              description="What is done to the images as they are imported into their collection. The wizard lists these before the import, and each run can still switch them off."
            >
              <CheckOption label="Rename the images" hint="<DEPLOYMENT>__<YYYYMMDD>_<n>.<EXT>, in upper case — e.g. R0003-DONA_01__20240904_1.JPEG. The originals keep their names."
                           checked={draft.rename} onChange={(v) => set('rename', v)} />
              <CheckOption label="Resize the images" hint="To the width below, keeping their proportions. Images no wider than that are left as they are."
                           checked={draft.resize} onChange={(v) => set('resize', v)} />
              <CheckOption label="Add metadata" hint="Authorship, rights and license, written into each image as XMP. Needs ExifTool."
                           checked={draft.metadata} onChange={(v) => set('metadata', v)} />
            </Row>
            <Row label="Resize" description="The width images are resized to. wildintel-tools used 2400 pixels.">
              <NumberBox label="Width" value={draft.resizeWidth} limits={RESIZE_WIDTH} onChange={(v) => set('resizeWidth', v)} unit="pixels" />
            </Row>
            <Row label="Authorship" description="What the metadata says: who the images belong to and where they were taken. A blank owner or publisher is written as “Unknown”.">
              <TextBox label="Owner" value={draft.owner} onChange={(v) => set('owner', v)} placeholder="Pick an institution, or type any name" list="entity-options" />
              <TextBox label="Publisher" value={draft.publisher} onChange={(v) => set('publisher', v)} placeholder="Pick an institution, or type any name" list="entity-options" />
              <TextBox label="Coverage" value={draft.coverage} onChange={(v) => set('coverage', v)} placeholder="Pick an area, or type any place" list="coverage-options" />
              <datalist id="entity-options">{ENTITIES.map((e) => <option key={e.title} value={e.title} />)}</datalist>
              <datalist id="coverage-options">{COVERAGE_AREAS.map((a) => <option key={a} value={a} />)}</datalist>
              <p className={`${hintClass} px-1`}>
                The owner and the publisher are the institutions wildintel-publisher knows, but the fields are open: type any other name.
                The coverage is where the images were taken — likewise open. Left blank, the deployment&rsquo;s location is used.
              </p>
            </Row>
            <Row label="License" description="The Creative Commons license the images are shared under. wildintel-tools used CC BY-NC 4.0.">
              <SelectBox
                label="License" value={draft.licenseUrl} onChange={(v) => set('licenseUrl', v)}
                options={[
                  ...LICENSES.map((l) => ({ value: l.value, label: l.label })),
                  // A license set by hand in settings.toml is kept, and shown, until another is chosen.
                  ...(LICENSES.some((l) => l.value === draft.licenseUrl) ? [] : [{ value: draft.licenseUrl, label: 'Other (set in settings.toml)' }]),
                ]}
              />
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
                {LICENSES.find((l) => l.value === draft.licenseUrl)?.description ?? 'A license that is not one of the above.'}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                What is written into each image: <span className="font-mono break-all">{draft.licenseUrl || '(none)'}</span>
              </p>
            </Row>
            <Row label="Dates" description="The capture dates go into the image names and the metadata. They are read from the EXIF as the camera's local time, in the timezone given in the deployment's details.">
              <CheckOption label="Ignore summer time" hint="Read the camera's clock as if it never changed, using the timezone's standard offset — for cameras whose clock was set once and never adjusted."
                           checked={draft.ignoreDst} onChange={(v) => set('ignoreDst', v)} />
              <CheckOption label="Convert the dates to UTC" hint="Otherwise they keep the timezone's own offset."
                           checked={draft.convertToUtc} onChange={(v) => set('convertToUtc', v)} />
            </Row>
          </div>
        )}

        {draft && saved && section === 'entities' && (
          <EntitiesSection
            trappers={draft.trappers} roles={draft.roles} cameras={draft.cameras} sdCards={draft.sdCards}
            onTrappers={(v) => set('trappers', v)} onRoles={(v) => set('roles', v)} onCameras={(v) => set('cameras', v)} onSdCards={(v) => set('sdCards', v)}
            initialTab={initialSection && initialSection in ENTITY_SECTIONS ? ENTITY_SECTIONS[initialSection] : 'projects'} initialProject={initialProject} initialItem={initialItem} onDetail={setEntityDetail}
          />
        )}

        {section === 'reports' && <ReportsList />}

        {section === 'config' && (
          <ConfigsEditor onSwitched={reloadSettings} onError={(message) => setStatus({ kind: 'error', message })} />
        )}

        {section !== 'reports' && section !== 'config' && !(section === 'entities' && entityDetail) && (
        <div className="flex items-center justify-end gap-4 pt-5 mt-2 border-t border-zinc-200 dark:border-zinc-800">
          {status.kind === 'error' && <p className="text-sm text-red-600 dark:text-red-400 mr-auto">{status.message}</p>}
          {status.kind === 'saved' && <p className="text-sm text-emerald-700 dark:text-emerald-400 mr-auto">Settings saved.</p>}
          {draft && !update && <p className="text-sm text-red-600 dark:text-red-400 mr-auto">Fix the values marked in red first.</p>}
          <button type="button" className={btnPrimary} disabled={!update || status.kind === 'saving'} onClick={handleSave}>
            {status.kind === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
        )}
      </div>
    </div>
  )
}
