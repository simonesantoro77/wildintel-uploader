import type { CloseAfter } from '../types'

export type CloseMode = 'last' | 'fixed'

const UNITS: { value: CloseAfter['unit']; label: string; short: string }[] = [{ value: 'days', label: 'Days', short: 'd' }, { value: 'weeks', label: 'Weeks', short: 'w' }, { value: 'months', label: 'Months', short: 'm' }]
const PRESETS: Record<CloseAfter['unit'], number[]> = { days: [7, 14, 21, 30], weeks: [1, 2, 3, 4], months: [1, 2, 3, 6] }

const pill = (on: boolean) => `px-3 h-8 rounded-md text-sm font-semibold transition-colors ${on ? 'bg-blue-600 text-white' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`

/** How long each revision that is closed lasted, from its first visit: the day its locations still to be visited are marked as not visited — or the day of its last visit. */
export default function CloseDuration({ mode, amount, unit, onMode, onAmount, onUnit }: {
  mode: CloseMode; amount: number; unit: CloseAfter['unit']; onMode: (m: CloseMode) => void; onAmount: (n: number) => void; onUnit: (u: CloseAfter['unit']) => void
}) {
  const unitLabel = UNITS.find((u) => u.value === unit)!
  return (
    <section aria-label="How long each revision lasted" className="border-t border-zinc-200 dark:border-zinc-700 border-l-4 border-l-blue-500 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-prose">
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">How long each revision lasted</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Measured from its first visit. Unvisited locations are marked as not visited on that day (or on the last visit day if left unset). If it reaches the next revision, the day before its first visit is used.</p>
        </div>
        <div role="radiogroup" aria-label="When a revision is closed" className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 p-1">
          {([['last', 'Last visit date'], ['fixed', 'Fixed duration from 1st visit']] as const).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => onMode(value)}
                    className={`inline-flex items-center gap-2 px-3 h-8 rounded-md text-sm font-semibold ${mode === value ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${mode === value ? 'bg-blue-500' : 'bg-zinc-400'}`} />{label}
            </button>
          ))}
        </div>
      </div>
      {mode === 'last' && (
        <p className="mt-4 flex items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
          <span>Duration left unset — unvisited locations are marked as <strong>not visited</strong> on the date of the revision&apos;s last recorded visit.</span>
        </p>
      )}
      {mode === 'fixed' && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 p-1">
            <button type="button" aria-label="One less" className={pill(false)} disabled={amount <= 1} onClick={() => onAmount(Math.max(1, amount - 1))}>−</button>
            <input aria-label="How long each revision lasted" inputMode="numeric" className="w-14 bg-transparent text-center font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none" value={amount}
                   onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, '')); onAmount(n > 0 ? n : 1) }} />
            <button type="button" aria-label="One more" className={pill(false)} onClick={() => onAmount(amount + 1)}>+</button>
            <span aria-hidden="true" className="mx-1 h-6 w-px bg-zinc-200 dark:bg-zinc-700" />
            <div role="radiogroup" aria-label="Unit" className="flex gap-1">
              {UNITS.map((u) => <button key={u.value} type="button" role="radio" aria-checked={unit === u.value} className={pill(unit === u.value)} onClick={() => onUnit(u.value)}>{u.label}</button>)}
            </div>
          </div>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">Presets:</span>
          {PRESETS[unit].map((n) => (
            <button key={n} type="button" aria-pressed={amount === n} onClick={() => onAmount(n)}
                    className={`px-3 h-8 rounded-md border text-sm font-semibold ${amount === n ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'}`}>{n}{unitLabel.short}</button>
          ))}
        </div>
      )}
    </section>
  )
}
