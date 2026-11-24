import { useEffect } from 'react'
import { LineIcon } from './TaskCard'
import { TERMS, type GlossaryEntry } from '../glossary'

const BOOK = <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>

/** The button of the title of the menu that opens the glossary. */
export function GlossaryButton({ onClick, expanded }: { onClick: () => void; expanded: boolean }) {
  return (
    <button type="button" aria-haspopup="dialog" aria-expanded={expanded} onClick={onClick}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-600 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800">
      <LineIcon size={16}>{BOOK}</LineIcon>Glossary
    </button>
  )
}

function Entries({ entries }: { entries: GlossaryEntry[] }) {
  return (
    <section aria-label="Words">
      <dl className="space-y-4">
        {entries.map((e) => (
          <div key={e.term}>
            <dt className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{e.term}</dt>
            <dd className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{e.meaning}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** The panel at the right with what each word of the app means. It closes with its cross, the background or Escape. */
export default function Glossary({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Glossary">
      <button type="button" aria-label="Close the glossary" tabIndex={-1} className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-sm flex-col overflow-y-auto border-l border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"><LineIcon size={20}>{BOOK}</LineIcon></span>
            <div>
              <h2 className="text-lg font-semibold leading-tight">Glossary</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">What each word means</p>
            </div>
          </div>
          <button type="button" aria-label="Close the glossary panel" className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={onClose}>
            <LineIcon size={20}><path d="M6 6l12 12M18 6L6 18" /></LineIcon>
          </button>
        </div>
        <Entries entries={TERMS} />
      </aside>
    </div>
  )
}
