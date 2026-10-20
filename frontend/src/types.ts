export interface ResearchProject {
  pk: number
  name: string
  acronym?: string | null
}

export interface ClassificationProject {
  pk: number
  name: string
  is_active: boolean
}

export interface Location {
  pk: number
  location_id: string
  name: string | null
  timezone: string | null
  /** Whether the location ignores summer time, as Trapper has it. */
  ignore_dst?: boolean | null
  /** WGS84 decimal degrees, from Trapper — null when it can't say. */
  latitude?: number | null
  longitude?: number | null
}

/** What scanning a folder finds: how many files, and how many of them are images. Nothing is read from the images —
 * that is for the steps that follow (the validation, and GuessedDetails for the deployment form). */
export interface ScanResult {
  file_count: number
  image_count: number
  warnings: string[]
}

/** The deployment form's starting point, read from a folder's images: their date range and camera. */
export interface GuessedDetails {
  start_date: string | null
  end_date: string | null
  /** Filled in only when every image has the same one. */
  camera_model: string | null
  camera_id: string | null
  warnings: string[]
}

/** One subfolder of a session folder, scanned — a deployment's images. */
export interface SessionScanDeployment extends ScanResult {
  name: string
  path: string
  /** Only given when they come from the collection's FileTimestampLog — otherwise they are read from the images later. */
  start_date: string | null
  end_date: string | null
  /** Its start and end come from the collection's FileTimestampLog, not from the images' EXIF. */
  from_timestamp_log: boolean
  /** The id its row in the log names it by (R0033-DONA_01), when it has one. */
  log_deployment_id: string | null
}

/** The <collection>_FileTimestampLog.csv found beside a session's subfolders. */
export interface SessionTimestampLog {
  name: string
  path: string
  rows: number
  matched: number
  /** The revision number the matched ids start with (R0033-… → 33), when they all agree. */
  revision: number | null
}

export interface SessionScan {
  deployments: SessionScanDeployment[]
  loose_files: number
  warnings: string[]
  timestamp_log: SessionTimestampLog | null
}

export interface CorruptedImage {
  path: string
  error: string
}

/** A higher-numbered shot with an earlier EXIF date than a lower-numbered
 * one in the same folder — see core.services.deployment_import_service
 * .validate_images. */
export interface SequenceIssue {
  path_a: string
  index_a: number
  date_a: string
  path_b: string
  index_b: number
  date_b: string
}

/** The "Validate folder contents" step's checks — see
 * core.services.deployment_import_service.IMAGE_CHECKS. Only the results of
 * whichever were asked for are present. */
export type ImageCheck = 'corrupted' | 'sequence' | 'structure' | 'camera' | 'exif' | 'duplicates'

/** The EXIF fields the wizard needs of every image. */
export type ExifField = 'date' | 'camera_model' | 'camera_id'

/** How many images lack one of them, with a few examples. */
export interface MissingExif {
  count: number
  examples: string[]
}

/** Two or more files with exactly the same content. */
export interface DuplicateGroup {
  size: number
  files: string[]
}

/** One camera (model and id) among a folder's images, and how many of them it took. */
export interface CameraGroup {
  model: string | null
  camera_id: string | null
  count: number
  /** A few of its files, relative to the scanned folder. */
  examples: string[]
}

export interface ValidationResult {
  checked_count: number
  corrupted?: CorruptedImage[]
  sequence_issues?: SequenceIssue[]
  /** Folders other than the scanned one itself holding files. */
  subdirectories?: string[]
  /** The distinct cameras among the images — more than one means different cameras got mixed. */
  cameras?: CameraGroup[]
  /** Images with no camera information at all. */
  cameras_without_info?: number
  /** Whether ExifTool (which reads the serial number of most camera traps) did the reading. */
  exiftool?: boolean
  /** Images lacking the capture date, the camera model or the camera id. */
  exif_missing?: Record<ExifField, MissingExif>
  duplicates?: DuplicateGroup[]
  /** The report this validation was kept in — see ReportPanel. Null if it couldn't be written. */
  report_id?: string | null
}

/** An EXIF-dated shot outside the deployment's own date range. */
export interface OutOfRangeImage {
  path: string
  date: string
  /** Which rule it broke: the first image is at the start, the last at the end, the rest in between. */
  rule?: 'first' | 'last' | 'between'
  /** The range it should have fallen in, e.g. "2024-09-04T10:00:00 ± 1h". */
  expected?: string
}

