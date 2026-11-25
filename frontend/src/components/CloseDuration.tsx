import type { CloseAfter } from '../types'

const UNITS: { value: CloseAfter['unit']; label: string; short: string }[] = [{ value: 'days', label: 'Days', short: 'd' }, { value: 'weeks', label: 'Weeks', short: 'w' }, { value: 'months', label: 'Months', short: 'm' }]
const PRESETS: Record<CloseAfter['unit'], number[]> = { days: [0, 7, 14, 30], weeks: [1, 2, 3, 4], months: [1, 2, 3, 6] }
const ANCHORS: { value: CloseAfter['anchor']; label: string }[] = [{ value: 'after_last', label: 'After its last visit' }, { value: 'before_next', label: 'Before the next revision' }]

const pill = (on: boolean) => `px-3 h-8 rounded-md text-sm font-semibold transition-colors ${on ? 'bg-blue-600 text-white' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`

/** The day each revision that is closed is closed on: so long after its last visit, or before the first visit of the revision that closes it. Its locations still to be visited are
 * marked as not visited on that day. */
export default function CloseDuration({ value, onChange }: { value: CloseAfter; onChange: (v: CloseAfter) => void }) {
  const unitLabel = UNITS.find((u) => u.value === value.unit)!
  const set = (changes: Partial<CloseAfter>) => onChange({ ...value, ...changes })
  return (
    <section aria-label="The day of the not visited mark" className="border-t border-zinc-200 dark:border-zinc-700 border-l-4 border-l-blue-500 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-prose">
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">The day of the not visited mark</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Only the date written for the locations with no visit. The day of the last visit of the revision is right for almost everyone: change it only if you need to.</p>
        </div>
        <div role="radiogroup" aria-label="Counted from" className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 p-1">
          {ANCHORS.map((a) => (
            <button key={a.value} type="button" role="radio" aria-checked={value.anchor === a.value} onClick={() => set({ anchor: a.value })}
                    className={`inline-flex items-center gap-2 px-3 h-8 rounded-md text-sm font-semibold ${value.anchor === a.value ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${value.anchor === a.value ? 'bg-blue-500' : 'bg-zinc-400'}`} />{a.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 p-1">
          <button type="button" aria-label="One less" className={pill(false)} disabled={value.amount <= 0} onClick={() => set({ amount: Math.max(0, value.amount - 1) })}>−</button>
          <input aria-label="How long" inputMode="numeric" className="w-14 bg-transparent text-center font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none" value={value.amount}
                 onChange={(e) => set({ amount: Number(e.target.value.replace(/\D/g, '') || 0) })} />
          <button type="button" aria-label="One more" className={pill(false)} onClick={() => set({ amount: value.amount + 1 })}>+</button>
          <span aria-hidden="true" className="mx-1 h-6 w-px bg-zinc-200 dark:bg-zinc-700" />
          <div role="radiogroup" aria-label="Unit" className="flex gap-1">
            {UNITS.map((u) => <button key={u.value} type="button" role="radio" aria-checked={value.unit === u.value} className={pill(value.unit === u.value)} onClick={() => set({ unit: u.value })}>{u.label}</button>)}
          </div>
        </div>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">Presets:</span>
        {PRESETS[value.unit].map((n) => (
          <button key={n} type="button" aria-pressed={value.amount === n} onClick={() => set({ amount: n })}
                  className={`px-3 h-8 rounded-md border text-sm font-semibold ${value.amount === n ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'}`}>{n}{unitLabel.short}</button>
        ))}
      </div>
      <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400" aria-label="The day">
        {value.anchor === 'after_last'
          ? (value.amount === 0 ? 'On the day of the last visit of the revision.' : `${value.amount} ${unitLabel.label.toLowerCase()} after the last visit of the revision.`)
          : `${value.amount} ${unitLabel.label.toLowerCase()} before the first visit of the next revision.`}
      </p>
    </section>
  )
}
