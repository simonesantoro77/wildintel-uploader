import type { EpicollectEntry } from './epicollectImport'
import type {
  AppSettings, AppSettingsUpdate, ConfigInfo, UpdateCheck, PreviousDeployment, ClassificationProject, PreprocessingOptions, CollectionCheck, CollectionPath, LocalLocation, LocalResearchProject, StoredVisit, DeploymentCheck, DeploymentCheckResult, DeploymentFields,
  DeploymentSelection, ExistingDeployment, ImageCheck, ImportEvent, Location, LocalDeployment, ResearchProject,
  AccessCheck, CardCopyEvent, GuessedDetails, ScanResult, SessionSummary, StatisticsParams, SyncCollection, SyncEvent, TimestampLogResult, LogEntry, SessionScan, UploadCollection, UploadEvent, UploadMode, ValidationResult,
  ClosedVisit, VisitCheckInfo, VisitsCsvColumns, VisitsCsvFormat, VisitsCsvResult, ImportCsvOptions, Report, ReportSummary, RepairCollection, RepairEvent, Timeline, TimeFixTarget, RepairState, RevisionCreated, StatisticsRow, EpicollectForm, FieldworkVisits, FieldLogsResult, FieldDeployment, BookVisit, BackupProjectInfo, BackupRead, BackupCreateRequest, BackupRestoreRequest, BackupEvent, RestoreEvent } from './types'

/** A failed response's message — FastAPI's `detail` when there is one. */
async function errorMessage(r: Response): Promise<string> {
  const text = await r.text().catch(() => r.statusText)
  let message = text
  try { message = JSON.parse(text).detail ?? text } catch { /* not JSON */ }
  return typeof message === 'string' ? message : JSON.stringify(message)
}

async function req<T>(url: string, options?: RequestInit): Promise<T> {
  const r = await fetch(url, options)
  if (!r.ok) throw new Error(await errorMessage(r))
  return r.json() as Promise<T>
}

function post<T>(url: string, body: unknown): Promise<T> {
  return req<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** POSTs body and reads the response as NDJSON: every event goes to
 * onEvent; resolves on {"type": "done"}, rejects on {"type": "error"} — or
 * with endedEarly if the stream ends before either. */
async function streamNdjson<E extends { type: string }>(
  url: string, body: unknown, onEvent: (event: E) => void, endedEarly: string, signal?: AbortSignal,
): Promise<void> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!r.ok || !r.body) throw new Error(await errorMessage(r))
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line) as E
      if (event.type === 'error') throw new Error((event as unknown as { detail: string }).detail)
      onEvent(event)
      if (event.type === 'done') return
    }
  }
  throw new Error(endedEarly)
}

/** Blank fields fall back to what's saved in settings.toml (the password is
 * never sent back to the frontend — see services.trapper_service). */
export interface TrapperCredentials {
  url?: string
  username?: string
  password?: string
}