/** One of the postvalidation's naming checks — whether it holds, and why or why not. */
export interface NameCheck {
  ok: boolean
  message: string
}

/** A shot whose EXIF camera model differs from the deployment's declared
 * one. */
export interface CameraMismatch {
  path: string
  detected: string
}

/** The postvalidation step's checks — see
 * core.services.deployment_import_service.DEPLOYMENT_CHECKS. */
export type DeploymentCheck =
  | 'deployment_id' | 'collection_prefix' | 'collection_name' | 'location' | 'time_range' | 'camera'
  | 'image_count' | 'sequence_count' | 'sequence_length'

/** The statistical checks — each compares this revision with the location's previous ones. */
export type StatisticCheck = 'image_count' | 'sequence_count' | 'sequence_length'

/** How this revision is compared to the previous ones: their median or mean, the last, or the range they span. */
export type SimilarityMethod = 'median' | 'mean' | 'last' | 'range'

/** What the statistical checks mean by a sequence and by similar. */
export interface StatisticsParams {
  /** A sequence starts when the gap to the previous image is at least this many seconds. */
  sequence_gap_seconds: number
  /** How many previous revisions are needed to judge — with fewer the checks are skipped. */
  min_revisions: number
  method: SimilarityMethod
  /** What is similar, in percent, for each statistic. */
  image_count_tolerance: number
  sequence_count_tolerance: number
  sequence_length_tolerance: number
}

/** One statistical check's finding. */
export interface StatisticResult {
  ok: boolean
  /** Not enough previous revisions to judge: counts as ok. */
  skipped: boolean
  message: string
  value: number
  reference: number | null
  lower: number | null
  upper: number | null
  /** How many previous revisions it was compared with. */
  previous: number
  /** The value in each of them. */
  history: { revision: number; deployment_id: string; value: number }[]
}

/** What writing a deployment into its collection's FileTimestampLog did. */
export interface TimestampLogResult {
  path: string
  action: 'added' | 'updated' | 'unchanged'
  rows: number
  collection: string
}

export interface DeploymentCheckResult {
  checked_count: number
  deployment_id?: NameCheck
  collection_prefix?: NameCheck
  collection_name?: NameCheck
  location?: NameCheck
  image_count?: StatisticResult
  sequence_count?: StatisticResult
  sequence_length?: StatisticResult
  out_of_range?: OutOfRangeImage[]
  /** The hours of leeway the date range was checked with. */
  tolerance_hours?: number
  camera_mismatches?: CameraMismatch[]
  /** Every distinct EXIF camera model found — more than one usually means
   * images from different cameras got mixed into the folder. */
  camera_models_found?: string[]
  /** The report this postvalidation was kept in. */
  report_id?: string | null
}

/** Camtrap DP's own "featureType" enum — deployments-table-schema.json. */
export type FeatureType =
  | 'roadPaved' | 'roadDirt' | 'trailHiking' | 'trailGame' | 'roadUnderpass' | 'roadOverpass' | 'roadBridge'
  | 'culvert' | 'burrow' | 'nestSite' | 'carcass' | 'waterSource' | 'fruitingTree'

/** One row of the Camtrap Data Package "deployments" table — see
 * https://camtrap-dp.tdwg.org (deployments-table-schema.json), whose field
 * names this mirrors (deploymentID -> deployment_id, etc.). The standard
 * requires deployment_id, latitude, longitude, start_date and end_date (the
 * dates as ISO 8601 with a timezone designator) — see deploymentValidation.ts
 * and core.schemas.requests.DeploymentFields, which enforce it. */
export interface DeploymentFields {
  deployment_id: string
  location_id?: string | null
  location_name?: string | null

  latitude?: number | null
  longitude?: number | null
  coordinate_uncertainty?: number | null

  start_date: string
  end_date?: string | null

  setup_by?: string | null
  camera_id?: string | null
  camera_model?: string | null
  camera_interval?: number | null // cameraDelay
  // cameraHeight and cameraDepth are mutually exclusive in the standard.
  camera_height?: number | null
  camera_depth?: number | null
  camera_tilt?: number | null
  camera_heading?: number | null
  detection_distance?: number | null

