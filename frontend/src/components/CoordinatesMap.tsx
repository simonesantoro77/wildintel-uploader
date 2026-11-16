import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'

/** A site on the map: where it is, what colour it has and what to tell of it when it is pointed at or chosen. */
export interface MapPoint {
  key: string
  /** What is written beside the point: the site's id. */
  label: string
  latitude: number
  longitude: number
  /** Which of the legend's entries it is of, and the class that fills it. */
  legend: string
  fill: string
  /** A small tick on the point, with what it says — "Uploaded": a second thing a colour cannot say; it is in the name of the point and in the legend. */
  badge?: string
  /** The card over it: its title and name, a few lines — [name, value] — and a last line. */
  subtitle?: string | null
  lines?: [string, string][]
  footer?: string | null
  /** What the card of a chosen point offers to do — its buttons, as the row of a table has them. */
  actions?: () => ReactNode
  /** A button of the card that goes to the site where the rest of the page has it (its row in the table). */
  onPick?: () => void
  pickName?: string
}

/** What a colour says. */
export interface MapLegend { key: string; label: string; dot: string }

const VIEW = { width: 1000, left: 88, right: 24, top: 22, bottom: 44 }
const TICKS = 4
/** The map behind the points: the raster tiles of OpenStreetMap — free, with its attribution. The picture asks them from the provider: it needs a connection, and the provider sees which area is drawn. */
const TILES = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
const BACKGROUND_KEY = 'wildintel.mapBackground'
const MAX_TILES = 36
const MAX_TILE_ZOOM = 18
const ZOOM_OUT = -3

