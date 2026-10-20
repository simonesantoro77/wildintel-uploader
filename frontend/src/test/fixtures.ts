import type { AppSettings, DeploymentSelection, SessionSummary } from '../types'

export const SCAN = { file_count: 12, image_count: 12, start_date: '2024-09-04T13:10:00', end_date: '2024-11-04T14:28:00', camera_model: 'Reconyx HC600', camera_id: null as string | null, warnings: [] as string[] }

export const SELECTION: DeploymentSelection = {
  destination: 'trapper', mode: 'new',
  research_project: { pk: 2, name: 'Doñana', acronym: 'DONA' },
  classification_project: { pk: 10, name: 'Main CP' },
  location: { pk: 5, location_id: 'DONA_01', name: 'Doñana site 1', timezone: 'Europe/Madrid' },
}

export const EXISTING_SELECTION: DeploymentSelection = {
  destination: 'trapper', mode: 'existing', research_project: { pk: 2, name: 'Doñana', acronym: 'DONA' },
}

export const LOCAL_SELECTION: DeploymentSelection = {
  destination: 'local', mode: 'new', collection_dir: '/home/me/Collections/R0001', collection_name: 'Doñana 2024',
}

export const LOCAL_EXISTING_SELECTION: DeploymentSelection = {
  destination: 'local', mode: 'existing', collection_dir: '/home/me/Collections/R0001',
}

/** Phase "scanned" — the source folder is scanned, but no project/location
 * chosen yet. */
export const SESSION: SessionSummary = {
  task_id: 'task-1', created_at: '2026-09-25T10:00:00+00:00', phase: 'scanned', task: 'deployment',
  source_dir: '/home/me/DONA_01', scan: SCAN,
}

/** Phase "selected" — the research project/classification project/location
 * are chosen too. */
export const SELECTED_SESSION: SessionSummary = { ...SESSION, phase: 'selected', selection: SELECTION }

/** Phase "ready" — the deployment's own fields are filled in too. */
export const READY_SESSION: SessionSummary = {
  ...SELECTED_SESSION, phase: 'ready',
  deployment: {
    deployment_id: 'DONA-DONA_01', location_id: 'DONA_01', location_name: 'Doñana site 1', latitude: 37.0, longitude: -6.5,
    start_date: '2024-09-04T13:10:00+02:00', end_date: '2024-11-04T14:28:00+01:00', camera_model: 'Reconyx HC600', tags: [],
  },
}

/** An "existing deployment" run, fully resolved from Trapper — no
 * classification project/location of its own. */
export const EXISTING_READY_SESSION: SessionSummary = {
  ...SESSION, phase: 'ready', selection: EXISTING_SELECTION,
  deployment: {
    deployment_id: 'DONA-DONA_01', location_id: 'DONA_01', location_name: 'Doñana site 1',
    start_date: '2024-09-04T13:10:00', end_date: '2024-11-04T14:28:00', camera_model: 'Reconyx HC600', tags: [],
  },
}

/** A "Local folder" run, new deployment, its own fields already filled in. */
export const LOCAL_READY_SESSION: SessionSummary = {
  ...SESSION, phase: 'ready', selection: LOCAL_SELECTION,
  deployment: {
    deployment_id: 'DONA-DONA_01', location_id: 'DONA_01', latitude: 37.0, longitude: -6.5,
    start_date: '2024-09-04T13:10:00+02:00', end_date: '2024-11-04T14:28:00+01:00', camera_model: 'Reconyx HC600', tags: [],
  },
}

/** A "Local folder" run using an existing deployment already organized in
 * the collection. */
export const LOCAL_EXISTING_READY_SESSION: SessionSummary = {
  ...SESSION, phase: 'ready', selection: LOCAL_EXISTING_SELECTION,
  deployment: {
    deployment_id: 'DONA-DONA_01', location_id: 'DONA_01', latitude: 37.0, longitude: -6.5,
    start_date: '2024-09-04T13:10:00', end_date: '2024-11-04T14:28:00', camera_model: 'Reconyx HC600', tags: [],
  },
}

/** Phase "ready" as the wizard now saves it: the deployment's own details are filled in
 * (where it was taken isn't kept in a session). */
export const DETAILED_SESSION: SessionSummary = {
  ...SESSION, phase: 'ready',
  deployment: {
    deployment_id: 'R0001-DONA_01', location_id: 'DONA_01', location_name: 'Doñana site 1', latitude: 37.0, longitude: -6.5,
    start_date: '2024-09-04T13:10:00+02:00', end_date: '2024-11-04T14:28:00+01:00', camera_model: 'Reconyx HC600', tags: [],
  },
}

/** The settings a fresh install has — every check shown — with a Trapper account saved. */
export const APP_SETTINGS: AppSettings = {
  GENERAL: { log_level: 'INFO', workers: 4, cpu_count: 8, log_file: '/home/me/.config/wildintel-uploader/logs/wildintel-uploader.log', log_level_override: null },
  EPICOLLECT5: { enabled: false, unmapped_to_comments: false, project_slug: null, client_id: null, has_secret: false, mapping: {} },
  TRAPPER: { base_url: 'https://trapper.example.org', user_name: 'alice', has_password: true, max_zip_mb: 500 },
  DATA: { dir: '/home/me/Documents/wildintel-uploader', collections_dir: null, reports_dir: null, packages_dir: null,
    default_collections_dir: '/home/me/Documents/wildintel-uploader/collections', default_reports_dir: '/home/me/Documents/wildintel-uploader/reports', default_packages_dir: '/home/me/Documents/wildintel-uploader/packages' },
  VALIDATION: { corrupted: true, sequence: true, structure: true, camera: true, exif: true, duplicates: true },
  POSTVALIDATION: {
    deployment_id: true, collection_prefix: true, collection_name: true, location: true, time_range: true, camera: true,
    image_count: true, sequence_count: true, sequence_length: true, tolerance_hours: 1,
    sequence_gap_seconds: 60, min_revisions: 2, similarity_method: 'median',
    image_count_tolerance: 50, sequence_count_tolerance: 50, sequence_length_tolerance: 50,
  },
  PREPROCESSING: {
    rename: true, resize: true, resize_width: 2400, metadata: true, owner: '', publisher: '', coverage: '',
    license_url: 'https://creativecommons.org/licenses/by-nc/4.0/', ignore_dst: true, convert_to_utc: true,
  },
}