  timestamp_issues?: boolean | null
  bait_use?: boolean | null
  feature_type?: FeatureType | null
  habitat?: string | null
  /** deploymentGroups — the standard's single field for what Trapper keeps
   * as two (session/array), e.g. "season:winter 2020 | grid:A1". */
  deployment_groups?: string | null
  comments?: string | null
  tags: string[]
}

export const EMPTY_DEPLOYMENT_FIELDS: DeploymentFields = {
  deployment_id: '', location_id: '', location_name: null,
  latitude: null, longitude: null, coordinate_uncertainty: null,
  start_date: '', end_date: null,
  setup_by: null, camera_id: null, camera_model: null, camera_interval: null,
  camera_height: null, camera_depth: null, camera_tilt: null, camera_heading: null, detection_distance: null,
  timestamp_issues: null, bait_use: null, feature_type: null, habitat: null, deployment_groups: null, comments: null,
  tags: [],
}

export type ImportEvent =
  | { type: 'copy'; index: number; total: number; name: string }
  | { type: 'registering' }
  /** The images are done and their metadata is being written. */
  | { type: 'metadata'; total: number }
  /** An image that couldn't be processed — the rest go on. */
  | { type: 'skipped'; name: string; detail: string }
  /** The images are being checked and the deployment sealed (see seal.json). */
  | { type: 'sealing' }
  | { type: 'done'; dest_dir: string; processed?: number; skipped?: number; sealed?: boolean | null; report_id?: string | null }

/** What is done to the images as they are imported, and the values it uses — see
 * core.services.preprocessing_service. */
export interface PreprocessingOptions {
  rename: boolean
  resize: boolean
  resize_width: number
  metadata: boolean
  owner: string
  publisher: string
  coverage: string
  license_url: string
  research_project: string
  convert_to_utc: boolean
}

/** What the app's menu offers — import a deployment, import a whole session of them, or upload one to Trapper. */
export type Task = 'deployment' | 'upload' | 'session' | 'upload-session' | 'utils' | 'sync' | 'repair' | 'fieldlog' | 'cards' | 'timefix'

/** What syncing the local collections folder with Trapper did: for each kind of thing, what it created and what was already there. */
export interface SyncResult {
  research_project_id: string
  folder: string
  collections: string[]
  created: Record<'research_project' | 'locations' | 'collections' | 'deployments' | 'timestamp_log' | 'images', string[]>
  kept: Record<'research_project' | 'locations' | 'collections' | 'deployments' | 'timestamp_log' | 'images', string[]>
  unassigned: string[]
  failed: { deployment_id: string; error: string }[]
  /** Only when the images were asked for: what came, by deployment; what failed; and the images Trapper lists that the classification project doesn't hold. */
  downloaded?: {
    images: number
    bytes: number
    deployments: Record<string, number>
    failed: { deployment_id: string; name: string; error: string }[]
    not_held: Record<string, string[]>
  }
}

/** A collection the sync can bring, and the deployments in it. */
export interface SyncCollection {
  name: string
  deployments: string[]
}

/** What the sync reports as it goes: a message per step, and at the end the result. */
export type SyncEvent = { type: 'progress'; message: string } | ({ type: 'done' } & SyncResult)

/** What the upload page starts from when it is reached from a finished import: the research project and collection just imported into. */
export interface UploadTarget {
  researchProjectId: string
  collection: string
}

export interface SelectedResearchProject {
  pk: number
  name: string
  acronym?: string | null
}

export interface SelectedClassificationProject {
  pk: number
  name: string
}

export interface SelectedLocation {
  pk: number
  location_id: string
  name?: string | null
  timezone?: string | null
}

/** Where the deployment is going — "trapper": registered in (or found in) a
 * Trapper instance. "local": organized into a local collection folder
 * instead, no Trapper account involved at all. */
export type Destination = 'trapper' | 'local'

/** Whether the deployment already exists (in Trapper, or already organized
 * in the chosen local collection) and is being found, or is being created
 * for the first time — see DeploymentSelection. */
export type DeploymentMode = 'new' | 'existing'

/** An existing deployment found in Trapper — DeploymentFields' own shape,
 * plus the pk identifying it there. */
export interface ExistingDeployment extends DeploymentFields {
  pk: number
}