// Web Mercator, the projection of the tiles — drawn the same, the tiles fall under the points exactly. x and y are fractions of the whole world, from its north-west corner.
const worldX = (lon: number) => (lon + 180) / 360
const worldY = (lat: number) => { const s = Math.sin((lat * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) }
const lonOf = (x: number) => x * 360 - 180
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI
/** The zoom of the tiles where one is about 256 units across, when the plot shows `dx` of the world. */
const tileZoom = (dx: number, width: number) => Math.round(Math.log2(width / (256 * dx)))

/** Rectangles that must not meet: where the labels went, and where the points are. */
interface Box { x0: number; y0: number; x1: number; y1: number }
const meets = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0

function backgroundWanted(): boolean {
  try { return window.localStorage.getItem(BACKGROUND_KEY) !== 'off' } catch { return true }
}

const control = 'flex h-8 w-8 items-center justify-center rounded border border-zinc-300 dark:border-zinc-600 bg-white/95 dark:bg-zinc-900/95 text-lg font-semibold leading-none text-zinc-700 dark:text-zinc-200 shadow transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40'

/** The sites of a research project by where they are — latitude and longitude, WGS84 —, on a map. The area the sites cover is dashed; each site is a point with its id beside it,
 * coloured by what the legend says. The map is zoomed with the buttons at its corner and moved by dragging it; pointing at a point shows its details, and choosing it — pressing it, or Enter —
 * keeps it open. The card has the buttons of what can be done with the site. The map behind is switched off with its button — then the points are drawn on their own, which needs no connection and
 * asks nothing of a provider. Each point can be reached with the keyboard and says its state in its name. */
export default function CoordinatesMap({ name, points, legend, missing = 0, noun = 'sites' }: {
  name: string; points: MapPoint[]; legend: MapLegend[]; missing?: number; noun?: string
}) {
  const [hover, setHover] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [background, setBackground] = useState(backgroundWanted)
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set())
  const [failed, setFailed] = useState<Set<string>>(() => new Set())
  // where the map is looking: how many times it was zoomed — each step doubles — and the centre it was moved to (none: the one that shows all the sites)
  const [camera, setCamera] = useState<{ zoom: number; center: { x: number; y: number } | null }>({ zoom: 0, center: null })
  const svg = useRef<SVGSVGElement | null>(null)
  // the card stays while the pointer is on the point or on the card — it takes a moment to go from one to the other — so that its buttons can be pressed
  const leaving = useRef<number | null>(null)
  const cancelLeave = () => { if (leaving.current !== null) { window.clearTimeout(leaving.current); leaving.current = null } }
  const scheduleLeave = () => { cancelLeave(); leaving.current = window.setTimeout(() => { setHover(null); leaving.current = null }, 220) }
  const show = (key: string) => { cancelLeave(); setHover(key) }
  useEffect(() => cancelLeave, [])
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)

  function toggleBackground() {
    setBackground((on) => {
      try { window.localStorage.setItem(BACKGROUND_KEY, on ? 'off' : 'on') } catch { /* it is only remembered when it can be */ }
      return !on
    })
  }

  // other sites — the filters of the page changed them — are looked at from the start again
  const signature = points.map((p) => `${p.key}@${p.latitude},${p.longitude}`).join('|')
  useEffect(() => { setCamera({ zoom: 0, center: null }) }, [signature])

  // the view that shows all the sites with air around them
  const fit = useMemo(() => {
    if (points.length === 0) return null
    const xs = points.map((p) => worldX(p.longitude)), ys = points.map((p) => worldY(p.latitude))
    const tiny = 1.5e-5                                      // about 0.005° of longitude: a single site still has a place to be
    const spanX = Math.max(Math.max(...xs) - Math.min(...xs), tiny), spanY = Math.max(Math.max(...ys) - Math.min(...ys), tiny)
    const width = VIEW.width - VIEW.left - VIEW.right
    const wantedX = spanX * 1.36, wantedY = spanY * 1.44
    const height = Math.min(Math.max((width * wantedY) / wantedX, 260), 560)
    // one scale for both ways: the tiles are not stretched
    const scale = Math.min(width / wantedX, height / wantedY)
    return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, dx: width / scale, dy: height / scale, width, height }
  }, [points])

  const canZoomIn = fit !== null && tileZoom(fit.dx / 2 ** (camera.zoom + 1), fit.width) <= MAX_TILE_ZOOM
  const canZoomOut = camera.zoom > ZOOM_OUT

  const plot = useMemo(() => {
    if (!fit) return null
    const { width, height } = fit
    const factor = 2 ** camera.zoom
    const dx = fit.dx / factor, dy = fit.dy / factor
    const cx = camera.center?.x ?? fit.cx, cy = camera.center?.y ?? fit.cy
    const wx0 = cx - dx / 2, wy0 = cy - dy / 2
    const x = (lon: number) => VIEW.left + ((worldX(lon) - wx0) / dx) * width
    const y = (lat: number) => VIEW.top + ((worldY(lat) - wy0) / dy) * height
    const inside = (px: number, py: number) => px >= VIEW.left && px <= VIEW.left + width && py >= VIEW.top && py <= VIEW.top + height
    const placed = points.map((p) => ({ p, x: x(p.longitude), y: y(p.latitude) })).filter((s) => inside(s.x, s.y))
    // the id beside each point: above it, or below, or at a side — wherever it meets neither another label nor a point; a label that finds no place is only in the card
    const boxes: Box[] = placed.map((s) => ({ x0: s.x - 12, y0: s.y - 12, x1: s.x + 12, y1: s.y + 12 }))
    const labels = new Map<string, { x: number; y: number; anchor: 'start' | 'middle' | 'end' }>()
    for (const s of [...placed].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const w = s.p.label.length * 7.6 + 6
      const options: { x: number; y: number; anchor: 'start' | 'middle' | 'end'; box: Box }[] = [
        { x: s.x, y: s.y - 16, anchor: 'middle', box: { x0: s.x - w / 2, y0: s.y - 31, x1: s.x + w / 2, y1: s.y - 14 } },
        { x: s.x, y: s.y + 28, anchor: 'middle', box: { x0: s.x - w / 2, y0: s.y + 14, x1: s.x + w / 2, y1: s.y + 31 } },
        { x: s.x + 15, y: s.y + 4, anchor: 'start', box: { x0: s.x + 13, y0: s.y - 9, x1: s.x + 15 + w, y1: s.y + 9 } },
        { x: s.x - 15, y: s.y + 4, anchor: 'end', box: { x0: s.x - 15 - w, y0: s.y - 9, x1: s.x - 13, y1: s.y + 9 } },
      ]
      const fits = options.find((o) => o.box.x0 >= VIEW.left && o.box.x1 <= VIEW.width - 2 && o.box.y0 >= VIEW.top && !boxes.some((b) => meets(b, o.box)))
      if (fits) { boxes.push(fits.box); labels.set(s.p.key, { x: fits.x, y: fits.y, anchor: fits.anchor }) }
    }
    const all = points.map((p) => ({ x: x(p.longitude), y: y(p.latitude) }))
    const left = Math.max(Math.min(...all.map((s) => s.x)) - 30, VIEW.left + 4), right = Math.min(Math.max(...all.map((s) => s.x)) + 30, VIEW.left + width - 4)
    const top = Math.max(Math.min(...all.map((s) => s.y)) - 38, VIEW.top + 4), bottom = Math.min(Math.max(...all.map((s) => s.y)) + 38, VIEW.top + height - 4)
    const around = points.length > 1 && right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null
    const ticks = (from: number, to: number) => Array.from({ length: TICKS + 1 }, (_, i) => from + ((to - from) * i) / TICKS)
    const latTicks = ticks(latOf(wy0 + dy), latOf(wy0)), lonTicks = ticks(lonOf(wx0), lonOf(wx0 + dx))
    const decimals = Math.min(Math.max(Math.ceil(-Math.log10(Math.max(Math.abs(latTicks[1] - latTicks[0]), 1e-7))) + 1, 2), 6)

    // the tiles that cover the plot, at the zoom where one is about 256 units across — fewer when they would be many
    let zoom = Math.min(Math.max(tileZoom(dx, width), 2), MAX_TILE_ZOOM)
    const range = (z: number) => {
      const n = 2 ** z
      return { n, x0: Math.floor(wx0 * n), x1: Math.floor((wx0 + dx) * n), y0: Math.max(0, Math.floor(wy0 * n)), y1: Math.min(n - 1, Math.floor((wy0 + dy) * n)) }
    }
    while (zoom > 2 && (range(zoom).x1 - range(zoom).x0 + 1) * (range(zoom).y1 - range(zoom).y0 + 1) > MAX_TILES) zoom -= 1
    const { n, x0, x1, y0, y1 } = range(zoom)
    const tiles: { url: string; left: number; top: number; width: number; height: number }[] = []
    for (let tx = x0; tx <= x1; tx += 1) {
      for (let ty = y0; ty <= y1; ty += 1) {
        tiles.push({ url: TILES(zoom, ((tx % n) + n) % n, ty), left: ((tx / n - wx0) / dx) * 100, top: ((ty / n - wy0) / dy) * 100, width: (1 / n / dx) * 100, height: (1 / n / dy) * 100 })
      }
    }
    return { placed, labels, around, width, height, dx, dy, cx, cy, x, y, tiles, latTicks, lonTicks, decimals, viewHeight: VIEW.top + height + VIEW.bottom }
  }, [fit, points, camera])

  // the card of the site pointed at; when none is, the one that was chosen
  const cardOf = plot?.placed.find((s) => s.p.key === hover) ?? plot?.placed.find((s) => s.p.key === chosen)
  const picked = points.find((p) => p.key === chosen)
  const counts = (key: string) => points.filter((p) => p.legend === key).length
  const noTiles = background && plot !== null && plot.tiles.length > 0 && loaded.size === 0 && plot.tiles.every((t) => failed.has(t.url))
  const grid = background ? 'stroke-zinc-400/30 dark:stroke-zinc-500/30' : 'stroke-zinc-200 dark:stroke-zinc-800'

  // zooming in looks at the site that was chosen, if there is one: it does not leave the view
  function zoomBy(step: number) {
    setCamera((c) => ({ zoom: c.zoom + step, center: step > 0 && picked ? { x: worldX(picked.longitude), y: worldY(picked.latitude) } : c.center }))
  }

  // moving the map by dragging it — not from a point or a button
  function startDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !plot || (e.target as Element).closest('[data-point],[data-card],button,a')) return
    drag.current = { x: e.clientX, y: e.clientY, cx: plot.cx, cy: plot.cy }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  function moveDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const start = drag.current, box = svg.current?.getBoundingClientRect()
    if (!start || !plot || !box || box.width === 0) return
    const unitsPerPixel = VIEW.width / box.width
    const shiftX = ((e.clientX - start.x) * unitsPerPixel / plot.width) * plot.dx, shiftY = ((e.clientY - start.y) * unitsPerPixel / plot.height) * plot.dy
    setCamera((c) => ({ ...c, center: { x: start.cx - shiftX, y: start.cy - shiftY } }))
  }
  const endDrag = () => { drag.current = null }

  return (
    <div className="p-4" role="group" aria-label={name}>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-600 dark:text-zinc-300">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-label="Legend" role="list">
          {legend.filter((l) => counts(l.key) > 0).map((l) => (
            <span key={l.key} role="listitem" className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${l.dot}`} />{l.label}<span className="font-mono text-zinc-500 dark:text-zinc-400">{counts(l.key)}</span></span>
          ))}
          {[...new Set(points.map((p) => p.badge).filter(Boolean))].map((b) => (
            <span key={b} role="listitem" className="inline-flex items-center gap-1.5">
              <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4"><circle cx="8" cy="8" r="6.5" strokeWidth="1" className="fill-white stroke-zinc-400 dark:fill-zinc-900 dark:stroke-zinc-500" /><path d="M5 8l2.200 2.200 3.800-4.200" fill="none" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" className="stroke-emerald-600 dark:stroke-emerald-400" /></svg>{b}
            </span>
          ))}
        </div>
        <span className="ml-auto text-zinc-500 dark:text-zinc-400">{points.length} {points.length === 1 ? noun.replace(/s$/, '') : noun} on the map{missing > 0 ? ` · ${missing} with no coordinates, not drawn` : ''}</span>
        <button type="button" aria-pressed={background} onClick={toggleBackground} title="The map behind the points comes from OpenStreetMap: it needs a connection, and it sees which area is drawn"
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${background ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' : 'border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3L3 5v16l6-2 6 2 6-2V3l-6 2z" /><path d="M9 3v16M15 5v16" /></svg>
          Background map
        </button>
      </div>

      {!plot ? <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">{missing > 0 ? `None of the ${missing} ${noun} has coordinates, so there is nothing to draw.` : `There are no ${noun} to draw.`}</p> : (
        <div className="relative cursor-grab touch-none select-none overflow-visible rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/40 active:cursor-grabbing"
             onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
          {background && (
            <div className="pointer-events-none absolute z-0 overflow-hidden"
                 style={{ left: `${(VIEW.left / VIEW.width) * 100}%`, top: `${(VIEW.top / plot.viewHeight) * 100}%`, width: `${(plot.width / VIEW.width) * 100}%`, height: `${(plot.height / plot.viewHeight) * 100}%` }}>
              {plot.tiles.map((t) => (
                <img key={t.url} src={t.url} alt="" draggable={false} referrerPolicy="strict-origin-when-cross-origin" data-tile
                     onLoad={() => setLoaded((s) => new Set(s).add(t.url))} onError={() => setFailed((s) => new Set(s).add(t.url))}
                     className="absolute max-w-none select-none dark:brightness-[0.68] dark:saturate-75"
                     style={{ left: `${t.left}%`, top: `${t.top}%`, width: `${t.width + 0.05}%`, height: `${t.height + 0.05}%` }} />
              ))}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="pointer-events-auto absolute bottom-0 right-0 rounded-tl bg-white/80 px-1.5 py-0.5 text-[10px] text-zinc-700 hover:underline">© OpenStreetMap contributors</a>
            </div>
          )}
          <svg ref={svg} viewBox={`0 0 ${VIEW.width} ${plot.viewHeight}`} className="relative z-10 h-auto w-full" role="presentation">
            {plot.latTicks.map((v) => (
              <g key={`lat${v}`}>
                <line x1={VIEW.left} x2={VIEW.width - VIEW.right} y1={plot.y(v)} y2={plot.y(v)} strokeWidth="1" className={grid} />
                <text x={VIEW.left - 8} y={plot.y(v) + 4} textAnchor="end" fontSize="12" className="fill-zinc-500 dark:fill-zinc-400 font-mono">{v.toFixed(plot.decimals)}°</text>
              </g>
            ))}
            {plot.lonTicks.map((v) => (
              <g key={`lon${v}`}>
                <line x1={plot.x(v)} x2={plot.x(v)} y1={VIEW.top} y2={VIEW.top + plot.height} strokeWidth="1" className={grid} />
                <text x={plot.x(v)} y={VIEW.top + plot.height + 20} textAnchor="middle" fontSize="12" className="fill-zinc-500 dark:fill-zinc-400 font-mono">{v.toFixed(plot.decimals)}°</text>
              </g>
            ))}
            <text transform={`translate(13 ${VIEW.top + plot.height / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" className="fill-zinc-500 dark:fill-zinc-400">Latitude (WGS84)</text>
            <text x={VIEW.left + plot.width / 2} y={VIEW.top + plot.height + 38} textAnchor="middle" fontSize="12" className="fill-zinc-500 dark:fill-zinc-400">Longitude (WGS84)</text>
            <rect x={VIEW.left} y={VIEW.top} width={plot.width} height={plot.height} fill="none" strokeWidth="1" className="stroke-zinc-400 dark:stroke-zinc-600" />
            {plot.around && (
              <rect x={plot.around.left} y={plot.around.top} width={plot.around.width} height={plot.around.height} rx="10" strokeWidth="2" strokeDasharray="6 5" className="fill-emerald-500/5 stroke-emerald-600 dark:stroke-emerald-400" />
            )}
            {plot.placed.map((s) => {
              const label = plot.labels.get(s.p.key)
              const on = hover === s.p.key, isChosen = chosen === s.p.key
              return (
                <g key={s.p.key} data-point role="button" tabIndex={0} aria-pressed={isChosen} aria-label={`${s.p.label}${s.p.lines?.[0] ? `: ${s.p.lines[0][1]}` : ''}${s.p.badge ? ` · ${s.p.badge}` : ''}. ${isChosen ? 'Chosen' : 'Choose it'}`}
                   className="cursor-pointer outline-none [&:focus-visible>circle:nth-child(2)]:stroke-blue-500"
                   onMouseEnter={() => show(s.p.key)} onMouseLeave={scheduleLeave} onFocus={() => show(s.p.key)} onBlur={scheduleLeave}
                   onClick={() => setChosen(isChosen ? null : s.p.key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setChosen(isChosen ? null : s.p.key) } }}>
                  <circle cx={s.x} cy={s.y} r="20" fill="transparent" />
                  <circle cx={s.x} cy={s.y} r={on || isChosen ? 11 : 9} strokeWidth={isChosen ? 4 : 2.5} className={`${s.p.fill} ${isChosen ? 'stroke-blue-500' : 'stroke-white dark:stroke-zinc-900'} transition-all duration-150`} />
                  {s.p.badge && (
                    <g aria-hidden="true" pointerEvents="none">
                      <circle cx={s.x + 9} cy={s.y - 9} r="6.5" strokeWidth="1" className="fill-white stroke-zinc-400 dark:fill-zinc-900 dark:stroke-zinc-500" />
                      <path d={`M${s.x + 5.8} ${s.y - 9} l2.3 2.3 l4.1-4.6`} fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="stroke-emerald-600 dark:stroke-emerald-400" />
                    </g>
                  )}
                  {label && <text x={label.x} y={label.y} textAnchor={label.anchor} fontSize="13" fontWeight="700" paintOrder="stroke" strokeWidth="4" strokeLinejoin="round" className="fill-zinc-900 dark:fill-zinc-50 stroke-white dark:stroke-zinc-950 font-mono">{s.p.label}</text>}
                </g>
              )
            })}
          </svg>

          <div className="absolute z-20 flex flex-col gap-1" style={{ left: `calc(${(VIEW.left / VIEW.width) * 100}% + 10px)`, top: `calc(${(VIEW.top / plot.viewHeight) * 100}% + 10px)` }} role="group" aria-label="Zoom">
            <button type="button" className={control} aria-label="Zoom in" title="Zoom in" disabled={!canZoomIn} onClick={() => zoomBy(1)}>+</button>
            <button type="button" className={control} aria-label="Zoom out" title="Zoom out" disabled={!canZoomOut} onClick={() => zoomBy(-1)}>−</button>
            <button type="button" className={control} aria-label="Show all the sites" title="Show all the sites" disabled={camera.zoom === 0 && camera.center === null} onClick={() => setCamera({ zoom: 0, center: null })}>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
            </button>
          </div>

          {cardOf && (
            <section data-card role="region" aria-label={`Details of ${cardOf.p.label}`} onMouseEnter={cancelLeave} onMouseLeave={scheduleLeave} onFocus={cancelLeave} onBlur={scheduleLeave}
                     className={`absolute z-30 w-72 cursor-default rounded-xl border bg-white dark:bg-zinc-900 p-3 text-left text-zinc-900 dark:text-white shadow-2xl ${cardOf.p.key === chosen ? 'border-blue-500' : 'border-zinc-300 dark:border-zinc-700'}`}
                     style={{
                       left: `${(cardOf.x / VIEW.width) * 100}%`, top: `${(cardOf.y / plot.viewHeight) * 100}%`,
                       transform: `translate(${cardOf.x / VIEW.width < 0.22 ? '-12%' : cardOf.x / VIEW.width > 0.78 ? '-88%' : '-50%'}, ${cardOf.y < 230 ? '14px' : 'calc(-100% - 14px)'})`,
                     }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2"><span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${legend.find((l) => l.key === cardOf.p.legend)?.dot ?? ''}`} /><span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">{cardOf.p.label}</span></p>
                  {cardOf.p.subtitle && <p className="mt-0.5 text-sm font-semibold">{cardOf.p.subtitle}</p>}
                </div>
                {cardOf.p.key === chosen && (
                  <button type="button" aria-label="Close the details" title="Close the details" className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white" onClick={() => { setChosen(null); setHover(null) }}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                )}
              </div>
              <dl className="mt-1.5 space-y-0.5 text-xs">
                {cardOf.p.lines?.map(([k, v]) => <div key={k} className="flex gap-1.5"><dt className="shrink-0 text-zinc-500 dark:text-zinc-400">{k}:</dt><dd className="font-mono text-zinc-900 dark:text-zinc-100">{v}</dd></div>)}
              </dl>
              {cardOf.p.footer && <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{cardOf.p.footer}</p>}
              {/* what can be done with it: the buttons of its row */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {cardOf.p.actions?.()}
                {cardOf.p.onPick && (
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700" onClick={cardOf.p.onPick}>{cardOf.p.pickName ?? 'Show it'}</button>
                )}
              </div>
              {cardOf.p.key !== chosen && <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">Press the point to keep this card open</p>}
            </section>
          )}
        </div>
      )}
      {noTiles && <p role="status" className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">The map behind could not be loaded — it needs a connection. The points are drawn all the same.</p>}

    </div>
  )
}
