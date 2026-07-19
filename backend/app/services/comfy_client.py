"""Async ComfyUI client.

Ported from legacy/js/comfyui-service.js to async Python (httpx). Handles image
upload, prompt queueing, polling for completion, output retrieval, workflow
template loading/patching, and best-effort GPU coordination with Ollama.
"""

import asyncio
import copy
import json
from collections.abc import Callable

import httpx

from ..config import REPO_ROOT, settings

WORKFLOWS_DIR = REPO_ROOT / "workflows"

# Cache of /object_info class_type -> definition (populated on first validate call).
_object_info_cache: dict | None = None


def _client(timeout: float = 60.0) -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=settings.comfyui_url, timeout=timeout)


async def upload_image(image_bytes: bytes, filename: str = "input.png") -> str:
    """Upload an image to ComfyUI. Returns the server-side filename."""
    async with _client() as client:
        resp = await client.post(
            "/upload/image",
            files={"image": (filename, image_bytes, "application/octet-stream")},
            data={"overwrite": "true"},
        )
    resp.raise_for_status()
    result = resp.json()
    return result["name"]


async def queue_prompt(workflow: dict, client_id: str) -> str:
    """Queue a workflow for execution. Returns the prompt_id."""
    async with _client() as client:
        resp = await client.post(
            "/prompt", json={"prompt": workflow, "client_id": client_id}
        )
    if resp.status_code != 200:
        raise RuntimeError(f"ComfyUI queue failed ({resp.status_code}): {resp.text[:500]}")
    result = resp.json()
    if result.get("error"):
        raise RuntimeError(f"ComfyUI queue error: {result['error']}")
    return result["prompt_id"]


async def wait_for_completion(
    prompt_id: str,
    on_progress: Callable[[float], None] | None = None,
    timeout_s: int = 600,
) -> dict:
    """Poll /history/{prompt_id} once per second until the entry has outputs.

    Returns the ``outputs`` dict from the completed history entry. Progress is a
    crude poll-count-based estimate (asymptotically approaches ~0.95) since the
    WebSocket progress channel is skipped for M3.
    """
    async with _client(timeout=30.0) as client:
        for attempt in range(timeout_s):
            resp = await client.get(f"/history/{prompt_id}")
            if resp.status_code == 200:
                history = resp.json()
                entry = history.get(prompt_id)
                if entry and entry.get("outputs"):
                    if on_progress:
                        on_progress(1.0)
                    return entry["outputs"]
            if on_progress:
                # Asymptotic estimate: never reaches 1.0 until real completion.
                on_progress(min(0.95, (attempt + 1) / (attempt + 20)))
            await asyncio.sleep(1)
    raise TimeoutError(f"ComfyUI job {prompt_id} did not complete within {timeout_s}s")


async def fetch_output_images(outputs: dict) -> list[bytes]:
    """Download all output images referenced in a history ``outputs`` dict."""
    images: list[bytes] = []
    async with _client() as client:
        for node_output in outputs.values():
            for image in node_output.get("images", []) or []:
                resp = await client.get(
                    "/view",
                    params={
                        "filename": image["filename"],
                        "subfolder": image.get("subfolder", ""),
                        "type": image.get("type", "output"),
                    },
                )
                resp.raise_for_status()
                images.append(resp.content)
    return images


async def is_available() -> bool:
    """True if the ComfyUI server responds to /system_stats promptly."""
    try:
        async with _client(timeout=3.0) as client:
            resp = await client.get("/system_stats")
        return resp.status_code == 200
    except httpx.HTTPError:
        return False


async def validate_workflow(workflow: dict) -> list[str]:
    """Return the list of class_types in ``workflow`` unknown to the server.

    Fetches /object_info once and caches it. If the server is unreachable, the
    result is an empty list (validation is best-effort).
    """
    global _object_info_cache
    if _object_info_cache is None:
        try:
            async with _client(timeout=30.0) as client:
                resp = await client.get("/object_info")
            resp.raise_for_status()
            _object_info_cache = resp.json()
        except httpx.HTTPError:
            return []
    missing: list[str] = []
    for node in workflow.values():
        class_type = node.get("class_type")
        if class_type and class_type not in _object_info_cache:
            if class_type not in missing:
                missing.append(class_type)
    return missing


# --- Workflow template helpers ------------------------------------------------


def load_workflow(name: str) -> dict:
    """Load a workflow template from ``workflows/{name}.json``."""
    path = WORKFLOWS_DIR / f"{name}.json"
    if not path.is_file():
        raise FileNotFoundError(f"workflow template not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _is_literal(value) -> bool:
    """True for a literal input value (not a node-link list like ["844", 0])."""
    return not isinstance(value, list)


def patch_workflow(
    wf: dict,
    *,
    input_image: str | None = None,
    prompt_text: str | None = None,
    seed: int | None = None,
) -> dict:
    """Return a deep-copied workflow with inputs patched.

    - input_image: set every ``LoadImage`` node's ``inputs.image``.
    - prompt_text: for nodes whose ``_meta.title`` starts with ``"PROMPT"``, set
      ``inputs.string`` (StringConstantMultiline) or ``inputs.text`` (CLIPTextEncode).
    - seed: set the ``seed``/``noise_seed`` of KSampler/KSamplerAdvanced nodes and
      any node carrying a literal ``seed``/``noise_seed`` input.
    """
    wf = copy.deepcopy(wf)
    for node in wf.values():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs", {})
        class_type = node.get("class_type", "")
        title = node.get("_meta", {}).get("title", "")

        if input_image is not None and class_type == "LoadImage":
            inputs["image"] = input_image

        if prompt_text is not None and title.startswith("PROMPT"):
            # Prompt input key varies by node family: StringConstantMultiline uses
            # "string", CLIPTextEncode uses "text", TextEncodeQwenImageEdit/Plus
            # uses "prompt". Patch whichever literal key the node exposes.
            for key in ("string", "text", "prompt"):
                if key in inputs and _is_literal(inputs[key]):
                    inputs[key] = prompt_text
                    break
            else:
                inputs["text" if class_type == "CLIPTextEncode" else "string"] = prompt_text

        if seed is not None:
            for key in ("seed", "noise_seed"):
                if key in inputs and _is_literal(inputs[key]):
                    inputs[key] = seed
    return wf


# --- GPU coordination (M3 minimum) --------------------------------------------


async def evict_ollama() -> None:
    """Best-effort: ask Ollama to unload the story model from VRAM before a job."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{settings.ollama_url}/api/generate",
                json={"model": settings.story_model, "keep_alive": 0},
            )
    except httpx.HTTPError:
        pass


async def free_comfy() -> None:
    """Best-effort: free ComfyUI VRAM after a job completes."""
    try:
        async with _client(timeout=30.0) as client:
            await client.post(
                "/free", json={"unload_models": True, "free_memory": True}
            )
    except httpx.HTTPError:
        pass
