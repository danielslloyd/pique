import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from ..db import get_session
from ..models import Job

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


class JobOut(BaseModel):
    id: str
    kind: str
    status: str
    progress: float
    result: dict | None
    error: str | None


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: str, session: Session = Depends(get_session)) -> JobOut:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(404, "job not found")
    try:
        result = json.loads(job.result_json) if job.result_json else None
    except json.JSONDecodeError:
        result = None
    # An empty {} result_json (the default) reads as no result yet.
    if result == {}:
        result = None
    return JobOut(
        id=job.id,
        kind=job.kind,
        status=job.status,
        progress=job.progress,
        result=result,
        error=job.error or None,
    )
