import { StatusIcon } from './Notice'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Bar, Spinner, Tile, btnOutline, btnPrimary, count, formatBytes, formatDuration, panel } from './PrepareFiles'

/** One deployment of an upload, as the page has followed it. */
export interface UploadItem {
  id: string
  images: number
  /** What it is expected to weigh — the packages' real size once they are made. */
  bytes: number
  state: 'pending' | 'working' | 'done' | 'failed'
  /** Where it is: set up in Trapper, packing its images, sending them, or Trapper processing them. */
  stage: 'setup' | 'pack' | 'send' | 'process'
  /** Bytes of the packages that have gone up. */
  sentBytes: number
  /** What each step said, in the order they ran. */
  steps: { label: string; message: string; done: boolean; links?: { label: string; url: string }[] }[]
  locationId: string | null
  locationCreated: boolean
  deploymentCreated: boolean
  /** Where the collection is, in Trapper's own interface. */
  collectionUrl?: string
  error?: string
}

const sentShare = (item: UploadItem) => (item.state === 'done' ? 1 : item.bytes > 0 ? Math.min(1, item.sentBytes / item.bytes) : 0)
const sentImages = (item: UploadItem) => Math.round(item.images * sentShare(item))

function Phase({ n, state, title, children, right }: { n: number; state: 'done' | 'running' | 'pending'; title: string; children?: ReactNode; right?: ReactNode }) {
  return (
    <div className={`flex items-start gap-4 px-5 py-4 ${state === 'running' ? 'bg-blue-50/70 dark:bg-blue-950/30' : ''}`}>
      <span className="mt-0.5 flex w-6 h-6 shrink-0 items-center justify-center">
        {state === 'done' ? <span aria-hidden="true" className="flex w-6 h-6 items-center justify-center rounded-full bg-emerald-600 text-white text-xs">✓</span>
          : state === 'running' ? <Spinner />
          : <span aria-hidden="true" className="flex w-6 h-6 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 text-xs text-zinc-600 dark:text-zinc-300">{n}</span>}
      </span>
      <div className="flex-1 min-w-0">
        <p className={`font-semibold ${state === 'pending' ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-900 dark:text-zinc-100'}`}>{title}</p>
        <div className="text-sm text-zinc-500 dark:text-zinc-400">{children}</div>
      </div>
      {right}
    </div>
  )
}

