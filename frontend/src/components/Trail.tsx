import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/** A step of the path from the menu to the page: pressable unless it is the last one. */
export interface TrailStep {
  label: string
  onClick?: () => void
  /** The paths of an icon, drawn before the label when the step is the last one. */
  icon?: ReactNode
}

interface Trail {
  steps: TrailStep[]
  /** What the page is, said after the path. */
  description?: string
}

interface Value {
  trail: Trail | null
  setTrail: (trail: Trail | null) => void
  /** Goes to the menu of the application, the first step of every path. */
  onMenu?: () => void
}

const TrailContext = createContext<Value>({ trail: null, setTrail: () => {} })

/** Holds the path of the page that is shown, which the header of the application says. */
export function TrailProvider({ children, onMenu }: { children: ReactNode; onMenu?: () => void }) {
  const [trail, setTrail] = useState<Trail | null>(null)
  const value = useMemo(() => ({ trail, setTrail, onMenu }), [trail, onMenu])
  return <TrailContext.Provider value={value}>{children}</TrailContext.Provider>
}

/** The path of the page that is shown, for the header. */
export function useCurrentTrail(): Trail | null {
  return useContext(TrailContext).trail
}

/** A page says where it is: from the menu to itself; `null` when it is not the one that is shown. The path is cleared when the page goes away. */
export function useTrail(steps: TrailStep[] | null, description?: string) {
  const { setTrail } = useContext(TrailContext)
  const key = steps ? steps.map(s => s.label).join('›') : ''
  // The functions change at every render; the labels say when the path is another one.
  const latest = useMemo(() => (steps ? { steps, description } : null), [key, description]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!latest) return
    setTrail(latest)
    return () => setTrail(null)
  }, [latest, setTrail])
}

/** The path of a page that hangs from the menu (`parent` is "Menu") or from a section that hangs from it: Menu › parent › the page. */
export function usePageTrail(page: { title: string; parent: string; onParent?: () => void; icon?: ReactNode; description?: string }) {
  const { onMenu } = useContext(TrailContext)
  const steps: TrailStep[] = page.parent === 'Menu'
    ? [{ label: 'Menu', onClick: page.onParent ?? onMenu }, { label: page.title, icon: page.icon }]
    : [{ label: 'Menu', onClick: onMenu }, { label: page.parent, onClick: page.onParent }, { label: page.title, icon: page.icon }]
  useTrail(steps, page.description)
}