export const api = {
  checkHealth: async (): Promise<boolean> => {
    try {
      const r = await fetch('/api/health')
      return r.ok
    } catch {
      return false
    }
  },

  checkVersion: () => req<{ current: string }>('/api/version'),

  // Asks GitHub whether a newer release exists (only when the user presses the button).
  checkForUpdate: () => req<UpdateCheck>('/api/version/check'),

  trapperGetConfig: () =>
    req<{ base_url: string | null; user_name: string | null; has_password: boolean }>('/api/trapper/config'),

  trapperTestConnection: (creds: TrapperCredentials) =>
    post<{ ok: boolean; research_projects_count: number }>('/api/trapper/test-connection', creds),

  trapperResearchProjects: (creds: TrapperCredentials) =>
    post<{ results: ResearchProject[] }>('/api/trapper/research-projects', creds),

  trapperClassificationProjects: (creds: TrapperCredentials, researchProjectPk: number) =>
    post<{ results: ClassificationProject[] }>('/api/trapper/classification-projects', {
      ...creds, research_project_pk: researchProjectPk,
    }),

  trapperLocations: (creds: TrapperCredentials, researchProjectPk: number) =>
    post<{ results: Location[] }>('/api/trapper/locations', {
      ...creds, research_project_pk: researchProjectPk,
    }),

  trapperDeployments: (creds: TrapperCredentials, researchProjectPk: number) =>
    post<{ results: ExistingDeployment[] }>('/api/trapper/deployments', {
      ...creds, research_project_pk: researchProjectPk,
    }),

  // The backend and frontend always run on the same machine (a local
  // desktop app — see web.app_entry), so this pops the OS's own native
  // folder dialog and returns what was picked (null if cancelled).
  browseFolder: (title?: string) =>
    post<{ path: string | null }>('/api/deployment-import/browse-folder', { title: title ?? null }),

  scanFolder: (path: string) =>
    post<ScanResult>('/api/deployment-import/scan-folder', { path }),
  /** The date range and the camera of a folder's images — what the deployment form starts from. */
  guessDetails: (path: string) =>
    post<GuessedDetails>('/api/deployment-import/guess-details', { path }),

  // For each deployment id, the folder where it is already kept in the collections folder (null if it is not there yet).
  existingDeployments: (researchProjectId: string, deploymentIds: string[]) =>
    post<{ results: Record<string, string | null> }>('/api/deployment-import/existing-deployments', { research_project_id: researchProjectId, deployment_ids: deploymentIds }),

  // For each deployment id, the details of the closest earlier revision of its location (null if there is none).
  previousDeployments: (researchProjectId: string, deploymentIds: string[]) =>
    post<{ results: Record<string, PreviousDeployment | null> }>('/api/deployment-import/previous-deployments', { research_project_id: researchProjectId, deployment_ids: deploymentIds }),

  // A session folder: one subfolder per deployment, each scanned.
  scanSession: (path: string) =>
    post<SessionScan>('/api/deployment-import/scan-session', { path }),

  checkCollection: (path: string) =>
    post<CollectionCheck>('/api/deployment-import/check-collection', { path }),

  // The research projects and locations kept in the collections folder.
  listResearchProjects: () =>
    post<{ results: LocalResearchProject[] }>('/api/deployment-import/research-projects/list', {}),

  saveResearchProject: (project: LocalResearchProject) =>
    post<LocalResearchProject>('/api/deployment-import/research-projects/save', project),

  // Changes a kept research project: the fields given are the ones that change (its acronym names it, and can't).
  updateResearchProject: (acronym: string, changes: Partial<Omit<LocalResearchProject, 'acronym' | 'trapper_pk'>>) =>
    post<LocalResearchProject>('/api/deployment-import/research-projects/update', { acronym, ...changes }),

  // Deletes a research project with its locations and visits; refused when it holds collections.
  deleteResearchProject: (acronym: string) =>
    post<{ deleted: string }>('/api/deployment-import/research-projects/delete', { research_project_id: acronym }),

  /** Finishes a revision: the locations with no visit in it are marked as not visited. */
  /** Plans the next revision: a visit to each location that can be visited. `previous` says what is still to be visited in the revision before, when it is not finished. */
  createRevision: (researchProjectId: string) =>
    post<RevisionCreated>('/api/visits/create-revision', { research_project_id: researchProjectId }),
  markNotVisited: (researchProjectId: string, session: string) =>
    post<{ session: string; marked: string[] }>('/api/visits/mark-not-visited', { research_project_id: researchProjectId, session }),

  listLocalLocations: (researchProjectId: string) =>
    post<{ results: LocalLocation[] }>('/api/deployment-import/locations/list', { research_project_id: researchProjectId }),

  // The visits kept for a research project — those to one location only when it is given.
  listVisits: (researchProjectId: string, locationId?: string) =>
    post<{ results: StoredVisit[] }>('/api/visits/list', { research_project_id: researchProjectId, location_id: locationId ?? null }),

  // The visits of a research project as a CSV the import of visits reads back.
  exportVisitsCsv: (researchProjectId: string) =>
    post<{ csv: string; filename: string; count: number }>('/api/visits/export-csv', { research_project_id: researchProjectId }),

  saveVisit: (researchProjectId: string, visit: StoredVisit) =>
    post<StoredVisit & { field_logs?: FieldLogsResult }>('/api/visits/save', { research_project_id: researchProjectId, visit }),

  // Edits a visit kept — its site and revision are its key. Refused when it starts or closes an imported deployment, or when the change makes it or a later visit impossible.
  updateVisit: (researchProjectId: string, visit: StoredVisit) =>
    post<StoredVisit & { field_logs?: FieldLogsResult }>('/api/visits/update', { research_project_id: researchProjectId, location_id: visit.location_id, session: visit.session, visit }),

  // The visits of a research project that closed a deployment — they collected the card — and have none linked yet.
  closedVisits: (researchProjectId: string) => post<{ results: ClosedVisit[] }>('/api/visits/closed', { research_project_id: researchProjectId }),

  // Records on a visit the deployment it closed.
  /** The visit book of a research project: its visits, each with the deployment it started and whether that is closed or open. */
  visitBook: (researchProjectId: string) => post<{ results: BookVisit[] }>('/api/visits/book', { research_project_id: researchProjectId }),
  /** The deployments the visits of a research project say, closed and open, by collection and site. */
  fieldDeployments: (researchProjectId: string) => post<{ results: FieldDeployment[] }>('/api/visits/deployments', { research_project_id: researchProjectId }),
  linkVisit: (researchProjectId: string, visit: StoredVisit, deploymentId: string) =>
    post<StoredVisit>('/api/visits/link', { research_project_id: researchProjectId, location_id: visit.location_id, date: visit.date, time: visit.time, deployment_id: deploymentId }),

  // The visits of a CSV file for a research project: what can be kept and what is wrong with the rest — kept too when `save` is set.
  importVisitsCsv: (researchProjectId: string, csv: string, save = false, format: VisitsCsvFormat = 'mapped', mapping?: Record<string, string>, options?: ImportCsvOptions) =>
    post<VisitsCsvResult>('/api/visits/import-csv', {
      research_project_id: researchProjectId, csv, save, format, mapping: mapping ?? null,
      ...(options?.create ? { create: options.create } : {}), ...(options?.defaults ? { defaults: options.defaults } : {}), ...(options?.close_revisions ? { close_revisions: true } : {}),
    }),

  // The columns of a CSV file, a few of its rows, the fields of a visit it can give and the column that most likely gives each.
  epicollectVisitsDownload: () => post<{ csv: string; count: number }>('/api/visits/epicollect-download', {}),
  visitsCsvColumns: (csv: string) => post<VisitsCsvColumns>('/api/visits/csv-columns', { csv }),

  // The revision a new deployment at this location is expected to have: one after the highest kept for it, or 1.
  nextRevision: (researchProjectId: string, locationId: string) =>
    post<{ last: number | null; next: number }>('/api/deployment-import/next-revision', { research_project_id: researchProjectId, location_id: locationId }),

  // Creates in the collections folder what Trapper has for the classification project and it lacks.
  // The collections of the classification project that can be synced, each with the ids of its deployments.
  syncCollectionNames: (creds: TrapperCredentials, researchProjectPk: number, classificationProjectPk: number) =>
    post<{ results: SyncCollection[] }>('/api/sync/collection-names', { ...creds, research_project_pk: researchProjectPk, classification_project_pk: classificationProjectPk }),

  // Creates in the collections folder what Trapper has for the classification project and it lacks, one deployment at a time:
  // onEvent gets a progress message per step, and the last event is the done one with the result.
  syncCollections: (
    creds: TrapperCredentials, researchProject: ResearchProject, classificationProjectPk: number, collections: string[], deployments: string[],
    downloadImages: boolean, onEvent: (event: SyncEvent) => void,
  ) =>
    streamNdjson<SyncEvent>('/api/sync/collections', {
      ...creds, research_project_pk: researchProject.pk, research_project_name: researchProject.name,
      research_project_acronym: researchProject.acronym ?? null, classification_project_pk: classificationProjectPk, collections, deployments, download_images: downloadImages,
    }, onEvent, 'The sync ended unexpectedly.'),

  saveLocalLocation: (researchProjectId: string, location: LocalLocation) =>
    post<LocalLocation>('/api/deployment-import/locations/save', { research_project_id: researchProjectId, location }),

  // Changes a kept location: the fields given are the ones that change (null clears one).
  /** Deletes a location of a research project — refused while visits were made to it, or when it comes from Trapper. */
  deleteLocalLocation: (researchProjectId: string, locationId: string) =>
    post<{ deleted: string }>('/api/deployment-import/locations/delete', { research_project_id: researchProjectId, location_id: locationId }),
  updateLocalLocation: (researchProjectId: string, locationId: string, changes: Partial<Pick<LocalLocation, 'name' | 'latitude' | 'longitude' | 'coordinate_uncertainty' | 'timezone' | 'ignore_dst' | 'status' | 'status_date' | 'status_note'>>) =>
    post<LocalLocation>('/api/deployment-import/locations/update', { research_project_id: researchProjectId, location_id: locationId, ...changes }),

  /** Marks a camera (by its serial number or label) or an SD card (by its label) of a research project as no longer available — stolen, lost… */
  setFieldItemStatus: (researchProjectId: string, kind: 'cameras' | 'sd_cards', key: string, status: 'stolen' | 'lost' | 'broken' | 'archived', statusDate: string | null, statusNote: string | null) =>
    post<{ updated: boolean }>('/api/settings/field-item-status', { research_project_id: researchProjectId, kind, key, status, status_date: statusDate, status_note: statusNote }),

  collectionPath: (researchProjectId: string, deploymentId: string) =>
    post<CollectionPath>('/api/deployment-import/collection-path', { research_project_id: researchProjectId, deployment_id: deploymentId }),

  listLocalDeployments: (collectionDir: string) =>
    post<{ results: LocalDeployment[] }>('/api/deployment-import/list-local-deployments', { path: collectionDir }),

  // checks omitted (or undefined) runs every check.
  // researchProjectId: the duplicates check also looks for images imported before into it; deploymentId: the one being imported again, left out of that.
  validateImages: (path: string, checks?: ImageCheck[], researchProjectId?: string | null, deploymentId?: string | null) =>
    post<ValidationResult>('/api/deployment-import/validate-images', { path, checks: checks ?? null, research_project_id: researchProjectId || null, deployment_id: deploymentId || null }),

  // collectionName: the collection folder's name (Local folder) — omitted for Trapper, whose collection is the id's own prefix.
  validateDeployment: (
    path: string, deployment: DeploymentFields, checks: DeploymentCheck[] | undefined,
    options: {
      collectionName?: string | null; expectedLocationId?: string | null; toleranceHours?: number
      /** Whose collections hold the previous revisions of the location, for the statistical checks. */
      researchProjectId?: string | null; statistics?: StatisticsParams
      /** The visit the deployment is of, for the checks of the card and of the photos. */
      visit?: VisitCheckInfo | null
    } = {},
  ) =>
    post<DeploymentCheckResult>('/api/deployment-import/validate-deployment', {
      path, deployment, checks: checks ?? null, collection_name: options.collectionName ?? null,
      expected_location_id: options.expectedLocationId ?? null, tolerance_hours: options.toleranceHours ?? 1,
      research_project_id: options.researchProjectId ?? null, ...(options.statistics ? { statistics: options.statistics } : {}),
      visit: options.visit ?? null,
    }),

  // Puts the deployment's start and end in its collection's <collection>_FileTimestampLog.csv — before the postvalidation — and its
  // row in the <collection>_FieldworkLog.csv, with what the visits it is of say of it.
  writeTimestampLog: (researchProjectId: string, deployment: DeploymentFields, visits?: FieldworkVisits) =>
    post<TimestampLogResult>('/api/deployment-import/timestamp-log', { research_project_id: researchProjectId, deployment, visits: visits ?? null }),

  // What the collection's two logs say of a deployment, if they have its row.
  logEntry: (researchProjectId: string, deploymentId: string) =>
    req<LogEntry>(`/api/deployment-import/log-entry?research_project_id=${encodeURIComponent(researchProjectId)}&deployment_id=${encodeURIComponent(deploymentId)}`),

  importDeployment: (
    creds: TrapperCredentials, researchProjectPk: number, classificationProjectPk: number | null,
    sourceDir: string, deployment: DeploymentFields, registerDeployment: boolean,
    researchProjectId: string, onEvent: (event: ImportEvent) => void,
  ) =>
    streamNdjson<ImportEvent>('/api/deployment-import/import', {
      ...creds, research_project_pk: researchProjectPk, research_project_id: researchProjectId, classification_project_pk: classificationProjectPk,
      source_dir: sourceDir, deployment, register_deployment: registerDeployment,
    }, onEvent, 'The import ended unexpectedly.'),

  // Copies a memory card — read only — to a temporary folder of this computer: its images are then processed as any local folder.
  copyCard: (path: string, onEvent: (event: CardCopyEvent) => void) =>
    streamNdjson<CardCopyEvent>('/api/deployment-import/copy-card', { path }, onEvent, 'The copy of the memory card ended unexpectedly.'),

  // Ejects the removable drive the memory card was copied from, so it can be taken out.
  ejectCard: (path: string) => post<{ ejected: boolean; message: string }>('/api/deployment-import/eject-card', { path }),

  // Removes the temporary copy of a memory card once the import is over.
  discardCardCopy: (path: string) => post<{ removed: boolean }>('/api/deployment-import/discard-card-copy', { path }),

  // preprocessing null copies the images as they are.
  importLocal: (
    sourceDir: string, collectionDir: string, collectionName: string | null, deployment: DeploymentFields,
    preprocessing: PreprocessingOptions | null, onEvent: (event: ImportEvent) => void,
  ) =>
    streamNdjson<ImportEvent>('/api/deployment-import/import-local', {
      source_dir: sourceDir, collection_dir: collectionDir, collection_name: collectionName, deployment, preprocessing,
    }, onEvent, 'The import ended unexpectedly.'),

  // Preprocesses the images into their collection and leaves the deployment pending — not sealed, so it can be done again — until consolidate.
  preprocess: (
    sourceDir: string, collectionDir: string, collectionName: string | null, deployment: DeploymentFields,
    preprocessing: PreprocessingOptions, onEvent: (event: ImportEvent) => void,
  ) =>
    streamNdjson<ImportEvent>('/api/deployment-import/preprocess', {
      source_dir: sourceDir, collection_dir: collectionDir, collection_name: collectionName, deployment, preprocessing,
    }, onEvent, 'The preprocessing ended unexpectedly.'),

  // Freezes the preprocessed deployment: writes its metadata and seals it.
  consolidate: (sourceDir: string, collectionDir: string, deployment: DeploymentFields, onEvent: (event: ImportEvent) => void) =>
    streamNdjson<ImportEvent>('/api/deployment-import/consolidate', {
      source_dir: sourceDir, collection_dir: collectionDir, deployment,
    }, onEvent, 'The import ended unexpectedly.'),

  // The collections kept for a research project, and the deployments in each — what can be uploaded to Trapper.
  uploadCollections: (researchProjectId: string) =>
    post<{ results: UploadCollection[] }>('/api/upload/collections', { research_project_id: researchProjectId }),

  // Whether the saved account can reach the research project, its locations and the uploader — changing nothing.
  checkUploadAccess: (researchProjectId: string, collection: string | null, deploymentIds: string[], classificationProjectPk: number | null) =>
    post<{ checks: AccessCheck[] }>('/api/upload/check-access', {
      research_project_id: researchProjectId, collection, deployment_ids: deploymentIds, classification_project_pk: classificationProjectPk,
    }),

  // The statistics of a revision: each of its deployments against the previous revisions of its location.
  statisticsRevision: (researchProjectId: string, collection: string) =>
    post<{ results: StatisticsRow[] }>('/api/statistics/revision', { research_project_id: researchProjectId, collection }),
  // Repairing the deployments kept in the collections folder: the collections of a research project and their deployment folders,
  // the state of one (valid as its seal says), and its repair — its metadata files written again from what its folder holds.
  repairCollections: (researchProjectId: string) =>
    post<{ results: RepairCollection[] }>('/api/repair/collections', { research_project_id: researchProjectId }),
  repairInspect: (researchProjectId: string, collection: string, deploymentId: string) =>
    post<RepairState>('/api/repair/inspect', { research_project_id: researchProjectId, collection, deployment_id: deploymentId }),
  repairDeployment: (researchProjectId: string, collection: string, deploymentId: string, onEvent: (event: RepairEvent) => void) =>
    streamNdjson<RepairEvent>('/api/repair/deployment', { research_project_id: researchProjectId, collection, deployment_id: deploymentId }, onEvent, 'The repair ended unexpectedly.'),
  // Backups of the settings and of a research project, and their restoration.
  backupProjectInfo: (researchProjectId: string) => post<BackupProjectInfo>('/api/backup/project-info', { research_project_id: researchProjectId }),
  backupPickFile: () => post<{ path: string | null }>('/api/backup/pick-file', {}),
  backupRead: (path: string) => post<BackupRead>('/api/backup/read', { path }),
  backupCreate: (request: BackupCreateRequest, onEvent: (event: BackupEvent) => void) =>
    streamNdjson<BackupEvent>('/api/backup/create', request, onEvent, 'The backup ended unexpectedly.'),
  /** Where the browser gets a backup made with no folder: it is a file to save. */
  backupDownloadUrl: (name: string) => `/api/backup/download/${encodeURIComponent(name)}`,
  backupRestore: (request: BackupRestoreRequest, onEvent: (event: RestoreEvent) => void) =>
    streamNdjson<RestoreEvent>('/api/backup/restore', request, onEvent, 'The restoration ended unexpectedly.'),
  // Fixing the dates and times of the images in a folder, against the period of the visit that left the camera (see the backend's timefix_service).
  timefixTimeline: (target: TimeFixTarget) => post<Timeline>('/api/timefix/timeline', target),
  timefixShift: (target: TimeFixTarget, first: string, last: string | null, offsetSeconds: number, reason: string) =>
    post<Timeline>('/api/timefix/shift', { ...target, first, last, offset_seconds: offsetSeconds, reason }),
  timefixRemove: (target: TimeFixTarget, names: string[], reason: string) => post<Timeline>('/api/timefix/remove', { ...target, names, reason }),

  // Whether the saved account has access to the research project — and to the collection, when one is chosen — changing nothing.
  checkUploadSelection: (researchProjectId: string, collection?: string) =>
    post<{ checks: AccessCheck[] }>('/api/upload/check-selection', { research_project_id: researchProjectId, ...(collection ? { collection } : {}) }),

  // The classification projects Trapper has for a research project kept locally — the collection goes to one of them.
  uploadClassificationProjects: (researchProjectId: string) =>
    post<{ results: ClassificationProject[] }>('/api/upload/classification-projects', { research_project_id: researchProjectId }),

  // Uploads one deployment: creates its location and the deployment in Trapper if need be, packs it and sends it — or,
  // as `mode` says, only shows what that would do, or only writes the files. The Trapper credentials are the saved ones.
  uploadDeployment: (
    researchProjectId: string, collection: string, deploymentId: string, mode: UploadMode,
    onEvent: (event: UploadEvent) => void, classificationProjectPk: number | null = null, signal?: AbortSignal, deleteFiles = false,
  ) =>
    streamNdjson<UploadEvent>('/api/upload/deployment', {
      research_project_id: researchProjectId, collection, deployment_id: deploymentId, mode,
      classification_project_pk: classificationProjectPk, delete_files: deleteFiles,
    }, onEvent, 'The upload ended unexpectedly.', signal),

  // Keeps the report of an upload that has ended, with the others; says its id.
  saveUploadReport: (researchProjectId: string, collection: string, startedAt: string, finishedAt: string, items: Record<string, unknown>[]) =>
    post<{ report_id: string }>('/api/upload/report', { research_project_id: researchProjectId, collection, started_at: startedAt, finished_at: finishedAt, items }),

  // Whether ExifTool is installed — adding metadata needs it.
  // Opens a folder kept by the app (inside its data folder) in the system's file explorer.
  openFolder: (path: string) => post<{ opened: string }>('/api/deployment-import/open-folder', { path }),
  exiftoolStatus: () => req<{ available: boolean; path: string | null }>('/api/deployment-import/exiftool'),

  /** The photos of a created deployment, in the order they were taken — to look at them — and each one as a JPEG: a thumbnail, or one to look at closely. */
  deploymentPhotos: (researchProjectId: string, collection: string, deploymentId: string) =>
    req<{ photos: { name: string; taken: string | null }[] }>(`/api/deployment-import/photos?${new URLSearchParams({ research_project_id: researchProjectId, collection, deployment_id: deploymentId })}`),
  deploymentPhotoUrl: (researchProjectId: string, collection: string, deploymentId: string, name: string, size: 'thumb' | 'large' = 'thumb') =>
    `/api/deployment-import/photo?${new URLSearchParams({ research_project_id: researchProjectId, collection, deployment_id: deploymentId, name, size })}`,

  listReports: () => req<ReportSummary[]>('/api/reports'),
  getReport: (id: string) => req<Report>(`/api/reports/${encodeURIComponent(id)}`),
  deleteReport: (id: string) => req<{ status: string }>(`/api/reports/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Where a report can be downloaded from — its JSON, or a CSV with a row per image and check. */
  /** An image a report lists, as a JPEG: a thumbnail, or one to look at closely. */
  reportImageUrl: (id: string, path: string, size: 'thumb' | 'large' = 'thumb') =>
    `/api/reports/${encodeURIComponent(id)}/image?path=${encodeURIComponent(path)}${size === 'large' ? '&size=large' : ''}`,
  reportUrl: (id: string, format: 'json' | 'csv') => `/api/reports/${encodeURIComponent(id)}/download?format=${format}`,

  listSessions: () => req<SessionSummary[]>('/api/sessions'),

  // The wizard's first step — task_id is undefined for a brand new run,
  // which creates its session.
  saveScan: (sourceDir: string, scan: ScanResult, taskId?: string) =>
    post<SessionSummary>('/api/sessions/scan', { task_id: taskId ?? null, source_dir: sourceDir, scan }),

  saveSelection: (taskId: string, selection: DeploymentSelection) =>
    post<SessionSummary>('/api/sessions/selection', { task_id: taskId, selection }),

  saveDetails: (taskId: string, deployment: DeploymentFields) =>
    post<SessionSummary>('/api/sessions/details', { task_id: taskId, deployment }),

  discardSession: (taskId: string) =>
    req<{ status: string }>(`/api/sessions/${taskId}`, { method: 'DELETE' }),

  getSettings: () => req<AppSettings>('/api/settings'),
  /** The inputs of the Epicollect5 project saved in the settings. */
  epicollectForm: () => req<EpicollectForm>('/api/epicollect/form'),
  /** The entries of the Epicollect5 project that are this location's — and this revision's, when the form asks it — as the fields of a deployment. */
  epicollectEntries: (locationId: string, revision: number | null) =>
    post<{ results: EpicollectEntry[] }>('/api/epicollect/entries', { location_id: locationId, revision }),

  /** The newest entry of each of the locations (and of this revision), null for one that has none — the project is read once. */
  epicollectEntriesBatch: (locationIds: string[], revision: number | null) =>
    post<{ results: Record<string, EpicollectEntry | null> }>('/api/epicollect/entries/batch', { location_ids: locationIds, revision }),

  /** Whether the project can be read with these values — saved or not; a blank secret is the saved one. Saves nothing. */
  epicollectTestConnection: (values: { project_slug: string; client_id: string; client_secret: string }) =>
    post<{ ok: boolean; project: string; slug: string; forms: number; inputs: number }>('/api/epicollect/test-connection', values),

  saveSettings: (settings: AppSettingsUpdate) =>
    req<AppSettings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),

  clearLog: () => req<{ deleted: number }>('/api/settings/log', { method: 'DELETE' }),

  // The settings files the user can switch to (the default settings.toml plus the ones created with addConfig);
  // each one's file itself is downloaded straight from /api/settings/configs/<id>/download.
  configs: () => req<ConfigInfo[]>('/api/settings/configs'),
  addConfig: (name: string) => post<ConfigInfo[]>('/api/settings/configs', { name }),
  activateConfig: (id: string) => post<ConfigInfo[]>(`/api/settings/configs/${encodeURIComponent(id)}/activate`, {}),
  openConfigFolder: (id: string) => post<{ ok: boolean }>(`/api/settings/configs/${encodeURIComponent(id)}/open-folder`, {}),
}
