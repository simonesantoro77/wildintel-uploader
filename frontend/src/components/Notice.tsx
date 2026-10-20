import type { ReactNode } from 'react'

export type NoticeKind = 'success' | 'info' | 'warning' | 'error'

const TONES: Record<NoticeKind, string> = {
  success: 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300',
  info: 'border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200',
  warning: 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300',
  error: 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300',
}

/** Line icons (24×24, stroke), in the colour of the text: a tick in a circle, an "i", a triangle with "!" and a cross in a circle. */
const ICONS: Record<NoticeKind, ReactNode> = {
  success: <><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  warning: <><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></>,
  error: <><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></>,
}

/** The icon of a kind on its own — for the rows of a list, in the colour its container gives it (text-emerald-500, text-amber-500…). */
export function StatusIcon({ kind, className = 'h-5 w-5' }: { kind: NoticeKind; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`${className} shrink-0 fill-none stroke-current`} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[kind]}</svg>
  )
}

interface Props {
  kind: NoticeKind
  children: ReactNode
  /** A button or a link, at the end of the line. */
  action?: ReactNode
  role?: 'status' | 'alert'
  className?: string
}

/** A message in a box: every one has the icon of its kind, so a warning looks like a warning wherever it is shown. */
export default function Notice({ kind, children, action, role, className = '' }: Props) {
  return (
    <div role={role} className={`flex items-center gap-3 flex-wrap rounded-lg border px-4 py-3 text-sm ${TONES[kind]} ${className}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[kind]}</svg>
      <div className="flex-1 min-w-[12rem]">{children}</div>
      {action}
    </div>
  )
}
