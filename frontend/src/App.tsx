import { useEffect, useState } from 'react'
import Navbar from './components/Navbar'
import { DEFAULT_PROJECT_CHANGED } from './components/DefaultResearchProject'
import { TrailProvider } from './components/Trail'
import Footer from './components/Footer'
import ImportDeploymentPage from './pages/ImportDeploymentPage'
import ImportDeploymentsPage from './pages/ImportDeploymentsPage'
import UploadsHomePage from './pages/UploadsHomePage'
import type { UploadsView } from './pages/UploadsHomePage'
import UploadStatusPage from './pages/UploadStatusPage'
import MenuPage from './pages/MenuPage'
import RepairPage from './pages/RepairPage'
import ResumeSessionsPage from './pages/ResumeSessionsPage'
import SettingsPage from './pages/SettingsPage'
import SyncCollectionsPage from './pages/SyncCollectionsPage'
import UploadDeploymentPage from './pages/UploadDeploymentPage'
import UtilsPage from './pages/UtilsPage'
import VisitsHomePage from './pages/VisitsHomePage'
import DeploymentsHomePage from './pages/DeploymentsHomePage'
import StatisticsPage from './pages/StatisticsPage'
import DeploymentStatusPage from './pages/DeploymentStatusPage'
import type { VisitFocus } from './pages/VisitBookPage'
import type { DeploymentsView } from './pages/DeploymentsHomePage'
import WelcomePage from './pages/WelcomePage'
import { api } from './api'
import type { ClosedVisitTarget, FieldDeployment, SessionSummary, Task, UploadTarget } from './types'

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
  // The section the settings open on, when something sends the user to one in particular.
  const [settingsSection, setSettingsSection] = useState<'general' | 'epicollect' | 'projects' | 'trappers' | 'sdcards' | 'cameras' | 'locations' | undefined>(undefined)
  const [settingsProject, setSettingsProject] = useState<string | undefined>(undefined)
  // The SD card or the camera whose page the settings open on.
  const [settingsItem, setSettingsItem] = useState<string | undefined>(undefined)
  function openSettings(section?: 'general' | 'epicollect' | 'projects' | 'trappers' | 'sdcards' | 'cameras' | 'locations', researchProjectId?: string, item?: string) { setSettingsSection(section); setSettingsProject(researchProjectId); setSettingsItem(item); setSettingsOpen(true) }
  // Back on the welcome screen by the title: it is shown ahead of anything else until "Get Started" is pressed again.
  const [home, setHome] = useState(false)
  // Where the upload page starts from, when it is reached from a finished import.
  const [uploadTarget, setUploadTarget] = useState<UploadTarget | null>(null)
  // The visit Import deployment starts from, when it is reached from the visits page, right after one was closed.
  const [closedVisitTarget, setClosedVisitTarget] = useState<ClosedVisitTarget | null>(null)
  // Import deployment opened on a research project, to pick the revision whose visits were just closed.
  const [importProjectId, setImportProjectId] = useState<string | null>(null)
  // What Manage deployments shows: its options (none), the import or the status — on a deployment when a link of the visit book sent the user to it.
  const [uploadsView, setUploadsView] = useState<UploadsView | null>(null)
  const [deploymentsView, setDeploymentsView] = useState<DeploymentsView | null>(null)
  const [visitFocus, setVisitFocus] = useState<VisitFocus | undefined>(undefined)
  const [deploymentFocus, setDeploymentFocus] = useState<string | undefined>(undefined)
  // the deployment the statistics start on: its revision, with it isolated
  const [statisticsFocus, setStatisticsFocus] = useState<{ collection: string; deploymentId: string } | undefined>(undefined)
  // the deployment whose uploads the uploads dashboard starts on
  const [uploadSearch, setUploadSearch] = useState<string | undefined>(undefined)

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
    setSettingsOpen(false); setTask(null); setResumeSession(null); setUploadTarget(null); setClosedVisitTarget(null); setImportProjectId(null); setDeploymentsView(null); setUploadsView(null); setDeploymentFocus(undefined); setStatisticsFocus(undefined); setUploadSearch(undefined); setVisitFocus(undefined); setMenuShown(false); setHome(true)
  }

  function goMenu() {
    setSettingsOpen(false); setTask(null); setResumeSession(null); setUploadTarget(null); setClosedVisitTarget(null); setImportProjectId(null); setDeploymentsView(null); setUploadsView(null); setDeploymentFocus(undefined); setStatisticsFocus(undefined); setUploadSearch(undefined); setVisitFocus(undefined); setHome(false); setMenuShown(true)
  }

  function goToImportOfVisit(target: ClosedVisitTarget) {
    setClosedVisitTarget(target); setDeploymentsView('import'); setTask('deployment')
  }

  function goToImportOfProject(researchProjectId: string) {
    setImportProjectId(researchProjectId); setDeploymentsView('import'); setTask('deployment')
  }

  function goToDeploymentStatus(deploymentId: string) {
    setDeploymentFocus(deploymentId); setDeploymentsView('status'); setTask('deployment')
  }

  function goToStatistics(d: FieldDeployment) {
    setStatisticsFocus({ collection: d.collection, deploymentId: d.deployment_id }); setDeploymentsView('statistics'); setTask('deployment')
  }

  function goToUploadStatus(deploymentId: string) {
    setUploadSearch(deploymentId); setUploadsView('status'); setTask('upload')
  }
  function goToVisit(target: VisitFocus) {
    setVisitFocus(target); setTask('visits')
  }

  function goToUpload(target: UploadTarget) {
    setUploadTarget(target); setUploadsView('upload'); setTask('upload')
  }

  const showResumeScreen = !task && !menuShown && !home && unfinishedSessions !== null && unfinishedSessions.length > 0

  return (
    <TrailProvider onMenu={goMenu}>
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <Navbar version={currentVersion} onHome={goHome} settingsOpen={settingsOpen} onOpenSettings={() => openSettings()} />
      {backendDown && (
        <div className="bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm text-center py-2">
          Backend not reachable — is the server running?
        </div>
      )}
      <main className="flex-1">
        {settingsOpen && <SettingsPage initialSection={settingsSection} initialProject={settingsProject} initialItem={settingsItem} onClose={() => { setSettingsOpen(false); window.dispatchEvent(new Event(DEFAULT_PROJECT_CHANGED)) }} />}
        <div className={settingsOpen ? 'hidden' : ''}>
          {task === 'deployment'
            ? (resumeSession || closedVisitTarget || deploymentsView === 'import')
              ? <ImportDeploymentPage resumeSession={resumeSession ?? undefined} closedVisit={closedVisitTarget ?? undefined} researchProject={importProjectId ?? undefined} onUpload={goToUpload} settingsOpen={settingsOpen} onOpenSettings={openSettings}
                                      onDeploymentsMenu={() => { setClosedVisitTarget(null); setImportProjectId(null); setResumeSession(null); setDeploymentsView(null) }}
                                      onMainMenu={() => { setClosedVisitTarget(null); setImportProjectId(null); setResumeSession(null); setDeploymentsView(null); setTask(null) }}
                                      onBack={() => { setClosedVisitTarget(null); setImportProjectId(null); setResumeSession(null); if (closedVisitTarget || importProjectId || resumeSession) { setDeploymentsView(null); setTask(null) } else setDeploymentsView(null) }} />
              : deploymentsView === 'many'
                ? <ImportDeploymentsPage onUpload={goToUpload} settingsOpen={settingsOpen} onOpenSettings={openSettings} onBack={() => setDeploymentsView(null)} />
              : deploymentsView === 'statistics'
                ? <StatisticsPage settingsOpen={settingsOpen} onOpenSettings={openSettings} focus={statisticsFocus} onBack={() => { setDeploymentsView(statisticsFocus ? 'status' : null); setStatisticsFocus(undefined) }} />
              : deploymentsView === 'status'
                ? <DeploymentStatusPage settingsOpen={settingsOpen} onOpenSettings={openSettings} focus={deploymentFocus} onShowVisit={goToVisit} onUpload={goToUpload} onShowUploads={goToUploadStatus} onImportImages={goToImportOfVisit} onShowStatistics={goToStatistics} onBack={() => { setDeploymentsView(null); setDeploymentFocus(undefined) }} />
                : <DeploymentsHomePage onChoose={setDeploymentsView} onBack={() => setTask(null)} />
            : task === 'session'
              ? <ImportDeploymentsPage onUpload={goToUpload} settingsOpen={settingsOpen} onOpenSettings={openSettings} onBack={() => setTask(null)} />
              : task === 'upload'
              ? (uploadsView === 'upload' || uploadTarget || resumeSession)
                ? <UploadDeploymentPage initial={uploadTarget ?? undefined} onOpenSettings={() => openSettings()} onBack={() => { setUploadTarget(null); if (uploadsView === 'upload' && !resumeSession) setUploadsView(null); else setTask(null) }} />
                : uploadsView === 'status'
                  ? <UploadStatusPage settingsOpen={settingsOpen} onOpenSettings={openSettings} onShowVisit={goToVisit} onShowDeployment={goToDeploymentStatus} onUpload={goToUpload} search={uploadSearch} onBack={() => { setUploadsView(null); setUploadSearch(undefined) }} />
                  : <UploadsHomePage onChoose={setUploadsView} onBack={() => setTask(null)} />
              : task === 'utils'
              ? <UtilsPage onBack={() => setTask(null)} onOpenSettings={openSettings} settingsOpen={settingsOpen} />
              : task === 'sync'
              ? <SyncCollectionsPage onBack={() => setTask(null)} />
              : task === 'repair'
              ? <RepairPage onBack={() => setTask(null)} />
              : task === 'visits'
              ? <VisitsHomePage settingsOpen={settingsOpen} onOpenSettings={openSettings} onImportImages={goToImportOfVisit} onImportImagesOf={goToImportOfProject} onShowDeployment={goToDeploymentStatus} focusVisit={visitFocus} onBack={() => { setTask(null); setVisitFocus(undefined) }} />
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
                  ? <MenuPage onChoose={(t) => { setClosedVisitTarget(null); setUploadTarget(null); setUploadsView(null); setDeploymentsView(null); setDeploymentFocus(undefined); setUploadSearch(undefined); setVisitFocus(undefined); setTask(t) }} />
                  : <WelcomePage onStart={() => { setHome(false); if (!unfinishedSessions?.length) setMenuShown(true) }} />}
        </div>
      </main>
      <Footer />
    </div>
    </TrailProvider>
  )
}
