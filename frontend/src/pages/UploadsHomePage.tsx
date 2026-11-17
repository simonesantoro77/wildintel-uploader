import TaskCard, { MENU_ICONS, SectionHeader } from '../components/TaskCard'
import { btnOutline } from './ImportDeploymentPage'

export type UploadsView = 'upload' | 'status'

interface Props {
  onBack: () => void
  onChoose: (view: UploadsView) => void
}

/** Manage the uploads to Trapper: send a deployment, or look at the status of the uploads of the deployments and the revisions. */
export default function UploadsHomePage({ onBack, onChoose }: Props) {
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8">
      <SectionHeader icon={MENU_ICONS.upload} title="Manage uploads" description="Send a deployment to a repository, or see how far the uploads are." onMenu={onBack} withProject />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TaskCard icon={<><path d="M18 20V10M12 20V4M6 20v-6" /></>} title="Uploads dashboard"
                  description="Which deployments and revisions are uploaded, and which are created and still to be uploaded." onClick={() => onChoose('status')} />
        <TaskCard icon={<><path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9" /><path d="M12 12v9M8 16l4-4 4 4" /></>} title="Upload deployment to Trapper"
                  description="Pick a collection kept on this computer and send a deployment to Trapper. Its location and the deployment are created there if they are missing." onClick={() => onChoose('upload')} />
      </div>
      <div className="mt-10">
        <button type="button" className={btnOutline} onClick={onBack}><span aria-hidden="true">← </span>Back</button>
      </div>
    </div>
  )
}
