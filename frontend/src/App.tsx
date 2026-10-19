import { useEffect, useState } from 'react'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import ImportDeploymentPage from './pages/ImportDeploymentPage'
import ImportSessionPage from './pages/ImportSessionPage'
import MenuPage from './pages/MenuPage'
import RepairPage from './pages/RepairPage'
import ResumeSessionsPage from './pages/ResumeSessionsPage'
import SettingsPage from './pages/SettingsPage'
import SyncCollectionsPage from './pages/SyncCollectionsPage'
import UploadDeploymentPage from './pages/UploadDeploymentPage'
import UtilsPage from './pages/UtilsPage'
import WelcomePage from './pages/WelcomePage'
import { api } from './api'
import type { SessionSummary, Task, UploadTarget } from './types'

export default function App() {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)
  const [backendDown, setBackendDown] = useState(false)
  // Shown once the welcome screen is dismissed — the menu of tasks, unless
  // a session is offered for resuming first (see showResumeScreen below).
  const [menuShown, setMenuShown] = useState(false)
  const [task, setTask] = useState<Task | null>(null)
  // A run an earlier visit left unfinished (see the backend's own
  // services.session_store) — offered ahead of the menu. null while still
  // loading, so nothing flashes before the check completes.
  const [unfinishedSessions, setUnfinishedSessions] = useState<SessionSummary[] | null>(null)
  const [resumeSession, setResumeSession] = useState<SessionSummary | null>(null)
  // The settings page is shown over the rest, which stays mounted (just
  // hidden) — so a run in progress isn't lost.
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Back on the welcome screen by the title: it is shown ahead of anything else until "Get Started" is pressed again.
  const [home, setHome] = useState(false)
  // Where the upload page starts from, when it is reached from a finished import.
  const [uploadTarget, setUploadTarget] = useState<UploadTarget | null>(null)

  useEffect(() => {
    let cancelled = false
    async function ping() {
      const ok = await api.checkHealth()
      if (!cancelled) setBackendDown(!ok)
    }
    ping()
    const interval = setInterval(ping, 10_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  useEffect(() => {
    api.checkVersion()
      .then((v) => setCurrentVersion(v.current === 'dev' ? null : v.current))
      .catch(() => {})
  }, [])

  useEffect(() => {
    api.listSessions()
      .then((sessions) => setUnfinishedSessions(sessions))
      .catch(() => setUnfinishedSessions([]))
  }, [])

  function goHome() {
    setSettingsOpen(false); setTask(null); setResumeSession(null); setUploadTarget(null); setMenuShown(false); setHome(true)
  }

  function goToUpload(target: UploadTarget) {
    setUploadTarget(target); setTask('upload')
  }

  const showResumeScreen = !task && !menuShown && !home && unfinishedSessions !== null && unfinishedSessions.length > 0

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <Navbar version={currentVersion} onHome={goHome} settingsOpen={settingsOpen} onOpenSettings={() => setSettingsOpen(true)} />
      {backendDown && (
        <div className="bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm text-center py-2">
          Backend not reachable — is the server running?
        </div>
      )}
      <main className="flex-1">
        {settingsOpen && <SettingsPage onClose={() => setSettingsOpen(false)} />}
        <div className={settingsOpen ? 'hidden' : ''}>
          {task === 'deployment'
            ? <ImportDeploymentPage resumeSession={resumeSession ?? undefined} onUpload={goToUpload} onOpenSettings={() => setSettingsOpen(true)} />
            : task === 'session'
              ? <ImportSessionPage onUpload={goToUpload} />
              : task === 'upload'
              ? <UploadDeploymentPage initial={uploadTarget ?? undefined} onOpenSettings={() => setSettingsOpen(true)} />
              : task === 'utils'
              ? <UtilsPage onBack={() => setTask(null)} />
              : task === 'sync'
              ? <SyncCollectionsPage />
              : task === 'repair'
              ? <RepairPage />
              : showResumeScreen
                ? (
                  <ResumeSessionsPage
                    sessions={unfinishedSessions!}
                    onResume={(session) => { setResumeSession(session); setTask(session.task) }}
                    onDiscarded={(taskId) => setUnfinishedSessions((s) => (s ?? []).filter((x) => x.task_id !== taskId))}
                    onSkip={() => { setUnfinishedSessions([]); setMenuShown(true) }}
                  />
                )
                : menuShown
                  ? <MenuPage onChoose={setTask} />
                  : <WelcomePage onStart={() => { setHome(false); if (!unfinishedSessions?.length) setMenuShown(true) }} />}
        </div>
      </main>
      <Footer />
    </div>
  )
}
