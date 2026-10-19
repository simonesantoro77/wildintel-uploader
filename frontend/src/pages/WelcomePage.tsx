interface Props { onStart: () => void }

export default function WelcomePage({ onStart }: Props) {
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ minHeight: 'calc(100vh - 56px)' }}
    >
      <div className="text-center px-4" style={{ maxWidth: 580 }}>
        <div className="mb-3 text-7xl">📤</div>
        <h1 className="text-4xl font-bold mb-3">WildINTEL Uploader</h1>
        <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-lg">
          Bring camera-trap images from a memory card into the WildINTEL project, organized and registered in Trapper.
        </p>
        <ul className="list-none text-left text-zinc-500 dark:text-zinc-400 mb-6 mx-auto p-0 space-y-2" style={{ maxWidth: 440 }}>
          <li>📷 <strong className="text-zinc-900 dark:text-zinc-100">Import deployment</strong> — organize a folder of images locally and register the deployment in Trapper.</li>
          <li>🗂️ <strong className="text-zinc-900 dark:text-zinc-100">Import session</strong> — coming soon.</li>
        </ul>
        <button
          type="button"
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-base flex items-center gap-2 mx-auto"
          onClick={onStart}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Get Started
        </button>
      </div>
    </div>
  )
}
