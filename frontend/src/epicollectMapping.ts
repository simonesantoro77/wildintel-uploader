import type { EpicollectInput } from './types'

/** What a deployment field holds — which Epicollect5 inputs can fill it. */
export type FieldKind = 'text' | 'number' | 'date' | 'yesno' | 'choice' | 'list' | 'place'

export interface MappedField {
  /** The key in DeploymentFields. */
  key: string
  label: string
  kind: FieldKind
  hint: string
  /** What an input is likely to be called — to suggest the mapping. */
  aliases: string[]
}

export interface MappedGroup { id: string; label: string; fields: MappedField[] }

/** Every field asked for when a deployment is defined, as the wizard groups them. */
export const DEPLOYMENT_FIELD_GROUPS: MappedGroup[] = [
  {
    id: 'where', label: 'Where',
    fields: [
      { key: 'location_id', label: 'Location id', kind: 'text', hint: 'The code of the place, e.g. DONA_01.', aliases: ['location id', 'location', 'site id', 'site', 'camera site', 'station', 'localizacion', 'ubicacion'] },
      { key: 'location_name', label: 'Location name', kind: 'text', hint: 'The place’s name, optional.', aliases: ['location name', 'site name', 'place', 'nombre'] },
      { key: 'latitude', label: 'Latitude', kind: 'place', hint: 'Decimal degrees.', aliases: ['latitude', 'lat', 'latitud', 'gps', 'coordinates', 'location'] },
      { key: 'longitude', label: 'Longitude', kind: 'place', hint: 'Decimal degrees.', aliases: ['longitude', 'lon', 'lng', 'long', 'longitud', 'gps', 'coordinates', 'location'] },
      { key: 'coordinate_uncertainty', label: 'Coordinate uncertainty', kind: 'place', hint: 'In metres.', aliases: ['uncertainty', 'accuracy', 'precision', 'gps accuracy'] },
    ],
  },
  {
    id: 'period', label: 'Period',
    fields: [
      { key: 'start_date', label: 'Start date', kind: 'date', hint: 'When the camera started recording.', aliases: ['start date', 'start', 'begin', 'setup date', 'deployment date', 'date start', 'fecha inicio', 'fecha de inicio', 'date'] },
      { key: 'end_date', label: 'End date', kind: 'date', hint: 'When the camera stopped recording.', aliases: ['end date', 'end', 'retrieval date', 'pickup date', 'date end', 'fecha fin', 'fecha de fin', 'fecha de recogida'] },
    ],
  },
  {
    id: 'camera', label: 'Camera',
    fields: [
      { key: 'camera_model', label: 'Camera model', kind: 'text', hint: 'Manufacturer and model, written as manufacturer-model.', aliases: ['camera model', 'model', 'camera make', 'camara modelo', 'modelo'] },
      { key: 'camera_id', label: 'Camera id', kind: 'text', hint: 'The camera’s serial number.', aliases: ['camera id', 'camera number', 'serial', 'serial number', 'camera', 'camara', 'id camara'] },
      { key: 'camera_interval', label: 'Camera delay (s)', kind: 'number', hint: 'Seconds between triggers.', aliases: ['delay', 'camera delay', 'interval', 'camera interval', 'retraso'] },
      { key: 'detection_distance', label: 'Detection distance (m)', kind: 'number', hint: 'In metres.', aliases: ['detection distance', 'distance', 'distancia'] },
      { key: 'camera_height', label: 'Camera height (m)', kind: 'number', hint: 'Exclusive with depth.', aliases: ['camera height', 'height', 'altura'] },
      { key: 'camera_depth', label: 'Camera depth (m)', kind: 'number', hint: 'Exclusive with height.', aliases: ['camera depth', 'depth', 'profundidad'] },
      { key: 'camera_tilt', label: 'Camera tilt (°)', kind: 'number', hint: '-90 to 90.', aliases: ['tilt', 'camera tilt', 'inclinacion'] },
      { key: 'camera_heading', label: 'Camera heading (°)', kind: 'number', hint: '0 to 360.', aliases: ['heading', 'camera heading', 'bearing', 'azimuth', 'orientacion'] },
    ],
  },
  {
    id: 'site', label: 'Site',
    fields: [
      { key: 'feature_type', label: 'Feature type', kind: 'choice', hint: 'One of the standard’s: road, trail, burrow…', aliases: ['feature type', 'feature', 'placement', 'tipo'] },
      { key: 'habitat', label: 'Habitat', kind: 'text', hint: 'A short description.', aliases: ['habitat', 'vegetation', 'habitat type'] },
      { key: 'setup_by', label: 'Set up by', kind: 'text', hint: 'Who placed the camera.', aliases: ['setup by', 'set up by', 'observer', 'recorder', 'person', 'technician', 'name', 'instalado por'] },
      { key: 'bait_use', label: 'Bait used', kind: 'yesno', hint: 'Yes or no.', aliases: ['bait', 'bait used', 'baited', 'cebo'] },
      { key: 'timestamp_issues', label: 'Timestamps have issues', kind: 'yesno', hint: 'Yes or no.', aliases: ['timestamp issues', 'clock', 'time problems', 'timestamp'] },
    ],
  },
  {
    id: 'notes', label: 'Grouping and notes',
    fields: [
      { key: 'deployment_groups', label: 'Deployment groups', kind: 'text', hint: 'e.g. season:winter 2020 | grid:A1.', aliases: ['groups', 'deployment groups', 'group', 'grid', 'season', 'array', 'grupo'] },
      { key: 'tags', label: 'Tags', kind: 'list', hint: 'A comma-separated list.', aliases: ['tags', 'tag', 'labels', 'etiquetas'] },
      { key: 'comments', label: 'Comments', kind: 'text', hint: 'Notes about the deployment.', aliases: ['comments', 'comment', 'notes', 'remarks', 'observations', 'comentarios', 'notas', 'observaciones'] },
    ],
  },
]

export const ALL_MAPPED_FIELDS: MappedField[] = DEPLOYMENT_FIELD_GROUPS.flatMap((g) => g.fields)

/** Which kinds of Epicollect5 input can fill a field of each kind. A text input can fill any: what was typed is read as it is. */
const FILLS: Record<FieldKind, string[]> = {
  text: ['text', 'textarea', 'dropdown', 'radio', 'searchsingle', 'barcode', 'integer', 'decimal', 'phone'],
  number: ['integer', 'decimal', 'text'],
  date: ['date', 'text'],
  yesno: ['radio', 'dropdown', 'checkbox', 'text'],
  choice: ['dropdown', 'radio', 'searchsingle', 'text'],
  list: ['checkbox', 'searchmultiple', 'text', 'textarea'],
  place: ['location', 'decimal', 'text'],
}

export function canFill(kind: FieldKind, inputType: string): boolean {
  return FILLS[kind].includes(inputType)
}

const normalise = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** For each field not mapped yet, the input whose question is its name (or an alias of it) — never one that cannot fill it,
 * and an exact name before a partial one. Fields already mapped are kept. */
export function suggestMapping(inputs: EpicollectInput[], current: Record<string, string>): Record<string, string> {
  const next = { ...current }
  for (const field of ALL_MAPPED_FIELDS) {
    if (next[field.key]) continue
    const fits = inputs.filter((i) => canFill(field.kind, i.type))
    const names = [field.label, ...field.aliases].map(normalise)
    const exact = fits.find((i) => names.includes(normalise(i.label)))
    const partial = exact ?? fits.find((i) => names.some((n) => n.length > 3 && normalise(i.label).includes(n)))
    if (partial) next[field.key] = partial.ref
  }
  return next
}