/** The images going up to Trapper: the three phases, how much has gone, and each deployment's state. */
export function UploadingToTrapper({ items, target, startedAt, onStop }: {
  items: UploadItem[]; target: string; startedAt: number; onStop: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const totalBytes = items.reduce((sum, i) => sum + i.bytes, 0)
  const sentBytes = items.reduce((sum, i) => sum + (i.state === 'done' ? i.bytes : Math.min(i.sentBytes, i.bytes || i.sentBytes)), 0)
  const percent = totalBytes > 0 ? (sentBytes / totalBytes) * 100 : 0
  const doneCount = items.filter((i) => i.state === 'done').length
  const reachedSend = items.some((i) => i.state === 'done' || i.stage === 'send' || i.stage === 'process')
  const sendingDone = doneCount === items.length || items.every((i) => i.state === 'done' || i.stage === 'process')
  const processing = items.some((i) => i.state === 'working' && i.stage === 'process')
  const elapsed = (now - startedAt) / 1000
  const speed = sentBytes > 0 && elapsed > 3 ? sentBytes / elapsed : null
  const secondsLeft = speed ? (totalBytes - sentBytes) / speed : null
  const left = secondsLeft === null ? null : secondsLeft < 60 ? 'less than a minute left' : `about ${Math.round(secondsLeft / 60)} min left`
  const sendState = sendingDone ? 'done' : reachedSend ? 'running' : 'pending'
  return (
    <div>
      <div role="status" className="flex items-center gap-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-5 py-4 mb-4">
        <Spinner />
        <div>
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">Sending the images…</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">To {target}. You can leave this page open and come back.</p>
        </div>
      </div>

      <div className={`${panel} divide-y divide-zinc-200 dark:divide-zinc-700 overflow-hidden mb-4`}>
        <Phase n={1} state={reachedSend ? 'done' : 'running'} title="Set up Trapper">
          {reachedSend ? 'The research project, the locations and the deployments are ready in Trapper.' : 'Looking for what is already in Trapper and creating what is missing.'}
        </Phase>
        <Phase n={2} state={sendState} title="Send the images" right={sendState === 'running' && <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{Math.round(percent)}%</p>}>
          {sendState === 'pending' ? 'Starts once Trapper is set up.' : (
            <>
              <p>{formatBytes(sentBytes)} of {formatBytes(totalBytes)}{speed ? ` · ${formatBytes(speed)}/s` : ''}{left ? ` · ${left}` : ''}</p>
              {sendState === 'running' && <div className="mt-2"><Bar percent={percent} label="Progress of the images sent" /></div>}
            </>
          )}
        </Phase>
        <Phase n={3} state={processing ? 'running' : 'pending'} title="Trapper processes them">
          Starts once the images are sent. It happens on Trapper’s side, so you don’t need to wait here.
        </Phase>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Tile value={`${doneCount} of ${items.length}`} label="Deployments sent" />
        <Tile value={items.reduce((sum, i) => sum + sentImages(i), 0).toLocaleString('en-US')} label="Images sent" />
        <Tile value={formatBytes(sentBytes)} label="Sent so far" />
      </div>

      <div className={`${panel} mb-4 overflow-hidden`}>
        <div className="flex justify-between px-5 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700"><span>Deployment</span><span>Status</span></div>
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-4 px-5 py-3">
              <span className="w-5 shrink-0 flex justify-center">
                {i.state === 'done' ? <StatusIcon kind="success" className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /> : i.state === 'working' ? <Spinner /> : i.state === 'failed' ? <StatusIcon kind="error" className="h-5 w-5 text-red-600 dark:text-red-400" /> : null}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">{i.id}</p>
                {i.state === 'done' && <p className="text-xs text-zinc-500 dark:text-zinc-400">{count(i.images, 'image')} · {formatBytes(i.bytes)} sent</p>}
                {i.state === 'working' && i.stage === 'setup' && <p className="text-xs text-zinc-500 dark:text-zinc-400">Setting it up in Trapper</p>}
                {i.state === 'working' && i.stage === 'pack' && <p className="text-xs text-zinc-500 dark:text-zinc-400">Packing the images</p>}
                {i.state === 'working' && i.stage === 'process' && <p className="text-xs text-zinc-500 dark:text-zinc-400">Sent · waiting for Trapper to take them</p>}
                {i.state === 'working' && i.stage === 'send' && (
                  <>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{sentImages(i).toLocaleString('en-US')} of {i.images.toLocaleString('en-US')} images · {formatBytes(i.sentBytes)} of {formatBytes(i.bytes)}</p>
                    <div className="mt-1.5 max-w-xs"><Bar percent={sentShare(i) * 100} label={`Progress of ${i.id}`} /></div>
                  </>
                )}
                {i.state === 'pending' && <p className="text-xs text-zinc-500 dark:text-zinc-400">{count(i.images, 'image')} · waiting</p>}
                {i.state === 'failed' && <p className="text-xs text-red-600 dark:text-red-400">{i.error}</p>}
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${i.state === 'done' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : i.state === 'working' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' : i.state === 'failed' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'}`}>
                {i.state === 'done' ? 'Sent' : i.state === 'working' ? 'Sending…' : i.state === 'failed' ? 'Failed' : 'Waiting'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">If you stop, what’s already in Trapper stays there.</p>
      <div className="flex justify-end"><button type="button" className={btnOutline} onClick={onStop}>Stop</button></div>
    </div>
  )
}

function Pill({ children, tone }: { children: ReactNode; tone: 'green' | 'grey' | 'blue' }) {
  const colors = {
    green: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
    grey: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400',
    blue: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  }[tone]
  return <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${colors}`}>{children}</span>
}

/** What was sent, once the upload has ended — whether it all went well or not. */
export function UploadedToTrapper({ collection, researchProject, items, startedAt, finishedAt, onMore, filesNote }: {
  collection: string; researchProject: string; items: UploadItem[]; startedAt: number; finishedAt: number; onMore: () => void
  /** What became of the package files — deleted, or kept where. */
  filesNote?: ReactNode
}) {
  const [open, setOpen] = useState<string | null>(null)
  const sent = items.filter((i) => i.state === 'done')
  const failed = items.filter((i) => i.state !== 'done')
  const finished = new Date(finishedAt)
  const when = `${finished.getUTCDate()} ${finished.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${finished.getUTCFullYear()}, ${String(finished.getUTCHours()).padStart(2, '0')}:${String(finished.getUTCMinutes()).padStart(2, '0')} UTC`
  const locations = [...new Set(sent.map((i) => i.locationId).filter(Boolean) as string[])]
  const locationsCreated = new Set(sent.filter((i) => i.locationCreated).map((i) => i.locationId))
  const deploymentsCreated = sent.filter((i) => i.deploymentCreated).length
  const collectionUrl = sent.map((i) => i.collectionUrl).filter(Boolean).pop()
  return (
    <div>
      {failed.length === 0 ? (
        <div role="status" className="flex items-center gap-4 rounded-xl border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-5 py-4 mb-4">
          <span aria-hidden="true" className="flex w-9 h-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">✓</span>
          <div>
            <p className="font-semibold text-emerald-900 dark:text-emerald-100">Upload complete</p>
            <p className="text-xs text-emerald-800/90 dark:text-emerald-200/80">{when} · took {formatDuration(finishedAt - startedAt)}. All the images are in Trapper.</p>
          </div>
        </div>
      ) : (
        <div role="alert" className="rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-5 py-4 mb-4">
          <p className="font-semibold text-red-900 dark:text-red-200">{sent.length === 0 ? 'Nothing was uploaded' : `${count(sent.length, 'deployment')} uploaded, ${failed.length} could not be uploaded`}</p>
          <ul className="mt-1 text-sm text-red-800 dark:text-red-300 list-disc ml-5">
            {failed.map((i) => <li key={i.id}><span className="font-mono">{i.id}</span>: {i.error ?? 'It was not uploaded.'}</li>)}
          </ul>
        </div>
      )}

      {sent.length > 0 && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 px-5 py-3 text-sm text-zinc-700 dark:text-zinc-300 mb-4">
          <strong className="font-semibold">Trapper is now processing the images.</strong> It happens on Trapper’s side and can take a while for large deployments. You don’t need to stay here.
        </div>
      )}

      {sent.length > 0 && filesNote && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-5 py-3 text-sm text-zinc-700 dark:text-zinc-300 mb-4">{filesNote}</div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <Tile value={String(sent.length)} label="Deployments uploaded" />
        <Tile value={String(failed.length)} label="Deployments failed" tone={failed.length > 0 ? 'red' : undefined} />
        <Tile value={sent.reduce((sum, i) => sum + i.images, 0).toLocaleString('en-US')} label="Images sent" />
        <Tile value={formatBytes(sent.reduce((sum, i) => sum + i.bytes, 0))} label="Total size" />
        <Tile value={String(locationsCreated.size)} label="Locations created in Trapper" />
        <Tile value={String(deploymentsCreated)} label="Deployments created in Trapper" />
      </div>

      {sent.length > 0 && (
        <>
          <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">Deployments</h4>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">Open one to see what happened to it.</p>
          <ul className={`${panel} divide-y divide-zinc-200 dark:divide-zinc-700 mb-5`}>
            {failed.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-5 py-3">
                <StatusIcon kind="error" className="h-5 w-5 text-red-500" />
                <span className="flex-1 min-w-0">
                  <span className="block font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">{i.id}</span>
                  <span className="block text-xs text-red-700 dark:text-red-400 dark:text-zinc-400">{i.error ?? 'It was not uploaded.'}</span>
                </span>
                <span className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300">Not uploaded</span>
              </li>
            ))}
            {sent.map((i) => (
              <li key={i.id}>
                <button type="button" aria-expanded={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left">
                  <StatusIcon kind="success" className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  <span className="flex-1 min-w-0">
                    <span className="block font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">{i.id}</span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">{count(i.images, 'image')} · {formatBytes(i.bytes)} sent</span>
                  </span>
                  <Pill tone="blue">Processing on Trapper</Pill>
                  <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 fill-none stroke-current text-zinc-500 transition-transform ${open === i.id ? 'rotate-180' : ''}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                </button>
                {open === i.id && (
                  <ul className="px-5 pb-4 pl-12 space-y-2 text-sm">
                    {i.steps.map((step) => (
                      <li key={step.label}>
                        <p className="font-medium text-zinc-900 dark:text-zinc-100">{step.label}</p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">{step.message}</p>
                        {step.links && step.links.length > 0 && (
                          <p className="text-xs mt-0.5 flex gap-3">
                            {step.links.map((link) => <a key={link.url} className="text-blue-600 dark:text-blue-400 hover:underline" href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">What was set up in Trapper</h4>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">Only what was missing was created.</p>
          <ul className={`${panel} divide-y divide-zinc-200 dark:divide-zinc-700 mb-5`}>
            {[
              { name: researchProject, kind: 'Research project', pill: <Pill tone="grey">Already there</Pill> },
              ...(locations.length ? [{ name: locations.join(', '), kind: locations.length === 1 ? 'Location' : 'Locations', pill: locationsCreated.size === 0 ? <Pill tone="grey">Already there</Pill> : <Pill tone="green">Created</Pill> }] : []),
              { name: collection, kind: 'Collection', pill: <Pill tone="blue">Sent</Pill> },
              ...sent.map((i) => ({ name: i.id, kind: 'Deployment', pill: i.deploymentCreated ? <Pill tone="green">Created</Pill> : <Pill tone="grey">Already there</Pill> })),
            ].map((row) => (
              <li key={`${row.kind}-${row.name}`} className="flex items-center gap-3 px-5 py-3">
                <span className="flex-1 min-w-0">
                  <span className="block font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100 break-all">{row.name}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">{row.kind}</span>
                </span>
                {row.pill}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex justify-between items-center">
        <button type="button" className={btnOutline} onClick={onMore}>Upload more deployments</button>
        {collectionUrl && <a className={`${btnPrimary} inline-flex items-center gap-2`} href={collectionUrl} target="_blank" rel="noreferrer">Open in Trapper<span aria-hidden="true">↗</span></a>}
      </div>
    </div>
  )
}