/** An existing deployment already organized in a local collection folder —
 * DeploymentFields' own shape, read back from its deployment.json. */
export type LocalDeployment = DeploymentFields

/** Whether a local collection folder already exists, and the name recorded
 * in it from an earlier run, if any. */
export interface CollectionCheck {
  exists: boolean
  name: string | null
}

/** Where a deployment's collection is kept locally by default:
 * <collections folder>/<research project id>/<R0003>. */
export interface CollectionPath extends CollectionCheck {
  path: string
  collection: string
}

/** How the deployment is identified for this run — see
 * core.schemas.requests.DeploymentSelection. research_project/
 * classification_project/location only apply to destination "trapper";
 * collection_dir/collection_name only to "local". An "existing" deployment's
 * own fields (including its location) come from wherever it was found (see
 * SessionSummary.deployment), so they aren't collected here. */
export interface DeploymentSelection {
  destination: Destination
  mode: DeploymentMode
  research_project?: SelectedResearchProject | null
  classification_project?: SelectedClassificationProject | null
  location?: SelectedLocation | null
  collection_dir?: string | null
  collection_name?: string | null
}

/** One "Import deployment" wizard run persisted on disk (see the backend's
 * session_store) — offered back on the resume screen until it finishes.
 * Phases, in the order the wizard asks for them: "scanned" (the source
 * folder), "selected" (destination/mode, and whatever else identifies the
 * deployment for them), "ready" (the deployment's own fields — everything
 * to import needs). */
export interface SessionSummary {
  task_id: string
  created_at: string
  updated_at?: string
  phase: 'scanned' | 'selected' | 'ready'
  task: Task
  /** Set once the source folder is chosen and scanned — the wizard's first
   * step, so every session has it. */
  source_dir: string
  scan: ScanResult
  /** Set once the research project/classification project/location are
   * chosen. */
  selection?: DeploymentSelection
  /** Set once the deployment's own fields are filled in — ready to import. */
  deployment?: DeploymentFields
}

export type LogLevel = 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG'

/** Which of the "Validate folder contents" checks the wizard shows — and so runs. */
export type ValidationSettings = Record<ImageCheck, boolean>

/** Which postvalidation checks the wizard shows, and the tolerance it starts from. */
export interface PostvalidationSettings extends Record<DeploymentCheck, boolean> {
  tolerance_hours: number
  sequence_gap_seconds: number
  min_revisions: number
  similarity_method: SimilarityMethod
  image_count_tolerance: number
  sequence_count_tolerance: number
  sequence_length_tolerance: number
}

/** The preprocessing a new run starts with, and the values it uses. */
export interface PreprocessingSettings {
  rename: boolean
  resize: boolean
  resize_width: number
  metadata: boolean
  owner: string
  publisher: string
  coverage: string
  license_url: string
  ignore_dst: boolean
  convert_to_utc: boolean
}

/** Field records: how the Epicollect download of a field trip and the fieldwork datasheet are read. Every time is UTC. */
export interface FieldlogSettings {
  time_source: 'created_at' | 'hour'
  keep_seconds: boolean
  datasheet_format: 'original' | 'standard' | 'both'
  camera_timezone: string
  /** The Epicollect column that gives each datasheet field, when it isn't the default one. */
  columns: Record<string, string>
  last_epicollect: string | null
  last_datasheet: string | null
  last_research_project: string | null
}

/** Copying the SD cards: how long the untouched copy of each card is kept, and how far the files may be from the photos counted. */
export interface IngestSettings {
  keep_cards: 'until_verified' | 'always' | 'until_imported'
  count_tolerance: number
}

/** One visit of the field records, as a deployment's start or end. */
export interface FieldVisit {
  session: string
  action: string
  when: string
  camera: number | null
  card: string | null
  photos: number | null
  trappers: string | null
  notes: string | null
  new: boolean
}

/** A deployment as the field records say it: closed once the visit that collects its card is recorded, open until then. */
export interface FieldDeployment {
  deployment_id: string
  collection: string
  site: string
  status: 'closed' | 'open'
  start: string
  end: string | null
  setup_by: string | null
  camera_id: string | null
  card: string | null
  photos_counted: number | null
  comments: string
  start_visit: FieldVisit
  end_visit: FieldVisit | null
}

