// The web app's backend, faked inside the page for the documentation's
// screenshots (see capture.py): window.fetch answers /api/* from the sample
// data below — no Trapper, no real folders, no real account. Streaming
// endpoints send their NDJSON events a few milliseconds apart; with
// hold: true the stream stays open after them, so a screenshot catches the
// run midway. capture.py changes window.__mock before a step when needed.
(() => {
  const TRAPPER_URL = 'https://trapper.example.org'
  const DATA_DIR = '/home/me/Documents/wildintel-uploader'
  const COLLECTIONS = `${DATA_DIR}/collections`

  const PROJECT = { name: 'Doñana National Park', acronym: 'DONA', trapper_pk: 2 }

  const LOCATIONS = [
    { location_id: 'DONA_01', name: 'Doñana site 1', timezone: 'Europe/Madrid', ignore_dst: true, latitude: 37.0074, longitude: -6.4392, coordinate_uncertainty: 50, trapper_pk: 101 },
    { location_id: 'DONA_02', name: 'Doñana site 2', timezone: 'Europe/Madrid', ignore_dst: true, latitude: 37.0121, longitude: -6.4287, coordinate_uncertainty: 50, trapper_pk: 102 },
    { location_id: 'DONA_03', name: 'Doñana site 3', timezone: 'Europe/Madrid', ignore_dst: true, latitude: 36.9983, longitude: -6.4511, coordinate_uncertainty: 100, trapper_pk: 103 },
  ]

  // What the Epicollect5 project has for DONA_01, revision 3: the day and the time of each end come apart.
  const EPICOLLECT_ENTRY = {
    uuid: 'a1b2c3', title: 'DONA_01 · R3', created_at: '2024-10-13T09:12:00Z',
    fields: { revision: 3, start_date: '2024-09-04', start_time: '12:55:00', end_date: '2024-10-12', end_time: '07:30:00', camera_model: 'Reconyx HyperFire 2' },
  }

  const CAMERA = { model: 'Reconyx HyperFire 2', id: 'P800HG08' }

  // The scan only counts; the dates and the camera are read when the details are asked for.
  const SCAN = { file_count: 241, image_count: 241, warnings: [] }
  const GUESS = { start_date: '2024-09-04T13:10:00', end_date: '2024-10-12T07:02:41', camera_model: CAMERA.model, camera_id: CAMERA.id, warnings: [] }

  const SESSION_SCAN = {
    deployments: [
      ['DONA_01', 241, '2024-09-04T13:10:00', '2024-10-12T07:02:41'],
      ['DONA_02', 188, '2024-09-04T14:02:11', '2024-10-12T07:40:09'],
      ['DONA_03', 305, '2024-09-05T09:31:00', '2024-10-13T08:15:33'],
    ].map(([name, n, start_date, end_date]) => ({
      name, path: `/home/me/Pictures/trip-2024-09/${name}`, file_count: n, image_count: n, start_date: null, end_date: null,
      warnings: [], from_timestamp_log: name === 'DONA_02', log_deployment_id: name === 'DONA_02' ? 'R0003-DONA_02' : null, guess: { start_date, end_date },
    })).map((d) => d.name === 'DONA_02' ? { ...d, start_date: '2024-09-04T13:30:00', end_date: '2024-10-12T07:00:00' } : d),
    loose_files: 0, warnings: [],
    timestamp_log: { name: 'R0003_FileTimestampLog.csv', path: '/home/me/Pictures/trip-2024-09/R0003_FileTimestampLog.csv', rows: 2, matched: 1, revision: 3, unmatched: ['R0003-DONA_04'] },
  }

  // The validation of 241 images, some with problems — the result, and (below) the report made of it.
  const name = (n) => `IMG_${String(n).padStart(4, '0')}.JPG`
  const taken = (n) => new Date(Date.UTC(2024, 8, 4, 11, 10) + n * 4 * 3600e3).toISOString().slice(0, 19)
  const BAD = {
    corrupted: [24, 28, 135, 167, 201, 218, 233], sequence: [7, 82, 141, 177, 209], noDate: [12, 56, 99, 150, 188, 230, 239], noModel: [56, 99, 203],
    duplicates: [[87, 'IMG_0087 (copy).JPG']],
  }
  const VALIDATION = {
    checked_count: 241,
    corrupted: BAD.corrupted.map((n) => ({ path: name(n), error: 'image file is truncated' })),
    sequence_issues: BAD.sequence.map((n) => ({ path_a: name(n), index_a: n, date_a: taken(n), path_b: name(n + 1), index_b: n + 1, date_b: taken(n - 1) })),
    subdirectories: [],
    cameras: [{ model: CAMERA.model, camera_id: CAMERA.id, count: 241, examples: [name(1), name(2)] }],
    cameras_without_info: 0,
    exiftool: true,
    exif_missing: {
      date: { count: BAD.noDate.length, examples: BAD.noDate.slice(0, 3).map(name), files: BAD.noDate.map(name) },
      camera_model: { count: BAD.noModel.length, examples: BAD.noModel.map(name), files: BAD.noModel.map(name) },
      camera_id: { count: 0, examples: [], files: [] },
    },
    duplicates: BAD.duplicates.map(([n, copy]) => ({ size: 1843211, files: [name(n), copy] })),
  }

  const validationReport = (id) => {
    const entries = []
    const images = Array.from({ length: 241 }, (_, i) => i + 1)
    const fails = (check, bad, message, tag) => images.forEach((n) => {
      const hit = bad[n]
      entries.push(hit ? { identifier: name(n), check, status: 'failed', message: hit.message ?? message, tag: hit.tag ?? tag, taken: taken(n) } : { identifier: name(n), check, status: 'ok', message: 'ok' })
    })
    fails('corrupted', Object.fromEntries(BAD.corrupted.map((n) => [n, {}])), 'image file is truncated', 'Corrupted')
    fails('sequence', Object.fromEntries(BAD.sequence.map((n) => [n + 1, {}])), `dated before ${name(0)}, which has a lower number`, 'Out of order')
    const missing = {}
    BAD.noDate.forEach((n) => { missing[n] = { message: 'no date', tag: 'No date' } })
    BAD.noModel.forEach((n) => { missing[n] = { message: (missing[n] ? 'no date, ' : '') + 'no camera model', tag: missing[n] ? 'No date, no camera model' : 'No camera model' } })
    fails('exif', missing, 'no date', 'No date')
    const dup = {}
    BAD.duplicates.forEach(([n]) => { dup[n] = { message: `same content as ${BAD.duplicates[0][1]}` } })
    fails('duplicates', dup, 'same content', 'Duplicate')
    entries.push({ identifier: '(deployment)', check: 'structure', status: 'ok', message: 'all the images are in one folder' })
    entries.push({ identifier: '(deployment)', check: 'camera', status: 'ok', message: '1 camera(s)' })
    BAD.duplicates.forEach(([, copy]) => entries.push({ identifier: copy, check: 'duplicates', status: 'failed', message: `same content as ${name(87)}`, tag: 'Duplicate', taken: taken(87) }))
    const by = (c, st) => entries.filter((e) => e.check === c && e.status === st).length
    const checks = {}
    ;[['corrupted', 'Corrupted images', 'images'], ['sequence', 'Shooting order vs. filename sequence', 'images'], ['exif', 'Required EXIF fields', 'images'],
      ['duplicates', 'Duplicate images', 'images'], ['structure', 'Folder structure', 'deployment'], ['camera', 'Camera', 'deployment']]
      .forEach(([c, label, scope]) => { checks[c] = { label, scope, ok: by(c, 'ok'), failed: by(c, 'failed') } })
    const failed = entries.filter((e) => e.status === 'failed')
    return {
      id, kind: 'validation', title: 'Validation of R0003-DONA_01', created_at: '2026-10-06T09:45:12+00:00', source_dir: '/home/me/Pictures/R0003-DONA_01',
      deployment_id: null, checked: 241, parameters: { checks: Object.keys(checks).sort() }, checks,
      totals: { entries: entries.length, ok: entries.length - failed.length, failed: failed.length, images_with_issues: new Set(failed.filter((e) => checks[e.check].scope === 'images').map((e) => e.identifier)).size },
      entries,
    }
  }

  const statistic = (value, reference, lower, upper, history, message) => ({
    ok: true, skipped: false, message, value, reference, lower, upper, previous: history.length,
    history: history.map(([revision, v]) => ({ revision, deployment_id: `R000${revision}-DONA_01`, value: v })),
  })

  const POSTVALIDATION = {
    checked_count: 241,
    deployment_id: { ok: true, message: 'R0003-DONA_01 is a valid deployment id.' },
    collection_prefix: { ok: true, message: 'The deployment id starts with its collection, R0003.' },
    collection_name: { ok: true, message: 'R0003 is a valid collection name.' },
    location: { ok: true, message: 'The id’s location, DONA_01, is the one chosen.' },
    image_count: statistic(241, 238, 119, 357, [[1, 224], [2, 252]], '241 images — like the previous revisions (median 238, ±50 %).'),
    sequence_count: statistic(62, 58, 29, 87, [[1, 55], [2, 61]], '62 sequences — like the previous revisions (median 58, ±50 %).'),
    sequence_length: statistic(3.9, 4.1, 2.1, 6.2, [[1, 4.1], [2, 4.1]], 'Sequences of 3.9 images on average — like the previous revisions (median 4.1, ±50 %).'),
    out_of_range: [], tolerance_hours: 1, camera_mismatches: [], camera_models_found: [CAMERA.model],
  }

  // The report of the deployment's checks: one row for each, all passed.
  const POSTVALIDATION_REPORT_ID = '20261006-094700_postvalidation_R0003-DONA_01'
  const postvalidationReport = () => {
    const rows = [['deployment_id', 'Deployment id format'], ['collection_prefix', 'Deployment id starts with its collection'], ['collection_name', 'Collection name'],
      ['location', 'Deployment id’s location'], ['time_range', 'Image dates fit the deployment'], ['camera', 'Camera consistency'],
      ['image_count', 'Number of images'], ['sequence_count', 'Number of sequences'], ['sequence_length', 'Length of the sequences']]
    const checks = {}
    rows.forEach(([c, label]) => { checks[c] = { label, scope: 'deployment', ok: 1, failed: 0 } })
    const entries = rows.map(([c]) => ({ identifier: '(deployment)', check: c, status: 'ok', message: POSTVALIDATION[c]?.message ?? 'ok' }))
    return {
      id: POSTVALIDATION_REPORT_ID, kind: 'postvalidation', title: 'Checks of R0003-DONA_01', created_at: '2026-10-06T09:47:00+00:00',
      source_dir: '/home/me/Pictures/R0003-DONA_01', deployment_id: 'R0003-DONA_01', checked: 241, parameters: {}, checks,
      totals: { entries: entries.length, ok: entries.length, failed: 0, images_with_issues: 0 }, entries,
    }
  }

  const PREVIOUS = {
    revision: 2, deployment_id: 'R0002-DONA_01',
    deployment: {
      deployment_id: 'R0002-DONA_01', location_id: 'DONA_01', location_name: 'Doñana site 1', latitude: 37.0074, longitude: -6.4392,
      coordinate_uncertainty: 50, start_date: '2024-06-01T09:00:00+02:00', end_date: '2024-07-10T08:00:00+02:00',
      setup_by: 'M. Ruiz', camera_id: CAMERA.id, camera_model: CAMERA.model, camera_interval: 5, camera_height: 0.6, camera_tilt: 0,
      camera_heading: 180, detection_distance: 12, bait_use: false, feature_type: 'trailGame', habitat: 'Mediterranean scrubland',
      deployment_groups: 'season:summer 2024', comments: null, tags: [],
    },
  }

  const SETTINGS = {
    GENERAL: { log_level: 'INFO', workers: 4, cpu_count: 8, log_file: '/home/me/.local/state/wildintel-uploader/log/wildintel-uploader.log', log_level_override: null },
    TRAPPER: { base_url: TRAPPER_URL, user_name: 'field.team@example.org', has_password: true, max_zip_mb: 500 },
    EPICOLLECT5: { enabled: true, unmapped_to_comments: true, project_slug: 'donana-cameras', client_id: null, has_secret: false,
      mapping: { location_id: 'l', location_name: 'n', revision: 'r', start_date: 'sd', start_time: 'st', camera_model: 'm' } },
    DATA: { dir: DATA_DIR, collections_dir: null, reports_dir: null, packages_dir: null,
      default_collections_dir: `${DATA_DIR}/collections`, default_reports_dir: `${DATA_DIR}/reports`, default_packages_dir: `${DATA_DIR}/packages` },
    VALIDATION: { corrupted: true, sequence: true, structure: true, camera: true, exif: true, duplicates: true },
    POSTVALIDATION: {
      deployment_id: true, collection_prefix: true, collection_name: true, location: true, time_range: true, camera: true,
      image_count: true, sequence_count: true, sequence_length: true,
      tolerance_hours: 1, sequence_gap_seconds: 60, min_revisions: 2, similarity_method: 'median',
      image_count_tolerance: 50, sequence_count_tolerance: 50, sequence_length_tolerance: 50,
    },
    PREPROCESSING: {
      rename: true, resize: true, resize_width: 2400, metadata: true, owner: 'Estación Biológica de Doñana', publisher: 'WildINTEL',
      coverage: 'Doñana National Park', license_url: 'https://creativecommons.org/licenses/by-nc/4.0/', ignore_dst: true, convert_to_utc: true,
    },
  }

  const TRAPPER_PROJECTS = [
    { pk: 2, name: 'Doñana National Park', acronym: 'DONA' },
    { pk: 5, name: 'Sierra Morena', acronym: 'SMOR' },
    { pk: 7, name: 'Bavarian Forest', acronym: 'BFNP' },
  ]

  const UPLOAD_COLLECTIONS = [{
    name: 'R0003', path: `${COLLECTIONS}/DONA/R0003`,
    deployments: [
      { deployment_id: 'R0003-DONA_01', location_id: 'DONA_01', start_date: '2024-09-04T13:10:00+02:00', end_date: '2024-10-12T07:02:41+02:00', images: 241, preprocessed: true, uploaded_at: null },
      { deployment_id: 'R0003-DONA_02', location_id: 'DONA_02', start_date: '2024-09-04T14:02:11+02:00', end_date: '2024-10-12T07:40:09+02:00', images: 188, preprocessed: true, uploaded_at: null },
      { deployment_id: 'R0003-DONA_03', location_id: 'DONA_03', start_date: '2024-09-05T09:31:00+02:00', end_date: '2024-10-13T08:15:33+02:00', images: 305, preprocessed: true, uploaded_at: '2026-09-27T10:12:00+00:00' },
    ],
  }]

  // The reports the validation, the postvalidation and the preprocessing leave.
  const VALIDATION_REPORT_ID = '20261006-094512_validation_R0003-DONA_01'
  const REPORTS = {
    [VALIDATION_REPORT_ID]: validationReport(VALIDATION_REPORT_ID),
    [POSTVALIDATION_REPORT_ID]: postvalidationReport(),
    '20261006-094930_preprocessing_R0003-DONA_01': {
      id: '20261006-094930_preprocessing_R0003-DONA_01', kind: 'preprocessing', title: 'Preprocessing of R0003-DONA_01', created_at: '2026-10-06T09:49:30+00:00',
      source_dir: '/home/me/Pictures/R0003-DONA_01', deployment_id: 'R0003-DONA_01', checked: 241, parameters: { rename: true, resize: true, metadata: true },
      checks: { preprocessing: { label: 'Preprocessing', scope: 'images', ok: 241, failed: 0 } },
      totals: { entries: 241, ok: 241, failed: 0 }, entries: [],
    },
  }
  const reportSummary = ({ entries, parameters, checks, ...summary }) => summary

  const step = (name, status, message, url) => ({ type: 'step', step: name, status, message, ...(url ? { url } : {}) })

  // One deployment's upload: all done — or, held, halfway through sending a zip.
  const uploadEvents = (body, halfway) => {
    const id = body.deployment_id
    const images = { 'R0003-DONA_01': 241, 'R0003-DONA_02': 188, 'R0003-DONA_03': 305 }[id]
    const events = [
      step('connect', 'done', `Connected to ${TRAPPER_URL}.`),
      step('classification', 'done', 'Classification project: DONA 2024.'),
      step('location', 'done', `Location ${id.split('-')[1]} already in Trapper.`, `${TRAPPER_URL}/geomap/location/detail/${12 + Number(id.slice(-1))}/`),
      step('deployment', 'done', `Deployment ${id} created in Trapper.`, `${TRAPPER_URL}/geomap/deployment/detail/${46 + Number(id.slice(-1))}/`),
      step('package', 'done', `Packed ${images} images in 1 zip (${Math.round(images * 0.49)} MB).`),
      { type: 'package_ready', images, parts: 1, bytes: Math.round(images * 0.49 * 1048576) },
      step('csv', 'done', 'R0003_deployments.csv updated.'),
    ]
    if (halfway) {
      events.push(step('upload', 'running', 'Uploading R0003-DONA_02_part1.zip…'))
      events.push({ type: 'upload_progress', file: 'R0003-DONA_02_part1.zip', bytes: 52428800, total: 98566144 })
      return events
    }
    events.push(
      step('upload', 'done', 'Uploaded R0003-DONA_01_part1.zip.'),
      step('process', 'done', 'Trapper is processing the collection.'),
      step('wait', 'done', 'The collection is ready.', `${TRAPPER_URL}/storage/collection/detail/26/`),
      { type: 'done', mode: body.mode, collection: 'R0003', deployment_id: id, parts: 1, location_created: false, deployment_created: true, bytes: Math.round(images * 0.49 * 1048576) },
    )
    return events
  }

  const mock = {
    sessions: [],
    uploads: 0,
    streamDelay: 0,
    streams: {
      '/api/deployment-import/preprocess': () => ({
        events: [
          ...Array.from({ length: 241 }, (_, i) => ({ type: 'copy', index: i + 1, total: 241, name: `R0003-DONA_01__20240904_${i + 1}.JPEG` })),
          { type: 'metadata', total: 241 },
          { type: 'done', dest_dir: `${COLLECTIONS}/DONA/R0003/R0003-DONA_01`, processed: 241, skipped: 0, sealed: null, report_id: '20261006-094930_preprocessing_R0003-DONA_01' },
        ],
      }),
      '/api/repair/deployment': (body) => ({
        events: [
          { type: 'step', step: 'inspect', status: 'done', message: '188 image(s), 2 of 4 metadata files.' },
          { type: 'step', step: 'dates', status: 'done', message: '2024-09-04 14:02:11 → 2024-10-12 07:40:09 (the timestamp log says so).' },
          { type: 'step', step: 'deployment', status: 'done', message: 'deployment.json rebuilt.' },
          { type: 'step', step: 'preprocessing', status: 'done', message: 'preprocessing.json written for 188 image(s).' },
          { type: 'step', step: 'images', status: 'done', message: 'images.json written: 188 image(s).' },
          { type: 'step', step: 'seal', status: 'done', message: 'Sealed. The images passed every check.' },
          { type: 'done', deployment_id: body.deployment_id, images: 188, written: ['deployment.json', 'preprocessing.json', 'images.json', 'seal.json'], problems: 0, status: 'valid', report_id: '20261006-094930_preprocessing_R0003-DONA_01' },
        ],
      }),
      '/api/deployment-import/consolidate': () => ({
        events: [
          { type: 'sealing' },
          { type: 'done', dest_dir: `${COLLECTIONS}/DONA/R0003/R0003-DONA_01`, processed: 241, skipped: 0, sealed: true },
        ],
      }),
      '/api/deployment-import/import-local': () => ({
        events: [
          ...Array.from({ length: 241 }, (_, i) => ({ type: 'copy', index: i + 1, total: 241, name: `IMG_${String(i + 1).padStart(4, '0')}.JPG` })),
          { type: 'metadata', total: 241 },
          { type: 'sealing' },
          { type: 'done', dest_dir: `${COLLECTIONS}/DONA/R0003/R0003-DONA_01`, processed: 241, skipped: 0, sealed: true },
        ],
      }),
      '/api/upload/deployment': (body) => {
        mock.uploads += 1
        // The run holds at its second deployment, so a screenshot catches it midway.
        const halfway = body.mode === 'upload' && mock.holdSecond && mock.uploads === 2
        return { events: uploadEvents(body, halfway), hold: halfway }
      },
      '/api/sync/collections': () => ({
        events: [
          { type: 'progress', message: 'Research project DONA: already there.' },
          { type: 'progress', message: 'Reading the locations from Trapper…' },
          { type: 'progress', message: 'Locations: 1 created, 2 already there.' },
          { type: 'progress', message: 'Reading the deployments and collections from Trapper…' },
          { type: 'progress', message: 'R0001: collection created.' },
          { type: 'progress', message: 'R0001-DONA_01: created (224 images).' },
          { type: 'progress', message: 'R0001-DONA_02: created (190 images).' },
          { type: 'progress', message: 'R0002: collection created.' },
          { type: 'progress', message: 'R0002-DONA_01: created (252 images).' },
          {
            type: 'done', research_project_id: 'DONA', folder: `${COLLECTIONS}/DONA`, collections: ['R0001', 'R0002'],
            created: {
              research_project: [], locations: ['DONA_03'], collections: ['R0001', 'R0002'],
              deployments: ['R0001-DONA_01', 'R0001-DONA_02', 'R0002-DONA_01'], timestamp_log: ['R0001', 'R0002'],
              images: ['R0001-DONA_01', 'R0001-DONA_02', 'R0002-DONA_01'],
            },
            kept: { research_project: ['DONA'], locations: ['DONA_01', 'DONA_02'], collections: [], deployments: [], timestamp_log: [], images: [] },
            unassigned: [], failed: [{ deployment_id: 'R0002-DONA_09', error: 'its start date is not valid' }],
          },
        ],
      }),
    },
    json: {
      'GET /api/health': () => ({ status: 'ok' }),
      'GET /api/version': () => ({ current: '0.1.0' }),
      'GET /api/version/check': () => ({ current: '0.1.0', latest: '0.1.0', update_available: false, release_url: null, download_url: null, error: null }),
      'GET /api/settings': () => SETTINGS,
      'PUT /api/settings': () => SETTINGS,
      'GET /api/settings/configs': () => [
        { id: 'default', name: 'Default config', path: '/home/me/.config/wildintel-uploader/settings.toml', active: true },
        { id: 'test-server', name: 'test-server', path: '/home/me/.config/wildintel-uploader/configs/test-server.toml', active: false },
      ],
      'GET /api/trapper/config': () => ({ base_url: TRAPPER_URL, user_name: 'field.team@example.org', has_password: true }),
      'POST /api/trapper/test-connection': () => ({ ok: true, research_projects_count: 3 }),
      'POST /api/trapper/research-projects': () => ({ results: TRAPPER_PROJECTS }),
      'POST /api/trapper/classification-projects': () => ({ results: [{ pk: 10, name: 'DONA 2024', is_active: true }, { pk: 11, name: 'DONA 2023', is_active: false }] }),
      'POST /api/trapper/locations': () => ({ results: LOCATIONS.map((l) => ({ pk: l.trapper_pk, location_id: l.location_id.toLowerCase(), name: l.name, timezone: l.timezone, ignore_dst: true, latitude: l.latitude, longitude: l.longitude })) }),
      'GET /api/deployment-import/exiftool': () => ({ available: true, path: '/usr/bin/exiftool' }),
      'POST /api/deployment-import/browse-folder': () => ({ path: mock.browse }),
      'POST /api/deployment-import/scan-folder': () => SCAN,
      'POST /api/deployment-import/guess-details': (body) => {
        const found = SESSION_SCAN.deployments.find((d) => d.path === body.path)
        return found ? { ...GUESS, ...found.guess } : GUESS
      },
      'POST /api/deployment-import/scan-session': () => ({ ...SESSION_SCAN, deployments: SESSION_SCAN.deployments.map(({ guess, ...d }) => d) }),
      'POST /api/deployment-import/validate-images': () => ({ ...VALIDATION, report_id: VALIDATION_REPORT_ID }),
      'POST /api/deployment-import/validate-deployment': () => ({ ...POSTVALIDATION, report_id: POSTVALIDATION_REPORT_ID }),
      'POST /api/deployment-import/research-projects/list': () => ({ results: [{
        ...PROJECT, sampling_design: 1, sensor_method: 1, animal_types: 1, bait_use: 1, event_interval: 0, keywords: '', abstract: '', methods: '', description: '',
      }] }),
      'POST /api/deployment-import/locations/list': () => ({ results: LOCATIONS }),
      'POST /api/deployment-import/next-revision': () => ({ last: 2, next: 3 }),
      'POST /api/deployment-import/previous-deployments': (body) => ({ results: Object.fromEntries(body.deployment_ids.map((id) => [id, id.endsWith('DONA_01') ? PREVIOUS : null])) }),
      'POST /api/deployment-import/existing-deployments': (body) => ({ results: Object.fromEntries(body.deployment_ids.map((id) => [id, null])) }),
      'POST /api/deployment-import/collection-path': () => ({ path: `${COLLECTIONS}/DONA/R0003`, collection: 'R0003', exists: true, name: 'R0003' }),
      'POST /api/deployment-import/check-collection': () => ({ exists: true, name: 'R0003' }),
      'POST /api/deployment-import/timestamp-log': () => ({ path: `${COLLECTIONS}/DONA/R0003/R0003_FileTimestampLog.csv`, action: 'added', rows: 1, collection: 'R0003' }),
      'POST /api/deployment-import/open-folder': () => ({ opened: '' }),
      'POST /api/epicollect/entries': () => ({ results: [EPICOLLECT_ENTRY] }),
      'POST /api/epicollect/entries/batch': (body) => ({ results: Object.fromEntries(body.location_ids.map((id) => [id, id === 'DONA_01' ? EPICOLLECT_ENTRY : null])) }),
      'GET /api/epicollect/form': () => ({ project: { name: 'Doñana cameras', slug: 'donana-cameras' }, inputs: [
        { ref: 'l', label: 'Location id', type: 'searchsingle', form: 'Visit', group: 'Where', branch: null, options: [] },
        { ref: 'n', label: 'Location name', type: 'text', form: 'Visit', group: 'Where', branch: null, options: [] },
        { ref: 'g', label: 'Location (GPS)', type: 'location', form: 'Visit', group: 'Where', branch: null, options: [] },
        { ref: 'r', label: 'Revision', type: 'integer', form: 'Visit', group: 'When', branch: null, options: [] },
        { ref: 'sd', label: 'Start date', type: 'date', form: 'Visit', group: 'When', branch: null, options: [] },
        { ref: 'st', label: 'Start time', type: 'time', form: 'Visit', group: 'When', branch: null, options: [] },
        { ref: 'm', label: 'Camera model', type: 'text', form: 'Visit', group: 'Camera', branch: null, options: [] },
      ] }),
      'GET /api/reports': () => Object.values(REPORTS).map(reportSummary).sort((a, b) => b.created_at.localeCompare(a.created_at)),
      'GET /api/sessions': () => mock.sessions,
      'POST /api/sessions/scan': (body) => ({ ...UNFINISHED[0], task_id: body.task_id ?? 'new', phase: 'scanned' }),
      'POST /api/sessions/selection': (body) => ({ ...UNFINISHED[0], task_id: body.task_id, phase: 'selected' }),
      'POST /api/sessions/details': (body) => ({ ...UNFINISHED[0], task_id: body.task_id, phase: 'ready' }),
      'POST /api/repair/collections': () => ({ results: [{
        name: 'R0003', path: `${COLLECTIONS}/DONA/R0003`,
        deployments: ['R0003-DONA_01', 'R0003-DONA_02', 'R0003-DONA_03'].map((deployment_id, i) => ({
          deployment_id, images: [241, 188, 305][i], synced: false,
          files: { 'deployment.json': i !== 1, 'images.json': i !== 1, 'preprocessing.json': true, 'seal.json': i === 0 },
        })),
      }] }),
      'POST /api/repair/inspect': (body) => {
        const files = { 'deployment.json': 'ok', 'images.json': 'ok', 'preprocessing.json': 'ok', 'seal.json': 'ok' }
        if (body.deployment_id === 'R0003-DONA_01') return { deployment_id: body.deployment_id, status: 'valid', files, images: 241, log: 'row', problems: [] }
        if (body.deployment_id === 'R0003-DONA_02') {
          return { deployment_id: body.deployment_id, status: 'broken', files: { ...files, 'deployment.json': 'missing', 'images.json': 'missing' }, images: 188, log: 'row',
            problems: ['deployment.json is missing', 'images.json is missing', '3 image(s) changed since they were sealed', 'deployment.json is not what was sealed'] }
        }
        return { deployment_id: body.deployment_id, status: 'unsealed', files: { ...files, 'seal.json': 'missing' }, images: 305, log: 'no row',
          problems: ['It has no seal: its images were never sealed.', 'The collection’s timestamp log has no row for it.'] }
      },
      'POST /api/upload/collections': () => ({ results: UPLOAD_COLLECTIONS }),
      'POST /api/upload/classification-projects': () => ({ results: [{ pk: 10, name: 'DONA 2024', is_active: true }] }),
      'POST /api/upload/check-selection': () => ({ checks: [
        { check: 'research_project', ok: true, message: 'You have access to the research project DONA (#2) in Trapper.' },
        { check: 'collection', ok: true, message: 'You have access to the collection R0003 (#26): it is already in Trapper, so the upload adds to it.' },
      ] }),
      'POST /api/upload/check-access': () => ({ checks: [
        { check: 'research_project', ok: true, message: 'Research project DONA found in Trapper (pk 2).' },
        { check: 'classification_project', ok: true, message: 'Classification project DONA 2024 (pk 10).' },
        { check: 'location', ok: true, message: 'The locations DONA_01, DONA_02 are in Trapper.' },
        { check: 'uploader', ok: true, message: 'The uploader accepted the login.' },
      ] }),
      'POST /api/sync/collection-names': () => ({ results: [
        { name: 'R0001', deployments: ['R0001-DONA_01', 'R0001-DONA_02'] },
        { name: 'R0002', deployments: ['R0002-DONA_01', 'R0002-DONA_09'] },
        { name: 'R0003', deployments: ['R0003-DONA_01', 'R0003-DONA_02', 'R0003-DONA_03'] },
      ] }),
    },
  }

  // Unfinished runs, for the resume page.
  const UNFINISHED = [
    {
      task_id: '5f0c2a1e-8d4b-4c61-9a57-2b3e7f1d6c90', created_at: '2026-09-26T16:02:00+00:00', updated_at: '2026-09-26T16:20:00+00:00',
      phase: 'ready', task: 'deployment', source_dir: '/home/me/Pictures/R0003-DONA_01', scan: SCAN,
      selection: {
        destination: 'local', mode: 'new', research_project: { pk: 2, name: PROJECT.name, acronym: 'DONA' },
        location: { pk: 101, location_id: 'DONA_01', name: 'Doñana site 1', timezone: 'Europe/Madrid' },
        collection_dir: `${COLLECTIONS}/DONA/R0003`, collection_name: 'R0003',
      },
      deployment: PREVIOUS.deployment,
    },
    {
      task_id: '0b7d9e44-1c2f-4a88-b3d1-7e5a0c9f2b61', created_at: '2026-09-22T11:15:00+00:00', updated_at: '2026-09-22T11:20:00+00:00',
      phase: 'scanned', task: 'deployment', source_dir: '/home/me/Pictures/R0003-DONA_02', scan: { ...SCAN, file_count: 188, image_count: 188 },
    },
  ]
  mock.unfinished = UNFINISHED
  mock.reports = REPORTS
  window.__mock = mock

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const realFetch = window.fetch.bind(window)

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href)
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init)
    const method = (init.method || 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body) : {}
    await sleep(30)

    const stream = mock.streams[url.pathname]
    if (stream) {
      const { events, hold } = stream(body)
      const encoder = new TextEncoder()
      const signal = init.signal
      return new Response(new ReadableStream({
        async start(controller) {
          // A few at a time: the page renders as it would with a real run.
          for (let i = 0; i < events.length; i += 200) {
            if (signal?.aborted) return
            controller.enqueue(encoder.encode(events.slice(i, i + 200).map((e) => JSON.stringify(e) + '\n').join('')))
            await sleep(mock.streamDelay)
          }
          if (!hold) controller.close()
        },
      }), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } })
    }

    const report = url.pathname.match(/^\/api\/reports\/([^/]+)$/)
    if (report && method === 'GET' && mock.reports[decodeURIComponent(report[1])]) {
      return new Response(JSON.stringify(mock.reports[decodeURIComponent(report[1])]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    const key = `${method} ${url.pathname}`
    const handler = mock.json[key] ?? (method === 'DELETE' ? () => ({ status: 'ok' }) : null)
    if (!handler) {
      console.warn('[mock] unhandled', key)
      return new Response(JSON.stringify({ detail: `Not mocked: ${key}` }), { status: 404 })
    }
    return new Response(JSON.stringify(handler(body)), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
})()
