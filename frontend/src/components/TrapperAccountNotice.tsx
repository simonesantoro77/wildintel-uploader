import { SmallSpinner, btnOutline } from '../pages/ImportDeploymentPage'

/** The Trapper account of the settings, as saved — what the backend uses wherever the request leaves the credentials blank. */
export interface TrapperAccount { base_url: string | null; user_name: string | null; has_password: boolean }

export const trapperAccountReady = (account: TrapperAccount | null): boolean => Boolean(account?.base_url && account.user_name && account.has_password)

export type TrapperConnection = { status: 'idle' | 'testing' | 'ok' | 'error'; message: string }

interface Props {
  account: TrapperAccount | null
  conn: TrapperConnection
  onRetry: () => void
}

/** Where the pages that read from Trapper say which account they use: the one saved in the settings — they never ask for credentials. */
export default function TrapperAccountNotice({ account, conn, onRetry }: Props) {
  return (
    <div className="text-sm">
      {!trapperAccountReady(account) ? (
        <p role="alert" className="text-amber-700 dark:text-amber-400">
          The TRAPPER account isn’t set up: save its URL, username and password in the settings (⚙️) first.
        </p>
      ) : (
        <>
          <p className="text-zinc-600 dark:text-zinc-400">
            The account saved in the settings: <span className="font-mono">{account!.user_name}</span> at <span className="font-mono">{account!.base_url}</span>.
          </p>
          {(conn.status === 'idle' || conn.status === 'testing') && (
            <p role="status" className="mt-2 flex items-center gap-2 text-zinc-500 dark:text-zinc-400"><SmallSpinner /> Connecting to TRAPPER…</p>
          )}
          {conn.status === 'error' && (
            <div className="mt-2">
              <p className="text-red-600 dark:text-red-400">{conn.message}</p>
              <button type="button" className={`${btnOutline} mt-2`} onClick={onRetry}>Try again</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
