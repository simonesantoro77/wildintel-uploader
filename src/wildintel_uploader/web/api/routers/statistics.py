"""FastAPI router — the statistics of a revision: its deployments against the previous revisions of their locations (see services.statistics_service)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from wildintel_uploader.core import config
from wildintel_uploader.core.schemas.requests import StatisticsRequest
from wildintel_uploader.core.services import deployment_import_service, statistics_service

router = APIRouter(prefix="/api/statistics", tags=["statistics"])


@router.post("/revision")
def revision(req: StatisticsRequest) -> dict:
    """One row per deployment of the revision: its metrics, what each check of POSTVALIDATION says of it, its status and the metrics of the
    previous revisions of its location. The metrics are kept beside each deployment, so asking again is quick."""
    settings = config.load_settings()
    post = settings.POSTVALIDATION
    try:
        rows = statistics_service.collection_statistics(
            config.collections_dir(settings), req.research_project_id, req.collection,
            sequence_gap_seconds=post.sequence_gap_seconds, min_revisions=post.min_revisions, method=post.similarity_method,
            tolerances={"image_count": post.image_count_tolerance, "sequence_count": post.sequence_count_tolerance, "sequence_length": post.sequence_length_tolerance},
        )
    except deployment_import_service.DeploymentImportError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"results": rows}
