import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import EpicollectMapping from '../components/EpicollectMapping'
import { DOCS_URL, REPO_URL } from '../components/Navbar'
import { COVERAGE_AREAS, ENTITIES } from '../entities'
import ReportsList from '../components/ReportsList'
import type { AppSettings, AppSettingsUpdate, ConfigInfo, DeploymentCheck, ImageCheck, LogLevel, SimilarityMethod, UpdateCheck } from '../types'

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

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

const CameraIcon = () => (
  <Icon>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </Icon>
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
const ReportIcon = () => (
  <Icon>
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path d="M8 16h.01" />
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
  logLevel: LogLevel
  workers: string
  dataDir: string
  collectionsDir: string
  reportsDir: string
  packagesDir: string
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
}

function toDraft(s: AppSettings): Draft {
  const post = s.POSTVALIDATION
  const checks = {
    deployment_id: post.deployment_id, collection_prefix: post.collection_prefix, collection_name: post.collection_name,
    location: post.location, time_range: post.time_range, camera: post.camera,
    image_count: post.image_count, sequence_count: post.sequence_count, sequence_length: post.sequence_length,
  }
  return {
    logLevel: s.GENERAL.log_level,
    workers: String(s.GENERAL.workers),
    dataDir: s.DATA.dir,
    collectionsDir: s.DATA.collections_dir ?? '',
    reportsDir: s.DATA.reports_dir ?? '',
    packagesDir: s.DATA.packages_dir ?? '',
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
  if (id === 'trapper') return numberIn(d.maxZipMb, MAX_ZIP_MB) !== null
  return true
}

function toUpdate(d: Draft): AppSettingsUpdate | null {
  if (!SECTIONS.every((s) => sectionValid(d, s.id))) return null
  return {
    GENERAL: { log_level: d.logLevel, workers: Number(d.workers) },
    TRAPPER: { base_url: d.trapperUrl.trim() || null, user_name: d.trapperUser.trim() || null, user_password: d.trapperPassword, max_zip_mb: Number(d.maxZipMb) },
    EPICOLLECT5: { enabled: d.epicollectEnabled, unmapped_to_comments: d.epicollectUnmappedToComments, project_slug: d.epicollectSlug.trim() || null, client_id: d.epicollectClientId.trim() || null, client_secret: d.epicollectClientSecret, mapping: d.epicollectMapping },
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
  }
}

// ── Layout pieces ───────────────────────────────────────────────────────

/** The folders of the app that can be put somewhere of their own; blank, each is a folder inside the data folder. */
const FOLDERS: { draftKey: 'collectionsDir' | 'reportsDir' | 'packagesDir'; label: string; description: string; hint: string; dialog: string }[] = [
  { draftKey: 'collectionsDir', label: 'Collections folder', dialog: 'Select the folder to keep the collections in',
    description: 'Where the collections are kept before they are uploaded — <folder>/<research project>/<R0003>/<deployment>. Left blank, they go in a “collections” folder inside the data folder.',
    hint: 'Handy to keep the collections on another disk.' },
  { draftKey: 'reportsDir', label: 'Reports folder', dialog: 'Select the folder to keep the reports in',
    description: 'Where the reports of the checks and of the preprocessing are kept. Left blank, they go in a “reports” folder inside the data folder.',
    hint: 'Reports already made stay where they are: move them by hand if you want them in the new folder.' },
  { draftKey: 'packagesDir', label: 'Packages folder', dialog: 'Select the folder to keep the packages in',
    description: 'Where the zips, the yamls and the deployments csv made to upload to Trapper are written — <folder>/<research project>/<R0003>. Left blank, they go in a “packages” folder inside the data folder.',
    hint: 'Handy when the packages are big and the data folder is on a small disk.' },
]

type SectionId = 'general' | 'trapper' | 'epicollect' | 'validation' | 'postvalidation' | 'preprocessing' | 'reports' | 'config'

const SECTIONS: { id: SectionId; label: string; icon: () => ReactNode }[] = [
  { id: 'general', label: 'General', icon: SlidersIcon },
  { id: 'trapper', label: 'Trapper', icon: CameraIcon },
  { id: 'epicollect', label: 'Epicollect5', icon: FileIcon },
  { id: 'validation', label: 'Validation', icon: CheckIcon },
  { id: 'postvalidation', label: 'Postvalidation', icon: ShieldIcon },
  { id: 'preprocessing', label: 'Preprocessing', icon: ImageIcon },
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

function TextBox({ label, value, onChange, type = 'text', placeholder, mono, error, list }: {
  label: string; value: string; onChange: (v: string) => void; type?: 'text' | 'password'; placeholder?: string; mono?: boolean; error?: string | null
  /** The id of a <datalist> of suggestions: pick one, or type anything. */
  list?: string
}) {
  return (
    <BoxField label={label} error={error}>
      <input
        type={type} className={`${boxInput} ${mono ? 'font-mono text-sm' : ''}`} value={value} placeholder={placeholder} aria-label={label} list={list}
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
  { value: 'ERROR', label: 'Error', hint: 'Only what went wrong.' },
  { value: 'WARNING', label: 'Warning', hint: 'Also what may be wrong: retries, failed images…' },
  { value: 'INFO', label: 'Info', hint: 'Also what the app does: each scan, validation and import started and finished.' },
  { value: 'DEBUG', label: 'Debug', hint: 'Everything: each image scanned and copied, each Trapper query, full tracebacks. Big logs — for tracking a problem down.' },
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
function AllChecksButtons({ onAll }: { onAll: (on: boolean) => void }) {
  return (
    <div className="flex gap-2">
      <button type="button" className={btnSoft} onClick={() => onAll(true)}>Turn all on</button>
      <button type="button" className={btnSoft} onClick={() => onAll(false)}>Turn all off</button>
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
]

const SIMILARITY_METHODS: { value: SimilarityMethod; label: string }[] = [
  { value: 'median', label: 'The median of the previous revisions' },
  { value: 'mean', label: 'The mean of the previous revisions' },
  { value: 'last', label: 'The last previous revision' },
  { value: 'range', label: 'The range the previous revisions span' },
]

// ── The page ────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
  /** The section to open on; the general one when left out. */
  initialSection?: SectionId
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
    { icon: 'bug', title: 'Report a problem', subtitle: 'Open a pre-filled GitHub issue', href: issue },
    { icon: 'book', title: 'Documentation', subtitle: 'The user manual', href: DOCS_URL },
    { icon: 'code', title: 'GitHub', subtitle: 'Source code', href: REPO_URL },
    { icon: 'notes', title: 'What’s new', subtitle: 'Show release notes', href: `${REPO_URL}/releases` },
  ]
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6 py-6" aria-label="About the app" role="group">
      <div>
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-3xl">📤</span>
          <div>
            <h4 className="text-2xl font-semibold leading-tight">WildINTEL Uploader</h4>
            {shownVersion && <p className="text-sm text-zinc-500 dark:text-zinc-400 font-mono" aria-label="Version">{shownVersion}</p>}
          </div>
        </div>
        <div className="mt-5 space-y-2"><UpdateCheckButton /></div>
      </div>
      <ul className="space-y-1">
        {links.map((l) => (
          <li key={l.title}>
            <a href={l.href} target="_blank" rel="noreferrer"
               className="flex items-center gap-4 rounded-lg px-4 py-2.5 no-underline text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 transition-colors">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current text-zinc-600 dark:text-zinc-300" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{LINK_ICONS[l.icon]}</svg>
              <span>
                <span className="block text-base leading-tight">{l.title}</span>
                <span className="block text-sm text-zinc-500 dark:text-zinc-400">{l.subtitle}</span>
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
    <div className="space-y-4">
      <p className={`${hintClass} leading-relaxed`}>
        Each config is a settings file; the active one is what the app reads and saves — the folder the images are kept in,
        the Trapper account, the checks and the preprocessing. A new one starts from the default values. Keep in mind these
        files hold your passwords as plain text.
      </p>
      <div className="flex items-center justify-between">
        <span className="text-base text-zinc-800 dark:text-zinc-200">Config</span>
        <button type="button" className={`${iconBtn} text-xl`} aria-label="Add config" title="Add a config with the default values" onClick={() => setAdding({ name: '' })}>+</button>
      </div>
      <div className="space-y-3">
        {configs?.map((c, i) => (
          <div key={c.id} className={`flex items-center gap-4 px-4 py-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 border ${c.active ? 'border-blue-500' : 'border-transparent'}`}>
            <span className="w-10 h-10 flex items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 text-sm font-semibold shrink-0" aria-hidden="true">#{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-base truncate">{c.name}</p>
                {c.active && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-600 text-white">ACTIVE</span>}
              </div>
              <p className={`${hintClass} font-mono break-all`} aria-label={`${c.name} file location`}>{c.path}</p>
            </div>
            {!c.active && <button type="button" className={btnSoft} aria-label={`Activate ${c.name}`} onClick={() => activate(c.id)}>Activate</button>}
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
export default function SettingsPage({ onClose, initialSection }: Props) {
  const [section, setSection] = useState<SectionId>(initialSection ?? 'general')
  const [saved, setSaved] = useState<AppSettings | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string }>({ kind: 'idle' })
  const [clearLog, setClearLog] = useState<{ kind: 'idle' | 'confirming' | 'clearing' | 'cleared' | 'error'; message?: string }>({ kind: 'idle' })
  const [conn, setConn] = useState<{ kind: 'idle' | 'testing' | 'ok' | 'error'; message?: string }>({ kind: 'idle' })
  const [epiConn, setEpiConn] = useState<{ kind: 'idle' | 'testing' | 'ok' | 'error'; message?: string }>({ kind: 'idle' })
  const [browsing, setBrowsing] = useState(false)

  // Also called after switching config, which discards whatever wasn't saved.
  function reloadSettings() {
    api.getSettings()
      .then((s) => { setSaved(s); setDraft(toDraft(s)); setStatus({ kind: 'idle' }) })
      .catch((e) => setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load the settings.' }))
  }

  useEffect(reloadSettings, [])

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
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
      setConn({ kind: 'ok', message: `Connected — ${result.research_projects_count} research project(s) available.` })
    } catch (e) {
      setConn({ kind: 'error', message: e instanceof Error ? e.message : 'Could not connect to Trapper.' })
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
        <h4 className="text-2xl font-semibold mb-2">{current.label}</h4>

        {!draft && status.kind !== 'error' && <p className="text-sm text-zinc-500 dark:text-zinc-400 py-5">Loading…</p>}

        {draft && saved && section === 'general' && (
          <div className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
            <AboutBlock />
            <Row
              label="Data folder"
              description="Where the app keeps what it makes: the collections, the reports and the packages, each in a folder inside it. You can put any of them somewhere else below."
            >
              <TextBox label="Folder" value={draft.dataDir} onChange={(v) => set('dataDir', v)} mono error={dataDirError} />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={btnSoft} aria-label="Browse for the data folder" disabled={browsing} onClick={() => handleBrowse('dataDir')}>{browsing ? 'Browsing…' : 'Browse…'}</button>
                <button type="button" className={btnSoft} aria-label="Use the default data folder" onClick={() => set('dataDir', '')} disabled={draft.dataDir === ''}>Use the default</button>
              </div>
              <p className={`${hintClass} px-1`}>
                By default a folder named like the app, in your documents folder. Left blank, that is what is used.
              </p>
            </Row>
            {FOLDERS.map(({ draftKey, label, description, hint }) => {
              const error = draft[draftKey].trim() !== '' && !isAbsolutePath(draft[draftKey]) ? 'An absolute path (or one starting with ~).' : null
              const defaultKey = draftKey.replace('Dir', '') as 'collections' | 'reports' | 'packages'
              return (
                <Row key={draftKey} label={label} description={description}>
                  <TextBox label={label} value={draft[draftKey]} onChange={(v) => set(draftKey, v)} mono error={error} placeholder={saved.DATA[`default_${defaultKey}_dir`]} />
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={btnSoft} aria-label={`Browse for the ${defaultKey} folder`} disabled={browsing} onClick={() => handleBrowse(draftKey)}>{browsing ? 'Browsing…' : 'Browse…'}</button>
                    <button type="button" className={btnSoft} aria-label={`Use the default ${defaultKey} folder`} onClick={() => set(draftKey, '')} disabled={draft[draftKey] === ''}>Use the default</button>
                  </div>
                  <p className={`${hintClass} px-1`}>{hint}</p>
                </Row>
              )
            })}
            <Row
              label="Parallel work"
              description="How many images are validated or preprocessed at once. More workers use more CPUs and finish sooner, up to what the machine has."
            >
              <NumberBox label="Workers" value={draft.workers} limits={WORKERS} onChange={(v) => set('workers', v)} unit="images at once" />
              <p className={`${hintClass} px-1`}>
                This machine has {saved.GENERAL.cpu_count} CPU{saved.GENERAL.cpu_count === 1 ? '' : 's'}. The default is the CPUs it has, up to 4;
                with a hard disk or a network drive, more workers may not help, as the files are read slower than they are worked on.
              </p>
            </Row>
            <Row
              label="Log level"
              description="How much the app writes to its log — raise it to Debug to track a problem down, then lower it again. Applied as soon as it's saved."
            >
              <SelectBox label="Level" value={draft.logLevel} options={LOG_LEVELS} onChange={(v) => set('logLevel', v)} />
              <p className={`${hintClass} px-1`}>{LOG_LEVELS.find((l) => l.value === draft.logLevel)?.hint}</p>
              {saved.GENERAL.log_level_override && (
                <p className="text-xs text-amber-700 dark:text-amber-400 px-1">
                  The environment variable <span className="font-mono">WILDINTEL_UPLOADER_WEB_LOG_LEVEL</span> sets it
                  to <strong>{saved.GENERAL.log_level_override}</strong> for now — it wins over this setting.
                </p>
              )}
            </Row>
            <Row label="Log file" description="Rotated at 5 MB, keeping the last 5. Attach it to a bug report.">
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
            </Row>
          </div>
        )}

        {draft && saved && section === 'trapper' && (
          <div className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
            <Row label="Server" description="The Trapper instance the research projects and locations are fetched from, and the deployments will be uploaded to.">
              <TextBox label="URL" value={draft.trapperUrl} onChange={(v) => set('trapperUrl', v)} placeholder="https://trapper.example.org" mono />
            </Row>
            <Row
              label="Account"
              description={saved.TRAPPER.has_password ? 'A password is saved — leave it blank to keep it.' : 'No password saved yet.'}
            >
              <TextBox label="Username" value={draft.trapperUser} onChange={(v) => set('trapperUser', v)} />
              <TextBox label="Password" type="password" value={draft.trapperPassword} onChange={(v) => set('trapperPassword', v)} />
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={btnSoft} disabled={!canTest || conn.kind === 'testing'} onClick={handleTestConnection}>
                  {conn.kind === 'testing' ? 'Testing…' : 'Test connection'}
                </button>
                {conn.kind === 'ok' && <span className="text-sm text-emerald-700 dark:text-emerald-400">{conn.message}</span>}
                {conn.kind === 'error' && <span className="text-sm text-red-600 dark:text-red-400">{conn.message}</span>}
              </div>
            </Row>
            <Row label="Upload packages" description="A deployment's images go up in zips of at most this size, each with its own yaml.">
              <NumberBox label="Largest zip" value={draft.maxZipMb} limits={MAX_ZIP_MB} onChange={(v) => set('maxZipMb', v)} unit="MB" />
            </Row>
          </div>
        )}

        {draft && saved && section === 'epicollect' && (
          <div className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
            <Row label="Use Epicollect5" description="Offers to fill in the dates, camera, site and notes of a deployment from its entry in the Epicollect5 project. Turned off, nothing is read from Epicollect5.">
              <CheckOption label="Import deployment information from Epicollect5" checked={draft.epicollectEnabled} onChange={(v) => set('epicollectEnabled', v)} />
            </Row>
            <Row label="Project" description="The Epicollect5 project the deployment information is imported from: the name in its URL, five.epicollect.net/project/<slug>.">
              <TextBox label="Slug" value={draft.epicollectSlug} onChange={(v) => set('epicollectSlug', v)} placeholder="my-camera-trap-project" mono />
            </Row>
            <Row
              label="API client"
              description={<>
                {saved.EPICOLLECT5.has_secret ? 'Only private projects need it. A secret is saved — leave it blank to keep it.' : 'Only private projects need it. No secret saved yet.'}
                {' '}Create the client app at <a href="https://developers.epicollect.net" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">developers.epicollect.net</a>.
              </>}
            >
              <TextBox label="Client id" value={draft.epicollectClientId} onChange={(v) => set('epicollectClientId', v)} mono />
              <TextBox label="Client secret" type="password" value={draft.epicollectClientSecret} onChange={(v) => set('epicollectClientSecret', v)} />
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={btnSoft} disabled={!draft.epicollectSlug.trim() || epiConn.kind === 'testing'} onClick={handleTestEpicollect}>
                  {epiConn.kind === 'testing' ? 'Testing…' : 'Test connection'}
                </button>
                {epiConn.kind === 'ok' && <span className="text-sm text-emerald-700 dark:text-emerald-400">{epiConn.message}</span>}
                {epiConn.kind === 'error' && <span className="text-sm text-red-600 dark:text-red-400">{epiConn.message}</span>}
              </div>
            </Row>
            <Row label="Unmapped answers" description="An entry may answer inputs of the form that no field of a deployment is related to.">
              <CheckOption label="Add them to the comments" checked={draft.epicollectUnmappedToComments} onChange={(v) => set('epicollectUnmappedToComments', v)}
                           hint="Each one goes in as a line, “question: answer”, after the comments the entry gives. Photos are left out." />
            </Row>
            <div className="py-5">
              <h3 className="text-sm font-medium mb-3">Mapping</h3>
              <EpicollectMapping
                mapping={draft.epicollectMapping} onChange={(m) => set('epicollectMapping', m)}
                projectSaved={Boolean(saved.EPICOLLECT5.project_slug)}
                unsavedProject={draft.epicollectSlug.trim() !== (saved.EPICOLLECT5.project_slug ?? '') || draft.epicollectClientId.trim() !== (saved.EPICOLLECT5.client_id ?? '') || draft.epicollectClientSecret !== ''}
              />
            </div>
          </div>
        )}

        {draft && saved && section === 'validation' && (
          <div className="py-5 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <p className={`${hintClass} leading-relaxed max-w-prose`}>
                The checks of the &ldquo;Validate folder contents&rdquo; step. They look at the images alone, without knowing the deployment.
                One that is turned off is neither shown nor run.
              </p>
              <AllChecksButtons onAll={(on) => set('validation', Object.fromEntries(IMAGE_CHECKS.map((c) => [c.key, on])) as typeof draft.validation)} />
            </div>
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
              <AllChecksButtons onAll={(on) => set('postvalidation', Object.fromEntries(DEPLOYMENT_CHECKS.map((c) => [c.key, on])) as typeof draft.postvalidation)} />
            </div>
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

        {section === 'reports' && <ReportsList />}

        {section === 'config' && (
          <ConfigsEditor onSwitched={reloadSettings} onError={(message) => setStatus({ kind: 'error', message })} />
        )}

        {section !== 'reports' && (
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
