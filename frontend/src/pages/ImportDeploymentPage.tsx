import ValidationDashboard, { formatRun } from '../components/ValidationDashboard'
import WizardStep from '../components/WizardStep'
import { formatDay, formatPeriod } from '../dateFormat'
import TrapperAccountNotice, { trapperAccountReady } from '../components/TrapperAccountNotice'
import type { TrapperAccount } from '../components/TrapperAccountNotice'
import { Fragment, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { TrapperCredentials } from '../api'
import CheckboxList from '../components/CheckboxList'
import Combobox from '../components/Combobox'
import OptionCards from '../components/OptionCards'
import type { Option } from '../components/OptionCards'
import { EMPTY_DEPLOYMENT_FIELDS, EMPTY_RESEARCH_PROJECT } from '../types'
import { applyEntry, entryLabel, entryPeriod } from '../epicollectImport'
import DateSourcePicker from '../components/DateSourcePicker'
import type { DateSource, Period, SourceOption } from '../components/DateSourcePicker'
import type { EpicollectEntry } from '../epicollectImport'
import { RESEARCH_PROJECT_LIMITS, shownProjectErrors, validateResearchProject } from '../researchProjectValidation'
import { isValidTimezone, knownTimezones, shownErrors, stampTimezone, validateDeployment } from '../deploymentValidation'
import type {
  Report, AppSettings, CameraGroup, CollectionPath, PreprocessingOptions, SimilarityMethod, StatisticCheck, StatisticsParams, ExifField, DeploymentCheck, DeploymentCheckResult, DeploymentFields,
  FeatureType, GuessedDetails, ImageCheck, ImportEvent, Location, LocalLocation, LocalResearchProject, PreviousDeployment, ResearchProject, ScanResult,
  SessionSummary, UploadTarget, ValidationResult,
} from '../types'

export const inputClass = 'w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono'
export const labelClass = 'block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300'
export const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400 mt-1'
export const btnPrimary = 'px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
export const btnOutline = 'px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50'

export function SmallSpinner() {
  return <div className="w-4 h-4 border border-zinc-500 border-t-zinc-200 rounded-full animate-spin" />
}

export function StepHeading({ children }: { children: ReactNode }) {
  return <h4 className="text-lg font-semibold mb-1 text-zinc-900 dark:text-zinc-100">{children}</h4>
}

type ConnStatus = 'idle' | 'testing' | 'ok' | 'error'

function fieldId(label: string) {
  return `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

function FieldLabel({ id, label, required }: { id: string; label: string; required?: boolean }) {
  return (
    <div className="flex items-baseline justify-between mb-1.5">
      <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300" htmlFor={id}>{label}</label>
      {required && <span className="text-[11px] uppercase tracking-wide text-blue-600 dark:text-blue-400">Required</span>}
    </div>
  )
}

/** A single optional text/number field in the deployment details grid. */
export function Field({ label, value, onChange, type = 'text', min, max, step, hint, required, placeholder, error, list, maxLength, readOnly }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; min?: number; max?: number; step?: number | string
  hint?: string; required?: boolean; placeholder?: string; error?: string; list?: string; maxLength?: number; readOnly?: boolean
}) {
  const id = fieldId(label)
  return (
    <div>
      <FieldLabel id={id} label={label} required={required} />
      <input id={id} className={`${inputClass} ${error ? 'border-red-500 dark:border-red-500' : ''} ${readOnly ? 'bg-zinc-100 dark:bg-zinc-900 cursor-default' : ''}`} type={type} min={min} max={max} step={step} value={value}
             placeholder={placeholder} list={list} maxLength={maxLength} readOnly={readOnly} aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)} />
      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
      {hint && <p className={hintClass}>{hint}</p>}
    </div>
  )
}

/** A date-and-time field with the browser's own calendar picker. Values
 * travel as ISO local timestamps ("2024-09-04T13:10:00"), the format the
 * scan and the API already use. */
export function DateTimeField({ label, value, onChange, hint, required, error }: {
  label: string; value: string; onChange: (v: string) => void; hint?: string; required?: boolean; error?: string
}) {
  const id = fieldId(label)
  const shown = value.slice(0, 19) // a timezone suffix would make the input reject it
  return (
    <div>
      <FieldLabel id={id} label={label} required={required} />
      <input id={id} type="datetime-local" step={1} className={`${inputClass} [color-scheme:light] dark:[color-scheme:dark]`}
             aria-invalid={error ? true : undefined}
             value={shown} onChange={(e) => onChange(e.target.value.length === 16 ? `${e.target.value}:00` : e.target.value)} />
      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
      {value.length > 19 && <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400 mt-1">Saved as {value}</p>}
      {hint && <p className={hintClass}>{hint}</p>}
    </div>
  )
}

/** A titled group of related fields. */
export function FormCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="mb-5 p-5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/40">
      <h5 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h5>
      {description && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** A dropdown field restricted to a fixed set of options, with a blank
 * "not set" choice. */
export function SelectField({ label, value, onChange, options, hint, allowEmpty = true }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; hint?: string; allowEmpty?: boolean
}) {
  const id = fieldId(label)
  return (
    <div>
      <FieldLabel id={id} label={label} />
      <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {allowEmpty && <option value="">—</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p className={hintClass}>{hint}</p>}
    </div>
  )
}

/** A single yes/no field — unchecked means "not recorded", not "no". */
function CheckboxField({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div>
      <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {hint && <p className={`${hintClass} ml-6`}>{hint}</p>}
    </div>
  )
}

/** A yes/no field as a card with a switch — off means "not recorded", not "no". */
function SwitchRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/40 px-5 py-4">
      <div className="flex-1 min-w-0">
        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{label}</p>
        <p className={`${hintClass} mt-0.5`}>{hint}</p>
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
              className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  )
}

/** Each field's description, as worded by Camtrap DP's own
 * deployments-table-schema.json. */
const DESCRIPTIONS = {
  deploymentID: 'Unique identifier of the deployment.',
  locationID: 'Identifier of the deployment location.',
  locationName: 'Name given to the deployment location.',
  latitude: 'Latitude of the deployment location in decimal degrees, using the WGS84 datum.',
  longitude: 'Longitude of the deployment location in decimal degrees, using the WGS84 datum.',
  coordinateUncertainty: 'Horizontal distance from the given latitude and longitude describing the smallest circle containing the deployment location. Expressed in meters. Especially relevant when coordinates are rounded to protect sensitive species.',
  timezone: "IANA timezone the camera's clock was set to (e.g. Europe/Madrid). It gives both dates their timezone designator.",
  setupBy: 'Name or identifier of the person or organization that deployed the camera.',
  cameraID: 'The camera’s serial number.',
  cameraModel: 'Manufacturer and model, written as manufacturer-model.',
  cameraDelay: 'Predefined duration after detection when further activity is ignored.',
  cameraHeight: 'Height at which the camera was deployed. Expressed in meters. Not to be combined with camera depth.',
  cameraDepth: 'Depth at which the camera was deployed. Expressed in meters. Not to be combined with camera height.',
  cameraTilt: 'Angle at which the camera was deployed in the vertical plane. Expressed in degrees, with -90 facing down, 0 horizontal and 90 facing up.',
  cameraHeading: 'Angle at which the camera was deployed in the horizontal plane. Expressed in decimal degrees clockwise from north, with values ranging from 0 to 360: 0 = north, 90 = east, 180 = south, 270 = west.',
  detectionDistance: 'Maximum distance at which the camera can reliably detect activity.',
  timestampIssues: 'True if timestamps in the media resource for the deployment are known to have (unsolvable) issues (e.g. unknown timezone, am/pm switch).',
  baitUse: 'True if bait was used for the deployment. More information can be provided in tags or comments.',
  featureType: 'Type of the feature (if any) associated with the deployment.',
  habitat: 'Short characterization of the habitat at the deployment location.',
  deploymentGroups: 'Deployment group(s) associated with the deployment. Deployment groups can have a spatial (arrays, grids, clusters), temporal (sessions, seasons, months, years) or other context. Formatted as a pipe (|) separated list for multiple values, with values preferably formatted as key:value pairs.',
  deploymentTags: 'Tag(s) associated with the deployment. Formatted as a comma separated list for multiple values, with values optionally formatted as key:value pairs.',
  deploymentComments: 'Comments or notes about the deployment.',
} as const

/** A multi-line field. */
export function TextAreaField({ label, value, onChange, maxLength, error, hint }: {
  label: string; value: string; onChange: (v: string) => void; maxLength?: number; error?: string; hint?: string
}) {
  const id = fieldId(label)
  return (
    <div>
      <FieldLabel id={id} label={label} />
      <textarea id={id} rows={4} maxLength={maxLength} value={value} aria-invalid={error ? true : undefined}
                className={`${inputClass} ${error ? 'border-red-500 dark:border-red-500' : ''}`} onChange={(e) => onChange(e.target.value)} />
      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
      {(hint || maxLength) && <p className={hintClass}>{hint}{hint && maxLength ? ' ' : ''}{maxLength ? `${value.length}/${maxLength}` : ''}</p>}
    </div>
  )
}

// The choices of Trapper's own "Add research project" form, keyed by its option numbers.
export const SAMPLING_DESIGN_OPTIONS = ['simpleRandom', 'systematicRandom', 'clusteredRandom', 'experimental', 'targeted', 'opportunistic']
  .map((label, i) => ({ value: String(i + 1), label }))
export const SENSOR_METHOD_OPTIONS = ['activityDetection', 'timeLapse', 'both'].map((label, i) => ({ value: String(i + 1), label }))
export const ANIMAL_TYPES_OPTIONS = ['unmarked', 'marked', 'both'].map((label, i) => ({ value: String(i + 1), label }))
export const BAIT_USE_OPTIONS = ['none', 'scent', 'food', 'visual', 'acoustic', 'other'].map((label, i) => ({ value: String(i + 1), label }))

/** One thing the preprocessing does — optional (a box to tick) or always done. */
export function PreprocessItem({ title, always, checked, onToggle, disabledReason, children }: {
  title: string; always?: boolean; checked?: boolean; onToggle?: () => void; disabledReason?: string; children: ReactNode
}) {
  return (
    <li className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center gap-2 mb-1">
        {always ? (
          <span className="text-xs uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">Always</span>
        ) : (
          <input type="checkbox" aria-label={title} checked={Boolean(checked) && !disabledReason} disabled={Boolean(disabledReason)} onChange={onToggle} />
        )}
        <h5 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h5>
      </div>
      <div className="text-sm text-zinc-600 dark:text-zinc-400">{children}</div>
      {disabledReason && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{disabledReason}</p>}
    </li>
  )
}

/** "renaming, resizing and adding metadata", for the import step's sentence. */
export function describePreprocessing(steps: Set<PreprocessStep>): string {
  const names = [steps.has('rename') && 'renaming', steps.has('resize') && 'resizing', steps.has('metadata') && 'adding metadata to'].filter(Boolean) as string[]
  if (names.length === 0) return 'as they are'
  return `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]} them`
}

/** The opt-in checks as a table: one row per check, with whether to run it
 * and whether it must pass to move past this step. "Required" is only
 * meaningful — and only enabled — alongside "run". */
export type CheckStatus = 'running' | 'passed' | 'failed' | 'none'

export function CheckTable<T extends string>({ options, enabled, required, status, describe, outcome, opened, onOpen, onToggleEnabled, onToggleRequired, onSetEnabled, onSetRequired }: {
  options: { value: T; label: string }[]; enabled: Set<T>; required: Set<T>
  /** A line under each check's name, saying what it looks for. */
  describe?: (value: T) => string | undefined
  /** How a check ended — how many images failed it (null for a check of the whole folder) — shown as a badge and a count. Left out, no such columns. */
  outcome?: (value: T) => { failed: number; images: number | null } | undefined
  /** The check whose failures are open, and what opening one does: a check that failed has a chevron. */
  opened?: T | null
  onOpen?: (value: T) => void
  /** How each check is going — shown in a first column: running, or how it ended. Left out, there is no column. */
  status?: (value: T) => CheckStatus
  onToggleEnabled: (value: T) => void; onToggleRequired: (value: T) => void
  /** The whole new set of checks to run / that must pass — what the "all" boxes in the header ask for. */
  onSetEnabled: (next: Set<T>) => void; onSetRequired: (next: Set<T>) => void
}) {
  const th = 'px-3 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400'
  const values = options.map((o) => o.value)
  const runValues = values.filter((v) => enabled.has(v))
  const allRun = runValues.length === values.length
  const someRun = runValues.length > 0
  // "Required" only means something for a check that runs, so the "all" box speaks for those.
  const allRequired = runValues.length > 0 && runValues.every((v) => required.has(v))
  const someRequired = runValues.some((v) => required.has(v))
  const without = (set: Set<T>) => new Set([...set].filter((v) => !values.includes(v)))
  const indeterminate = (partial: boolean) => (el: HTMLInputElement | null) => { if (el) el.indeterminate = partial }
  return (
    <table className="w-full text-sm mb-4 border border-zinc-200 dark:border-zinc-700 rounded">
      <thead className="bg-zinc-50 dark:bg-zinc-800/50">
        <tr>
          {status && <th scope="col" className={`${th} w-12 text-center`}><span className="sr-only">Status</span></th>}
          <th scope="col" className={`${th} text-left`}>{outcome ? 'Tests' : 'Check'}</th>
          <th scope="col" className={`${th} text-center`}>
            <span className="inline-flex items-center gap-2">
              <input type="checkbox" aria-label="Run all checks" checked={allRun} ref={indeterminate(someRun && !allRun)}
                     onChange={() => {
                       if (allRun) { onSetEnabled(without(enabled)); onSetRequired(without(required)) } else onSetEnabled(new Set([...enabled, ...values]))
                     }} />
              Run
            </span>
          </th>
          <th scope="col" className={`${th} text-center`}>
            <span className="inline-flex items-center gap-2">
              <input type="checkbox" aria-label="Require all checks" checked={allRequired} disabled={!someRun} ref={indeterminate(someRequired && !allRequired)}
                     onChange={() => onSetRequired(allRequired ? without(required) : new Set([...required, ...runValues]))} />
              Required to continue
            </span>
          </th>
          {outcome && <th scope="col" className={`${th} text-center`}>Status</th>}
          {outcome && <th scope="col" className={`${th} text-center`}>Failed images</th>}
          {outcome && <th scope="col" className={`${th} w-8`}><span className="sr-only">Open</span></th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
        {options.map((opt) => (
          <tr key={opt.value}>
            {status && <td className="px-3 py-2 text-center"><CheckStatusIcon status={status(opt.value)} required={required.has(opt.value)} label={opt.label} /></td>}
            <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
              {opt.label}
              {describe?.(opt.value) && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{describe(opt.value)}</span>}
            </td>
            <td className="px-3 py-2 text-center">
              <input type="checkbox" aria-label={opt.label} checked={enabled.has(opt.value)} onChange={() => onToggleEnabled(opt.value)} />
            </td>
            <td className="px-3 py-2 text-center">
              <input type="checkbox" aria-label="Required to continue" checked={required.has(opt.value)}
                     disabled={!enabled.has(opt.value)} onChange={() => onToggleRequired(opt.value)} />
            </td>
            {outcome && (() => {
              const result = outcome(opt.value)
              const failed = result !== undefined && result.failed > 0
              return (
                <>
                  <td className="px-3 py-2 text-center">
                    {result && <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${failed ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300' : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'}`}>
                      {failed ? '▲ Failed' : '▲ Passed'}</span>}
                  </td>
                  <td className="px-3 py-2 text-center">{result ? (result.images === null ? (failed ? '—' : 0) : result.failed) : ''}</td>
                  <td className="px-3 py-2 text-center">
                    {failed && onOpen && (
                      <button type="button" aria-label={`${opened === opt.value ? 'Close' : 'Open'} the failures of ${opt.label}`} aria-expanded={opened === opt.value}
                              className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => onOpen(opt.value)}>{opened === opt.value ? '⌄' : '›'}</button>
                    )}
                  </td>
                </>
              )
            })()}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** How strict a check is: it is skipped, only warns about what it finds, or must pass for the step to go on. */
export type Strictness = 'skip' | 'warn' | 'must'

const STRICTNESS_CHOICES: { value: Strictness; label: string }[] = [
  { value: 'skip', label: 'Skip' }, { value: 'warn', label: 'Warn' }, { value: 'must', label: 'Must pass' },
]

export function strictnessOf(enabled: boolean, required: boolean): Strictness {
  return !enabled ? 'skip' : required ? 'must' : 'warn'
}

/** The checks as a table of one row each, with how strict each is (skip, warn, must pass) and how it ended — the failed ones open
 * the images that failed them. */
