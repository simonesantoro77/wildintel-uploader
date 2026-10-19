import { useMemo, useState } from 'react'

const inputClass = 'w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono'

export interface CheckboxListOption {
  value: string
  label: string
}

interface Props {
  /** Accessible name of the filter box, e.g. "Filter Trapper research projects". */
  filterLabel: string
  options: CheckboxListOption[]
  selected: string[]
  onChange: (selected: string[]) => void
  disabled?: boolean
  emptyText: string
}

/** Several options to tick, filtered as you type — for choosing more than one. */
export default function CheckboxList({ filterLabel, options, selected, onChange, disabled = false, emptyText }: Props) {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
  }, [options, query])

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  const allShownSelected = shown.length > 0 && shown.every((o) => selected.includes(o.value))

  /** Ticks or unticks every option in view, so with a filter it only touches the matches. */
  function toggleAll() {
    const values = new Set(shown.map((o) => o.value))
    onChange(allShownSelected ? selected.filter((v) => !values.has(v)) : [...selected, ...shown.map((o) => o.value).filter((v) => !selected.includes(v))])
  }

  return (
    <div>
      <input aria-label={filterLabel} className={`${inputClass} mb-2`} placeholder="Type to filter…" value={query} onChange={(e) => setQuery(e.target.value)} disabled={disabled} />
      {shown.length > 0 && (
        <div className="flex justify-end mb-1">
          <button type="button" className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50" disabled={disabled} onClick={toggleAll}>
            {allShownSelected ? 'Deselect all' : 'Select all'}
          </button>
        </div>
      )}
      <div className="max-h-56 overflow-y-auto rounded border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700">
        {options.length === 0 && <p className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">{emptyText}</p>}
        {options.length > 0 && shown.length === 0 && <p className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">Nothing matches.</p>}
        {shown.map((o) => (
          <label key={o.value} className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
            <input type="checkbox" checked={selected.includes(o.value)} disabled={disabled} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  )
}