/** A site visited in the field that isn't among the research project's locations yet. */
export interface NewSite {
  site: string
  session: string
  action: string
  latitude: number | null
  longitude: number | null
}

/** POST /api/fieldlog/analyze (and apply, with the files written). */
export interface FieldlogResult {
  datasheet: string
  sessions: [string, string]
  new_rows: number
  new_visits: (FieldVisit & { site: string })[]
  collections: string[]
  deployments: FieldDeployment[]
  new_sites: NewSite[]
  locations_known: boolean
  warnings: string[]
  notes: string[]
  camera_timezone: string
  files?: string[]
  collection_dirs?: string[]
}

/** A copy record's summary (card_copy.json). */
export interface CardCopy {
  card_label: string | null
  copied_at: string | null
  copied_by: string | null
  file_count: number
  total_bytes: number
  source: string
  first: string | null
  last: string | null
}

/** A deployment of a collection as far as its card goes: camera still out, card to copy, or copied. */
export interface CardDeployment {
  deployment_id: string
  site: string | null
  state: 'out' | 'to_copy' | 'copied'
  start: string | null
  end: string | null
  card: string | null
  camera_id: string | null
  photos_counted: number | null
  copy: CardCopy | null
}

export interface CardsStatus {
  collection: string
  cards_dir: string
  has_fieldwork_log: boolean
  deployments: CardDeployment[]
  unexpected: { deployment_id: string; copy: CardCopy | null }[]
  counts: { out: number; to_copy: number; copied: number }
}

/** A deployment a card may belong to, best first, with what fits and what doesn't. */
export interface CardCandidate extends CardDeployment {
  score: number
  fits: string[]
  problems: string[]
}

/** A card looked at before it is copied. */
export interface CardInspection {
  source: string
  file_count: number
  image_count: number
  video_count: number
  other_count: number
  total_bytes: number
  subfolders: number
  first: string | null
  last: string | null
  undated: number
  camera_models: string[]
  fingerprint: string
  already_copied: { deployment_id: string; collection: string; copied_at: string | null; card_label: string | null }[]
  candidates: CardCandidate[]
  collection: string
}

export type CardCopyEvent =
  | { type: 'copy'; index: number; total: number; name: string }
  | { type: 'done'; record: CardCopy & { deployment_id: string; path: string } }

/** A folder with images found under a tree that comes from elsewhere, with its collection and site guessed from the path. */
export interface TreeFolder {
  path: string
  relative: string
  image_count: number
  file_count: number
  collection: string | null
  site: string | null
  deployment_id: string | null
}

/** A run of a deployment's images whose time never goes backwards, set against the deployment's period. */
export interface TimeSegment {
  first_index: number
  last_index: number
  first: string
  last: string
  first_time: string
  last_time: string
  count: number
  inside: number
  state: 'ok' | 'outside' | 'partly'
  suggestion: { offset_seconds: number; why: string } | null
}

/** A fix made to a deployment's images (time_corrections.json). */
export interface TimeCorrection {
  at: string
  by: string | null
  action: 'shift' | 'remove' | 'restore'
  first?: string
  last?: string
  count?: number
  offset_seconds?: number
  names?: string[]
  reason?: string | null
}

/** A copied card's images in the camera's order, with when each says it was taken. */
export interface Timeline {
  deployment_id: string
  collection: string
  folder: string
  period: { start: string; end: string } | null
  tolerance_hours: number
  camera_timezone: string
  images: { name: string; time: string | null }[]
  segments: TimeSegment[]
  undated: string[]
  outside: number
  problems: string[]
  ok: boolean
  corrections: TimeCorrection[]
  has_originals: boolean
}

/** An Epicollect column the field records read: the datasheet field it gives, and its name unless the settings map it. */
export interface FieldlogColumn {
  field: string
  default: string
  label: string
}

/** The details kept for the closest earlier revision of a deployment's location. */
export interface PreviousDeployment {
  revision: number
  deployment_id: string
  deployment: DeploymentFields
}

/** GET /api/version/check — whether a newer release exists. `error` is set when that
 * couldn't be found out (offline...), distinct from "up to date". */
export interface UpdateCheck {
  current: string
  latest: string | null
  update_available: boolean
  release_url: string | null
  download_url: string | null
  error: string | null
}

