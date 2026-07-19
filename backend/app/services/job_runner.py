"""Async in-process job runner.

``start_job`` records a Job row and schedules an asyncio task that runs a
coroutine, wiring a ``report(progress)`` callback into the DB row and capturing
the result or error. Each task uses its own Session so it never shares a request
session.
"""

import asyncio
import json
from collections.abc import Awaitable, Callable

from sqlmodel import Session

from ..db import get_engine
from ..models import Job, utcnow

# Coroutine factory: receives a report(progress: float) callback, returns a
# JSON-serializable result dict.
CoroFactory = Callable[[Callable[[float], None]], Awaitable[dict]]


def start_job(kind: str, coro_factory: CoroFactory) -> str:
    """Create a queued Job row and schedule it. Returns the job id."""
    with Session(get_engine()) as session:
        job = Job(kind=kind, status="queued")
        session.add(job)
        session.commit()
        session.refresh(job)
        job_id = job.id

    asyncio.create_task(_run(job_id, coro_factory))
    return job_id


def _update(job_id: str, **fields) -> None:
    with Session(get_engine()) as session:
        job = session.get(Job, job_id)
        if job is None:
            return
        for key, value in fields.items():
            setattr(job, key, value)
        job.updated_at = utcnow()
        session.add(job)
        session.commit()


async def _run(job_id: str, coro_factory: CoroFactory) -> None:
    def report(progress: float) -> None:
        _update(job_id, progress=float(progress))

    _update(job_id, status="running", progress=0.0)
    try:
        result = await coro_factory(report)
        _update(
            job_id,
            status="done",
            progress=1.0,
            result_json=json.dumps(result),
        )
    except Exception as e:  # noqa: BLE001 - surface any failure on the job row
        _update(job_id, status="error", error=str(e))
