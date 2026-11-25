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
  /** The ids of the rows of the log that no subfolder matches, as written in it. */
  unmatched?: string[]
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

/** An image of the folder that was imported before into the research project, and where. */
export interface ProjectDuplicate {
  file: string
  deployment_id: string
  collection: string
  original: string | null
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
  /** The images already imported into another deployment of the research project — only when the research project was given. */
  duplicates_in_project?: ProjectDuplicate[]
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
  | 'image_count' | 'sequence_count' | 'sequence_length' | 'sd_card' | 'photo_count'

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

/** What the collection's FileTimestampLog and FieldworkLog say of a deployment — each null where it has no row of it. */
export interface LogEntry {
  collection: string
  /** The camera's wall-clock time, ISO, from the FileTimestampLog. */
  timestamps: { start: string; end: string } | null
  /** The FieldworkLog: its dates in UTC and the details it fills in. */
  fieldwork: { start: string | null; end: string | null; details: Partial<DeploymentFields> } | null
}

/** What the visit a deployment is of says, for the checks against it: the card it left, and the photos counted when it was collected. */
export interface VisitCheckInfo {
  left_session: string | null
  left_sd: string | null
  collected_session: string | null
  counted_photos: number | null
  /** The card the images are said to come from. */
  sd_card: string | null
}

/** What the visits a deployment is of say of it, for the collection's FieldworkLog: the one that left the camera and the one that collected its card. */
export interface FieldworkVisits {
  left_session: string | null
  left_action: string | null
  left_sd: string | null
  collected_session: string | null
  collected_action: string | null
  counted_photos: number | null
  /** The card the images are said to come from. */
  sd_card: string | null
}

export interface DeploymentCheckResult {
  checked_count: number
  deployment_id?: NameCheck
  collection_prefix?: NameCheck
  collection_name?: NameCheck
  location?: NameCheck
  /** Against the visit the deployment is of: the card, and the photos counted on it. */
  sd_card?: NameCheck
  photo_count?: NameCheck
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

/** What copying a memory card to a temporary folder says: how many files there are, how many are copied, and where the copy is when it is done. */
export type CardCopyEvent =
  | { type: 'start'; files: number; bytes: number }
  | { type: 'progress'; copied: number; files: number; bytes_copied: number; bytes: number }
  | { type: 'done'; path: string; files: number; bytes: number }
  | { type: 'error'; detail: string }

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
export type Task = 'deployment' | 'upload' | 'session' | 'upload-session' | 'utils' | 'sync' | 'repair' | 'visits'

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
  /** The deployments of the collection to have ticked, when it comes from the ones ticked in the deployments dashboard (instead of all that are left to send). */
  deployments?: string[]
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
  GENERAL: { log_level: LogLevel; workers: number; cpu_count: number; log_file: string; log_level_override: string | null; default_research_project?: string | null; show_welcome?: boolean }
  TRAPPER: { enabled: boolean; base_url: string | null; user_name: string | null; has_password: boolean; max_zip_mb: number }
  /** What an upload to Agouti needs — kept; nothing is uploaded to Agouti yet. */
  AGOUTI: { enabled: boolean; base_url: string | null; has_api_key: boolean; project_id: string | null }
  /** Whether a CSV of any shape can be read for visits. */
  EPICOLLECTCSV: { enabled: boolean }
  /** mapping: the ref of the Epicollect5 input that gives each field of a deployment (deployment field → ref). */
  EPICOLLECT5: { enabled: boolean; unmapped_to_comments: boolean; project_slug: string | null; client_id: string | null; has_secret: boolean; mapping: Record<string, string> }
  /** The folder where the app keeps what it makes — its collections, reports and packages go in folders inside it, unless each has one of its own. */
  DATA: {
    dir: string
    collections_dir: string | null; reports_dir: string | null; packages_dir: string | null
    /** What each is when none of its own is set. */
    default_collections_dir: string; default_reports_dir: string; default_packages_dir: string
  }
  VALIDATION: ValidationSettings
  POSTVALIDATION: PostvalidationSettings
  PREPROCESSING: PreprocessingSettings
  /** trappers: the people who go to the field — suggested as who went when a visit is registered. */
  FIELDWORK: FieldworkSettings
  /** How the visits of a field trip are read from the file of the field app, and what is written of them. */
  FIELDLOG: FieldlogSettings
}

/** What the settings page saves. A blank password keeps the saved one. */
export interface AppSettingsUpdate {
  GENERAL: { log_level: LogLevel; workers: number; default_research_project: string | null; show_welcome: boolean }
  TRAPPER: { enabled: boolean; base_url: string | null; user_name: string | null; user_password: string; max_zip_mb: number }
  AGOUTI: { enabled: boolean; base_url: string | null; api_key: string; project_id: string | null }
  EPICOLLECTCSV: { enabled: boolean }
  EPICOLLECT5: { enabled: boolean; unmapped_to_comments: boolean; project_slug: string | null; client_id: string | null; client_secret: string; mapping: Record<string, string> }
  DATA: { dir: string | null; collections_dir: string | null; reports_dir: string | null; packages_dir: string | null }
  VALIDATION: ValidationSettings
  POSTVALIDATION: PostvalidationSettings
  PREPROCESSING: PreprocessingSettings
  FIELDWORK: FieldworkSettings
  FIELDLOG: FieldlogSettings
}

/** How the visits of a field trip are read from the file of the field app (an Epicollect download) and what is made of them. */
export interface FieldlogSettings {
  /** When a visit happened: when its entry was created (UTC), or the date and the hour typed in the form. */
  time_source: 'created_at' | 'hour'
  /** Keep the seconds of the start and the end of the deployments written in the logs; off, they are cut to the minute. */
  keep_seconds: boolean
}

/** The people, the SD cards and the cameras of the field work, kept in the settings. */
/** The roles of a contributor in Camtrap DP. */
export type TrapperRoleName = 'contact' | 'principalInvestigator' | 'rightsHolder' | 'publisher' | 'contributor'

/** What a trapper is in a research project. */
export interface TrapperRole {
  /** Its internal id — a UUID the app generates when it is kept: never typed, never changed; what the other records point to it by. Send back the one you were given. */
  id?: string | null
  research_project: string
  trapper: string
  role: TrapperRoleName
  /** When it was kept here, last changed and — if it was removed — deleted: ISO 8601, UTC, with a Z, written by the app, never typed. A removed one is kept, but not shown. */
  created_at?: string | null
  updated_at?: string | null
  deleted_at?: string | null
}

export interface FieldworkSettings {
  trappers: Trapper[]
  roles?: TrapperRole[]
  sd_cards: SdCard[]
  cameras: Camera[]
}

/** Whether a camera or an SD card can still be used; only an active one is offered for a visit. */
export type CameraStatus = 'planned' | 'ready' | 'active' | 'archived'
export type SdCardStatus = 'planned' | 'ready' | 'active' | 'archived'
/** Why a camera or an SD card was archived. */
/** Where a visit is in its life. */
export type VisitState = 'planned' | 'deployed' | 'collected' | 'stolen' | 'not_visited' | 'no_camera' | 'unknown'
export type ArchiveReason = 'lost' | 'stolen' | 'broken' | 'other'
export type TrapperStatus = 'active' | 'inactive' | 'archived'
export type LocationStatus = 'planned' | 'pending' | 'ready' | 'active' | 'archived'
export type ResearchProjectStatus = 'planned' | 'active' | 'finished' | 'archived'

/** One of the SD cards: what it is called (its number, or the label on it), who makes it, what it holds and the day it was put into production. */
export interface SdCard {
  /** Its internal id — a UUID the app generates when it is kept: never typed, never changed; what the other records point to it by. Send back the one you were given. */
  id?: string | null
  label: string
  brand: string | null
  capacity: string | null
  /** YYYY-MM-DD */
  in_service: string | null
  /** The acronym of the research project it belongs to: every one belongs to one (none only while an older one waits to be assigned). */
  research_project: string | null
  status?: SdCardStatus
  archive_reason?: ArchiveReason | null
  /** YYYY-MM-DD — the day it stopped being active. */
  status_date?: string | null
  status_note?: string | null
  /** When it was kept here and when it was last changed — ISO 8601, UTC, with a Z: written by the app, never typed (what is sent for them is not taken). Absent on one kept before they existed. */
  created_at?: string | null
  updated_at?: string | null
  deleted_at?: string | null
}

export type CameraConnectivity = 'none' | '4g' | '5g'
export type CameraPowerSource = 'cells' | 'battery'

/** One of the camera traps, named as Camtrap DP names it. */
export interface Camera {
  /** Its internal id — a UUID the app generates when it is kept: never typed, never changed; what the other records point to it by. Send back the one you were given. */
  id?: string | null
  /** What it is called in the field: the one thing it is asked for. */
  label: string
  /** Its serial number, when it is known. */
  camera_id: string | null
  camera_model: string | null
  /** The mobile network it sends its photos through: none when it does not. */
  connectivity?: CameraConnectivity | null
  /** What it runs on: cells (AA, AAA… the ones that are changed) or a battery. */
  power_source?: CameraPowerSource | null
  /** Whether the battery can be taken out — only a battery says: cells are always taken out to be changed. */
  battery_removable?: 'yes' | 'no' | null
  /** YYYY-MM-DD — the day it was put into production. */
  in_service: string | null
  /** The acronym of the research project it belongs to: every one belongs to one (none only while an older one waits to be assigned). */
  research_project: string | null
  status?: CameraStatus
  archive_reason?: ArchiveReason | null
  /** YYYY-MM-DD — the day it stopped being active. */
  status_date?: string | null
  status_note?: string | null
  /** When it was kept here and when it was last changed — ISO 8601, UTC, with a Z: written by the app, never typed (what is sent for them is not taken). Absent on one kept before they existed. */
  created_at?: string | null
  updated_at?: string | null
  deleted_at?: string | null
}

/** One of the people who go to the field, as wildintel-publisher keeps an author. */
export interface Trapper {
  /** Its internal id — a UUID the app generates when it is kept: never typed, never changed; what the other records point to it by. Send back the one you were given. */
  id?: string | null
  /** What the trapper is called in the app: required, and unique among the trappers (whatever its case), as the label of an SD card is. */
  username: string
  /** The full name — how a visit says who went. */
  name: string
  affiliation: string | null
  /** An email address — optional. */
  email?: string | null
  status?: TrapperStatus
  /** Set when the trapper was taken from Trapper: it can only be seen here. */
  trapper_pk?: number | null
  /** When it was kept here, last changed and — if it was removed — deleted: ISO 8601, UTC, with a Z, written by the app, never typed. A removed one is kept, but not shown. */
  created_at?: string | null
  updated_at?: string | null
  deleted_at?: string | null
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
  status?: ResearchProjectStatus
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
/** A change of the status of a location, a camera or an SD card, and why: the line of its history. */
export interface StatusChange {
  kind: 'locations' | 'cameras' | 'sd_cards'
  name: string
  /** What it was: none when it was just made. */
  before: string | null
  after: string
  /** The instant it was written, and the day it is of (the day of the visit that did it). */
  at: string
  day: string
  reason: string
  /** Worked out from the visits kept, not written as it happened (its `before` is `unknown` when the status before the first visit is not known). */
  reconstructed?: boolean
}

export interface LocalLocation {
  /** Its internal id — a UUID the app generates when it is kept: never typed, never changed; what the other records point to it by. */
  id?: string | null
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
  /** YYYY-MM-DD: the day it was put into production. */
  in_service?: string | null
  trapper_pk: number | null
  status?: LocationStatus
  /** YYYY-MM-DD */
  status_date?: string | null
  status_note?: string | null
}

/** A visit to a camera trap kept in a research project's visits.json (see the backend's VisitRecord): the visit's own fields, and
 * what the visit says of the deployment — named as DeploymentFields names them. */
export interface StoredVisit extends Omit<DeploymentFields, 'deployment_id' | 'location_id' | 'location_name' | 'coordinate_uncertainty' | 'start_date' | 'end_date' | 'latitude' | 'longitude'> {
  location_id: string
  session: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM:SS */
  time: string
  /** The instant of the visit: ISO 8601, UTC, with a Z (2024-09-04T11:10:00Z) — what is kept; the day and the time above are the wall clock of its location. */
  when?: string
  /** Where the visit is in its life — kept by the backend when the visit is added, and changed when a later visit collects its card. */
  state?: VisitState | null
  /** What was done at the visit — one or more. */
  actions: ('SiteStart' | 'Installation' | 'Revision' | 'Desinstallation' | 'Stolen' | 'Archive')[]
  /** Who went on the visit. */
  trappers: string | null
  /** The status of the camera when the visit found it (Working, Not revised…). */
  camera_status: string | null
  /** How the batteries were: OK, or NoBatteries when there were none. */
  battery_status: 'OK' | 'NoBatteries' | null
  /** How the SD card was: OK, or CardFull. */
  card_status: 'OK' | 'CardFull' | null
  num_photos: number | null
  sd: string | null
  date_time_ok: string | null
  /** Whether the camera was calibrated at the visit — only the form of the field flow asks it. */
  calibration?: boolean | null
  latitude: number | null
  longitude: number | null
  /** The deployment this visit closed, once it is imported. */
  deployment_id?: string | null
  /** Its internal id — a UUID the app generates when it is kept: never typed, never changed; what the other records point to it by. Send back the one you were given. */
  id?: string | null
  /** When it was kept here and when it was last changed — ISO 8601, UTC, with a Z: written by the app, never typed (what is sent for them is not taken). Absent on one kept before they existed. */
  created_at?: string | null
  updated_at?: string | null
}

/** A visit that left a camera, and the next one at the same location, which collected its card: the visit is closed, and the deployment is of it. */
export interface ClosedVisit {
  visit: StoredVisit
  end: StoredVisit
  /** What the two visits say of the deployment, mixed as the FieldworkLog mixes them (Setup: … | Retrieval: …): what its form starts from. */
  details?: Partial<DeploymentFields>
}

/** Where Import deployment starts from when it is reached from a visit that was just closed: the research project, and the visit whose card was
 * collected — the deployment is of it. */
export interface ClosedVisitTarget {
  researchProjectId: string
  visit: StoredVisit
}

/** How a CSV file of visits is read: as an Epicollect download, or with the column of each field said. */
export type VisitsCsvFormat = 'mapped' | 'epicollect-api' | 'epicollect-csv'

/** The columns of a CSV file, a few of its rows, the fields of a visit it can give (those a visit needs marked) and the column that most
 * likely gives each. */
export interface VisitsCsvColumns {
  columns: string[]
  sample: string[][]
  mapping: Record<string, string>
  /** What the file is: the download of the WildINTEL form of Epicollect5, or a CSV of any other shape. */
  kind: 'form' | 'other'
  /** When it is the form: the header of the column that answers each question of a visit. */
  form_columns?: Record<string, string>
  /** Why it cannot be read as the form, when it cannot. */
  form_error?: string | null
  fields: {
    field: string; label: string; required: boolean
    /** The entity this field is of, when it is not a visit's: only asked for when that entity is created (locations, cameras, sd_cards). */
    entity?: CsvEntity | null
    /** The entities that make this field required when they are created. */
    required_with?: CsvEntity[]
  }[]
}

/** What the import of visits can create when a visit names one that does not exist. */
export type CsvEntity = 'locations' | 'cameras' | 'sd_cards' | 'trappers'
export type CsvCreate = Record<CsvEntity, boolean>
/** What is asked of the import besides the file: the entities to create, the value of the fields the file has no column for, and whether a row with no coordinates takes those of its location (it does, unless it is turned off). */
/** The day a revision that is closed is closed on: so long after its last visit, or before the first visit of the revision after it. */
export interface CloseAfter { amount: number; unit: 'days' | 'weeks' | 'months'; anchor: 'after_last' | 'before_next' }
export interface ImportCsvOptions { create?: CsvCreate; defaults?: Record<string, string>; close_revisions?: boolean; close_after?: CloseAfter; coordinates_from_location?: boolean; photos_not_counted?: boolean }

/** What reading a CSV file of visits gave: the visits that can be kept, the rows that cannot (numbered as in the file, the header being 1),
 * those already kept, and how many were kept when asked to. */
export interface VisitsCsvResult {
  visits: StoredVisit[]
  problems: { row: number; message: string; }[]
  skipped: number
  /** What the visits to add create: the locations, cameras and SD cards that do not exist and the file was asked to create. */
  create?: Record<CsvEntity, Record<string, unknown>[]>   // `trappers` is missing from an answer of an older server
  /** What became of each row of the file, numbered as in it: kept to add (ok), a problem, already kept, held for a site that is not a location, or ignored. */
  rows?: { row: number; site: string; session?: string; date?: string; time?: string; actions?: string; result: 'ok' | 'problem' | 'already_kept' | 'new_site' | 'ignored'; label?: string; message: string; warnings?: string[]; data?: Record<string, string> }[]
  /** What is worth knowing of the visits, without being wrong (the sites of the trip before not visited on this one…). */
  notes?: string[]
  /** The report of the import, a text file beside the visits of the research project — when they were kept. */
  report?: string | null
  /** The folders and logs made of the collections the visits kept change — when they were kept. */
  field_logs?: FieldLogsResult | null
  saved: number | null
  /** The sites of the file that are not locations of the research project, with what tells a new site from a misnamed one; their visits are held. */
  new_sites: NewSite[]
  /** What is odd in the visits — their camera or card, what their actions ask, two Revisions in a session… — said, not refused. */
  warnings: string[]
  /** The warnings that are not about a row of the file — told in the rows otherwise — */
  loose_warnings?: string[]
  /** The locations of the revision before the file's own that were still planned and are marked as not visited — when the file was asked to close it. */
  closed?: { location_id: string; session: string }[]
}

/** A visit as the visit book shows it: with the deployment it started — closed once a later visit collected its card, open while the camera is still out — and neither when it left no camera. */
export interface BookVisit extends StoredVisit {
  /** The timezone of the location of the visit: what its day and time are told in. */
  timezone?: string | null
  deployment: string | null
  deployment_status: 'closed' | 'open' | null
  /** The deployment this visit gave was closed with no images: the camera was stolen. */
  deployment_no_images?: 'stolen' | null
  /** When the deployment this visit gave was uploaded to Trapper from here (null when it was not), and whether it is on Trapper — uploaded from here or synced from there. */
  uploaded_at?: string | null
  on_trapper?: boolean
  /** A row for a location that has no visit in a session the visits have: the visit was not made — it has no day, no time and no actions. */
  not_done: boolean
  /** The visit could not be made (its status says it was not revised): nothing was collected. */
  not_visited: boolean
  /** Nothing is known of the visit: a revision before the first one kept to the site. It has no day, no time and no actions, and only a known visit takes its place. */
  unknown?: boolean
  /** The visit starts or closes a deployment that is imported: it cannot be edited. */
  locked?: boolean
  /** Where the visit is in its life, as it is kept: kept when the visit is added, and changed when a later visit collects its card. A planned row is not a visit. */
  state?: VisitState | null
}

/** A deployment the visits of a research project say: closed (a visit left the camera and a later one collected its card) or still open (the camera is out). */
export interface FieldDeployment {
  deployment_id: string
  collection: string
  site: string
  status: 'closed' | 'open'
  /** ISO 8601, UTC, with a Z. */
  start: string
  end: string | null
  setup_by: string | null
  camera_id: string | null
  card: string | null
  photos_counted: number | null
  /** The card was full when it was collected, so its photos were not counted: it is told instead of their number. */
  card_full?: boolean
  start_session: string | null
  end_session: string | null
  /** The day and the time of the start and the end on the wall clock of the location (2026-09-14T08:30:00), and its timezone — what the period is told in. */
  start_local?: string | null
  end_local?: string | null
  timezone?: string | null
  /** Whether the deployment was created and its images imported, and whether it is on Trapper (uploaded from here, or synced from there). */
  images_stored?: boolean
  /** Why there are no images, and never will be: the camera was stolen, so the visit that found it closed the deployment with nothing collected. */
  no_images?: 'stolen' | null
  uploaded_at?: string | null
  on_trapper?: boolean
  /** What was done with it: one upload for each platform it was sent to. */
  uploads?: UploadEntry[]
  /** The upload to each uploader in use — its own state, apart from the deployment's: planned, done or failed. None for a deployment that will not be made. */
  upload_states?: DeploymentUploadState[]
}

/** Where the upload of a deployment to an uploader is: planned from the start, then done (sent from here, or synced from there) or failed — a failed one is tried again. */
export type UploadStateName = 'planned' | 'done' | 'failed'
export interface DeploymentUploadState {
  destination: string
  state: UploadStateName
  kind: 'uploaded' | 'synced' | null
  uploaded_at: string | null
  note: string | null
}

/** One upload of a deployment: the platform it was sent to (`destination`), when, and what it did there. A deployment that came from the platform (`synced`) was not sent from here, so it has no day. */
export interface UploadEntry {
  destination: string
  kind: 'uploaded' | 'synced'
  uploaded_at: string | null
  parts: number | null
  location_created: boolean | null
  deployment_created: boolean | null
  /** The page of what was sent, on the platform — the platform's own address when the exact page was not kept. */
  url?: string | null
}

/** A deployment that is created — its images are stored here — with its uploads: one for each platform it was sent to, none when it was not sent anywhere. */
export interface UploadedDeployment {
  deployment_id: string
  collection: string
  site: string
  start: string
  end: string | null
  start_session?: string | null
  uploads: UploadEntry[]
}

/** What writing the logs of the collections did: for each, how many deployments are closed and how many open, and the files written. */
export interface FieldLogsResult {
  collections: { collection: string; closed: number; open: number; files: string[] }[]
  warnings: string[]
}

/** A site of a file that is not a location of the research project yet: new, or misnamed in the field. */
export interface NewSite {
  site: string
  session: string | null
  actions: string[]
  date: string
  time: string
  /** The coordinates of its first visit, when the file has them. */
  latitude: number | null
  longitude: number | null
  visits: number
  /** The location of the project nearest to those coordinates, and how far it is. */
  nearest: { location_id: string; distance_m: number } | null
  /** The locations whose id is one character apart from the site's. */
  similar: string[]
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
    /** upload: whether the package files were deleted once up; when they were kept, output_dir, files and file_sizes say where and which. */
    files_deleted?: boolean
    /** dry run */
    would_create_location?: boolean; would_create_deployment?: boolean
    /** generate */
    output_dir?: string; files?: string[]; images?: number
    /** Each written file's size in bytes, by name. */
    file_sizes?: Record<string, number>
  }

// ── Reports ─────────────────────────────────────────────────────────────

/** What a report was made of: a validation, a postvalidation or a preprocessing. */
export type ReportKind = 'validation' | 'postvalidation' | 'preprocessing' | 'repair' | 'upload' | 'visits'

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

/** What a research project has that can go in a backup: its counts, and its deployments by collection, with their files and bytes — those that are images apart. */
export interface BackupProjectInfo {
  research_project_id: string
  locations: number
  cameras: number
  sd_cards: number
  visits: number
  collections: { name: string; deployments: { id: string; files: number; bytes: number; images: number; image_bytes: number }[] }[]
}

/** What a backup says it holds, as the zip's manifest. */
export interface BackupManifest {
  format: string
  version: number
  app_version: string
  created_at: string
  scope: { settings: boolean; research_project: string | null; project_files: boolean; visits: boolean; images: boolean; deployments: { id: string; collection: string; files: number; images: boolean }[] }
  counts: { locations?: number; cameras?: number; sd_cards?: number; visits?: number }
  secrets_included: boolean
}

/** A backup read: its manifest, and what of it is already here. */
export interface BackupRead {
  manifest: BackupManifest
  here: { project: boolean; deployments: Record<string, boolean>; visits: { in_backup: number; already: number } }
  has_images: Record<string, boolean>
}

export interface BackupCreateRequest { dest_dir?: string; settings: boolean; research_project_id: string | null; project_files: boolean; visits: boolean; deployments: string[]; images: boolean }
export interface BackupRestoreRequest { path: string; settings: boolean; project_files: boolean; visits: boolean; deployments: string[]; images: boolean; replace: boolean }

/** What a backup or a restoration says as it goes. */
export type BackupEvent =
  | { type: 'step'; message: string }
  | { type: 'file'; index: number; total: number; name: string }
  /** `download` is the file the browser asks for when the backup was made to be downloaded (no folder was given). */
  | { type: 'done'; path: string; bytes: number; files: number; manifest: BackupManifest; download?: string }

export interface RestoreSummary {
  settings: boolean
  project_files: { research_project?: 'written' | 'kept'; locations?: { added: number; replaced: number; kept: number }; cameras?: { added: number; replaced: number; kept: number }; sd_cards?: { added: number; replaced: number; kept: number }; status_history?: { added: number; replaced: number; kept: number } }
  visits: { added?: number; replaced?: number; kept?: number }
  deployments: { restored: string[]; skipped: string[] }
  files: number
}

export type RestoreEvent =
  | { type: 'step'; message: string }
  | { type: 'file'; index: number; total: number; name: string }
  | { type: 'done'; summary: RestoreSummary; manifest: BackupManifest }

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

// Fixing the dates and times of a deployment's images (see the backend's timefix_service).
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
export interface Timeline {
  folder: string
  period: { start: string; end: string } | null
  tolerance_hours: number
  images: { name: string; time: string | null }[]
  segments: TimeSegment[]
  undated: string[]
  outside: number
  problems: string[]
  ok: boolean
  corrections: TimeCorrection[]
}

/** What says which images and which period when their dates are fixed: a folder and, optionally, the visit that left the camera. */
export interface TimeFixTarget {
  folder: string
  research_project_id?: string
  location_id?: string
  date?: string
  time?: string
}

/** What a deployment's images look like — the statistics of a revision. Times are seconds since the epoch. */
export interface StatisticsMetrics {
  image_count: number
  sequence_count: number
  /** The mean number of images per sequence. */
  sequence_length: number
  /** The days from the first image to the last, as a fraction; null with fewer than two dated images. */
  days: number | null
  images_per_day: number | null
  /** The images of each calendar day, the days with none included. Only the deployment of a row has it, not the revisions of its location. */
  daily?: DailyImages[]
  /** The sequences that began each calendar day, and how many sequences have each number of images (in bins: 1, 2… 6–10, 11–20… 101+). Also only of the deployment of a row. */
  sequences_daily?: DailySequences[]
  /** How many sequences have each number of images: [[images, sequences]…], by images. */
  sequence_lengths?: [number, number][]
  /** The longest sequence of the deployment (the first, if several tie). */
  longest_sequence?: LongestSequence | null
  sequence_median: number
  sequence_max: number
  first_image: number | null
  last_image: number | null
}

/** The images taken on one day: its date (YYYY-MM-DD) and how many. */
export interface DailyImages { date: string; images: number }

export interface DailySequences { date: string; sequences: number }

/** A sequence: its images, when it began and ended on the camera's wall clock (2023-11-06T15:00:46) and how long it lasted. */
export interface LongestSequence { images: number; start: string; end: string; seconds: number }

export type StatisticsCheckName = 'image_count' | 'sequence_count' | 'sequence_length'

/** One metric of a deployment against the previous revisions of its location: skipped when there are too few to judge. */
export interface StatisticsCheck {
  ok: boolean
  skipped: boolean
  value: number
  previous: number
  reference: number | null
  lower: number | null
  upper: number | null
  message: string
}

/** A revision of a location, with its metrics. */
export interface StatisticsRevision { revision: number; deployment_id: string; metrics: StatisticsMetrics }

export interface StatisticsRow {
  deployment_id: string
  location: string
  revision: number
  metrics: StatisticsMetrics
  checks: Record<StatisticsCheckName, StatisticsCheck>
  status: 'ok' | 'review' | 'insufficient_history'
  /** Every revision of the location up to this one, this one last. */
  revisions: StatisticsRevision[]
}

/** What planning the next revision says: its name, the locations that have a planned visit in it, and — when the revision before is not finished — which locations are still to be visited in it. */
export interface RevisionCreated {
  session: string
  planned: string[]
  previous: { session: string; missing: string[] } | null
}

/** What Import deployments and the deployment pages show, and what the uploads show: the page the menu opened. */
export type DeploymentsView = 'import' | 'many' | 'status' | 'statistics'
export type UploadsView = 'upload' | 'status'
