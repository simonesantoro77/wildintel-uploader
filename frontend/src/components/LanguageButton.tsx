import { useEffect, useRef, useState } from 'react'
import { LANGUAGES, storeLanguage, storedLanguage } from '../language'

const btn = 'px-3 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors'

/** The button of the header that changes the language of the interface. */
export default function LanguageButton() {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState(storedLanguage)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.documentElement.lang = code
  }, [code])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === 'Escape') setOpen(false); return }
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  function choose(next: string) {
    setCode(next)
    storeLanguage(next)
    setOpen(false)
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button" className={`${btn} ${open ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
        title="Language" aria-label="Language" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        🌐 <span className="uppercase">{code}</span>
      </button>
      {open && (
        <ul
          role="listbox" aria-label="Languages"
          className="absolute right-0 mt-1 min-w-36 z-30 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 shadow-lg py-1"
        >
          {LANGUAGES.map(l => (
            <li
              key={l.code} role="option" aria-selected={l.code === code} tabIndex={0}
              className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 ${l.code === code ? 'font-semibold' : ''}`}
              onClick={() => choose(l.code)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(l.code) } }}
            >
              {l.code === code ? '✓ ' : ''}{l.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
