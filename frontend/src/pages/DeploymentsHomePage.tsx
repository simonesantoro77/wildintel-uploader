import TaskCard, { MENU_ICONS, SectionHeader } from '../components/TaskCard'
import { btnOutline } from './ImportDeploymentPage'

export type DeploymentsView = 'import' | 'many' | 'status' | 'statistics'

interface Props {
  onBack: () => void
  onChoose: (view: DeploymentsView) => void
}

/** Manage the deployments: import one from a folder of images, import one or several from the closed visits, look at the status of the deployments, or see their statistics. */
export default function DeploymentsHomePage({ onBack, onChoose }: Props) {
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8">
      <SectionHeader icon={MENU_ICONS.deployment} title="Manage deployments" description="Import the images of a deployment, see how far the deployments are, or compare them with the previous revisions." onMenu={onBack} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TaskCard icon={<><path d="M18 20V10M12 20V4M6 20v-6" /></>} title="Deployments dashboard"
                  description="The deployments the visits say and their statistics: which are created (their images stored), which are not yet, and which are uploaded to Trapper." onClick={() => onChoose('status')} />
        <TaskCard icon={<><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>} title="Import deployment"
                  description="Organize a folder of camera-trap images on this computer, then register the deployment in Trapper." onClick={() => onChoose('import')} />
        <TaskCard icon={<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />} title="Import deployments"
                  description="Pick one or several closed visits whose images you have: one is a folder of images, several a folder with a subfolder of images for each." onClick={() => onChoose('many')} />
        <TaskCard icon={<path d="M3 3v18h18M7 15l4-4 3 3 5-6" />} title="Statistics"
                  description="Compare the deployments of a revision with the previous revisions of their locations: how many images and sequences, and which depart from what was usual." onClick={() => onChoose('statistics')} />
      </div>
      <div className="mt-10">
        <button type="button" className={btnOutline} onClick={onBack}><span aria-hidden="true">← </span>Back</button>
      </div>
    </div>
  )
}
