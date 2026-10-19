import type {
  AppSettings, AppSettingsUpdate, ConfigInfo, UpdateCheck, PreviousDeployment, ClassificationProject, PreprocessingOptions, CollectionCheck, CollectionPath, LocalLocation, LocalResearchProject, DeploymentCheck, DeploymentCheckResult, DeploymentFields,
  DeploymentSelection, ExistingDeployment, ImageCheck, ImportEvent, Location, LocalDeployment, ResearchProject,
  AccessCheck, GuessedDetails, ScanResult, SessionSummary, StatisticsParams, SyncCollection, SyncEvent, TimestampLogResult, SessionScan, UploadCollection, UploadEvent, UploadMode, ValidationResult,
  Report, ReportSummary, RepairCollection, RepairEvent, RepairState, EpicollectForm,
} from './types'

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

  listLocalLocations: (researchProjectId: string) =>
    post<{ results: LocalLocation[] }>('/api/deployment-import/locations/list', { research_project_id: researchProjectId }),

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
    onEvent: (event: SyncEvent) => void,
  ) =>
    streamNdjson<SyncEvent>('/api/sync/collections', {
      ...creds, research_project_pk: researchProject.pk, research_project_name: researchProject.name,
      research_project_acronym: researchProject.acronym ?? null, classification_project_pk: classificationProjectPk, collections, deployments,
    }, onEvent, 'The sync ended unexpectedly.'),

  saveLocalLocation: (researchProjectId: string, location: LocalLocation) =>
    post<LocalLocation>('/api/deployment-import/locations/save', { research_project_id: researchProjectId, location }),

  collectionPath: (researchProjectId: string, deploymentId: string) =>
    post<CollectionPath>('/api/deployment-import/collection-path', { research_project_id: researchProjectId, deployment_id: deploymentId }),

  listLocalDeployments: (collectionDir: string) =>
    post<{ results: LocalDeployment[] }>('/api/deployment-import/list-local-deployments', { path: collectionDir }),

  // checks omitted (or undefined) runs every check.
  validateImages: (path: string, checks?: ImageCheck[]) =>
    post<ValidationResult>('/api/deployment-import/validate-images', { path, checks: checks ?? null }),

  // collectionName: the collection folder's name (Local folder) — omitted for Trapper, whose collection is the id's own prefix.
  validateDeployment: (
    path: string, deployment: DeploymentFields, checks: DeploymentCheck[] | undefined,
    options: {
      collectionName?: string | null; expectedLocationId?: string | null; toleranceHours?: number
      /** Whose collections hold the previous revisions of the location, for the statistical checks. */
      researchProjectId?: string | null; statistics?: StatisticsParams
    } = {},
  ) =>
    post<DeploymentCheckResult>('/api/deployment-import/validate-deployment', {
      path, deployment, checks: checks ?? null, collection_name: options.collectionName ?? null,
      expected_location_id: options.expectedLocationId ?? null, tolerance_hours: options.toleranceHours ?? 1,
      research_project_id: options.researchProjectId ?? null, ...(options.statistics ? { statistics: options.statistics } : {}),
    }),

  // Puts the deployment's start and end in its collection's <collection>_FileTimestampLog.csv — before the postvalidation.
  writeTimestampLog: (researchProjectId: string, deployment: DeploymentFields) =>
    post<TimestampLogResult>('/api/deployment-import/timestamp-log', { research_project_id: researchProjectId, deployment }),

  importDeployment: (
    creds: TrapperCredentials, researchProjectPk: number, classificationProjectPk: number | null,
    sourceDir: string, deployment: DeploymentFields, registerDeployment: boolean,
    researchProjectId: string, onEvent: (event: ImportEvent) => void,
  ) =>
    streamNdjson<ImportEvent>('/api/deployment-import/import', {
      ...creds, research_project_pk: researchProjectPk, research_project_id: researchProjectId, classification_project_pk: classificationProjectPk,
      source_dir: sourceDir, deployment, register_deployment: registerDeployment,
    }, onEvent, 'The import ended unexpectedly.'),

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

  // Repairing the deployments kept in the collections folder: the collections of a research project and their deployment folders,
  // the state of one (valid as its seal says), and its repair — its metadata files written again from what its folder holds.
  repairCollections: (researchProjectId: string) =>
    post<{ results: RepairCollection[] }>('/api/repair/collections', { research_project_id: researchProjectId }),
  repairInspect: (researchProjectId: string, collection: string, deploymentId: string) =>
    post<RepairState>('/api/repair/inspect', { research_project_id: researchProjectId, collection, deployment_id: deploymentId }),
  repairDeployment: (researchProjectId: string, collection: string, deploymentId: string, onEvent: (event: RepairEvent) => void) =>
    streamNdjson<RepairEvent>('/api/repair/deployment', { research_project_id: researchProjectId, collection, deployment_id: deploymentId }, onEvent, 'The repair ended unexpectedly.'),

  // Whether the saved account has access to the research project and the collection chosen — changing nothing.
  checkUploadSelection: (researchProjectId: string, collection: string) =>
    post<{ checks: AccessCheck[] }>('/api/upload/check-selection', { research_project_id: researchProjectId, collection }),

  // The classification projects Trapper has for a research project kept locally — the collection goes to one of them.
  uploadClassificationProjects: (researchProjectId: string) =>
    post<{ results: ClassificationProject[] }>('/api/upload/classification-projects', { research_project_id: researchProjectId }),

  // Uploads one deployment: creates its location and the deployment in Trapper if need be, packs it and sends it — or,
  // as `mode` says, only shows what that would do, or only writes the files. The Trapper credentials are the saved ones.
  uploadDeployment: (
    researchProjectId: string, collection: string, deploymentId: string, mode: UploadMode,
    onEvent: (event: UploadEvent) => void, classificationProjectPk: number | null = null, signal?: AbortSignal,
  ) =>
    streamNdjson<UploadEvent>('/api/upload/deployment', {
      research_project_id: researchProjectId, collection, deployment_id: deploymentId, mode,
      classification_project_pk: classificationProjectPk,
    }, onEvent, 'The upload ended unexpectedly.', signal),

  // Whether ExifTool is installed — adding metadata needs it.
  // Opens a folder kept by the app (inside its data folder) in the system's file explorer.
  openFolder: (path: string) => post<{ opened: string }>('/api/deployment-import/open-folder', { path }),
  exiftoolStatus: () => req<{ available: boolean; path: string | null }>('/api/deployment-import/exiftool'),

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
