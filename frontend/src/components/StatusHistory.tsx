import { useEffect, useState } from 'react'
import { api } from '../api'
import { formatDay } from '../dateFormat'
import type { StatusChange } from '../types'

const STATUS: Record<string, string> = { planned: 'Planned', pending: 'Pending', ready: 'Ready', active: 'Active', archived: 'Archived', OK: 'OK', Altered: 'Altered', Stolen: 'Stolen', unknown: 'Unknown' }
const say = (status: string) => STATUS[status] ?? status

/** What a location, a camera or an SD card was and why it changed: its history, the latest first. It says nothing when there is none, or when the research project is not known. */
export default function StatusHistory({ researchProject, kind, name }: { researchProject: string | null | undefined; kind: StatusChange['kind']; name: string }) {
  const [lines, setLines] = useState<StatusChange[] | null>(null)
  useEffect(() => {
    let cancelled = false
    setLines(null)
    if (!researchProject) return
    api.statusHistory(researchProject, kind, name).then((r) => { if (!cancelled) setLines(r.results) }).catch(() => { if (!cancelled) setLines([]) })
    return () => { cancelled = true }
  }, [researchProject, kind, name])
  if (!lines || lines.length === 0) return null
  return (
    <section aria-label="History" className="mt-6 border-t border-zinc-200 dark:border-zinc-700 pt-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">History</h3>
      <ol className="space-y-3 text-sm">
        {[...lines].reverse().map((l, i) => (
          <li key={`${l.at}-${i}`}>
            <p className="font-semibold text-zinc-900 dark:text-zinc-100">
              {l.before === null ? <>Created as {say(l.after)}</> : <>{say(l.before)} → {say(l.after)}</>}
            </p>
            <p className="text-zinc-500 dark:text-zinc-400">{formatDay(l.day)}{l.before !== null && <> · {l.reason}</>}{l.reconstructed && <> · <span className="italic">rebuilt from the visits</span></>}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