/** One settings file the app can run on (see the backend's config.ConfigInfo). */
export interface ConfigInfo {
  id: string
  name: string
  path: string
  active: boolean
}

export interface AppSettings {
  /** workers: how many images are validated or preprocessed at once; cpu_count: the CPUs this machine has (read-only). */
  GENERAL: { log_level: LogLevel; workers: number; cpu_count: number; log_file: string; log_level_override: string | null }
  TRAPPER: { base_url: string | null; user_name: string | null; has_password: boolean; max_zip_mb: number }
  /** mapping: the ref of the Epicollect5 input that gives each field of a deployment (deployment field → ref). */
  EPICOLLECT5: { enabled: boolean; unmapped_to_comments: boolean; project_slug: string | null; client_id: string | null; has_secret: boolean; mapping: Record<string, string> }
  /** The folder where the app keeps the images — its collections go in a "collections" folder inside. */
  DATA: { dir: string }
  VALIDATION: ValidationSettings
  POSTVALIDATION: PostvalidationSettings
  PREPROCESSING: PreprocessingSettings
  FIELDLOG: FieldlogSettings
  INGEST: IngestSettings
}

/** What the settings page saves. A blank password keeps the saved one. */
export interface AppSettingsUpdate {
  GENERAL: { log_level: LogLevel; workers: number }
  TRAPPER: { base_url: string | null; user_name: string | null; user_password: string; max_zip_mb: number }
  EPICOLLECT5: { enabled: boolean; unmapped_to_comments: boolean; project_slug: string | null; client_id: string | null; client_secret: string; mapping: Record<string, string> }
  DATA: { dir: string | null }
  VALIDATION: ValidationSettings
  POSTVALIDATION: PostvalidationSettings
  PREPROCESSING: PreprocessingSettings
  FIELDLOG: FieldlogSettings
  INGEST: IngestSettings
}

/** A research project entered by hand — the fields of Trapper's own "Add
 * research project" form. Its choice fields hold Trapper's own option
 * numbers (see the option lists in ImportDeploymentPage). */
export interface ResearchProjectDraft {
  name: string
  acronym: string
  sampling_design: number
  sensor_method: number
  animal_types: number
  bait_use: number
  event_interval: number | null
  keywords: string
  abstract: string
  methods: string
  description: string
}

export const EMPTY_RESEARCH_PROJECT: ResearchProjectDraft = {
  name: '', acronym: '', sampling_design: 1, sensor_method: 1, animal_types: 1, bait_use: 1, event_interval: 0,
  keywords: '', abstract: '', methods: '', description: '',
}

/** A research project kept in the collections folder (research_project.json). */
export interface LocalResearchProject extends ResearchProjectDraft {
  /** Set when it was filled in from Trapper. */
  trapper_pk: number | null
}

/** A location of one of those (locations.json). */
export interface LocalLocation {
  location_id: string
  name: string | null
  /** IANA timezone, when known. It belongs to the location, never to a deployment. */
  timezone: string | null
  /** Whether its cameras ignore summer time — also the location's. Unknown for one kept before it was asked. */
  ignore_dst?: boolean | null
  /** Where it is — WGS84 decimal degrees; unknown for one added from Trapper. */
  latitude: number | null
  longitude: number | null
  coordinate_uncertainty: number | null
  trapper_pk: number | null
}

// ── Uploading a deployment to Trapper ───────────────────────────────────

/** A deployment kept in a collection, as the upload page lists it. */
export interface UploadDeploymentInfo {
  deployment_id: string
  location_id: string | null
  start_date: string | null
  end_date: string | null
  /** The images the preprocessing recorded — 0 for one imported before it existed. */
  images: number
  /** What those images take on disk. */
  bytes: number
  /** Only a preprocessed deployment can be uploaded. */
  preprocessed: boolean
  /** When it was last uploaded, if it was. */
  uploaded_at: string | null
}

export interface UploadCollection {
  name: string
  path: string
  deployments: UploadDeploymentInfo[]
}

/** What an upload goes through, in order. */
/** One thing an upload needs, checked without changing anything in Trapper. */
export interface AccessCheck {
  check: 'research_project' | 'collection' | 'classification_project' | 'location' | 'uploader'
  ok: boolean
  message: string
  /** For the collection: whether it is already in Trapper (else the upload creates it). */
  found?: boolean
}