export function StrictnessTable<T extends string>({ options, enabled, required, running, results = false, unit, describe, outcome, opened, onOpen, note, onChoose }: {
  options: { value: T; label: string }[]; enabled: Set<T>; required: Set<T>
  /** Whether the checks are being run now. */
  running: boolean
  /** The table of results: how strict each check was is only told, not chosen, and the checks are not editable. */
  results?: boolean
  /** What a failure counts, when it is not images — "deployment" for a session, whose checks are counted by the deployments that failed them. */
  unit?: { one: string; many: string }
  describe?: (value: T) => string | undefined
  /** How a check ended: the images that failed it (null for a check of the whole folder). Undefined while it has no result. */
  outcome: (value: T) => { failed: number; images: number | null } | undefined
  opened?: T | null
  onOpen?: (value: T) => void
  /** What to say under a check that failed — its row gets a line of its own. */
  note?: (value: T) => ReactNode
  onChoose?: (value: T, strictness: Strictness) => void
}) {
  const th = 'px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 sticky top-0 bg-zinc-50 dark:bg-zinc-800'
  return (
    <div className="max-h-[26rem] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 mb-3">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {results && <th scope="col" className={`${th} w-12`}><span className="sr-only">Status</span></th>}
            <th scope="col" className={`${th} text-left`}>Check</th>
            <th scope="col" className={`${th} text-center`}>How strict</th>
            {results && <th scope="col" className={`${th} text-right`}>Result</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
          {options.map((opt) => {
            const runs = enabled.has(opt.value)
            const current = strictnessOf(runs, required.has(opt.value))
            const result = runs && !running ? outcome(opt.value) : undefined
            const failed = result !== undefined && result.failed > 0
            const status = checkStatus(runs, running, result ? !failed : null)
            return (
              <Fragment key={opt.value}>
              <tr>
                {results && <td className="pl-4 py-3 text-center align-middle"><CheckStatusIcon status={status} required={current === 'must'} label={opt.label} /></td>}
                <td className="px-4 py-3 text-zinc-800 dark:text-zinc-200">
                  <span className="font-medium">{opt.label}</span>
                  {describe?.(opt.value) && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{describe(opt.value)}.</span>}
                </td>
                <td className="px-4 py-3 text-center">
                  {results ? (
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">{STRICTNESS_CHOICES.find((c) => c.value === current)!.label}</span>
                  ) : (
                  <div role="radiogroup" aria-label={`How strict: ${opt.label}`} className="inline-flex rounded-md border border-zinc-300 dark:border-zinc-600 overflow-hidden">
                    {STRICTNESS_CHOICES.map((c) => (
                      <button key={c.value} type="button" role="radio" aria-checked={current === c.value}
                              className={`px-3 py-1.5 text-xs font-medium leading-tight transition-colors ${
                                current === c.value ? 'bg-blue-600 text-white' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                              }`}
                              onClick={() => onChoose?.(opt.value, c.value)}>{c.label}</button>
                    ))}
                  </div>
                  )}
                </td>
                {results && <td className="px-4 py-3 text-right">
                  {!runs ? <span className="text-xs text-zinc-400 dark:text-zinc-500">Skipped</span> : result && (
                    <button type="button" disabled={!failed || !onOpen} aria-expanded={failed ? opened === opt.value : undefined}
                            aria-label={failed ? `${opened === opt.value ? 'Close' : 'Open'} the failures of ${opt.label}` : undefined}
                            className="inline-flex flex-col items-end gap-0.5 enabled:hover:opacity-80" onClick={() => onOpen?.(opt.value)}>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${failed ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300' : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'}`}>
                        {failed ? 'Failed' : 'Passed'}
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">{!failed ? '0' : unit ? `${result.failed.toLocaleString('en-US')} ${result.failed === 1 ? unit.one : unit.many}` : result.images === null ? 'Whole folder' : `${result.failed.toLocaleString('en-US')} ${result.failed === 1 ? 'image' : 'images'}`}</span>
                    </button>
                  )}
                </td>}
              </tr>
              {failed && note?.(opt.value) && (
                <tr>{results && <td />}<td colSpan={3} className="px-4 pb-3 -mt-1 text-xs text-zinc-600 dark:text-zinc-400">{note(opt.value)}</td></tr>
              )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Whether a check is running, or how it ended: passed, or failed — which stops you if it is required to continue. */
export function CheckStatusIcon({ status, required, label }: { status: CheckStatus; required: boolean; label: string }) {
  if (status === 'running') return <span role="status" aria-label={`${label}: running`} title="Running…" className="inline-flex"><SmallSpinner /></span>
  if (status === 'passed') return <span role="img" aria-label={`${label}: passed`} title="Passed" className="text-emerald-500">✔</span>
  if (status === 'failed') {
    return required
      ? <span role="img" aria-label={`${label}: failed`} title="Failed — it is required to continue" className="text-red-500">✘</span>
      : <span role="img" aria-label={`${label}: failed`} title="Failed" className="text-amber-500">⚠</span>
  }
  return <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-600">–</span>
}

export function toggled<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value); else next.add(value)
  return next
}

/** What's wrong with a typed number that must lie in a range ('' is only "missing" when required). */
function rangeError(text: string, min: number, max: number, required: boolean): string | undefined {
  if (text.trim() === '') return required ? 'Required' : undefined
  const n = Number(text)
  return Number.isFinite(n) && n >= min && n <= max ? undefined : `Must be between ${min} and ${max}.`
}

export type OriginSource = 'trapper' | 'manual'

// A new location's form, its numbers as typed.
const EMPTY_LOCATION_DRAFT = { location_id: '', name: '', timezone: '', ignore_dst: true, latitude: '', longitude: '', coordinate_uncertainty: '' }

export const ORIGIN_SOURCE_OPTIONS: Option<OriginSource>[] = [
  { value: 'trapper', emoji: '🪤', title: 'From Trapper', description: 'Connect to Trapper and pick one — its fields fill in the form.', available: true },
  { value: 'manual', emoji: '✍️', title: 'By hand', description: 'Fill in the form yourself.', available: true },
]

export const IMAGE_CHECK_OPTIONS: { value: ImageCheck; label: string }[] = [
  { value: 'corrupted', label: 'Corrupted images' },
  { value: 'sequence', label: 'Shooting order vs. filename sequence' },
  { value: 'structure', label: 'Folder structure (subfolders)' },
  { value: 'camera', label: 'Same camera on every image' },
  { value: 'exif', label: 'Required photo data' },
  { value: 'duplicates', label: 'Duplicate images (same content)' },
]

export const IMAGE_CHECK_DESCRIPTIONS: Record<ImageCheck, string> = {
  corrupted: 'Checks that every image opens and decodes completely',
  sequence: 'Checks that the shooting order matches the order of the file names',
  structure: 'Checks that all the images are in one folder, with no subfolders',
  camera: 'Checks that every image was taken by the same camera (model and id)',
  exif: 'Checks that every image has its capture date, camera model and camera id',
  duplicates: 'Checks for images with exactly the same content',
}

export const DEPLOYMENT_CHECK_OPTIONS: { value: DeploymentCheck; label: string }[] = [
  { value: 'deployment_id', label: 'Deployment id format (R0033-DONA_01)' },
  { value: 'collection_prefix', label: 'Deployment id starts with its collection' },
  { value: 'collection_name', label: 'Collection name (R0033)' },
  { value: 'location', label: "Deployment id's location is the one chosen" },
  { value: 'time_range', label: 'Image dates fit the deployment (first at the start, last at the end)' },
  { value: 'camera', label: 'Camera consistency' },
  { value: 'image_count', label: 'Number of images is like the previous revisions' },
  { value: 'sequence_count', label: 'Number of sequences is like the previous revisions' },
  { value: 'sequence_length', label: 'Length of the sequences is like the previous revisions' },
]

/** How the postvalidation names each check, and what it says it does. */
export const DEPLOYMENT_CHECK_DISPLAY: Record<DeploymentCheck, { label: string; description: (locationId: string) => string }> = {
  deployment_id: { label: 'Deployment id format', description: () => 'It follows the pattern R + revision number + location, like R0033-DONA_01.' },
  collection_prefix: { label: 'Deployment id starts with its collection', description: () => 'The id begins with the collection you chose.' },
  collection_name: { label: 'Collection name', description: () => 'The collection name is written correctly.' },
  location: { label: "Deployment id's location is the one you chose", description: (id) => `The location in the id matches ${id}.` },
  time_range: { label: 'Image dates fit the deployment', description: () => 'The first image is at the start and the last one at the end.' },
  camera: { label: 'Camera consistency', description: () => 'Every image comes from one camera, the one the deployment says.' },
  image_count: { label: 'Number of images is like the previous revisions', description: () => 'The number of images is close to that of the previous revisions.' },
  sequence_count: { label: 'Number of sequences is like the previous revisions', description: () => 'The number of sequences is close to that of the previous revisions.' },
  sequence_length: { label: 'Length of the sequences is like the previous revisions', description: () => 'The length of the sequences is close to that of the previous revisions.' },
}

export const STATISTIC_CHECKS: StatisticCheck[] = ['image_count', 'sequence_count', 'sequence_length']

export const SIMILARITY_METHODS: { value: SimilarityMethod; label: string }[] = [
  { value: 'median', label: 'The median of the previous revisions' },
  { value: 'mean', label: 'The mean of the previous revisions' },
  { value: 'last', label: 'The last previous revision' },
  { value: 'range', label: 'The range the previous revisions span' },
]

export const ALL_DEPLOYMENT_CHECKS: DeploymentCheck[] = DEPLOYMENT_CHECK_OPTIONS.map((o) => o.value)

export const RANGE_RULE_LABELS = {
  first: 'the first image should be at the start',
  last: 'the last image should be at the end',
  between: 'it should be within the deployment',
} as const

/** The postvalidation's own leeway, in hours, around the deployment's start and end. */
export const DEFAULT_TOLERANCE_HOURS = 1

/** Every check shown, as before anything is configured (or when the settings can't be read). */
export type WizardSettings = Pick<AppSettings, 'VALIDATION' | 'POSTVALIDATION' | 'PREPROCESSING'>

export const DEFAULT_CHECK_SETTINGS: WizardSettings = {
  VALIDATION: { corrupted: true, sequence: true, structure: true, camera: true, exif: true, duplicates: true },
  POSTVALIDATION: {
    deployment_id: true, collection_prefix: true, collection_name: true, location: true, time_range: true, camera: true,
    image_count: true, sequence_count: true, sequence_length: true, tolerance_hours: DEFAULT_TOLERANCE_HOURS,
    sequence_gap_seconds: 60, min_revisions: 2, similarity_method: 'median',
    image_count_tolerance: 50, sequence_count_tolerance: 50, sequence_length_tolerance: 50,
  },
  PREPROCESSING: {
    rename: true, resize: true, resize_width: 2400, metadata: true, owner: '', publisher: '', coverage: '',
    license_url: 'https://creativecommons.org/licenses/by-nc/4.0/', ignore_dst: true, convert_to_utc: true,
  },
}

export type PreprocessStep = 'rename' | 'resize' | 'metadata'

/** The statistical parameters as typed (strings), from the settings. */
export function statParamsOf(post: AppSettings['POSTVALIDATION']) {
  return {
    gap: String(post.sequence_gap_seconds), minRevisions: String(post.min_revisions), method: post.similarity_method,
    imageTol: String(post.image_count_tolerance), seqCountTol: String(post.sequence_count_tolerance), seqLenTol: String(post.sequence_length_tolerance),
  }
}

/** The numbers the typed statistical parameters mean, or null where one isn't valid. */
export function statParamsValid(p: ReturnType<typeof statParamsOf>): StatisticsParams | null {
  const number = (text: string) => (text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : NaN)
  const gap = number(p.gap), minRevisions = number(p.minRevisions)
  const tolerances = [p.imageTol, p.seqCountTol, p.seqLenTol].map(number)
  if (!(gap > 0 && gap <= 86400) || !Number.isInteger(minRevisions) || minRevisions < 1 || minRevisions > 50) return null
  if (tolerances.some((t) => !(t >= 0 && t <= 1000))) return null
  return {
    sequence_gap_seconds: gap, min_revisions: minRevisions, method: p.method,
    image_count_tolerance: tolerances[0], sequence_count_tolerance: tolerances[1], sequence_length_tolerance: tolerances[2],
  }
}

// Camtrap DP's own "featureType" enum — deployments-table-schema.json.
const FEATURE_TYPE_OPTIONS: { value: FeatureType; label: string }[] = [
  { value: 'roadPaved', label: 'Road (paved)' },
  { value: 'roadDirt', label: 'Road (dirt)' },
  { value: 'trailHiking', label: 'Trail (hiking)' },
  { value: 'trailGame', label: 'Trail (game)' },
  { value: 'roadUnderpass', label: 'Road underpass' },
  { value: 'roadOverpass', label: 'Road overpass' },
  { value: 'roadBridge', label: 'Road bridge' },
  { value: 'culvert', label: 'Culvert' },
  { value: 'burrow', label: 'Burrow' },
  { value: 'nestSite', label: 'Nest site' },
  { value: 'carcass', label: 'Carcass' },
  { value: 'waterSource', label: 'Water source' },
  { value: 'fruitingTree', label: 'Fruiting tree' },
]

// ── Step model ───────────────────────────────────────────────────────────────
// The wizard's screens, in order: the folder of images and what can be checked of
// it without knowing the deployment (one screen, in three steps), where it was taken, the deployment's own
// details, what can be checked once they are known, the list of what is done to
// the images, and the import into the local collections folder.

type StepKey = 'images' | 'origin' | 'checks' | 'prepare'

interface StepDescriptor { key: StepKey; label: string }

const STEPS: StepDescriptor[] = [
  { key: 'images', label: 'Images' },
  { key: 'origin', label: 'Origin and dates' },
  { key: 'checks', label: 'Check details' },
  { key: 'prepare', label: 'Prepare and save' },
]

/** The naming wildintel-tools expects: R + the revision as four digits, a
 * hyphen and the location id — "R0003-DONA_01". Empty until both are known. */
export function revisionOf(deploymentId: string): string {
  const match = /^R(\d{4})-/.exec(deploymentId)
  return match ? String(Number(match[1])) : ''
}

export function buildDeploymentId(revision: string, locationId: string | null | undefined): string {
  const n = Number(revision)
  if (!revision.trim() || !Number.isInteger(n) || n < 1 || n > 9999 || !locationId?.trim()) return ''
  return `R${String(n).padStart(4, '0')}-${locationId.trim()}`
}

export const EXIF_FIELD_LABELS: Record<ExifField, string> = { date: 'a capture date', camera_model: 'a camera model', camera_id: 'a camera id' }

/** "Reconyx HC600 · id P800HG08", whichever of the two is known. */
export function describeCamera(camera: CameraGroup): string {
  return [camera.model ?? 'unknown model', camera.camera_id ? `id ${camera.camera_id}` : 'no id'].join(' · ')
}

/** One check over several deployments: failed if it failed in any, passed if it passed in all, unknown otherwise. */
export function allPassed(results: (boolean | null)[]): boolean | null {
  if (results.some((r) => r === false)) return false
  return results.length > 0 && results.every((r) => r === true) ? true : null
}

/** The status a check shows: running while its step runs, then how it ended — or nothing, if it didn't run. */
export function checkStatus(runs: boolean, running: boolean, passed: boolean | null): CheckStatus {
  if (!runs) return 'none'
  if (running) return 'running'
  return passed === null ? 'none' : passed ? 'passed' : 'failed'
}

export function imageCheckPassed(check: ImageCheck, result: ValidationResult | null): boolean | null {
  if (!result) return null
  if (check === 'corrupted') return result.corrupted !== undefined ? result.corrupted.length === 0 : null
  if (check === 'sequence') return result.sequence_issues !== undefined ? result.sequence_issues.length === 0 : null
  if (check === 'exif') return result.exif_missing !== undefined ? Object.values(result.exif_missing).every((m) => m.count === 0) : null
  if (check === 'duplicates') return result.duplicates !== undefined ? result.duplicates.length === 0 : null
  if (check === 'camera') return result.cameras !== undefined ? result.cameras.length === 1 && (result.cameras_without_info ?? 0) === 0 : null
  return result.subdirectories !== undefined ? result.subdirectories.length === 0 : null
}

export function deploymentCheckPassed(check: DeploymentCheck, result: DeploymentCheckResult | null): boolean | null {
  if (!result) return null
  if (check === 'time_range') return result.out_of_range !== undefined ? result.out_of_range.length === 0 : null
  if (check !== 'camera') return result[check] !== undefined ? result[check]!.ok : null  // the naming and the statistical checks all say {ok}
  if (result.camera_mismatches === undefined) return null
  return result.camera_mismatches.length === 0 && (result.camera_models_found?.length ?? 0) <= 1
}

/** Where the deployment was taken, and the timezone and summer-time setting it is read in, as tags. They are the location's — kept with it,
 * never asked for a deployment: every deployment there is read in them, and Trapper only accepts a package that declares the same ones. */
export function LocationTimeNote({ locationId, latitude, longitude, timezone, ignoreDst }: {
  locationId: string | null | undefined; latitude?: number | null; longitude?: number | null; timezone: string; ignoreDst: boolean
}) {
  if (!locationId) return null
  if (!timezone) {
    return <span className="block text-red-600 dark:text-red-400">The location <strong>{locationId}</strong> has no timezone, and a deployment needs it: add it to the location.</span>
  }
  const tag = 'rounded-full border border-zinc-300 dark:border-zinc-700 px-2.5 py-0.5 text-xs text-zinc-700 dark:text-zinc-300'
  return (
    <span className="flex flex-wrap gap-1.5">
      {latitude != null && longitude != null && <span className={tag}>GPS {latitude}, {longitude}</span>}
      <span className={tag}>{timezone}</span>
      <span className={tag}>{ignoreDst ? 'Ignores summer time' : 'Follows summer time'}</span>
    </span>
  )
}

/** The deployment's period, and — behind a tick — its camera, site and notes: Camtrap DP's own fields. */
type DetailsSection = 'camera' | 'site' | 'notes'

/** Line icons (24×24, stroke — lucide's shapes, as the settings page's), in the colour of the text. */
const DETAILS_SECTIONS: { id: DetailsSection; label: string; icon: ReactNode }[] = [
  { id: 'camera', label: 'Camera', icon: <><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></> },
  { id: 'site', label: 'Site', icon: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></> },
  { id: 'notes', label: 'Grouping and notes', icon: <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><line x1="16" x2="8" y1="13" y2="13" /><line x1="16" x2="8" y1="17" y2="17" /><line x1="10" x2="8" y1="9" y2="9" /></> },
]


/** A list of short values — typed in and added one by one, shown as chips that can be taken out again. */
function ChipEditor({ label, values, onChange, addLabel, placeholder, hint, suggestions }: {
  label: string; values: string[]; onChange: (values: string[]) => void; addLabel: string; placeholder: string; hint?: string; suggestions?: string[]
}) {
  const [text, setText] = useState('')
  const add = (value: string) => {
    const v = value.trim()
    if (v && !values.includes(v)) onChange([...values, v])
    setText('')
  }
  const id = fieldId(label)
  return (
    <div>
      <label className="block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300" htmlFor={id}>{label}</label>
      {hint && <p className={`${hintClass} mb-2 mt-0`}>{hint}</p>}
      <div className="flex gap-2">
        <input id={id} className={`${inputClass} flex-1`} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text) } }} />
        <button type="button" aria-label={addLabel} className={btnOutline} disabled={!text.trim()} onClick={() => add(text)}>Add</button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 dark:border-zinc-600 px-3 py-1 text-xs font-mono text-zinc-700 dark:text-zinc-300">
              {v}
              <button type="button" aria-label={`Remove ${v}`} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => onChange(values.filter((x) => x !== v))}>×</button>
            </span>
          ))}
        </div>
      )}
      {suggestions && suggestions.filter((x) => !values.includes(x)).length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>Suggestions:</span>
          {suggestions.filter((x) => !values.includes(x)).map((x) => (
            <button key={x} type="button" className="rounded-full border border-dashed border-zinc-300 dark:border-zinc-600 px-2.5 py-0.5 font-mono hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => add(x)}>{x}</button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A section of the details — shut until it is opened, with how much of it is filled in on its header: "3 of 7". */
function SectionCard({ title, icon, filled, total, summary, optional = false, children }: { title: string; icon: ReactNode; filled: number; total: number; summary?: string; optional?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-700 mb-3" aria-label={title}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-zinc-500 dark:text-zinc-400">{icon}</svg>
        <span className="min-w-0">
          <span className="block text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}{optional && <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">optional</span>}</span>
          {!open && summary && <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">{summary}</span>}
        </span>
        <span className={`ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${filled > 0 ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'}`}>{filled} of {total} filled</span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 fill-none stroke-current text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  )
}

const HEADINGS: { label: string; degrees: number }[] = [
  { label: 'N', degrees: 0 }, { label: 'NE', degrees: 45 }, { label: 'E', degrees: 90 }, { label: 'SE', degrees: 135 },
  { label: 'S', degrees: 180 }, { label: 'SW', degrees: 225 }, { label: 'W', degrees: 270 }, { label: 'NW', degrees: 315 },
]
const roundPill = (active: boolean) => `px-4 py-2 text-sm font-medium rounded-full border transition-colors ${active ? 'bg-blue-600 border-blue-600 text-white' : 'border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`

/** An angle in degrees: its label, a short input with the degree sign, the quick picks beside it, and one line on what it means. */
function AngleRow({ label, value, onChange, min, max, placeholder, hint, error, children }: {
  label: string; value: number | null | undefined; onChange: (v: number | null) => void; min: number; max: number; placeholder: string
  hint: string; error?: string; children: ReactNode
}) {
  const id = fieldId(label)
  return (
    <div>
      <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5" htmlFor={id}>{label}</label>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative w-32">
          <input id={id} type="number" min={min} max={max} step={1} placeholder={placeholder} aria-invalid={error ? true : undefined}
                 className={`${inputClass} pr-8 ${error ? 'border-red-500 dark:border-red-500' : ''}`}
                 value={value?.toString() ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} />
          <span aria-hidden="true" className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500 dark:text-zinc-400 pointer-events-none">°</span>
        </div>
        {children}
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
      <p className={hintClass}>{hint}</p>
    </div>
  )
}

const TILTS: { label: string; degrees: number }[] = [{ label: 'Down −90°', degrees: -90 }, { label: 'Level 0°', degrees: 0 }, { label: 'Up 90°', degrees: 90 }]

/** The optional details of a deployment — its camera, its site, its groups, tags and comments — as three cards, every field in view. */
export function MoreDetailsForm({ deployment, errors, onField }: {
  deployment: DeploymentFields; errors: ReturnType<typeof shownErrors>
  onField: <K extends keyof DeploymentFields>(key: K, value: DeploymentFields[K]) => void
}) {
  const [mount, setMount] = useState<'above' | 'below'>(deployment.camera_depth != null ? 'below' : 'above')
  const groups = (deployment.deployment_groups ?? '').split('|').map((g) => g.trim()).filter(Boolean)
  const count = (values: unknown[]) => values.filter((v) => v != null && v !== '' && v !== false).length
  const chooseMount = (next: 'above' | 'below') => {
    setMount(next)
    if (next === 'above') onField('camera_depth', null); else onField('camera_height', null)
  }
  const pill = (active: boolean) => `px-4 py-2 text-sm rounded-md border transition-colors ${active ? 'bg-blue-600 border-blue-600 text-white' : 'border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`
  const small = (active: boolean) => `px-2.5 py-1 text-xs rounded-md border ${active ? 'bg-blue-600 border-blue-600 text-white' : 'border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`
  const [camera, site, notes] = DETAILS_SECTIONS
  const sum = (parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' · ')
  const cameraSummary = sum([
    deployment.camera_model, deployment.camera_id,
    mount === 'above' ? deployment.camera_height != null && `${deployment.camera_height} m above the ground` : deployment.camera_depth != null && `${deployment.camera_depth} m below the surface`,
    deployment.camera_tilt != null && `tilt ${deployment.camera_tilt}°`, deployment.camera_heading != null && `heading ${deployment.camera_heading}°`,
    deployment.camera_interval != null && `delay ${deployment.camera_interval} s`, deployment.detection_distance != null && `detects up to ${deployment.detection_distance} m`,
  ])
  const siteSummary = sum([
    FEATURE_TYPE_OPTIONS.find((o) => o.value === deployment.feature_type)?.label, deployment.habitat, deployment.setup_by && `set up by ${deployment.setup_by}`,
    deployment.bait_use && 'bait used', deployment.timestamp_issues && 'photo dates may be wrong',
  ])
  const notesSummary = sum([groups.length > 0 && groups.join(', '), deployment.tags.length > 0 && `${deployment.tags.length} ${deployment.tags.length === 1 ? 'tag' : 'tags'}`, deployment.comments && 'comments'])
  return (
    <div>
      <SectionCard title="Camera" icon={camera.icon} total={7} summary={cameraSummary}
                   filled={count([deployment.camera_model, deployment.camera_id, mount === 'above' ? deployment.camera_height : deployment.camera_depth, deployment.camera_tilt, deployment.camera_heading, deployment.camera_interval, deployment.detection_distance])}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Camera model" placeholder="e.g. Reconyx-PC800" hint={DESCRIPTIONS.cameraModel}
                 value={deployment.camera_model ?? ''} onChange={(v) => onField('camera_model', v || null)} />
          <Field label="Camera id" placeholder="e.g. P800HG08192031" hint={DESCRIPTIONS.cameraID}
                 value={deployment.camera_id ?? ''} onChange={(v) => onField('camera_id', v || null)} />
        </div>

        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mt-5 mb-1">How was it mounted?</p>
        <p className={`${hintClass} mt-0 mb-2`}>A camera is either above the ground or below the surface (snow, ice, water) — so there is one measurement.</p>
        <div className="flex gap-2 mb-3" role="group" aria-label="How was it mounted?">
          <button type="button" aria-pressed={mount === 'above'} className={pill(mount === 'above')} onClick={() => chooseMount('above')}>Above the ground</button>
          <button type="button" aria-pressed={mount === 'below'} className={pill(mount === 'below')} onClick={() => chooseMount('below')}>Below the surface</button>
        </div>
        <div className="max-w-xs">
          {mount === 'above' ? (
            <Field label="Height above the ground (m)" type="number" min={0} step="any" placeholder="e.g. 1.2" hint="Measured from the ground to the camera, in meters." error={errors.camera_height}
                   value={deployment.camera_height?.toString() ?? ''} onChange={(v) => onField('camera_height', v ? Number(v) : null)} />
          ) : (
            <Field label="Depth below the surface (m)" type="number" min={0} step="any" placeholder="e.g. 4.8" hint="For underwater cameras, measured down from the surface, in meters." error={errors.camera_depth}
                   value={deployment.camera_depth?.toString() ?? ''} onChange={(v) => onField('camera_depth', v ? Number(v) : null)} />
          )}
        </div>

        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mt-5 mb-2">Where does it point?</p>
        <div className="space-y-4">
          <AngleRow label="Tilt" placeholder="e.g. -90" min={-90} max={90} value={deployment.camera_tilt} error={errors.camera_tilt}
                    hint="Angle up or down: -90° faces the ground, 0° is level, 90° faces the sky." onChange={(v) => onField('camera_tilt', v)}>
            {TILTS.map((t) => <button key={t.label} type="button" className={roundPill(deployment.camera_tilt === t.degrees)} onClick={() => onField('camera_tilt', t.degrees)}>{t.label}</button>)}
          </AngleRow>
          <AngleRow label="Heading" placeholder="e.g. 225" min={0} max={360} value={deployment.camera_heading} error={errors.camera_heading}
                    hint="Compass direction, from 0° to 360°: 0 is north, 90 east, 180 south, 270 west." onChange={(v) => onField('camera_heading', v)}>
            {HEADINGS.map((h) => <button key={h.label} type="button" aria-label={`Heading ${h.label}`} className={roundPill(deployment.camera_heading === h.degrees)} onClick={() => onField('camera_heading', h.degrees)}>{h.label}</button>)}
          </AngleRow>
        </div>

        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mt-5 mb-2">How does it detect?</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Camera delay (s)" type="number" min={0} step={1} placeholder="e.g. 120" hint={DESCRIPTIONS.cameraDelay} error={errors.camera_interval}
                 value={deployment.camera_interval?.toString() ?? ''} onChange={(v) => onField('camera_interval', v ? Number(v) : null)} />
          <Field label="Detection distance (m)" type="number" min={0} step="any" placeholder="e.g. 9.5" hint={DESCRIPTIONS.detectionDistance} error={errors.detection_distance}
                 value={deployment.detection_distance?.toString() ?? ''} onChange={(v) => onField('detection_distance', v ? Number(v) : null)} />
        </div>
      </SectionCard>

      <SectionCard title="Site" icon={site.icon} total={5} summary={siteSummary} filled={count([deployment.feature_type, deployment.habitat, deployment.setup_by, deployment.bait_use, deployment.timestamp_issues])}>
        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-1">What is the camera aimed at?</p>
        <p className={`${hintClass} mt-0 mb-2`}>The kind of feature in view, if any.</p>
        <div className="flex flex-wrap gap-2 mb-5" role="group" aria-label="Feature type">
          {FEATURE_TYPE_OPTIONS.map((o) => (
            <button key={o.value} type="button" aria-pressed={deployment.feature_type === o.value} className={small(deployment.feature_type === o.value)}
                    onClick={() => onField('feature_type', deployment.feature_type === o.value ? null : o.value)}>{o.label}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Habitat" placeholder="e.g. Mediterranean scrub" hint={DESCRIPTIONS.habitat}
                 value={deployment.habitat ?? ''} onChange={(v) => onField('habitat', v || null)} />
          <Field label="Set up by" placeholder="e.g. Jakub Bubnicki" hint={DESCRIPTIONS.setupBy}
                 value={deployment.setup_by ?? ''} onChange={(v) => onField('setup_by', v || null)} />
        </div>
        <div className="mt-4 space-y-3">
          <SwitchRow label="Bait was used" hint="Say what it was in the tags or comments below." checked={!!deployment.bait_use} onChange={(v) => onField('bait_use', v || null)} />
          <SwitchRow label="Photo dates may be wrong" hint="Turn on if the dates in the photos are known to be off and can’t be fixed, for example an unknown or wrong camera clock." checked={!!deployment.timestamp_issues} onChange={(v) => onField('timestamp_issues', v || null)} />
        </div>
      </SectionCard>

      <SectionCard title="Grouping and notes" icon={notes.icon} optional total={3} summary={notesSummary} filled={count([groups.length || null, deployment.tags.length || null, deployment.comments])}>
        <div className="space-y-5">
          <ChipEditor label="Groups" values={groups} onChange={(v) => onField('deployment_groups', v.length ? v.join(' | ') : null)} addLabel="Add group"
                      placeholder="e.g. season:winter 2025" hint="Which set the deployment belongs to — an array, a grid, a season. Preferably as key:value." />
          <ChipEditor label="Tags" values={deployment.tags} onChange={(v) => onField('tags', v)} addLabel="Add tag" placeholder="e.g. forest edge"
                      hint="Short words describing the deployment. Use key:value if you like." suggestions={['forest edge', 'bait:food', 'near water']} />
          <TextAreaField label="Comments" hint={DESCRIPTIONS.deploymentComments} value={deployment.comments ?? ''} onChange={(v) => onField('comments', v || null)} />
        </div>
      </SectionCard>
    </div>
  )
}

/** The period, then the rest of the fields one section at a time — chosen from a row of buttons, as a segmented control. */
export function DeploymentFormBody({ deployment, timezone, errors, onField, datesGuessed, datesFromLog, collapsible = false, periodOnly = false }: {
  deployment: DeploymentFields; timezone: string; errors: ReturnType<typeof shownErrors>
  onField: <K extends keyof DeploymentFields>(key: K, value: DeploymentFields[K]) => void
  datesGuessed: boolean
  /** The FileTimestampLog the dates were read from, if they were. */
  datesFromLog?: string
  /** The import's look: the period in a card of its own, and the rest of the fields behind an "optional" panel that opens. */
  collapsible?: boolean
  /** With `collapsible`: the period only — the rest of the details have a step of their own. */
  periodOnly?: boolean
}) {
  const [section, setSection] = useState<DetailsSection>('camera')
  const [moreOpen, setMoreOpen] = useState(false)
  // A section with a field that is wrong says so on its button, whichever is open.
  const flagged: Record<DetailsSection, boolean> = {
    camera: Boolean(errors.camera_interval || errors.detection_distance || errors.camera_height || errors.camera_depth || errors.camera_tilt || errors.camera_heading
      || (deployment.camera_height != null && deployment.camera_depth != null)),
    site: false,
    notes: false,
  }
  const details = (
    <>
    <div role="tablist" aria-label="Section of the details" className="grid grid-cols-3 gap-1 p-1 mb-4 rounded-lg bg-zinc-100 dark:bg-zinc-800/70">
      {DETAILS_SECTIONS.map(({ id, label, icon }) => (
        <button key={id} type="button" role="tab" aria-selected={section === id} onClick={() => setSection(id)}
                className={`relative flex flex-col items-center gap-0.5 rounded-md px-2 py-2 text-sm transition-colors ${section === id
                  ? 'bg-white dark:bg-zinc-600 text-zinc-900 dark:text-zinc-50 shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-700/60'}`}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
          {label}
          {flagged[id] && <span role="img" aria-label="has a problem" className="absolute top-1.5 right-2 h-2 w-2 rounded-full bg-red-500" />}
        </button>
      ))}
    </div>

    {section === 'camera' && (
      <>
        <FormCard title="Camera">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Camera model" placeholder="e.g. Reconyx-PC800" hint={DESCRIPTIONS.cameraModel}
                   value={deployment.camera_model ?? ''} onChange={(v) => onField('camera_model', v || null)} />
            <Field label="Camera id" placeholder="e.g. P800HG08192031" hint={DESCRIPTIONS.cameraID}
                   value={deployment.camera_id ?? ''} onChange={(v) => onField('camera_id', v || null)} />
            <Field label="Camera delay (s)" type="number" min={0} step={1} placeholder="e.g. 120" hint={DESCRIPTIONS.cameraDelay} error={errors.camera_interval}
                   value={deployment.camera_interval?.toString() ?? ''} onChange={(v) => onField('camera_interval', v ? Number(v) : null)} />
            <Field label="Detection distance (m)" type="number" min={0} step="any" placeholder="e.g. 9.5" hint={DESCRIPTIONS.detectionDistance} error={errors.detection_distance}
                   value={deployment.detection_distance?.toString() ?? ''} onChange={(v) => onField('detection_distance', v ? Number(v) : null)} />
            <Field label="Camera height (m)" type="number" min={0} step="any" placeholder="e.g. 1.2" hint={DESCRIPTIONS.cameraHeight} error={errors.camera_height}
                   value={deployment.camera_height?.toString() ?? ''} onChange={(v) => onField('camera_height', v ? Number(v) : null)} />
            <Field label="Camera depth (m)" type="number" min={0} step="any" placeholder="e.g. 4.8" hint={DESCRIPTIONS.cameraDepth} error={errors.camera_depth}
                   value={deployment.camera_depth?.toString() ?? ''} onChange={(v) => onField('camera_depth', v ? Number(v) : null)} />
            <Field label="Camera tilt (°)" type="number" min={-90} max={90} step={1} placeholder="e.g. -90" hint={DESCRIPTIONS.cameraTilt} error={errors.camera_tilt}
                   value={deployment.camera_tilt?.toString() ?? ''} onChange={(v) => onField('camera_tilt', v ? Number(v) : null)} />
            <Field label="Camera heading (°)" type="number" min={0} max={360} step={1} placeholder="e.g. 225" hint={DESCRIPTIONS.cameraHeading} error={errors.camera_heading}
                   value={deployment.camera_heading?.toString() ?? ''} onChange={(v) => onField('camera_heading', v ? Number(v) : null)} />
          </div>
          {deployment.camera_height != null && deployment.camera_depth != null && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">Camera height and depth are mutually exclusive — only one should be set.</p>
          )}
        </FormCard>
      </>
    )}

    {section === 'site' && (
      <>
        <FormCard title="Site">
          <div className="grid grid-cols-2 gap-4">
            <SelectField label="Feature type" value={deployment.feature_type ?? ''} options={FEATURE_TYPE_OPTIONS} hint={DESCRIPTIONS.featureType}
                         onChange={(v) => onField('feature_type', (v || null) as FeatureType | null)} />
            <Field label="Habitat" placeholder="e.g. Mixed temperate low-land forest" hint={DESCRIPTIONS.habitat}
                   value={deployment.habitat ?? ''} onChange={(v) => onField('habitat', v || null)} />
            <Field label="Set up by" placeholder="e.g. Jakub Bubnicki" hint={DESCRIPTIONS.setupBy}
                   value={deployment.setup_by ?? ''} onChange={(v) => onField('setup_by', v || null)} />
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <CheckboxField label="Bait used" hint={DESCRIPTIONS.baitUse} checked={!!deployment.bait_use} onChange={(v) => onField('bait_use', v || null)} />
            <CheckboxField label="Timestamps have issues" hint={DESCRIPTIONS.timestampIssues} checked={!!deployment.timestamp_issues} onChange={(v) => onField('timestamp_issues', v || null)} />
          </div>
        </FormCard>
      </>
    )}

    {section === 'notes' && (
      <>
        <FormCard title="Grouping and notes">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Deployment groups" placeholder="e.g. season:winter 2020 | grid:A1" hint={DESCRIPTIONS.deploymentGroups}
                   value={deployment.deployment_groups ?? ''} onChange={(v) => onField('deployment_groups', v || null)} />
            <Field label="Tags (comma-separated)" placeholder="e.g. forest edge, bait:food" hint={DESCRIPTIONS.deploymentTags}
                   value={deployment.tags.join(', ')} onChange={(v) => onField('tags', v.split(',').map((t) => t.trim()).filter(Boolean))} />
            <div className="col-span-2">
              <Field label="Comments" hint={DESCRIPTIONS.deploymentComments}
                     value={deployment.comments ?? ''} onChange={(v) => onField('comments', v || null)} />
            </div>
          </div>
        </FormCard>
      </>
    )}
    </>
  )
  return (
    <>
    {!collapsible && (
    <div className="flex justify-end mb-3">
      <button type="button" disabled title="Coming soon"
              className="rounded-md border border-zinc-300 dark:border-zinc-600 px-3 py-1.5 text-sm text-zinc-400 dark:text-zinc-500 cursor-not-allowed">
        Import info from Epicollect5 — coming soon
      </button>
    </div>
    )}
    {collapsible ? (
      <FormCard title="Period" description="When the camera was recording.">
        <div className="grid grid-cols-2 gap-4">
          <DateTimeField label="Start" required error={errors.start_date}
                         value={deployment.start_date} onChange={(v) => onField('start_date', stampTimezone(v, timezone))} />
          <DateTimeField label="End" required error={errors.end_date}
                         value={deployment.end_date ?? ''} onChange={(v) => onField('end_date', v ? stampTimezone(v, timezone) : null)} />
        </div>
        {datesGuessed && <p className="mt-3 flex items-center gap-2 rounded-md bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-xs text-blue-800 dark:text-blue-300"><span aria-hidden="true">ⓘ</span>Filled in from the images' photo data — change them if they're wrong</p>}
        {datesFromLog && <p className={hintClass}>The dates were taken from {datesFromLog}, not from the images' EXIF data.</p>}
      </FormCard>
    ) : (
      <FormCard title="Period" description="When the camera was recording. Pick a date from the calendar or type it.">
            <div className="grid grid-cols-2 gap-4">
              <DateTimeField label="Start date" required error={errors.start_date}
                             value={deployment.start_date} onChange={(v) => onField('start_date', stampTimezone(v, timezone))} />
              <DateTimeField label="End date" required error={errors.end_date}
                             value={deployment.end_date ?? ''} onChange={(v) => onField('end_date', v ? stampTimezone(v, timezone) : null)} />
            </div>
            {datesGuessed && <p className={hintClass}>The dates were guessed from the images' EXIF data.</p>}
            {datesFromLog && <p className={hintClass}>The dates were taken from {datesFromLog}, not from the images' EXIF data.</p>}
          </FormCard>
    )}

    {collapsible && periodOnly ? null : collapsible ? (
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
        <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
          <span>
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">More details <span className="font-normal text-zinc-500 dark:text-zinc-400">optional</span></span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">Camera, site, grouping and notes. You can fill these in later.</span>
          </span>
          <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 fill-none stroke-current text-zinc-500 transition-transform ${moreOpen ? 'rotate-180' : ''}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {moreOpen && (
          <div className="px-4 pb-4">
            {details}
          </div>
        )}
      </div>
    ) : details}
    </>
  )
}

/** What the image checks found — only the checks that were run have something to say. */
export function ValidationReport({ validation }: { validation: ValidationResult }) {
  return (
    <div className="mt-4 text-sm space-y-1 mb-2">
      {validation.corrupted !== undefined && (
        <p className={validation.corrupted.length ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>
          {validation.corrupted.length
            ? `⚠ ${validation.corrupted.length} corrupted image(s): ${validation.corrupted.map((c) => c.path).join(', ')}`
            : '✔ No corrupted images.'}
        </p>
      )}
      {validation.sequence_issues !== undefined && (
        <p className={validation.sequence_issues.length ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
          {validation.sequence_issues.length
            ? `⚠ ${validation.sequence_issues.length} out-of-order shot(s): ${validation.sequence_issues.map((i) => `${i.path_a} (${i.date_a.slice(0, 10)}) → ${i.path_b} (${i.date_b.slice(0, 10)})`).join('; ')}`
            : '✔ Shots are in chronological order.'}
        </p>
      )}
      {validation.cameras !== undefined && (
        <div className={imageCheckPassed('camera', validation) ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
          {imageCheckPassed('camera', validation) ? (
            <p>✔ Every image was taken by the same camera: <span className="font-mono">{describeCamera(validation.cameras[0])}</span>.</p>
          ) : (
            <>
              {validation.cameras.length > 1 && <p>⚠ The images come from {validation.cameras.length} different cameras:</p>}
              {validation.cameras.length > 0 && (
                <ul className="list-disc ml-6">
                  {validation.cameras.map((c, i) => (
                    <li key={i}>
                      <span className="font-mono">{describeCamera(c)}</span> — {c.count} image(s), e.g. {c.examples.join(', ')}
                    </li>
                  ))}
                </ul>
              )}
              {(validation.cameras_without_info ?? 0) > 0 && <p>⚠ {validation.cameras_without_info} image(s) have no camera information.</p>}
            </>
          )}
          {validation.exiftool === false && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">ExifTool isn't installed, so the camera id (serial number) may be missing — install it for a fuller reading.</p>
          )}
        </div>
      )}
      {validation.exif_missing !== undefined && (
        <div className={imageCheckPassed('exif', validation) ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
          {imageCheckPassed('exif', validation) ? (
            <p>✔ Every image has its capture date, camera model and camera id.</p>
          ) : (
            <ul className="list-disc ml-6">
              {(Object.keys(EXIF_FIELD_LABELS) as ExifField[]).filter((f) => validation.exif_missing![f].count > 0).map((f) => (
                <li key={f}>
                  ⚠ {validation.exif_missing![f].count} image(s) without {EXIF_FIELD_LABELS[f]}, e.g. {validation.exif_missing![f].examples.join(', ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {validation.duplicates !== undefined && (
        <div className={validation.duplicates.length ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
          {validation.duplicates.length === 0 ? (
            <p>✔ No duplicate images.</p>
          ) : (
            <>
              <p>⚠ {validation.duplicates.length} group(s) of duplicate images ({validation.duplicates.reduce((n, g) => n + g.files.length - 1, 0)} extra copies):</p>
              <ul className="list-disc ml-6">
                {validation.duplicates.map((g, i) => <li key={i} className="font-mono">{g.files.join(' = ')}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
      {validation.subdirectories !== undefined && (
        <p className={validation.subdirectories.length ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
          {validation.subdirectories.length
            ? `⚠ Images are spread across ${validation.subdirectories.length} subfolder(s): ${validation.subdirectories.join(', ')}`
            : '✔ All images are directly in this folder.'}
        </p>
      )}
    </div>
  )
}

/** What the postvalidation found — only the checks that were run have something to say. */
export function DeploymentCheckReport({ result, toleranceHours }: { result: DeploymentCheckResult; toleranceHours: string }) {
  return (
    <div className="mt-4 text-sm space-y-1 mb-2">
      {(['deployment_id', 'collection_name', 'collection_prefix', 'location'] as const).map((key) => {
        const check = result[key]
        return check === undefined ? null : (
          <p key={key} className={check.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
            {check.ok ? '✔' : '⚠'} {check.message}
          </p>
        )
      })}
      {STATISTIC_CHECKS.map((key) => {
        const stat = result[key]
        return stat === undefined ? null : (
          <div key={key} className={stat.skipped ? 'text-zinc-500 dark:text-zinc-400' : stat.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
            <p>{stat.skipped ? 'ℹ' : stat.ok ? '✔' : '⚠'} {stat.message}</p>
            {stat.history.length > 0 && (
              <p className="text-xs ml-5 text-zinc-500 dark:text-zinc-400 font-mono">
                {stat.history.map((h) => `R${String(h.revision).padStart(4, '0')}: ${Number.isInteger(h.value) ? h.value : h.value.toFixed(1)}`).join(' · ')}
              </p>
            )}
          </div>
        )
      })}
      {result.out_of_range !== undefined && (
        result.out_of_range.length === 0 ? (
          <p className="text-emerald-600 dark:text-emerald-400">
            ✔ The first image is at the start, the last at the end and the rest in between (± {result.tolerance_hours ?? toleranceHours} h).
          </p>
        ) : (
          <div className="text-amber-600 dark:text-amber-400">
            <p>⚠ {result.out_of_range.length} image(s) outside the deployment's dates (± {result.tolerance_hours ?? toleranceHours} h):</p>
            <ul className="list-disc ml-6">
              {result.out_of_range.map((o) => (
                <li key={o.path}>
                  <span className="font-mono">{o.path}</span> — {o.date.replace('T', ' ')}, {RANGE_RULE_LABELS[o.rule ?? 'between']}{o.expected ? ` (${o.expected.replace(/T/g, ' ')})` : ''}
                </li>
              ))}
            </ul>
          </div>
        )
      )}
      {result.camera_mismatches !== undefined && (
        <>
          <p className={result.camera_mismatches.length ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
            {result.camera_mismatches.length
              ? `⚠ ${result.camera_mismatches.length} image(s) with a different camera model than declared: ${result.camera_mismatches.map((m) => `${m.path} (${m.detected})`).join(', ')}`
              : '✔ No camera-model mismatches with the declared camera.'}
          </p>
          <p className={(result.camera_models_found?.length ?? 0) > 1 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
            {(result.camera_models_found?.length ?? 0) > 1
              ? `⚠ ${result.camera_models_found!.length} distinct camera models found across images: ${result.camera_models_found!.join(', ')}`
              : '✔ All images share the same camera model.'}
          </p>
        </>
      )}
    </div>
  )
}

/** What is filled in from the previous revision of the same deployment: its camera setup, site and notes — everything but what
 * is each revision's own (the id, the start and end dates, whether its timestamps had issues) and the location's (its coordinates). */
export const FILLED_FROM_PREVIOUS = [
  'camera_interval', 'detection_distance', 'camera_height', 'camera_depth', 'camera_tilt', 'camera_heading',
  'feature_type', 'habitat', 'setup_by', 'bait_use', 'deployment_groups', 'tags', 'comments',
] as const satisfies readonly (keyof DeploymentFields)[]

/** `current` filled in from the same deployment's previous revision, keeping its own id, location and dates. The camera model and id
 * only fill in what the images did not give, as what they say is more reliable than what was written down before. */
export function fillFromPreviousRevision(current: DeploymentFields, previous: DeploymentFields): DeploymentFields {
  return {
    ...current, ...Object.fromEntries(FILLED_FROM_PREVIOUS.map((k) => [k, previous[k]])), tags: previous.tags ?? [],
    camera_model: current.camera_model || previous.camera_model, camera_id: current.camera_id || previous.camera_id,
  }
}

interface Props {
  /** A run left unfinished by an earlier visit (see ResumeSessionsPage) —
   * its source folder and scan are restored, and, if it had got as far as
   * the deployment's details, those too. Where the images were taken isn't
   * kept in a session, so the wizard picks up at that step. */
  resumeSession?: SessionSummary
  /** Offered once a deployment is imported: goes to the upload page, on the collection it went into. */
  onUpload?: (target: UploadTarget) => void
  /** Opens the settings — where the owner and publisher written into the images are set — on a section when given one. */
  onOpenSettings?: (section?: 'epicollect') => void
  /** Whether the settings are open over the wizard: what they hold is read again once they close. */
  settingsOpen?: boolean
}

// Blank credentials: the backend uses the ones saved in the settings.
const NO_CREDENTIALS: TrapperCredentials = {}

export default function ImportDeploymentPage({ resumeSession, onUpload, onOpenSettings, settingsOpen = false }: Props) {
  const [step, setStep] = useState(resumeSession ? STEPS.findIndex((s) => s.key === 'origin') : 0)

  // The Trapper account is the one saved in the settings: nothing is asked for here, and the backend
  // fills in the blank credentials from it.
  const [account, setAccount] = useState<TrapperAccount | null>(null)
  const [conn, setConn] = useState<{ status: ConnStatus; message: string }>({ status: 'idle', message: '' })

  const [researchProjects, setResearchProjects] = useState<ResearchProject[]>([])
  // This run's session on disk (see services.session_store) — null until the
  // source folder is scanned, which is when it's first created.
  const [taskId, setTaskId] = useState<string | null>(resumeSession?.task_id ?? null)

  // What the images say of the deployment — its dates and camera — read when the details are asked for, not when the folder is scanned.
  const [guess, setGuess] = useState<GuessedDetails | null>(null)
  const [guessing, setGuessing] = useState(false)
  const guessedFor = useRef<string | null>(null)
  const [sourceDir, setSourceDir] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const [browseError, setBrowseError] = useState<string | null>(null)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)

  // Step "validate": opt-in checks over the scanned folder's images.
  const [imageChecks, setImageChecks] = useState<Set<ImageCheck>>(new Set(['corrupted', 'sequence', 'structure', 'camera', 'exif', 'duplicates']))
  const [requiredImageChecks, setRequiredImageChecks] = useState<Set<ImageCheck>>(new Set())
  const [validating, setValidating] = useState(false)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  // Step "origin": where the images were taken — a research project and
  // one of its locations, both kept in the local collections folder. Each
  // is picked from what's there or added: by hand, or filled in from
  // Trapper. `origin` holds the resolved choice.
  const [origin, setOrigin] = useState({ researchProject: '', locationId: '', locationName: '', timezone: '' })
  const [localProjects, setLocalProjects] = useState<LocalResearchProject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [addingProject, setAddingProject] = useState(false)
  const [projectSource, setProjectSource] = useState<OriginSource | null>(null)
  // The new research project's form, in Trapper's own "Add research project" fields.
  const [projectDraft, setProjectDraft] = useState(EMPTY_RESEARCH_PROJECT)
  const [trapperProjectPks, setTrapperProjectPks] = useState<string[]>([])
  const [savingProject, setSavingProject] = useState(false)
  const [localLocations, setLocalLocations] = useState<LocalLocation[]>([])
  const [selectedLocationId, setSelectedLocationId] = useState('')
  const [addingLocation, setAddingLocation] = useState(false)
  const [locationSource, setLocationSource] = useState<OriginSource | null>(null)
  const [locationDraft, setLocationDraft] = useState(EMPTY_LOCATION_DRAFT)
  const [trapperLocationProjectPk, setTrapperLocationProjectPk] = useState('')
  const [trapperLocations, setTrapperLocations] = useState<Location[]>([])
  const [trapperLocationPks, setTrapperLocationPks] = useState<string[]>([])
  const [loadingTrapperLocations, setLoadingTrapperLocations] = useState(false)
  const [savingLocation, setSavingLocation] = useState(false)
  const [originError, setOriginError] = useState<string | null>(null)

  // Step "checks"/"import": where the deployment's collection is kept locally by
  // default — <collections folder>/<research project id>/<R0003> — and whether it's there.
  // The folder where this deployment is already kept, if it is — importing it again would be refused.
  const [existingFolder, setExistingFolder] = useState<string | null>(null)
  // The closest earlier revision of this deployment, if one was kept — to offer filling the form in from it.
  const [previousRevision, setPreviousRevision] = useState<PreviousDeployment | null>(null)
  const [filledFrom, setFilledFrom] = useState<string | null>(null)
  // The entry of the Epicollect5 form that gives the period, and fills the camera, site and notes in.
  // Whether the settings turn Epicollect5 on — until they say so, nothing of it is offered.
  const [epicollectOn, setEpicollectOn] = useState(false)
  // The entry the Epicollect5 project holds for the location and revision, once looked up. There is one: if it has several, the newest is the one.
  const [epicollectEntry, setEpicollectEntry] = useState<EpicollectEntry | null>(null)
  const [epicollectDone, setEpicollectDone] = useState(false)
  // Whether the camera, site and notes of the entry have been imported — the dates are not part of that: they come from the source picked.
  const [epicollectImported, setEpicollectImported] = useState(false)
  // Where the period comes from; a source picked by hand is not changed by what is found later.
  const [dateSource, setDateSource] = useState<DateSource | undefined>(undefined)
  const sourcePicked = useRef(false)
  // Why the lookup found nothing to offer: Epicollect5 holds no entry for it (the empty string), or could not be read (what it said). Null while unknown or when there is something.
  const [epicollectMissing, setEpicollectMissing] = useState<string | null>(null)
  const [epicollectMessage, setEpicollectMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [plannedCollection, setPlannedCollection] = useState<CollectionPath | null>(null)
  const [plannedCollectionError, setPlannedCollectionError] = useState<string | null>(null)

  const [deployment, setDeployment] = useState<DeploymentFields>(EMPTY_DEPLOYMENT_FIELDS)
  const [revision, setRevision] = useState('')
  const [timezone, setTimezone] = useState('')
  // Both belong to the location (see LocationTimeSettings): the deployment only reads them from it.
  // null: the location doesn't say (it was kept before this was asked), so the setting's default stands.
  const [ignoreDstChoice, setIgnoreDst] = useState<boolean | null>(null)
  // The revision starts as the next one expected for the location, until it is typed.
  const revisionTouched = useRef(false)
  const [revisionHint, setRevisionHint] = useState<string | null>(null)
  const [savingDetails, setSavingDetails] = useState(false)

  // Step "checks": opt-in checks of the images against the deployment's own
  // fields, once it's known.
  const [deploymentChecks, setDeploymentChecks] = useState<Set<DeploymentCheck>>(new Set(ALL_DEPLOYMENT_CHECKS))
  // Which checks the settings page turns on, and the tolerance and the statistical parameters the postvalidation uses — read again
  // when the validate and postvalidation steps are shown, since the settings can change meanwhile.
  const [checkSettings, setCheckSettings] = useState<WizardSettings>(DEFAULT_CHECK_SETTINGS)
  const [preprocessSteps, setPreprocessSteps] = useState<Set<PreprocessStep>>(new Set(['rename', 'resize', 'metadata']))
  // Set the moment a value is edited here (a ref, so a settings response arriving meanwhile never puts it back).
  const preprocessTouched = useRef(false)
  const [exiftool, setExiftool] = useState<boolean | null>(null) // whether ExifTool is installed; null until known
  // The deployment's row in its collection's FileTimestampLog, written on leaving the details.
  const [timestampLogError, setTimestampLogError] = useState<string | null>(null)
  const [requiredDeploymentChecks, setRequiredDeploymentChecks] = useState<Set<DeploymentCheck>>(new Set())
  const [checkingDeployment, setCheckingDeployment] = useState(false)
  const [deploymentCheck, setDeploymentCheck] = useState<DeploymentCheckResult | null>(null)
  const [deploymentCheckError, setDeploymentCheckError] = useState<string | null>(null)
  // Which section of the checks is open: 1 to choose them, 2 for how they went.
  const [checksOpen, setChecksOpen] = useState(1)
  const [deploymentCheckReport, setDeploymentCheckReport] = useState<Report | null>(null)

  // The preprocessing runs in its own step and leaves the deployment pending; the import step then consolidates (seals) it.
  const [preprocessing, setPreprocessing] = useState(false)
  const [preprocessEvents, setPreprocessEvents] = useState<ImportEvent[]>([])
  // Whether the results of the preprocessing were gone over: step 2 shuts, and the saving opens.
  const [resultsDone, setResultsDone] = useState(false)
  const [preprocessError, setPreprocessError] = useState<string | null>(null)
  const [preprocessed, setPreprocessed] = useState<ImportEvent | null>(null)
  const [importing, setImporting] = useState(false)
  const [events, setEvents] = useState<ImportEvent[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const [destDir, setDestDir] = useState<string | null>(null)

  const stepKey = STEPS[step]?.key

  // The images screen is three steps: the folder, the checks, their results. The one open, and the furthest reached.
  const [imagesOpen, setImagesOpen] = useState(1)
  const [imagesReached, setImagesReached] = useState(1)
  const [imagesReport, setImagesReport] = useState<Report | null>(null)
  // The origin screen is two steps: where, and when. The one open, and the furthest reached.
  const [originOpen, setOriginOpen] = useState(1)
  const [originReached, setOriginReached] = useState(1)
  const [moreMetadataOpen, setMoreMetadataOpen] = useState(false)
  function openImagesStep(n: number) { setImagesOpen(n); setImagesReached((r) => Math.max(r, n)) }

  useEffect(() => {
    if (stepKey !== 'images' && stepKey !== 'checks' && stepKey !== 'prepare') return
    let cancelled = false
    api.getSettings()
      .then((s) => {
        if (cancelled) return
        setCheckSettings({ VALIDATION: s.VALIDATION, POSTVALIDATION: s.POSTVALIDATION, PREPROCESSING: s.PREPROCESSING })
        // What can be edited in the wizard starts from the settings, until it has been.
        if (!preprocessTouched.current) setPreprocessSteps(new Set((['rename', 'resize', 'metadata'] as const).filter((step) => s.PREPROCESSING[step])))
      })
      .catch(() => { /* the settings can't be read: every check stays shown */ })
    return () => { cancelled = true }
  }, [stepKey])

  // Adding metadata needs ExifTool: find out when the preprocessing is listed.
  useEffect(() => {
    if (stepKey !== 'prepare') return
    let cancelled = false
    api.exiftoolStatus()
      .then((s) => { if (!cancelled) setExiftool(s.available) })
      .catch(() => { if (!cancelled) setExiftool(null) })
    return () => { cancelled = true }
  }, [stepKey])

  // What is shown — and so run — is what the settings turn on.
  const shownImageChecks = IMAGE_CHECK_OPTIONS.filter((o) => checkSettings.VALIDATION[o.value])
  const shownDeploymentChecks = DEPLOYMENT_CHECK_OPTIONS.filter((o) => checkSettings.POSTVALIDATION[o.value])
  const runnableImageChecks = shownImageChecks.map((o) => o.value).filter((c) => imageChecks.has(c))
  const runnableDeploymentChecks = shownDeploymentChecks.map((o) => o.value).filter((c) => deploymentChecks.has(c))

  // What is done to the images: the steps chosen, less the metadata if ExifTool isn't there to write it.
  const preSettings = checkSettings.PREPROCESSING
  const ignoreDst = ignoreDstChoice ?? preSettings.ignore_dst
  const effectivePreprocessSteps = new Set([...preprocessSteps].filter((step) => step !== 'metadata' || exiftool !== false))
  const startDay = (guess?.start_date ?? '').slice(0, 10).replace(/-/g, '')
  const exampleImageName = `${deployment.deployment_id || 'R0003-DONA_01'}__${startDay || 'YYYYMMDD'}_1.JPEG`.toUpperCase()
  function togglePreprocessStep(step: PreprocessStep) {
    preprocessTouched.current = true
    setPreprocessSteps((current) => toggled(current, step))
  }

  useEffect(() => {
    api.trapperGetConfig()
      .then(setAccount)
      .catch(() => setAccount(null))
  }, [])

  // The resumed session's source folder and scan are restored straight away. Where
  // it was taken isn't kept in a session, so the run picks up at that step — with
  // the deployment's details, if it had got as far as filling them in.
  useEffect(() => {
    if (!resumeSession) return
    setSourceDir(resumeSession.source_dir)
    setScan(resumeSession.scan)
    if (resumeSession.deployment) {
      setDeployment(resumeSession.deployment)
      setRevision(revisionOf(resumeSession.deployment.deployment_id)); revisionTouched.current = true
      sourcePicked.current = true; setDateSource('manual')  // its dates were kept: what is found now does not replace them
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeSession])

  useEffect(() => {
    if (stepKey !== 'origin' || originOpen < 2 || !sourceDir || guessedFor.current === sourceDir) return
    guessedFor.current = sourceDir
    let cancelled = false
    let finished = false
    setGuessing(true)
    api.guessDetails(sourceDir)
      .then((g) => {
        if (cancelled) return
        finished = true
        setGuess(g)
        // What was already typed stays: only the empty fields are filled in.
        setDeployment((d) => ({
          ...d, start_date: d.start_date || stampTimezone(g.start_date ?? '', timezone), end_date: d.end_date || (g.end_date ? stampTimezone(g.end_date, timezone) : null),
          camera_model: d.camera_model || g.camera_model, camera_id: d.camera_id || g.camera_id,
        }))
      })
      .catch(() => { guessedFor.current = null })
      .finally(() => { if (!cancelled) setGuessing(false) })
    return () => { cancelled = true; if (!finished) guessedFor.current = null; setGuessing(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, sourceDir, originOpen])

  async function handleBrowse() {
    setBrowsing(true); setBrowseError(null)
    try {
      const { path } = await api.browseFolder()
      if (path) {
        setSourceDir(path); setScan(null); setValidation(null); setValidationError(null)
        await handleScan(path)
      }
    } catch (e) {
      setBrowseError(e instanceof Error ? e.message : 'Could not open the folder browser.')
    } finally {
      setBrowsing(false)
    }
  }

  async function handleScan(dir: string = sourceDir) {
    setScanning(true); setScanError(null); setScan(null); setValidation(null); setValidationError(null)
    try {
      const result = await api.scanFolder(dir)
      setScan(result)
      setGuess(null); guessedFor.current = null  // the details are read from the images when they are asked for
      try {
        const session = await api.saveScan(dir, result, taskId ?? undefined)
        setTaskId(session.task_id)
      } catch {
        // Best-effort — the run still works even if the session can't be saved.
      }
    } catch (e) {
      setScanError(e instanceof Error ? e.message : 'Could not scan the folder.')
    } finally {
      setScanning(false)
    }
  }

  function chooseImageCheckStrictness(check: ImageCheck, strictness: Strictness) {
    setImageChecks((prev) => { const next = new Set(prev); if (strictness === 'skip') next.delete(check); else next.add(check); return next })
    setRequiredImageChecks((prev) => { const next = new Set(prev); if (strictness === 'must') next.add(check); else next.delete(check); return next })
  }

  async function handleValidate() {
    setValidating(true); setValidationError(null); setValidation(null)
    try {
      setValidation(await api.validateImages(sourceDir, runnableImageChecks))
    } catch (e) {
      setValidationError(e instanceof Error ? e.message : 'Could not validate the images.')
    } finally {
      setValidating(false)
    }
  }

  const requiredImageChecksOk = [...requiredImageChecks]
    .filter((c) => checkSettings.VALIDATION[c])
    .every((c) => imageCheckPassed(c, validation) === true)

  const projectErrors = validateResearchProject(projectDraft)
  const shownProjectFieldErrors = shownProjectErrors(projectErrors)
  const selectedProject = localProjects.find((p) => p.acronym === selectedProjectId)
  const selectedLocation = localLocations.find((l) => l.location_id === selectedLocationId)
  // The deployment needs coordinates (Camtrap DP requires them) — they come with the location.
  const locationLacksCoordinates = Boolean(selectedLocation) && (selectedLocation!.latitude == null || selectedLocation!.longitude == null)
  const originReady = Boolean(selectedProjectId && origin.locationId.trim()) && !locationLacksCoordinates && !addingProject && !addingLocation
  const locationErrors = {
    location_id: locationDraft.location_id.trim() ? undefined : 'Required',
    timezone: locationDraft.timezone && !isValidTimezone(locationDraft.timezone) ? 'Not a known IANA timezone (e.g. Europe/Madrid).' : undefined,
    latitude: rangeError(locationDraft.latitude, -90, 90, true),
    longitude: rangeError(locationDraft.longitude, -180, 180, true),
    coordinate_uncertainty: locationDraft.coordinate_uncertainty.trim() === ''
      ? undefined
      : (Number.isInteger(Number(locationDraft.coordinate_uncertainty)) && Number(locationDraft.coordinate_uncertainty) >= 1 ? undefined : 'Must be a whole number, 1 or more.'),
  }
  const canSaveProject = projectSource !== null && Object.keys(projectErrors).length === 0 && !savingProject
  const canSaveLocation = locationSource === 'manual' && Object.values(locationErrors).every((e) => !e) && !savingLocation
  const accountReady = trapperAccountReady(account)

  async function handleTestConnection() {
    setConn({ status: 'testing', message: '' })
    try {
      const result = await api.trapperTestConnection(NO_CREDENTIALS)
      const { results } = await api.trapperResearchProjects(NO_CREDENTIALS)
      setResearchProjects(results)
      setConn({ status: 'ok', message: `Connected — ${result.research_projects_count} research project(s) available.` })
    } catch (e) {
      setConn({ status: 'error', message: e instanceof Error ? e.message : 'Could not connect to Trapper.' })
    }
  }

  // Adding a research project or a location from Trapper connects, with the account of the settings, as soon as it is asked for.
  const wantsTrapper = (addingProject && projectSource === 'trapper') || (addingLocation && locationSource === 'trapper')
  useEffect(() => {
    if (wantsTrapper && accountReady && conn.status === 'idle') void handleTestConnection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsTrapper, accountReady, conn.status])

  function resetOriginChoice() {
    setOrigin({ researchProject: '', locationId: '', locationName: '', timezone: '' })
    setSelectedProjectId(''); setAddingProject(false); setProjectSource(null); setProjectDraft(EMPTY_RESEARCH_PROJECT)
    setTrapperProjectPks([])
    setLocalLocations([]); setSelectedLocationId(''); setAddingLocation(false); setLocationSource(null)
    setLocationDraft(EMPTY_LOCATION_DRAFT)
    setTrapperLocationProjectPk(''); setTrapperLocations([]); setTrapperLocationPks([]); setOriginError(null)
    setDeployment((d) => ({ ...d, location_id: '', location_name: null }))
  }

  /** The location the images were taken at is also the deployment's own. */
  function applyOriginLocation(location?: LocalLocation) {
    const locationId = location?.location_id ?? ''
    setDeployment((d) => ({
      ...d, location_id: locationId || null, location_name: location?.name || null, deployment_id: buildDeploymentId(revision, locationId),
      latitude: location?.latitude ?? null, longitude: location?.longitude ?? null, coordinate_uncertainty: location?.coordinate_uncertainty ?? null,
    }))
  }

  function updateProject<K extends keyof typeof EMPTY_RESEARCH_PROJECT>(key: K, value: (typeof EMPTY_RESEARCH_PROJECT)[K]) {
    setProjectDraft((p) => ({ ...p, [key]: value }))
  }

  /** The revision number, and with it the deployment id. */
  function applyRevision(value: string) {
    setRevision(value)
    setDeployment((d) => ({ ...d, deployment_id: buildDeploymentId(value, d.location_id) }))
  }

  function handleRevisionChange(value: string) {
    revisionTouched.current = true; setRevisionHint(null)
    applyRevision(value)
  }

  // ── Research project ──

  function selectProject(project: LocalResearchProject | undefined) {
    setSelectedProjectId(project?.acronym ?? '')
    setSelectedLocationId(''); setAddingLocation(false); setOriginError(null)
    setOrigin({ researchProject: project ? `${project.acronym} — ${project.name}` : '', locationId: '', locationName: '', timezone: '' })
    applyOriginLocation(undefined)
  }

  function startAddingProject() {
    setAddingProject(true); setProjectSource(null); setProjectDraft(EMPTY_RESEARCH_PROJECT)
    setTrapperProjectPks([]); setOriginError(null)
  }

  function handleProjectSourceChange(source: OriginSource) {
    setProjectSource(source); setProjectDraft(EMPTY_RESEARCH_PROJECT); setTrapperProjectPks([])
  }

  /** Keeps a research project in the collections folder and picks it. */
  async function addProject(project: LocalResearchProject) {
    setSavingProject(true); setOriginError(null)
    try {
      const saved = await api.saveResearchProject(project)
      setLocalProjects((list) => [...list, saved].sort((a, b) => a.acronym.toLowerCase().localeCompare(b.acronym.toLowerCase())))
      setAddingProject(false)
      selectProject(saved)
    } catch (e) {
      setOriginError(e instanceof Error ? e.message : 'Could not save the research project.')
    } finally {
      setSavingProject(false)
    }
  }

  function handleSaveProject() {
    return addProject({
      ...projectDraft, name: projectDraft.name.trim(), acronym: projectDraft.acronym.trim(),
      event_interval: projectDraft.event_interval ?? 0, trapper_pk: null,
    })
  }

  /** From Trapper: the research projects ticked there are simply added — no form, as many as are ticked.
   * One already kept here is just picked. The first is the one marked by default afterwards. */
  async function handleAddTrapperProjects() {
    setSavingProject(true); setOriginError(null)
    const problems: string[] = []
    const chosen: LocalResearchProject[] = []
    const added: LocalResearchProject[] = []
    for (const pk of trapperProjectPks) {
      const rp = researchProjects.find((p) => String(p.pk) === pk)
      if (!rp) continue
      const already = localProjects.find((p) => p.acronym === rp.acronym)
      if (already) { chosen.push(already); continue }
      const project: LocalResearchProject = { ...EMPTY_RESEARCH_PROJECT, name: rp.name, acronym: rp.acronym ?? '', trapper_pk: rp.pk }
      const problem = validateResearchProject(project)
      if (problem.name || problem.acronym) {
        problems.push(`“${rp.name}” can't be added from Trapper as it is: ${problem.acronym ?? problem.name} Add it by hand instead.`)
        continue
      }
      try {
        const saved = await api.saveResearchProject(project)
        added.push(saved); chosen.push(saved)
      } catch (e) {
        problems.push(`“${rp.name}”: ${e instanceof Error ? e.message : 'could not be saved.'}`)
      }
    }
    if (added.length) setLocalProjects((list) => [...list, ...added].sort((a, b) => a.acronym.toLowerCase().localeCompare(b.acronym.toLowerCase())))
    setSavingProject(false)
    if (chosen.length) { setAddingProject(false); selectProject(chosen[0]) }
    if (problems.length) setOriginError(problems.join(' '))
  }

  // ── Location ──

  function selectLocation(location: LocalLocation | undefined) {
    setSelectedLocationId(location?.location_id ?? '')
    setOrigin((o) => ({ ...o, locationId: location?.location_id ?? '', locationName: location?.name ?? '', timezone: location?.timezone ?? '' }))
    applyOriginLocation(location)
    applyTimezone(location?.timezone ?? '')
    setIgnoreDst(location?.ignore_dst ?? null)
  }

  function startAddingLocation() {
    setAddingLocation(true); setLocationSource(null); setLocationDraft(EMPTY_LOCATION_DRAFT)
    setTrapperLocationProjectPk(''); setTrapperLocations([]); setTrapperLocationPks([]); setOriginError(null)
  }

  function handleLocationSourceChange(source: OriginSource) {
    setLocationSource(source); setLocationDraft(EMPTY_LOCATION_DRAFT)
    setTrapperLocationPks([])
  }

  /** From Trapper: the locations of the chosen Trapper research project. */
  async function handleTrapperLocationProjectChange(pk: string) {
    setTrapperLocationProjectPk(pk)
    setTrapperLocations([]); setTrapperLocationPks([]); setOriginError(null)
    if (!pk) return
    setLoadingTrapperLocations(true)
    try {
      const { results } = await api.trapperLocations(NO_CREDENTIALS, Number(pk))
      setTrapperLocations(results)
    } catch (e) {
      setOriginError(e instanceof Error ? e.message : "Could not load the research project's locations.")
    } finally {
      setLoadingTrapperLocations(false)
    }
  }

  /** Keeps a location in the research project's folder and picks it. */
  async function addLocation(location: LocalLocation) {
    setSavingLocation(true); setOriginError(null)
    try {
      const saved = await api.saveLocalLocation(selectedProjectId, location)
      setLocalLocations((list) => [...list, saved])
      setAddingLocation(false)
      selectLocation(saved)
    } catch (e) {
      setOriginError(e instanceof Error ? e.message : 'Could not save the location.')
    } finally {
      setSavingLocation(false)
    }
  }

  function handleSaveLocation() {
    return addLocation({
      location_id: locationDraft.location_id.trim(), name: locationDraft.name.trim() || null,
      timezone: locationDraft.timezone.trim() || null, ignore_dst: locationDraft.ignore_dst, trapper_pk: null,
      latitude: Number(locationDraft.latitude), longitude: Number(locationDraft.longitude),
      coordinate_uncertainty: locationDraft.coordinate_uncertainty.trim() ? Number(locationDraft.coordinate_uncertainty) : null,
    })
  }

  /** From Trapper: the locations ticked there are simply added — no form, as many as are ticked. One
   * already kept here is just picked. The first is the one marked by default afterwards. */
  async function handleAddTrapperLocations() {
    setSavingLocation(true); setOriginError(null)
    const problems: string[] = []
    const chosen: LocalLocation[] = []
    const added: LocalLocation[] = []
    for (const pk of trapperLocationPks) {
      const loc = trapperLocations.find((l) => String(l.pk) === pk)
      if (!loc) continue
      const already = localLocations.find((l) => l.location_id.toLowerCase() === loc.location_id.toLowerCase())
      if (already) { chosen.push(already); continue }
      if (loc.latitude == null || loc.longitude == null) {
        problems.push(`“${loc.location_id}” has no coordinates in Trapper, and a deployment needs them. Add it by hand instead.`)
        continue
      }
      try {
        const saved = await api.saveLocalLocation(selectedProjectId, {
          location_id: loc.location_id, name: loc.name || null,
          timezone: loc.timezone && isValidTimezone(loc.timezone) ? loc.timezone : null, ignore_dst: loc.ignore_dst ?? null, trapper_pk: loc.pk,
          latitude: loc.latitude, longitude: loc.longitude, coordinate_uncertainty: null,
        })
        added.push(saved); chosen.push(saved)
      } catch (e) {
        problems.push(`“${loc.location_id}”: ${e instanceof Error ? e.message : 'could not be saved.'}`)
      }
    }
    if (added.length) setLocalLocations((list) => [...list, ...added])
    setSavingLocation(false)
    if (chosen.length) { setAddingLocation(false); selectLocation(chosen[0]) }
    if (problems.length) setOriginError(problems.join(' '))
  }

  /** Sets the timezone and re-stamps both dates with the designator it
   * gives them — the wall-clock time stays, its offset follows. */
  function applyTimezone(tz: string) {
    setTimezone(tz)
    setDeployment((d) => ({
      ...d, start_date: stampTimezone(d.start_date, tz), end_date: d.end_date ? stampTimezone(d.end_date, tz) : d.end_date,
    }))
  }

  function chooseDeploymentCheckStrictness(check: DeploymentCheck, strictness: Strictness) {
    setDeploymentChecks((prev) => { const next = new Set(prev); if (strictness === 'skip') next.delete(check); else next.add(check); return next })
    setRequiredDeploymentChecks((prev) => { const next = new Set(prev); if (strictness === 'must') next.add(check); else next.delete(check); return next })
  }

  useEffect(() => {
    if (!deploymentCheck && !checkingDeployment && !deploymentCheckError) setChecksOpen(1)
  }, [deploymentCheck, checkingDeployment, deploymentCheckError])

  async function handleCheckDeployment() {
    setCheckingDeployment(true); setDeploymentCheckError(null); setDeploymentCheck(null)
    try {
      setDeploymentCheck(await api.validateDeployment(sourceDir, deployment, runnableDeploymentChecks, {
        // The collection is the one the deployment id names (its R0003 prefix).
        collectionName: null,
        expectedLocationId: origin.locationId || null,
        toleranceHours: Number(toleranceHours),
        researchProjectId: researchProjectId || null,
        statistics: statistics ?? undefined,
      }))
    } catch (e) {
      setDeploymentCheckError(e instanceof Error ? e.message : 'Could not check the deployment.')
    } finally {
      setCheckingDeployment(false)
    }
  }

  // The tolerance and what the statistical checks mean by a sequence and by similar come from the settings.
  const toleranceHours = String(checkSettings.POSTVALIDATION.tolerance_hours)
  const statistics = statParamsValid(statParamsOf(checkSettings.POSTVALIDATION))
  const requiredDeploymentChecksOk = [...requiredDeploymentChecks]
    .filter((c) => checkSettings.POSTVALIDATION[c])
    .every((c) => deploymentCheckPassed(c, deploymentCheck) === true)

  // Camtrap DP's own rules for the deployment's fields (required ones,
  // ranges, the dates' timezone designator…) — what a new deployment must
  // satisfy to leave the details, and what's flagged under each field.
  const deploymentErrors = validateDeployment(deployment, timezone)
  const fieldErrors = shownErrors(deploymentErrors)
  const revisionNumber = Number(revision)
  const revisionValid = revision.trim() !== '' && Number.isInteger(revisionNumber) && revisionNumber >= 1 && revisionNumber <= 9999
  const deploymentConforms = Object.keys(deploymentErrors).length === 0
  const newDetailsReady = revisionValid && deploymentConforms
  // What names this research project's folder in the local collections folder: its acronym.
  const researchProjectId = selectedProjectId

  // Every collection is kept locally before anything is uploaded: once the
  // deployment is known, work out where its collection goes by default — for the
  // postvalidation's checks and to say so at the import.
  useEffect(() => {
    if (stepKey !== 'checks' && stepKey !== 'prepare') return
    if (!researchProjectId || !deployment.deployment_id) return
    let cancelled = false
    api.collectionPath(researchProjectId, deployment.deployment_id)
      .then((result) => { if (!cancelled) { setPlannedCollection(result); setPlannedCollectionError(null) } })
      .catch((e) => {
        if (cancelled) return
        setPlannedCollection(null)
        setPlannedCollectionError(e instanceof Error ? e.message : 'Could not work out where the collection is kept.')
      })
    return () => { cancelled = true }
  }, [stepKey, researchProjectId, deployment.deployment_id])

  // Whether the deployment the revision and the location name is already kept — said as soon as it can be known.
  useEffect(() => {
    const id = deployment.deployment_id
    if (stepKey !== 'origin' || !researchProjectId || !id) { setExistingFolder(null); return }
    let cancelled = false
    api.existingDeployments(researchProjectId, [id])
      .then(({ results }) => { if (!cancelled) setExistingFolder(results[id] ?? null) })
      .catch(() => { if (!cancelled) setExistingFolder(null) })
    return () => { cancelled = true }
  }, [stepKey, researchProjectId, deployment.deployment_id])

  // The revision starts as the next one expected for the location — one after the highest kept — until it is typed.
  useEffect(() => {
    if (stepKey !== 'origin' || !selectedProjectId || !deployment.location_id || revisionTouched.current) return
    let cancelled = false
    api.nextRevision(selectedProjectId, deployment.location_id)
      .then(({ last, next }) => {
        if (cancelled || revisionTouched.current) return
        applyRevision(String(next))
        setRevisionHint(last
          ? `Filled in as the next after R${String(last).padStart(4, '0')}, the latest kept for this location — change it if it is not right.`
          : 'Filled in as the first revision of this location — change it if it is not right.')
      })
      .catch(() => { /* no suggestion: it is typed */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, selectedProjectId, deployment.location_id])

  // Whether the settings turn Epicollect5 on — read again when they are closed, as they may have changed.
  useEffect(() => {
    if (stepKey !== 'origin' || settingsOpen) return
    let cancelled = false
    api.getSettings()
      .then((s) => { if (!cancelled) setEpicollectOn(s.EPICOLLECT5.enabled) })
      .catch(() => { if (!cancelled) setEpicollectOn(false) })
    return () => { cancelled = true }
  }, [stepKey, settingsOpen])

  // ...and whether an earlier revision of it was kept, to offer its details.
  useEffect(() => {
    const id = deployment.deployment_id
    setFilledFrom(null)
    if (stepKey !== 'origin' || !researchProjectId || !id) { setPreviousRevision(null); return }
    let cancelled = false
    api.previousDeployments(researchProjectId, [id])
      .then(({ results }) => { if (!cancelled) setPreviousRevision(results[id] ?? null) })
      .catch(() => { if (!cancelled) setPreviousRevision(null) })
    return () => { cancelled = true }
  }, [stepKey, researchProjectId, deployment.deployment_id])

  // ...and whether Epicollect5 has the details of this location and revision, to offer them.
  useEffect(() => {
    setEpicollectEntry(null); setEpicollectMissing(null); setEpicollectDone(false); setEpicollectImported(false)
    if (stepKey !== 'origin' || settingsOpen || !epicollectOn || !deployment.location_id || !revisionValid) return
    let cancelled = false
    void (async () => {
      try {
        const { results } = await api.epicollectEntries(deployment.location_id!, revisionNumber)
        if (cancelled) return
        setEpicollectEntry(results[0] ?? null)  // newest first
        if (results.length === 0) setEpicollectMissing('')
        setEpicollectDone(true)
      } catch (e) {
        if (cancelled) return
        setEpicollectMissing(e instanceof Error ? e.message : 'Could not read the Epicollect5 project.')
        setEpicollectDone(true)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, settingsOpen, epicollectOn, deployment.location_id, revisionNumber, revisionValid])

  /** The period each source gives — null when it has none. */
  function periodOf(source: DateSource): Period | null {
    if (source === 'exif') return guess?.start_date ? { start: stampTimezone(guess.start_date, timezone), end: guess.end_date ? stampTimezone(guess.end_date, timezone) : null } : null
    if (source === 'epicollect') return entryPeriod(epicollectEntry?.fields, timezone)
    return null
  }

  function takePeriod(source: DateSource) {
    setDateSource(source)
    const period = periodOf(source)
    if (period) setDeployment((d) => ({ ...d, start_date: period.start ?? '', end_date: period.end }))
  }

  // The period comes from the first source that has it: Epicollect5, the images — and by hand if neither does, once both have been looked at.
  // A better one found later replaces the one taken, unless one was picked.
  useEffect(() => {
    if (stepKey !== 'origin' || sourcePicked.current) return
    const looking = guessing || (epicollectOn && !epicollectDone)
    const best = (['epicollect', 'exif', 'manual'] as DateSource[]).find((src) => (src === 'manual' ? !looking : periodOf(src) !== null))
    if (best && best !== dateSource) takePeriod(best)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, guess, guessing, epicollectEntry, epicollectOn, epicollectDone, timezone])

  function pickSource(source: DateSource) {
    sourcePicked.current = true
    takePeriod(source)
  }

  /** Fills the camera, site and notes from the entry of Epicollect5 — the dates follow the source picked. */
  function fillFromEpicollect(entry: EpicollectEntry) {
    setEpicollectImported(true); setEpicollectMissing(null)
    setDeployment((d) => ({ ...applyEntry(d, entry.fields, timezone), start_date: d.start_date, end_date: d.end_date }))
    setFilledFrom(`the Epicollect5 entry “${entryLabel(entry)}”`)
    setEpicollectMessage({ kind: 'info', text: `Filled in from “${entryLabel(entry)}” — check the camera, site and notes in More details.` })
  }

  function handleFillFromPrevious() {
    if (!previousRevision) return
    setDeployment((d) => fillFromPreviousRevision(d, previousRevision.deployment))
    setFilledFrom(previousRevision.deployment_id)
  }

  // The research projects kept in the collections folder — read each time the origin step is shown.
  useEffect(() => {
    if (stepKey !== 'origin') return
    let cancelled = false
    api.listResearchProjects()
      .then(({ results }) => { if (!cancelled) setLocalProjects(results) })
      .catch((e) => { if (!cancelled) setOriginError(e instanceof Error ? e.message : 'Could not read the collections folder.') })
    return () => { cancelled = true }
  }, [stepKey])

  // ...and the locations of the one picked.
  useEffect(() => {
    if (!selectedProjectId) { setLocalLocations([]); return }
    let cancelled = false
    api.listLocalLocations(selectedProjectId)
      .then(({ results }) => { if (!cancelled) setLocalLocations(results) })
      .catch((e) => { if (!cancelled) setOriginError(e instanceof Error ? e.message : 'Could not read the locations.') })
    return () => { cancelled = true }
  }, [selectedProjectId])

  // Adding a location from Trapper: start from the Trapper research project this one was filled in from.
  useEffect(() => {
    if (locationSource !== 'trapper' || conn.status !== 'ok' || trapperLocationProjectPk || !selectedProject?.trapper_pk) return
    void handleTrapperLocationProjectChange(String(selectedProject.trapper_pk))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationSource, conn.status, trapperLocationProjectPk, selectedProject])

  const canImport = Boolean(plannedCollection) && Boolean(researchProjectId) && deploymentConforms

  function handleBack() {
    setStep((s) => s - 1)
  }

  /** Saves the deployment's own fields (best-effort) before moving on to
   * the postvalidation. */
  async function handleContinueFromDeployment() {
    setSavingDetails(true); setTimestampLogError(null)
    if (taskId) {
      try { await api.saveDetails(taskId, deployment) } catch { /* best-effort */ }
    }
    try {
      // The collection's FileTimestampLog — wildintel-tools' file, one row per deployment — before the postvalidation.
      await api.writeTimestampLog(researchProjectId, deployment)
    } catch (e) {
      setTimestampLogError(e instanceof Error ? e.message : 'Could not write the collection\'s timestamp log.')
      setSavingDetails(false)
      return
    }
    setSavingDetails(false)
    setStep((s) => s + 1)
  }

  // Going back to change anything before the preprocessing makes what it did stale: it is run again (the pending folder is simply redone).
  useEffect(() => {
    if (STEPS[step].key !== 'prepare') { setPreprocessed(null); setPreprocessEvents([]) }
  }, [step])

  function preprocessOptions(): PreprocessingOptions {
    return {
      rename: effectivePreprocessSteps.has('rename'), resize: effectivePreprocessSteps.has('resize'), resize_width: preSettings.resize_width,
      metadata: effectivePreprocessSteps.has('metadata'), owner: preSettings.owner, publisher: preSettings.publisher,
      coverage: preSettings.coverage, license_url: preSettings.license_url, research_project: selectedProject?.name ?? '',
      convert_to_utc: preSettings.convert_to_utc,
    }
  }

  useEffect(() => { if (preprocessed?.type !== 'done') setResultsDone(false) }, [preprocessed])

  /** Back to choosing the steps: what was prepared is put aside, to prepare again. */
  function handleEditPreprocessSteps() {
    setPreprocessed(null); setPreprocessEvents([]); setPreprocessError(null)
  }

  async function handlePreprocess() {
    setPreprocessing(true); setPreprocessEvents([]); setPreprocessError(null); setPreprocessed(null)
    try {
      // Into its collection in the collections folder (a new one is named like the deployment's R0003 prefix) — still pending: not sealed.
      await api.preprocess(
        sourceDir, plannedCollection!.path, plannedCollection!.exists ? null : plannedCollection!.collection, deployment, preprocessOptions(),
        (event) => {
          setPreprocessEvents((prev) => [...prev, event])
          if (event.type === 'done') setPreprocessed(event)
        },
      )
    } catch (e) {
      setPreprocessError(e instanceof Error ? e.message : 'The preprocessing failed.')
    } finally {
      setPreprocessing(false)
    }
  }

  async function handleImport() {
    setImporting(true); setEvents([]); setImportError(null); setDestDir(null)
    try {
      await api.consolidate(sourceDir, plannedCollection!.path, deployment, (event) => {
        setEvents((prev) => [...prev, event])
        if (event.type === 'done') {
          setDestDir(event.dest_dir)
          // The run finished — nothing left to resume.
          if (taskId) api.discardSession(taskId).catch(() => {})
        }
      })
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'The import failed.')
    } finally {
      setImporting(false)
    }
  }

  const [openFolderError, setOpenFolderError] = useState<string | null>(null)
  async function handleOpenFolder() {
    setOpenFolderError(null)
    try { await api.openFolder(destDir!) } catch (e) { setOpenFolderError(e instanceof Error ? e.message : String(e)) }
  }

  function handleStartOver() {
    setStep(0); setImagesOpen(1); setImagesReached(1); setOriginOpen(1); setOriginReached(1)
    setSourceDir(''); setScan(null); setScanError(null); setValidation(null); setValidationError(null)
    setGuess(null); guessedFor.current = null; sourcePicked.current = false; setDateSource(undefined)
    setImageChecks(new Set(['corrupted', 'sequence', 'structure', 'camera', 'exif', 'duplicates'])); setRequiredImageChecks(new Set())
    resetOriginChoice()
    setConn({ status: 'idle', message: '' })
    setResearchProjects([])
    setDeployment(EMPTY_DEPLOYMENT_FIELDS); setTimezone('')
    setPlannedCollection(null); setPlannedCollectionError(null)
    setDeploymentCheck(null); setDeploymentCheckError(null)
    preprocessTouched.current = false
    setRevision(''); revisionTouched.current = false; setRevisionHint(null)
    setDeploymentChecks(new Set(ALL_DEPLOYMENT_CHECKS)); setRequiredDeploymentChecks(new Set())
    setTimestampLogError(null)
    setEvents([]); setImportError(null); setDestDir(null)
    setPreprocessEvents([]); setPreprocessError(null); setPreprocessed(null)
    setTaskId(null)
  }

  /** Takes back what was copied from the previous revision: the optional details start empty again. */
  function handleStartEmpty() {
    setDeployment((d) => ({ ...d, ...Object.fromEntries(FILLED_FROM_PREVIOUS.map((k) => [k, EMPTY_DEPLOYMENT_FIELDS[k]])) }))
    setFilledFrom(null)
  }

  function updateField<K extends keyof DeploymentFields>(key: K, value: DeploymentFields[K]) {
    setDeployment((d) => ({ ...d, [key]: value }))
  }

  const connectionForm = <TrapperAccountNotice account={account} conn={conn} onRetry={handleTestConnection} />

  return (
    <div className="max-w-screen-md mx-auto px-4 py-8">
      <h2 className="text-xl font-bold mb-1 text-zinc-900 dark:text-zinc-100">Process deployment</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
        Organizes a folder of camera-trap images into a local collection. It doesn't upload them to Trapper yet.
      </p>

      {/* Step indicator */}
      <div className="flex items-start mb-10">
        {STEPS.map((s, i) => (
          <div key={s.key} className="relative flex-1 flex flex-col items-center">
            {i < STEPS.length - 1 && (
              <div aria-hidden="true" className={`absolute top-[18px] left-[calc(50%+26px)] w-[calc(100%-52px)] border-t ${i < step ? 'border-emerald-500' : 'border-zinc-300 dark:border-zinc-700'}`} />
            )}
            <div
              className={`relative w-9 h-9 rounded-full flex items-center justify-center font-bold mb-1 text-sm ${
                i < step ? 'bg-emerald-600 text-white' : i === step ? 'bg-blue-600 text-white' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'
              }`}
            >
              {i < step ? '✓' : i + 1}
            </div>
            <small className={`text-xs text-center ${i === step ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>
              {s.label}
            </small>
          </div>
        ))}
      </div>

      {/* ── Step: the images — their folder, the checks, the results ── */}
      {stepKey === 'images' && (() => {
        const folderName = sourceDir.split(/[\\/]/).filter(Boolean).pop() ?? sourceDir
        const imageCount = scan ? `${scan.image_count.toLocaleString('en-US')} ${scan.image_count === 1 ? 'image' : 'images'}` : ''
        const mustCount = shownImageChecks.filter((o) => imageChecks.has(o.value) && requiredImageChecks.has(o.value)).length
        const imagesUnlocked = (n: number) => (n === 1 ? true : n === 2 ? Boolean(scan) : Boolean(validation || validating || validationError))
        const imagesStatus = (n: number): 'open' | 'done' | 'locked' | 'running' | 'error' => {
          if (n === 3 && n === imagesOpen) return validating ? 'running' : validationError ? 'error' : 'open'
          return n === imagesOpen ? 'open' : n <= imagesReached && imagesUnlocked(n) ? 'done' : 'locked'
        }
        const runChecks = () => { openImagesStep(3); handleValidate() }
        return (
        <div>
          <StepHeading>Images</StepHeading>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
            Select a folder with the camera-trap images, choose which checks to run, and validate the images before they go any further.
          </p>
          <div className="border-t border-zinc-200 dark:border-zinc-700" />
          <WizardStep n={1} title="Select the folder" status={imagesStatus(1)} canEdit={!validating} onEdit={() => setImagesOpen(1)}
                      description="Where the deployment's camera-trap images are, on this computer."
                      summary={scan && <>{folderName}<br />{imageCount}</>}>
            <div className="mb-4 flex items-center gap-2 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              <span aria-hidden="true">⚠</span>
              <span>Copy the images from the camera's memory card to a local folder first — don't point this at the card itself.</span>
            </div>
            <div className="mb-4">
              <label className={labelClass} htmlFor="source-dir">Folder</label>
              <div className="flex gap-2">
                <input id="source-dir" className={`${inputClass} flex-1`} placeholder="/home/me/Pictures/R0001-SITE_01"
                       value={sourceDir} onChange={(e) => { setSourceDir(e.target.value); setScan(null); setValidation(null); setValidationError(null) }} />
                <button type="button" className={`${btnOutline} flex items-center gap-2`} disabled={browsing} onClick={handleBrowse}>
                  {browsing && <SmallSpinner />}
                  {browsing ? 'Browsing…' : 'Browse…'}
                </button>
              </div>
              {browseError && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{browseError}</p>}
            </div>
            {scanError && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{scanError}</p>}
            {scanning ? (
              <div className="flex items-center gap-3 rounded border border-zinc-300 dark:border-zinc-700 px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">
                <SmallSpinner /> Scanning the folder…
              </div>
            ) : scan ? (
              <div className={`flex items-center gap-3 rounded border px-4 py-3 ${
                scan.image_count > 0
                  ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40'
                  : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40'
              }`}>
                <div aria-hidden="true" className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-white font-bold ${scan.image_count > 0 ? 'bg-emerald-600' : 'bg-amber-600'}`}>
                  {scan.image_count > 0 ? '✓' : '!'}
                </div>
                <div className="flex-1 min-w-0 text-sm">
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {scan.image_count > 0 ? `${imageCount} found` : 'No images found'}
                  </p>
                  <p className="text-zinc-600 dark:text-zinc-400">
                    {scan.file_count.toLocaleString('en-US')} {scan.file_count === 1 ? 'file' : 'files'} in the folder
                    {scan.file_count > 0 && ` · ${scan.image_count === scan.file_count ? 'every file is an image' : `${(scan.file_count - scan.image_count).toLocaleString('en-US')} not ${scan.file_count - scan.image_count === 1 ? 'an image' : 'images'}`}`}
                  </p>
                  {scan.warnings.map((w, i) => <p key={i} className="text-amber-700 dark:text-amber-400">{w}</p>)}
                </div>
                <button type="button" className={btnOutline} onClick={() => handleScan()}>Scan again</button>
              </div>
            ) : sourceDir ? (
              <button type="button" className={btnOutline} onClick={() => handleScan()}>Scan</button>
            ) : null}
            <div className="flex justify-end mt-4">
              <button type="button" aria-label="Continue to the checks" className={btnPrimary} disabled={!scan || scanning} onClick={() => openImagesStep(2)}>Continue<span aria-hidden="true"> →</span></button>
            </div>
          </WizardStep>

          <WizardStep n={2} title="Choose the checks" status={imagesStatus(2)} canEdit={!validating} onEdit={() => setImagesOpen(2)}
                      description="Choose which checks to run over the images, and how strict each one should be."
                      summary={<>{runnableImageChecks.length} {runnableImageChecks.length === 1 ? 'check' : 'checks'} to run{mustCount > 0 && ` · ${mustCount} must pass`}</>}>
            {shownImageChecks.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">
                Every validation check is turned off in the settings, so there is nothing to run here — go on.
              </p>
            ) : (
              <>
                <StrictnessTable options={shownImageChecks} enabled={imageChecks} required={requiredImageChecks} running={false}
                                 describe={(c) => IMAGE_CHECK_DESCRIPTIONS[c]} outcome={() => undefined} onChoose={chooseImageCheckStrictness} />
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                  <strong className="font-semibold text-zinc-700 dark:text-zinc-300">Skip</strong> doesn't run the check · <strong className="font-semibold text-zinc-700 dark:text-zinc-300">Warn</strong> shows the problems but lets you continue · <strong className="font-semibold text-zinc-700 dark:text-zinc-300">Must pass</strong> blocks you until it passes.
                </p>
              </>
            )}
            <div className="flex items-center justify-between gap-3 mt-4">
              <button type="button" className={btnOutline} onClick={() => setImagesOpen(1)}><span aria-hidden="true">← </span>Back</button>
              <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={runnableImageChecks.length === 0 || validating} onClick={runChecks}>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M6 4l14 8-14 8z" /></svg>Run checks
              </button>
            </div>
          </WizardStep>

          <WizardStep n={3} title="Results" status={imagesStatus(3)} canEdit={!validating} onEdit={() => setImagesOpen(3)}
                      description={imagesReport && !validating
                        ? <>Last run {formatRun(imagesReport.created_at)} · <a className="font-medium text-blue-600 dark:text-blue-400 hover:underline" href={api.reportUrl(imagesReport.id, 'csv')} download>Download report</a></>
                        : 'How each check went, and the images that failed them.'}
                      summary={validation && (requiredImageChecksOk ? 'Checks run — you can continue' : 'A check set to Must pass failed')}
                      badge={validating ? 'Checking…' : undefined} expanded={imagesOpen === 3}
                      action={validation && imagesOpen === 3 ? (
                        <button type="button" className={`${btnOutline} flex items-center gap-2`} disabled={validating || runnableImageChecks.length === 0} onClick={handleValidate}>
                          {validating ? <SmallSpinner /> : null}{validating ? 'Checking…' : 'Run again'}
                        </button>
                      ) : undefined}>
            <ValidationDashboard
              variant="steps" onReport={setImagesReport} runLabel="Run again" runningLabel="Checking…" title={folderName} subtitle={imageCount}
              reportId={validation?.report_id ?? null} running={validating} canRun={runnableImageChecks.length > 0} onRun={handleValidate}
            >
              {({ report, openCheck, open }) => {
                const problems = report ? shownImageChecks.filter((o) => (report.checks[o.value]?.failed ?? 0) > 0) : []
                const blocking = problems.filter((o) => requiredImageChecks.has(o.value) && imageChecks.has(o.value))
                const issueImages = report?.totals.images_with_issues ?? 0
                const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
                return (
                  <>
                    {report && (
                      <div role="status" className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
                        problems.length === 0
                          ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                          : blocking.length > 0
                            ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300'
                            : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
                      }`}>
                        {problems.length === 0
                          ? 'Every check passed.'
                          : <>{plural(problems.length, 'check found', 'checks found')} problems in {plural(issueImages, 'image', 'images')}. {
                              blocking.length > 0
                                ? `${plural(blocking.length, 'is', 'are')} set to Must pass — resolve ${blocking.length === 1 ? 'it' : 'them'} to continue.`
                                : requiredImageChecks.size === 0 ? 'None is set to Must pass, so you can continue.' : 'The ones set to Must pass passed, so you can continue.'
                            }</>}
                      </div>
                    )}
                    <StrictnessTable options={shownImageChecks} enabled={imageChecks} required={requiredImageChecks} running={validating} results
                                     describe={(c) => IMAGE_CHECK_DESCRIPTIONS[c]}
                                     outcome={(c) => { const r = report?.checks[c]; return r ? { failed: r.failed, images: r.scope === 'images' ? r.failed : null } : undefined }}
                                     opened={openCheck as ImageCheck | null} onOpen={open} />
                  </>
                )
              }}
            </ValidationDashboard>
            {validationError && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{validationError}</p>}
            {/* The report says it all; the plain lines are only for when it couldn't be written. */}
            {validation && !validation.report_id && <ValidationReport validation={validation} />}
          </WizardStep>
        </div>
        )
      })()}

      {/* ── Step: where and when the images were taken ── */}
      {stepKey === 'origin' && (() => {
        const folderName = sourceDir.split(/[\\/]/).filter(Boolean).pop() ?? sourceDir
        const chip = 'rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1 text-xs text-zinc-700 dark:text-zinc-300'
        const whenOpen = originOpen === 2 && originReady
        const moreOpen = originOpen === 3 && originReady
        const originStatus = (n: number): 'open' | 'done' | 'locked' => {
          if (n === 1) return !whenOpen && !moreOpen ? 'open' : 'done'
          if (n === 2) return whenOpen ? 'open' : originReady && originReached >= 2 ? 'done' : 'locked'
          return moreOpen ? 'open' : originReady && originReached >= 3 ? 'done' : 'locked'
        }
        const moreFilled = [deployment.camera_id, deployment.camera_model, deployment.camera_height, deployment.camera_depth, deployment.camera_tilt, deployment.camera_heading, deployment.camera_interval,
          deployment.detection_distance, deployment.feature_type, deployment.habitat, deployment.setup_by, deployment.bait_use, deployment.timestamp_issues, deployment.deployment_groups, deployment.comments,
          deployment.tags.length || null].filter((v) => v != null && v !== '' && v !== false).length
        return (
        <div>
          <div className="flex flex-wrap gap-2 mb-6">
            {scan && <span className={chip}>{scan.image_count.toLocaleString('en-US')} {scan.image_count === 1 ? 'image' : 'images'}</span>}
            <span className={`${chip} font-mono`}>{folderName}</span>
          </div>

          <StepHeading>Origin and dates</StepHeading>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
            Say where the images were taken and when they were collected, then add what you know about the camera and the site — the rest can wait.
          </p>
          <div className="border-t border-zinc-200 dark:border-zinc-700" />
          <WizardStep n={1} title="Where was it taken?" status={originStatus(1)} canEdit onEdit={() => setOriginOpen(1)}
                      description="The research project and the location the images come from. They are kept in the collections folder — pick one that is already there, or add a new one, by hand or from Trapper."
                      summary={selectedProject && selectedLocation && <>
                        {selectedProject.acronym} · {selectedLocation.location_id}{selectedLocation.name ? `, ${selectedLocation.name}` : ''}<br />
                        {selectedLocation.latitude != null && selectedLocation.longitude != null && <>GPS {selectedLocation.latitude}, {selectedLocation.longitude} · </>}Timezone {timezone || 'unknown'}
                      </>}>
          <FormCard title="Research project" description="Those found in the collections folder.">
            {!addingProject ? (
              <>
                <label className="sr-only" htmlFor="origin-research-project">Research project</label>
                <Combobox
                  id="origin-research-project" options={localProjects.map((p) => ({ value: p.acronym, label: `${p.acronym} — ${p.name}` }))}
                  value={selectedProjectId} onChange={(id) => selectProject(localProjects.find((p) => p.acronym === id))}
                  placeholder={localProjects.length === 0 ? 'No research projects yet' : 'Select a research project…'}
                  clearLabel="Clear research project"
                />
                {localProjects.length === 0 && <p className={hintClass}>The collections folder has no research projects yet — add the first one.</p>}
                <div className="mt-3">
                  <button type="button" className={btnOutline} onClick={startAddingProject}>➕ Add a new research project</button>
                </div>
              </>
            ) : (
              <div>
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-3">New research project</p>
                <OptionCards options={ORIGIN_SOURCE_OPTIONS} selected={projectSource} onChoose={handleProjectSourceChange} />

                {projectSource === 'trapper' && (
                  <div className="mt-4">
                    {conn.status !== 'ok' ? connectionForm : (
                      <>
                        <p className={labelClass}>Trapper research projects</p>
                        <CheckboxList
                          filterLabel="Filter Trapper research projects" emptyText="No research projects found in Trapper." disabled={savingProject}
                          options={researchProjects.map((p) => ({ value: String(p.pk), label: p.acronym ? `${p.acronym} — ${p.name}` : p.name }))}
                          selected={trapperProjectPks} onChange={setTrapperProjectPks}
                        />
                        <p className={hintClass}>Tick one or more — they are added to the collections folder as they are, and the first one is picked.</p>
                      </>
                    )}
                  </div>
                )}

                {projectSource === 'manual' && (
                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <div className="col-span-2">
                      <Field label="Name" required maxLength={RESEARCH_PROJECT_LIMITS.name} value={projectDraft.name} error={shownProjectFieldErrors.name}
                             onChange={(v) => updateProject('name', v)} />
                    </div>
                    <Field label="Acronym" required maxLength={RESEARCH_PROJECT_LIMITS.acronymMax} placeholder="e.g. DONA" value={projectDraft.acronym}
                           hint={`Between ${RESEARCH_PROJECT_LIMITS.acronymMin} and ${RESEARCH_PROJECT_LIMITS.acronymMax} characters. It names the project's folder.`} error={shownProjectFieldErrors.acronym}
                           onChange={(v) => updateProject('acronym', v)} />
                    <Field label="Event interval" type="number" required min={0} step={1} value={projectDraft.event_interval?.toString() ?? ''}
                           error={shownProjectFieldErrors.event_interval} onChange={(v) => updateProject('event_interval', v ? Number(v) : null)} />
                    <SelectField label="Sampling design" allowEmpty={false} options={SAMPLING_DESIGN_OPTIONS} value={String(projectDraft.sampling_design)}
                                 onChange={(v) => updateProject('sampling_design', Number(v))} />
                    <SelectField label="Sensor method" allowEmpty={false} options={SENSOR_METHOD_OPTIONS} value={String(projectDraft.sensor_method)}
                                 onChange={(v) => updateProject('sensor_method', Number(v))} />
                    <SelectField label="Animal types" allowEmpty={false} options={ANIMAL_TYPES_OPTIONS} value={String(projectDraft.animal_types)}
                                 onChange={(v) => updateProject('animal_types', Number(v))} />
                    <SelectField label="Bait use" allowEmpty={false} options={BAIT_USE_OPTIONS} value={String(projectDraft.bait_use)}
                                 onChange={(v) => updateProject('bait_use', Number(v))} />
                    <div className="col-span-2">
                      <Field label="Keywords" hint="Comma or space delimited tags." value={projectDraft.keywords} onChange={(v) => updateProject('keywords', v)} />
                    </div>
                    <div className="col-span-2">
                      <TextAreaField label="Abstract" maxLength={RESEARCH_PROJECT_LIMITS.text} value={projectDraft.abstract} error={shownProjectFieldErrors.abstract}
                                     onChange={(v) => updateProject('abstract', v)} />
                    </div>
                    <div className="col-span-2">
                      <TextAreaField label="Methods" maxLength={RESEARCH_PROJECT_LIMITS.text} value={projectDraft.methods} error={shownProjectFieldErrors.methods}
                                     onChange={(v) => updateProject('methods', v)} />
                    </div>
                    <div className="col-span-2">
                      <TextAreaField label="Description" maxLength={RESEARCH_PROJECT_LIMITS.text} value={projectDraft.description} error={shownProjectFieldErrors.description}
                                     onChange={(v) => updateProject('description', v)} />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 mt-4">
                  {projectSource === 'manual' && (
                    <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!canSaveProject} onClick={handleSaveProject}>
                      {savingProject && <SmallSpinner />}
                      Save research project
                    </button>
                  )}
                  {projectSource === 'trapper' && conn.status === 'ok' && (
                    <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={trapperProjectPks.length === 0 || savingProject} onClick={handleAddTrapperProjects}>
                      {savingProject && <SmallSpinner />}
                      {`Add ${trapperProjectPks.length} research project${trapperProjectPks.length === 1 ? '' : 's'}`}
                    </button>
                  )}
                  <button type="button" className={btnOutline} onClick={() => { setAddingProject(false); setOriginError(null) }}>Cancel</button>
                </div>
              </div>
            )}
          </FormCard>

          {selectedProjectId && !addingProject && (
            <FormCard title="Location" description={`Locations of ${selectedProjectId}, found in the collections folder.`}>
              {!addingLocation ? (
                <>
                  <label className={labelClass} htmlFor="origin-location">Location</label>
                  <Combobox
                    id="origin-location" options={localLocations.map((l) => ({ value: l.location_id, label: `${l.location_id}${l.name ? ` — ${l.name}` : ''}` }))}
                    value={selectedLocationId} onChange={(id) => selectLocation(localLocations.find((l) => l.location_id === id))}
                    placeholder={localLocations.length === 0 ? 'No locations yet' : 'Select a location…'}
                    clearLabel="Clear location"
                  />
                  {localLocations.length === 0 && <p className={hintClass}>{selectedProjectId} has no locations yet — add the first one.</p>}
                  {locationLacksCoordinates && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">{selectedLocationId} has no coordinates, and a deployment needs them — pick another location.</p>
                  )}
                  <div className="mt-3">
                    <button type="button" className={btnOutline} onClick={startAddingLocation}>➕ Add a new location</button>
                  </div>
                </>
              ) : (
                <div>
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-3">New location</p>
                  <OptionCards options={ORIGIN_SOURCE_OPTIONS} selected={locationSource} onChoose={handleLocationSourceChange} />

                  {locationSource === 'trapper' && (
                    <div className="mt-4">
                      {conn.status !== 'ok' ? connectionForm : (
                        <>
                          <div className="mb-4">
                            <label className={labelClass} htmlFor="trapper-location-project">Trapper research project</label>
                            <Combobox
                              id="trapper-location-project" options={researchProjects.map((p) => ({ value: String(p.pk), label: p.acronym ? `${p.acronym} — ${p.name}` : p.name }))}
                              value={trapperLocationProjectPk} onChange={handleTrapperLocationProjectChange}
                              placeholder={researchProjects.length === 0 ? 'No research projects found' : 'Select a research project…'}
                              clearLabel="Clear Trapper research project"
                            />
                          </div>
                          {trapperLocationProjectPk && (
                            <div>
                              <p className={labelClass}>Trapper locations</p>
                              <CheckboxList
                                filterLabel="Filter Trapper locations" emptyText={loadingTrapperLocations ? 'Loading locations…' : 'No locations found.'}
                                disabled={loadingTrapperLocations || savingLocation}
                                options={trapperLocations.map((l) => ({ value: String(l.pk), label: `${l.location_id}${l.name ? ` — ${l.name}` : ''}` }))}
                                selected={trapperLocationPks} onChange={setTrapperLocationPks}
                              />
                              <p className={hintClass}>Tick one or more — they are added to {selectedProjectId} as they are, and the first one is picked.</p>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {locationSource === 'manual' && (
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <Field label="Location id" required placeholder="e.g. DONA_01" hint={DESCRIPTIONS.locationID} value={locationDraft.location_id}
                             onChange={(v) => setLocationDraft((d) => ({ ...d, location_id: v }))} />
                      <Field label="Location name (optional)" placeholder="e.g. Doñana site 1" hint={DESCRIPTIONS.locationName} value={locationDraft.name}
                             onChange={(v) => setLocationDraft((d) => ({ ...d, name: v }))} />
                      <Field label="Latitude" type="number" required min={-90} max={90} step="any" placeholder="e.g. 52.70442"
                             hint={DESCRIPTIONS.latitude} error={locationDraft.latitude ? locationErrors.latitude : undefined} value={locationDraft.latitude}
                             onChange={(v) => setLocationDraft((d) => ({ ...d, latitude: v }))} />
                      <Field label="Longitude" type="number" required min={-180} max={180} step="any" placeholder="e.g. 23.84995"
                             hint={DESCRIPTIONS.longitude} error={locationDraft.longitude ? locationErrors.longitude : undefined} value={locationDraft.longitude}
                             onChange={(v) => setLocationDraft((d) => ({ ...d, longitude: v }))} />
                      <Field label="Coordinate uncertainty (m)" type="number" min={1} step={1} placeholder="e.g. 100"
                             hint={DESCRIPTIONS.coordinateUncertainty} error={locationErrors.coordinate_uncertainty} value={locationDraft.coordinate_uncertainty}
                             onChange={(v) => setLocationDraft((d) => ({ ...d, coordinate_uncertainty: v }))} />
                      <Field label="Timezone (IANA)" placeholder="e.g. Europe/Madrid" list="timezone-options" error={locationErrors.timezone}
                             hint="The location's own — every deployment there is read in it." value={locationDraft.timezone}
                             onChange={(v) => setLocationDraft((d) => ({ ...d, timezone: v }))} />
                      <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer mt-7">
                        <input type="checkbox" className="mt-1" checked={locationDraft.ignore_dst} onChange={(e) => setLocationDraft((d) => ({ ...d, ignore_dst: e.target.checked }))} />
                        The location’s cameras ignore summer time (DST)
                      </label>
                      <datalist id="timezone-options">
                        {knownTimezones().map((tz) => <option key={tz} value={tz} />)}
                      </datalist>
                    </div>
                  )}

                  <div className="flex items-center gap-3 mt-4">
                    {locationSource === 'manual' && (
                      <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!canSaveLocation} onClick={handleSaveLocation}>
                        {savingLocation && <SmallSpinner />}
                        Save location
                      </button>
                    )}
                    {locationSource === 'trapper' && conn.status === 'ok' && (
                      <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={trapperLocationPks.length === 0 || savingLocation} onClick={handleAddTrapperLocations}>
                        {savingLocation && <SmallSpinner />}
                        {`Add ${trapperLocationPks.length} location${trapperLocationPks.length === 1 ? '' : 's'}`}
                      </button>
                    )}
                    <button type="button" className={btnOutline} onClick={() => { setAddingLocation(false); setOriginError(null) }}>Cancel</button>
                  </div>
                </div>
              )}
            </FormCard>
          )}

          {originError && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{originError}</p>}
            <div className="flex justify-end mt-4">
              <button type="button" aria-label="Continue to the dates" className={btnPrimary} disabled={!originReady} onClick={() => { setOriginOpen(2); setOriginReached(2) }}>Continue<span aria-hidden="true"> →</span></button>
            </div>
          </WizardStep>

          <WizardStep n={2} title="When was it collected?" status={originStatus(2)} canEdit onEdit={() => setOriginOpen(2)}
                      description={!timezone
                        ? <span className="text-red-600 dark:text-red-400">The location <strong>{deployment.location_id}</strong> has no timezone, and a deployment needs it: add it to the location.</span>
                        : <>Tell us when the images of <strong>{deployment.location_id}</strong> were collected. Times are in <strong>{timezone}</strong>, which {ignoreDst ? 'has no daylight saving time' : 'follows daylight saving time'}.</>}
                      summary={deployment.start_date && <>{deployment.deployment_id}<br />{deployment.start_date.slice(0, 10)} → {deployment.end_date?.slice(0, 10) ?? '…'}</>}>
            {guessing && <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">Reading the dates and the camera from the images…</p>}
              <FormCard title="Which revision is this?">
                <div className="flex items-end gap-6 flex-wrap">
                  <div>
                    <div className="flex items-baseline gap-3 mb-1.5">
                      <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300" htmlFor="field-revision">Revision</label>
                      <span className="text-xs text-blue-600 dark:text-blue-400">Required</span>
                    </div>
                    <div className="inline-flex items-stretch rounded-lg border border-zinc-300 dark:border-zinc-600 overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                      <button type="button" aria-label="Lower the revision number" disabled={!revisionValid || Number(revision) <= 1}
                              className="w-12 text-lg text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40"
                              onClick={() => handleRevisionChange(String(Number(revision) - 1))}>−</button>
                      <input id="field-revision" type="number" min={1} max={9999} step={1} placeholder="e.g. 3" value={revision}
                             onChange={(e) => handleRevisionChange(e.target.value)}
                             className="w-20 text-center bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                      <button type="button" aria-label="Raise the revision number" disabled={revisionValid && Number(revision) >= 9999}
                              className="w-12 text-lg text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40"
                              onClick={() => handleRevisionChange(String((revisionValid ? Number(revision) : 0) + 1))}>+</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5" htmlFor="field-deployment-id">Deployment Id</label>
                    <input id="field-deployment-id" readOnly value={deployment.deployment_id} placeholder="Filled in from the revision"
                           className="rounded-full border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-4 py-2 font-mono text-sm text-zinc-800 dark:text-zinc-200 w-64 max-w-full" />
                  </div>
                </div>
                {revision.trim() !== '' && !revisionValid && <p className="text-xs text-red-600 dark:text-red-400 mt-2">Must be a whole number between 1 and 9999.</p>}
                {fieldErrors.deployment_id && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{fieldErrors.deployment_id}</p>}
                <p className={hintClass}>1 for the first visit to this location, 2 for the second, and so on.{revisionHint ? ` ${revisionHint}` : ''}</p>
                {previousRevision && (
                  <div className="mt-4 flex items-center gap-4 flex-wrap rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/50 px-5 py-4 text-sm text-blue-900 dark:text-blue-100">
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current text-blue-600 dark:text-blue-300" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
                    <span className="flex-1 min-w-[14rem]">
                      Revision {previousRevision.revision} is on file for <strong>{deployment.location_id}</strong> (<span className="font-mono">{previousRevision.deployment_id}</span>).
                      Copy its camera, site and notes? Dates are never copied — each revision has its own.
                      {filledFrom && <span role="status" className="block mt-1 text-xs text-blue-800 dark:text-blue-300">Filled in from {filledFrom} — check the camera, site and notes in More details.</span>}
                    </span>
                    <button type="button" className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700" onClick={handleFillFromPrevious}>Copy from revision {previousRevision.revision}</button>
                  </div>
                )}
                {epicollectEntry && !epicollectImported && (
                  <div className="mt-4 flex items-center gap-4 flex-wrap rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/50 px-5 py-4 text-sm text-blue-900 dark:text-blue-100">
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current text-blue-600 dark:text-blue-300" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
                    <span className="flex-1 min-w-[14rem]">
                      Epicollect5 has an entry for <strong>{deployment.location_id}</strong>, revision {revisionNumber}.
                      The camera, site and notes can be filled in from it.
                    </span>
                    <button type="button" className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700" onClick={() => fillFromEpicollect(epicollectEntry)}>Import from Epicollect5</button>
                  </div>
                )}
                {epicollectDone && epicollectMissing !== null && !epicollectMessage && (
                  <div role="alert" className="mt-4 flex items-center gap-4 flex-wrap rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/50 px-5 py-4 text-sm text-amber-900 dark:text-amber-100">
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current text-amber-600 dark:text-amber-300" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></svg>
                    <span className="flex-1 min-w-[14rem]">
                      {epicollectMissing || <>Epicollect5 has no entry for <strong>{deployment.location_id}</strong>, revision {revisionNumber}: its details have to be filled in here.</>}
                    </span>
                    {onOpenSettings && <button type="button" className="rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-700" onClick={() => onOpenSettings('epicollect')}>Open Epicollect5 settings</button>}
                  </div>
                )}
                {epicollectMessage && (
                  <p role={epicollectMessage.kind === 'error' ? 'alert' : 'status'}
                     className={`mt-3 text-sm ${epicollectMessage.kind === 'error' ? 'text-red-600 dark:text-red-400' : 'text-blue-800 dark:text-blue-300'}`}>{epicollectMessage.text}</p>
                )}
                {existingFolder && (
                  <p role="alert" className="mt-3 text-sm text-amber-700 dark:text-amber-400">
                    ⚠ This deployment already exists: <span className="font-mono break-all">{existingFolder}</span> is already kept, and importing again
                    would be refused as it would mix them. Choose another revision or location, or move that folder away.
                  </p>
                )}
              </FormCard>

              <FormCard title="Period">
                <DateSourcePicker
                  name={deployment.deployment_id || 'deployment'} value={dateSource} onPick={pickSource} start={deployment.start_date || null} end={deployment.end_date ?? null} timezone={timezone}
                  options={[
                    { source: 'exif', title: 'Camera data in the photos', period: periodOf('exif'),
                      hint: `First and last photo of the deployment.${scan && periodOf('exif') ? ` ${scan.image_count.toLocaleString('en-US')} ${scan.image_count === 1 ? 'photo' : 'photos'}, read from their EXIF data.` : ''}` },
                    { source: 'epicollect', title: 'Epicollect5 project', period: periodOf('epicollect'),
                      hint: periodOf('epicollect') ? 'Entry of your Epicollect5 project for this location and revision.'
                        : !epicollectOn ? 'Epicollect5 is turned off in the settings.'
                        : `Nothing found for ${deployment.location_id}, revision ${revisionValid ? revisionNumber : '?'}.` },
                    { source: 'manual', title: 'Manual entry', period: null, hint: 'Type the start and the end yourself.' },
                  ] satisfies SourceOption[]}
                  manualForm={<DeploymentFormBody collapsible periodOnly deployment={deployment} timezone={timezone} errors={fieldErrors} onField={updateField} datesGuessed={false} />} />
              </FormCard>
              <div className="flex justify-end mt-4">
                <button type="button" aria-label="Continue to more details" className={btnPrimary} onClick={() => { setOriginOpen(3); setOriginReached(3) }}>Continue<span aria-hidden="true"> →</span></button>
              </div>
          </WizardStep>

          <WizardStep n={3} title="More details" status={originStatus(3)} canEdit onEdit={() => { setOriginOpen(3); setOriginReached(3) }}
                      description="Everything here is optional. Fill in what you know now — you can add the rest later."
                      summary={moreFilled > 0 ? `${moreFilled} ${moreFilled === 1 ? 'detail' : 'details'} filled in` : 'Nothing filled in yet'}>
            {filledFrom && (
              <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-5 py-4 text-sm text-emerald-900 dark:text-emerald-100">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>
                <span className="flex-1"><strong className="font-semibold">Filled in from {filledFrom}.</strong> Change anything that&rsquo;s different this time.</span>
                <button type="button" className="rounded-lg border border-emerald-400 dark:border-emerald-800 px-4 py-2 text-sm font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/40" onClick={handleStartEmpty}>Start empty</button>
              </div>
            )}
            <MoreDetailsForm deployment={deployment} errors={fieldErrors} onField={updateField} />
          </WizardStep>
        </div>
        )
      })()}

      {/* ── Step: check the details ── */}
      {stepKey === 'checks' && (() => {
        const chip = 'rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1 text-xs text-zinc-700 dark:text-zinc-300'
        const date = (iso: string | null | undefined, year: boolean) => (iso ? formatDay(iso, year) : '…')
        const sameYear = deployment.start_date.slice(0, 4) === (deployment.end_date ?? '').slice(0, 4)
        const location = localLocations.find((l) => l.location_id === deployment.location_id)
        const imageCount = scan ? `${scan.image_count.toLocaleString('en-US')} ${scan.image_count === 1 ? 'image' : 'images'}` : ''
        return (
        <div>
          <div className="flex flex-wrap gap-2 mb-6">
            {imageCount && <span className={chip}>{imageCount}</span>}
            <span className={`${chip} font-mono`}>{deployment.deployment_id}</span>
            {location?.name && <span className={chip}>{location.name}</span>}
            {deployment.start_date && <span className={chip}>{date(deployment.start_date, !sameYear)} → {date(deployment.end_date, true)}</span>}
          </div>

          <StepHeading>Check the details</StepHeading>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
            Now that we know when and where the images were taken, we check the deployment's names and dates, and that the images fit it.
            Choose how strict each check should be.
          </p>
          <div className="border-t border-zinc-200 dark:border-zinc-700" />

          <WizardStep n={1} title="Choose the checks" status={checksOpen === 1 ? 'open' : 'done'} canEdit={!checkingDeployment} onEdit={() => setChecksOpen(1)}
                      description="Choose how strict each check should be: skip it, warn about what it finds, or make it a must."
                      summary={<>{runnableDeploymentChecks.length} {runnableDeploymentChecks.length === 1 ? 'check' : 'checks'} to run{requiredDeploymentChecks.size > 0 && ` · ${requiredDeploymentChecks.size} must pass`}</>}>
            {shownDeploymentChecks.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">
                Every postvalidation check is turned off in the settings, so there is nothing to run here — go on.
              </p>
            ) : (
              <>
                <StrictnessTable
                  options={shownDeploymentChecks.map((o) => ({ value: o.value, label: DEPLOYMENT_CHECK_DISPLAY[o.value].label }))}
                  enabled={deploymentChecks} required={requiredDeploymentChecks} running={false}
                  describe={(c) => DEPLOYMENT_CHECK_DISPLAY[c].description(deployment.location_id ?? '').replace(/\.$/, '')}
                  outcome={() => undefined} onChoose={chooseDeploymentCheckStrictness} />
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                  <strong className="font-semibold text-zinc-700 dark:text-zinc-300">Skip</strong> doesn't run the check · <strong className="font-semibold text-zinc-700 dark:text-zinc-300">Warn</strong> shows the problems but lets you continue · <strong className="font-semibold text-zinc-700 dark:text-zinc-300">Must pass</strong> blocks you until it passes.
                </p>
                <div className="flex justify-end mt-4">
                  <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={runnableDeploymentChecks.length === 0 || checkingDeployment}
                          onClick={() => { setChecksOpen(2); void handleCheckDeployment() }}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M6 4l14 8-14 8z" /></svg>Run checks
                  </button>
                </div>
              </>
            )}
          </WizardStep>

          <WizardStep n={2} title="Check results" status={checkingDeployment ? 'running' : deploymentCheckError ? 'error' : deploymentCheck ? (checksOpen === 2 ? 'open' : 'done') : 'locked'}
                      canEdit={!checkingDeployment} onEdit={() => setChecksOpen(2)} expanded={checksOpen === 2}
                      description={deploymentCheckReport && !checkingDeployment
                        ? <>{imageCount} · last run {formatRun(deploymentCheckReport.created_at)} · <a className="font-medium text-blue-600 dark:text-blue-400 hover:underline" href={api.reportUrl(deploymentCheckReport.id, 'csv')} download>Download report</a></>
                        : 'How each check went.'}
                      summary={deploymentCheck && (requiredDeploymentChecksOk ? 'Checks run — you can continue' : 'A check set to Must pass failed')}
                      badge={checkingDeployment ? 'Checking…' : undefined}
                      action={deploymentCheck && checksOpen === 2 ? (
                        <button type="button" className={`${btnOutline} flex items-center gap-2`} disabled={checkingDeployment || runnableDeploymentChecks.length === 0} onClick={() => void handleCheckDeployment()}>
                          {checkingDeployment ? <SmallSpinner /> : null}{checkingDeployment ? 'Checking…' : 'Run again'}
                        </button>
                      ) : undefined}>
            {shownDeploymentChecks.length > 0 && (
              <ValidationDashboard
                variant="steps" onReport={setDeploymentCheckReport} title={deployment.deployment_id} subtitle={imageCount}
                reportId={deploymentCheck?.report_id ?? null} running={checkingDeployment} canRun={runnableDeploymentChecks.length > 0}
                onRun={handleCheckDeployment} runLabel="Run again" runningLabel="Checking…"
              >
                {({ report, openCheck, open }) => {
                  const problems = report ? shownDeploymentChecks.filter((o) => (report.checks[o.value]?.failed ?? 0) > 0) : []
                  const passed = report ? shownDeploymentChecks.filter((o) => deploymentChecks.has(o.value) && report.checks[o.value] && report.checks[o.value].failed === 0).length : 0
                  const blocking = problems.filter((o) => requiredDeploymentChecks.has(o.value) && deploymentChecks.has(o.value))
                  const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
                  return (
                    <>
                      {report && (
                        <div role="status" className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
                          problems.length === 0
                            ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                            : blocking.length > 0
                              ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300'
                              : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
                        }`}>
                          {problems.length === 0
                            ? 'Every check passed.'
                            : <>{plural(passed, 'check', 'checks')} passed, {plural(problems.length, 'check found', 'checks found')} problems — see below. {
                                blocking.length > 0
                                  ? `${plural(blocking.length, 'is', 'are')} set to Must pass — resolve ${blocking.length === 1 ? 'it' : 'them'} to continue.`
                                  : requiredDeploymentChecks.size === 0 ? 'None is set to Must pass, so you can continue.' : 'The ones set to Must pass passed, so you can continue.'
                              }</>}
                        </div>
                      )}
                      <StrictnessTable
                        options={shownDeploymentChecks.map((o) => ({ value: o.value, label: DEPLOYMENT_CHECK_DISPLAY[o.value].label }))}
                        enabled={deploymentChecks} required={requiredDeploymentChecks} running={checkingDeployment} results
                        describe={(c) => DEPLOYMENT_CHECK_DISPLAY[c].description(deployment.location_id ?? '').replace(/\.$/, '')}
                        outcome={(c) => { const r = report?.checks[c]; return r ? { failed: r.failed, images: r.scope === 'images' ? r.failed : null } : undefined }}
                        note={(c) => report?.entries.find((e) => e.check === c && e.status === 'failed')?.message}
                        opened={openCheck as DeploymentCheck | null} onOpen={open} />
                    </>
                  )
                }}
              </ValidationDashboard>
            )}
            {deploymentCheckError && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{deploymentCheckError}</p>}
            {deploymentCheck && !deploymentCheck.report_id && <DeploymentCheckReport result={deploymentCheck} toleranceHours={toleranceHours} />}
          </WizardStep>
        </div>
        )
      })()}

      {/* ── Step: prepare the images and save the deployment ── */}
      {stepKey === 'prepare' && (() => {
        const rows: { key: string; label: string; always?: boolean; step?: PreprocessStep; text: ReactNode; disabledReason?: string }[] = [
          { key: 'copy', label: 'Copy into the collection', always: true, text: <>Copies every image into the deployment&rsquo;s folder. Anything that isn&rsquo;t an image is copied as it is.</> },
          { key: 'dates', label: 'Read the capture dates', always: true, text: <>From each image&rsquo;s EXIF, as the camera&rsquo;s local time in <span className="font-mono">{timezone || 'the timezone of the details'}</span>{ignoreDst ? ', ignoring summer time' : ''}{preSettings.convert_to_utc ? ', converted to UTC' : ''}. An image with no EXIF date uses its file&rsquo;s date.</> },
          { key: 'rename', label: 'Rename the images', step: 'rename', text: <><span className="font-mono">{'<deployment>__<YYYYMMDD>_<n>.<EXT>'}</span> in upper case — for example <span className="font-mono">{exampleImageName}</span>.</> },
          { key: 'resize', label: 'Resize the images', step: 'resize', text: <>Images wider than <strong>{preSettings.resize_width} px</strong> are resized to that width, keeping their proportions, EXIF and colour profile.</> },
          { key: 'metadata', label: 'Add metadata', step: 'metadata', text: <>Authorship, rights and license, written into each image as XMP.</>, disabledReason: exiftool === false ? 'ExifTool is not installed, and writing the metadata needs it.' : undefined },
        ]
        const doneRun = preprocessed?.type === 'done'
        const active = (r: (typeof rows)[number]) => r.always || (r.step !== undefined && effectivePreprocessSteps.has(r.step))
        const chip = 'rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1 text-xs text-zinc-700 dark:text-zinc-300'
        const location = localLocations.find((l) => l.location_id === deployment.location_id)
        const missingMetadata = [!preSettings.owner && 'Owner', !preSettings.publisher && 'Publisher'].filter(Boolean) as string[]
        // The images go through copy, dates, rename and resize in one pass, then the metadata is written: the pass's steps share its progress out between them.
        const activeRows = rows.filter(active)
        const passRows = activeRows.filter((r) => r.key !== 'metadata')
        const lastCopy = [...preprocessEvents].reverse().find((e) => e.type === 'copy')
        const writingMetadata = preprocessEvents.some((e) => e.type === 'metadata' || e.type === 'sealing')
        const currentStep = writingMetadata && activeRows.length > passRows.length
          ? activeRows.length - 1
          : lastCopy && lastCopy.type === 'copy' && lastCopy.total > 0 ? Math.min(passRows.length - 1, Math.floor((lastCopy.index / lastCopy.total) * passRows.length)) : 0
        const stepStatus = (r: (typeof rows)[number]): 'done' | 'running' | 'pending' => {
          if (doneRun) return 'done'
          const at = activeRows.indexOf(r)
          return !preprocessing ? 'pending' : at < currentStep ? 'done' : at === currentStep ? 'running' : 'pending'
        }
        const prepStarted = preprocessing || doneRun || Boolean(preprocessError)
        const prepStatus2 = importing ? 'running' : importError ? 'error' : destDir ? 'done' : resultsDone ? 'open' : 'locked'
        return (
          <div>
            <div className="flex flex-wrap gap-2 mb-6">
              {scan && <span className={chip}>{scan.image_count.toLocaleString('en-US')} {scan.image_count === 1 ? 'image' : 'images'}</span>}
              <span className={`${chip} font-mono`}>{deployment.deployment_id}</span>
              {location?.name && <span className={chip}>{location.name}</span>}
            </div>

            <StepHeading>Prepare and save</StepHeading>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
              Choose what is done to the images, see how it went, and save the deployment in your local collection. Nothing is uploaded to Trapper yet.
            </p>
            <div className="border-t border-zinc-200 dark:border-zinc-700" />

            <WizardStep n={1} title="Preprocessing steps" status={prepStarted ? 'done' : 'open'} canEdit={!preprocessing} onEdit={handleEditPreprocessSteps}
                        summary={`${activeRows.length} ${activeRows.length === 1 ? 'step' : 'steps'} chosen`}
                        description="Choose what to do to the images. They're copied, renamed, resized and tagged into the deployment's folder. Your originals are never touched, and nothing is final until you save.">
              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700 mb-4">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 dark:bg-zinc-800">
                    <tr className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      <th scope="col" className="px-4 py-2.5 text-left">Step</th>
                      <th scope="col" className="px-4 py-2.5 text-center">Include</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                    {rows.map((r) => (
                      <tr key={r.key}>
                        <td className="px-4 py-3 text-zinc-800 dark:text-zinc-200">
                          <span className="font-medium">{r.label}</span>
                          <span className="block text-xs text-zinc-500 dark:text-zinc-400">{r.text}</span>
                          {r.disabledReason && <span className="block text-xs text-red-600 dark:text-red-400">{r.disabledReason}</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {r.always
                            ? <span className="text-xs px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">Always</span>
                            : <input type="checkbox" aria-label={r.label} checked={active(r)} disabled={Boolean(r.disabledReason) || preprocessing}
                                     onChange={() => togglePreprocessStep(r.step!)} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {effectivePreprocessSteps.has('metadata') && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 mb-4">
                  <button type="button" aria-expanded={moreMetadataOpen} onClick={() => setMoreMetadataOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                    <span>
                      <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">What gets written into each image</span>
                      {missingMetadata.length > 0 && (
                        <span className="block text-xs text-amber-600 dark:text-amber-400">
                          {missingMetadata.length} {missingMetadata.length === 1 ? 'field isn’t' : 'fields aren’t'} set in Settings yet: {missingMetadata.join(' and ')}
                        </span>
                      )}
                    </span>
                    <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 fill-none stroke-current text-zinc-500 transition-transform ${moreMetadataOpen ? 'rotate-180' : ''}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                  {moreMetadataOpen && (
                    <div className="px-4 pb-4">
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  <dt className="text-zinc-500 dark:text-zinc-400">Creator</dt>
                  <dd className="font-mono">{`CT (<camera make and model> ${selectedProject?.name || 'Unknown'})`}</dd>
                  <dt className="text-zinc-500 dark:text-zinc-400">Owner</dt>
                  <dd className="font-mono">{preSettings.owner || 'Unknown'}{!preSettings.owner && <span className="ml-2 text-amber-600 dark:text-amber-400 font-sans">not set in Settings</span>}</dd>
                  <dt className="text-zinc-500 dark:text-zinc-400">Publisher</dt>
                  <dd className="font-mono">{preSettings.publisher || 'Unknown'}{!preSettings.publisher && <span className="ml-2 text-amber-600 dark:text-amber-400 font-sans">not set in Settings</span>}</dd>
                  <dt className="text-zinc-500 dark:text-zinc-400">Rights</dt>
                  <dd className="font-mono">{`© ${preSettings.owner || 'Unknown'}, ${new Date().getFullYear()}. All rights reserved.`}</dd>
                  <dt className="text-zinc-500 dark:text-zinc-400">License</dt>
                  <dd className="font-mono break-all">{preSettings.license_url}</dd>
                  <dt className="text-zinc-500 dark:text-zinc-400">Coverage</dt>
                  <dd className="font-mono">{preSettings.coverage || deployment.location_name || deployment.location_id || 'the deployment’s location'}</dd>
                  <dt className="text-zinc-500 dark:text-zinc-400">Identifiers</dt>
                  <dd>The hash of each original and of the image kept, so each can be traced back.</dd>
                </dl>
                {onOpenSettings && <button type="button" className={`${btnOutline} mt-3`} onClick={() => onOpenSettings()}>Open Settings</button>}
                    </div>
                  )}
                </div>
              )}
              {plannedCollectionError && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{plannedCollectionError}</p>}
              <div className="flex justify-end">
                <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!plannedCollection || preprocessing} onClick={handlePreprocess}><svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M6 4l14 8-14 8z" /></svg>Start preparing</button>
              </div>
            </WizardStep>

            <WizardStep n={2} title="Preprocessing results" status={preprocessing ? 'running' : preprocessError ? 'error' : doneRun ? 'done' : 'locked'} canEdit={resultsDone && !importing && !destDir} onEdit={() => setResultsDone(false)} expanded={doneRun && !resultsDone} badge={preprocessing ? 'Preparing…' : undefined}
                        action={!preprocessing && !destDir && !resultsDone && (doneRun || preprocessError) ? <button type="button" className={btnOutline} disabled={importing} onClick={handlePreprocess}>Prepare again</button> : undefined}
                        summary={preprocessed?.type === 'done' ? `${(preprocessed.processed ?? 0).toLocaleString('en-US')} ${preprocessed.processed === 1 ? 'image' : 'images'} prepared${preprocessed.skipped ? `, ${preprocessed.skipped} skipped` : ''}` : undefined}
                        description="How each step went, and which images, if any, had to be skipped.">
              {preprocessing && (
                <div className="mb-4" role="status" aria-label={`Step ${currentStep + 1} of ${activeRows.length}`}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">Step {currentStep + 1} of {activeRows.length}</span>
                    <span className="text-zinc-500 dark:text-zinc-400">{Math.round((currentStep / activeRows.length) * 100)}%</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                    <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${(currentStep / activeRows.length) * 100}%` }} />
                  </div>
                </div>
              )}
              <ValidationDashboard
                variant="steps" preprocessing lastRunLine
                title="Preprocessing" subtitle={scan ? `${scan.image_count.toLocaleString('en-US')} ${scan.image_count === 1 ? 'image' : 'images'}` : ''}
                reportId={preprocessed?.type === 'done' ? preprocessed.report_id ?? null : null}
                running={preprocessing} canRun={Boolean(plannedCollection) && !preprocessing} onRun={handlePreprocess} runLabel="Start preparing" runningLabel="Preparing…"
              >
                {({ report, openCheck, open }) => (
                  <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700 mb-4">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-50 dark:bg-zinc-800">
                        <tr className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          <th scope="col" className="px-4 py-2.5 text-left">Step</th>
                          <th scope="col" className="px-4 py-2.5 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                        {rows.filter(active).map((r) => {
                          const skipped = report?.checks.preprocessing?.failed ?? 0
                          return (
                            <tr key={r.key}>
                              <td className="px-4 py-3 text-zinc-800 dark:text-zinc-200">
                                <span className="font-medium">{r.label}</span>
                                <span className="block text-xs text-zinc-500 dark:text-zinc-400">{r.text}</span>
                                {r.disabledReason && <span className="block text-xs text-red-600 dark:text-red-400">{r.disabledReason}</span>}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {active(r) && preprocessing && stepStatus(r) === 'running' && <span role="status" aria-label={`${r.label}: running`} className="inline-flex"><SmallSpinner /></span>}
                                {active(r) && preprocessing && stepStatus(r) === 'done' && <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">Done</span>}
                                {doneRun && active(r) && (r.key === 'copy' && skipped > 0 ? (
                                  <button type="button" aria-label={`${openCheck === 'preprocessing' ? 'Close' : 'Open'} the skipped images`} aria-expanded={openCheck === 'preprocessing'}
                                          className="rounded-full px-2 py-0.5 text-xs font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300" onClick={() => open('preprocessing')}>
                                    {skipped.toLocaleString('en-US')} skipped {openCheck === 'preprocessing' ? '⌄' : '›'}
                                  </button>
                                ) : (
                                  <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">Done</span>
                                ))}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </ValidationDashboard>
              {preprocessError && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{preprocessError}</p>}
              {!preprocessing && !destDir && !resultsDone && (doneRun || preprocessError) && (
                <div className="flex justify-between items-center">
                  <button type="button" className={btnOutline} disabled={importing} onClick={handleBack}><span aria-hidden="true">← </span>Back</button>
                  <div className="flex items-center gap-3">
                    {doneRun && <button type="button" aria-label="Continue to save" className={btnPrimary} disabled={importing} onClick={() => setResultsDone(true)}>Continue<span aria-hidden="true"> →</span></button>}
                  </div>
                </div>
              )}
            </WizardStep>

            <WizardStep n={3} title="Save to your collection" status={prepStatus2} canEdit={false} onEdit={() => {}} expanded={Boolean(destDir)} badge={importing ? 'Saving…' : undefined}
                        description="Available once the images are prepared.">
              <p className="text-base text-zinc-600 dark:text-zinc-300 mb-4">
                Everything is ready. This saves the deployment in your local collection. Nothing is uploaded to Trapper yet.
              </p>
              {(() => {
                const done = preprocessed?.type === 'done' ? preprocessed : null
                const savedLocation = localLocations.find((l) => l.location_id === deployment.location_id)
                const did = [effectivePreprocessSteps.has('rename') && 'renamed', effectivePreprocessSteps.has('resize') && 'resized', effectivePreprocessSteps.has('metadata') && 'tagged'].filter(Boolean) as string[]
                const rows: [string, ReactNode][] = [
                  ['Deployment', <span className="font-mono font-semibold">{deployment.deployment_id}</span>],
                  ['Taken at', [selectedProject?.acronym, [deployment.location_id, savedLocation?.name].filter(Boolean).join(', ')].filter(Boolean).join(' · ')],
                  ['Period', `${formatPeriod(deployment.start_date, deployment.end_date)}${timezone ? ` (${timezone})` : ''}`],
                  ['Images', done ? `${(done.processed ?? 0).toLocaleString('en-US')} prepared${did.length ? ` · ${did.join(', ').replace(/, ([^,]*)$/, ' and $1')}` : ''}${done.skipped ? ` · ${done.skipped} skipped` : ''}` : ''],
                  ['Saved to', plannedCollection ? <span className="font-mono break-all">{`${plannedCollection.path}/${deployment.deployment_id}`}</span> : ''],
                ]
                return (
                  <dl className="mb-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/40 px-6 divide-y divide-zinc-200 dark:divide-zinc-700 text-sm">
                    {rows.map(([term, value]) => (
                      <div key={term} className="grid grid-cols-[7rem_1fr] gap-4 py-4">
                        <dt className="text-zinc-500 dark:text-zinc-400">{term}</dt>
                        <dd className="text-zinc-900 dark:text-zinc-100">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )
              })()}
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
                Saving consolidates the deployment: its metadata is written and it is <strong>sealed</strong>, so it can&rsquo;t be modified afterwards
                — the app notices if an image or its details change — and it can then be uploaded.
              </p>
          {importError && <p className="text-sm text-red-600 dark:text-red-400">{importError}</p>}
          {destDir && (
            <div>
              <div role="status" className="mb-4 rounded-xl border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-6 py-4 text-emerald-900 dark:text-emerald-100">
                <p className="text-lg font-semibold">Deployment saved</p>
                <p className="text-sm text-emerald-800/90 dark:text-emerald-200/80">
                  {deployment.deployment_id} is now in your local collection.
                  {events.some((e) => e.type === 'done' && e.sealed === false) && ' It could not be sealed — see the log.'}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
              <button type="button" className={btnOutline} onClick={handleOpenFolder}>Open folder</button>
              {onUpload && selectedProjectId && plannedCollection && (
                <button type="button" className={btnPrimary} onClick={() => onUpload({ researchProjectId: selectedProjectId, collection: plannedCollection.collection })}>
                  Upload to Trapper
                </button>
              )}
              {openFolderError && <p className="text-sm text-red-600 dark:text-red-400">{openFolderError}</p>}
              </div>
            </div>
          )}
            </WizardStep>
          </div>
        )
      })()}

      {/* Navigation */}
      <div className="flex justify-between items-start mt-10">
        {destDir ? (
          <button type="button" className={btnOutline} onClick={handleStartOver}>Start over</button>
        ) : step > 0 && !(stepKey === 'prepare' && !preprocessing && !resultsDone && (preprocessed?.type === 'done' || preprocessError)) ? (
          <button type="button" className={btnOutline} disabled={importing || preprocessing} onClick={handleBack}><span aria-hidden="true">← </span>Back</button>
        ) : stepKey === 'images' && imagesOpen === 3 ? (
          <button type="button" className={btnOutline} disabled={validating} onClick={() => setImagesOpen(2)}><span aria-hidden="true">← </span>Back</button>
        ) : (
          <div />
        )}

        {!destDir && stepKey === 'images' && (
          <div className="flex flex-col items-end gap-1">
            {scan && !requiredImageChecksOk && <p className="text-xs text-amber-600 dark:text-amber-400">Run the checks and resolve the ones set to Must pass to continue.</p>}
            <button type="button" className={btnPrimary} disabled={!scan || !requiredImageChecksOk} onClick={() => setStep((s) => s + 1)}>Continue<span aria-hidden="true"> →</span></button>
          </div>
        )}
        {!destDir && stepKey === 'origin' && (
          <div className="flex flex-col items-end gap-1 max-w-md">
            {timestampLogError && <p className="text-xs text-red-600 dark:text-red-400 text-right">{timestampLogError}</p>}
            <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!originReady || !newDetailsReady || savingDetails} onClick={handleContinueFromDeployment}>
              {savingDetails && <SmallSpinner />}
              {savingDetails ? 'Saving…' : <>Continue<span aria-hidden="true"> →</span></>}
            </button>
          </div>
        )}
        {!destDir && stepKey === 'prepare' && (
          <div className="flex items-center gap-3">
            {preprocessed?.type !== 'done' && !preprocessing && <p className="text-xs text-amber-600 dark:text-amber-400">Prepare the images to save.</p>}
            <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={preprocessed?.type !== 'done' || !resultsDone || !canImport || importing || preprocessing} onClick={handleImport}>
              {importing && <SmallSpinner />}{importing ? 'Saving…' : 'Save deployment'}
            </button>
          </div>
        )}
        {!destDir && stepKey === 'checks' && (
          <div className="flex flex-col items-end gap-1">
            {!requiredDeploymentChecksOk && <p className="text-xs text-amber-600 dark:text-amber-400">Run the checks and resolve the ones set to Must pass to continue.</p>}
            <button type="button" className={btnPrimary} disabled={!requiredDeploymentChecksOk} onClick={() => setStep((s) => s + 1)}>Continue<span aria-hidden="true"> →</span></button>
          </div>
        )}
      </div>
    </div>
  )
}