export type UploadStep = 'check' | 'connect' | 'classification' | 'uploader' | 'location' | 'deployment' | 'package' | 'csv' | 'upload' | 'process' | 'wait'

/** What an upload run does: send the deployment to Trapper; say what that would do, changing nothing
 * (a dry run); or only write the files (the zips, the yamls and the collection's deployments csv). */
export type UploadMode = 'upload' | 'dry_run' | 'generate'

export type UploadEvent =
  /** url: the page of what the step made or found, in Trapper's own web interface (the location, the deployment, the collection). */
  | { type: 'step'; step: UploadStep; status: 'running' | 'done' | 'skipped'; message: string; url?: string }
  | { type: 'upload_progress'; file: string; bytes: number; total: number }
  /** The images going into the zips, a few at a time. */
  | { type: 'pack_progress'; index: number; total: number }
  /** The images are packed: how many went in, in how many packages, and what the packages weigh — what is to be sent. */
  | { type: 'package_ready'; images: number; parts: number; bytes: number }
  | {
    type: 'done'; mode: UploadMode; collection: string; deployment_id: string; parts: number
    /** upload */
    location_created?: boolean; deployment_created?: boolean; bytes?: number
    /** dry run */
    would_create_location?: boolean; would_create_deployment?: boolean
    /** generate */
    output_dir?: string; files?: string[]; images?: number
    /** Each written file's size in bytes, by name. */
    file_sizes?: Record<string, number>
  }

// ── Reports ─────────────────────────────────────────────────────────────

/** What a report was made of: a validation, a postvalidation or a preprocessing. */
export type ReportKind = 'validation' | 'postvalidation' | 'preprocessing' | 'repair'

/** One check of one image — or of the whole deployment, "(deployment)". */
export interface ReportEntry {
  identifier: string
  check: string
  status: 'ok' | 'failed'
  message: string
  /** A failed image's problem in a few words, for a badge. */
  tag?: string
  /** A failed image's capture date, as its EXIF says. */
  taken?: string
}

export interface ReportCheck {
  label: string
  scope: 'images' | 'deployment'
  ok: number
  failed: number
}

/** What a report says of itself — the list of reports. */
export interface ReportSummary {
  id: string
  kind: ReportKind
  title: string
  created_at: string
  source_dir: string | null
  deployment_id: string | null
  checked: number
  totals: { entries: number; ok: number; failed: number; images_with_issues?: number }
}

export interface Report extends ReportSummary {
  parameters: Record<string, unknown>
  checks: Record<string, ReportCheck>
  entries: ReportEntry[]
}

// ── Repair ──────────────────────────────────────────────────────────────

/** A deployment folder of a local collection, as the repair lists it — whatever state it is in. */
export interface RepairDeployment {
  deployment_id: string
  images: number
  /** Which of the metadata files (deployment.json, images.json, preprocessing.json, seal.json) are there. */
  files: Record<string, boolean>
  synced: boolean
}

export interface RepairCollection { name: string; path: string; deployments: RepairDeployment[] }

/** The state of a deployment. Valid is what its seal.json says; anything else is not valid. */
export interface RepairState {
  deployment_id: string
  status: 'valid' | 'broken' | 'unsealed' | 'synced'
  files: Record<string, 'ok' | 'missing' | 'unreadable'>
  images: number
  /** What the collection's timestamp log has for it: "row", "no row", "no log" — or what is wrong with the log. */
  log: string
  problems: string[]
}

export type RepairStep = 'inspect' | 'dates' | 'deployment' | 'preprocessing' | 'images' | 'seal'

export type RepairEvent =
  | { type: 'step'; step: RepairStep; status: 'running' | 'done' | 'skipped'; message: string }
  | { type: 'done'; deployment_id: string; images: number; written: string[]; problems: number; status: RepairState['status']; report_id: string | null }

/** One input of the Epicollect5 project's form — what can be mapped onto a field of a deployment. */
export interface EpicollectInput {
  ref: string
  label: string
  /** Epicollect5's own: text, integer, decimal, date, time, location, dropdown, radio, checkbox… */
  type: string
  form: string
  group: string | null
  branch: string | null
  options: string[]
}

export interface EpicollectForm {
  project: { name: string; slug: string }
  inputs: EpicollectInput[]
}
