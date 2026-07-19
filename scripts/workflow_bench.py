"""Workflow benchmark harness — run several ComfyUI workflows against the same
prompt(s)/reference image and produce a side-by-side HTML comparison gallery.

Usage (from repo root, backend venv — needs only httpx from it):
  backend\\.venv\\Scripts\\python scripts\\workflow_bench.py --all --prompt "a small cheerful orange fox with a blue scarf, soft watercolor storybook style" --ref data\\media\\characters\\2\\ref.png
  backend\\.venv\\Scripts\\python scripts\\workflow_bench.py --workflows adv_kontext_scene,adv_qwen_edit_scene --prompt "..." --ref ref.png --seeds 7,42

Notes:
- Workflows run SEQUENTIALLY; ComfyUI's VRAM is freed between different workflows
  (POST /free) so 20B models don't fight the previous model's cache.
- Workflows that contain a LoadImage node REQUIRE --ref; text-to-image workflows
  ignore --ref. The sentinel contract: nodes titled PROMPT get the prompt text
  (works for CLIPTextEncode .text, StringConstantMultiline .string, and
  TextEncodeQwenImageEdit/Plus .prompt), nodes titled SEED (or any literal
  seed/noise_seed input) get the seed, every LoadImage gets the uploaded ref.
- Output: data/bench/<timestamp>/ with one PNG per (workflow, seed), a
  manifest.json (timings + parameters), and index.html — open it in a browser.
"""

import argparse
import copy
import json
import random
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path

import httpx

REPO = Path(__file__).resolve().parents[1]
WORKFLOWS_DIR = REPO / "workflows"
COMFY = "http://127.0.0.1:8188"

ADV_DEFAULT = [
    "base_flux_txt2img",
    "character_sheet_uso",
    "adv_uso_hires_sheet",
    "adv_kontext_scene",
    "adv_kontext_sheet",
    "adv_qwen_txt2img",
    "adv_qwen_txt2img_lightning",
    "adv_qwen_edit_scene",
]

PROMPT_KEYS = ("text", "string", "prompt")


def patch(wf: dict, prompt: str | None, seed: int | None, ref_name: str | None) -> dict:
    wf = copy.deepcopy(wf)
    for node in wf.values():
        title = node.get("_meta", {}).get("title", "")
        inputs = node.get("inputs", {})
        if prompt and title.startswith("PROMPT"):
            for key in PROMPT_KEYS:
                if key in inputs and not isinstance(inputs[key], list):
                    inputs[key] = prompt
                    break
        if seed is not None:
            for key in ("seed", "noise_seed"):
                if key in inputs and not isinstance(inputs[key], list):
                    inputs[key] = seed
        if ref_name and node.get("class_type") == "LoadImage":
            inputs["image"] = ref_name
    return wf


def needs_ref(wf: dict) -> bool:
    return any(n.get("class_type") == "LoadImage" for n in wf.values())


def upload_ref(client: httpx.Client, path: Path) -> str:
    resp = client.post(
        f"{COMFY}/upload/image",
        files={"image": (f"bench_{path.name}", path.read_bytes())},
        data={"overwrite": "true"},
    )
    resp.raise_for_status()
    data = resp.json()
    name = data.get("name", f"bench_{path.name}")
    sub = data.get("subfolder", "")
    return f"{sub}/{name}" if sub else name


def run_workflow(client: httpx.Client, wf: dict, timeout_s: int) -> tuple[list[bytes], float]:
    client_id = uuid.uuid4().hex
    resp = client.post(f"{COMFY}/prompt", json={"prompt": wf, "client_id": client_id})
    if resp.status_code != 200:
        raise RuntimeError(f"queue failed {resp.status_code}: {resp.text[:400]}")
    prompt_id = resp.json()["prompt_id"]

    started = time.time()
    while time.time() - started < timeout_s:
        time.sleep(2)
        hist = client.get(f"{COMFY}/history/{prompt_id}").json()
        entry = hist.get(prompt_id)
        if not entry:
            continue
        status = entry.get("status", {})
        if status.get("status_str") == "error":
            messages = status.get("messages", [])
            raise RuntimeError(f"execution error: {json.dumps(messages)[-600:]}")
        outputs = entry.get("outputs", {})
        if outputs:
            images: list[bytes] = []
            for out in outputs.values():
                for img in out.get("images", []):
                    r = client.get(
                        f"{COMFY}/view",
                        params={
                            "filename": img["filename"],
                            "subfolder": img.get("subfolder", ""),
                            "type": img.get("type", "output"),
                        },
                    )
                    r.raise_for_status()
                    images.append(r.content)
            return images, time.time() - started
    raise TimeoutError(f"no result after {timeout_s}s")


def free_vram(client: httpx.Client) -> None:
    try:
        client.post(f"{COMFY}/free", json={"unload_models": True, "free_memory": True})
    except httpx.HTTPError:
        pass


def evict_ollama(client: httpx.Client) -> None:
    # Best-effort: get whatever is resident out of VRAM before heavy sampling.
    try:
        tags = client.get("http://127.0.0.1:11434/api/ps", timeout=5).json()
        for m in tags.get("models", []):
            client.post(
                "http://127.0.0.1:11434/api/generate",
                json={"model": m["name"], "keep_alive": 0},
                timeout=15,
            )
    except Exception:
        pass


def write_gallery(out_dir: Path, manifest: dict) -> None:
    runs = manifest["runs"]
    seeds = sorted({r["seed"] for r in runs})
    workflows = []
    for r in runs:
        if r["workflow"] not in workflows:
            workflows.append(r["workflow"])
    cell = {(r["workflow"], r["seed"]): r for r in runs}

    rows = []
    for w in workflows:
        cells = []
        for s in seeds:
            r = cell.get((w, s))
            if r is None:
                cells.append("<td>-</td>")
            elif r.get("error"):
                cells.append(f"<td class='err'>{r['error'][:200]}</td>")
            else:
                imgs = "".join(
                    f"<a href='{f}' target='_blank'><img src='{f}'></a>" for f in r["files"]
                )
                cells.append(f"<td>{imgs}<div class='meta'>{r['duration_s']:.0f}s</div></td>")
        rows.append(f"<tr><th>{w}</th>{''.join(cells)}</tr>")

    html = f"""<!doctype html><meta charset="utf-8"><title>Pique workflow bench</title>
<style>
body{{font-family:system-ui;margin:20px;background:#faf7f0}}
table{{border-collapse:collapse}} td,th{{border:1px solid #ddd;padding:8px;vertical-align:top;text-align:left}}
th{{background:#fff}} img{{max-width:340px;display:block;margin-bottom:4px;border-radius:8px}}
.meta{{color:#888;font-size:12px}} .err{{color:#c00;max-width:340px;font-size:12px}}
</style>
<h1>Workflow bench — {manifest['timestamp']}</h1>
<p><b>Prompt:</b> {manifest['prompt']}</p>
<p><b>Ref:</b> {manifest.get('ref') or '—'}</p>
<table><tr><th>workflow \\ seed</th>{''.join(f'<th>seed {s}</th>' for s in seeds)}</tr>
{''.join(rows)}</table>"""
    (out_dir / "index.html").write_text(html, encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--workflows", help="comma-separated workflow names (files in workflows/, no .json)")
    ap.add_argument("--all", action="store_true", help=f"run the default set: {', '.join(ADV_DEFAULT)}")
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--ref", help="reference image path (required by ref-based workflows)")
    ap.add_argument("--seeds", default="7", help="comma-separated seeds (default: 7)")
    ap.add_argument("--timeout", type=int, default=3600, help="per-run timeout seconds (big models offload and can be VERY slow)")
    ap.add_argument("--out", default=str(REPO / "data" / "bench"))
    args = ap.parse_args()

    names = ADV_DEFAULT if args.all else [n.strip() for n in (args.workflows or "").split(",") if n.strip()]
    if not names:
        ap.error("give --workflows or --all")
    seeds = [int(s) for s in args.seeds.split(",")]

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(args.out) / stamp
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest = {
        "timestamp": stamp,
        "prompt": args.prompt,
        "ref": args.ref,
        "seeds": seeds,
        "runs": [],
    }

    with httpx.Client(timeout=60.0) as client:
        try:
            client.get(f"{COMFY}/system_stats")
        except httpx.HTTPError:
            print("ComfyUI is not reachable at", COMFY)
            sys.exit(1)

        evict_ollama(client)
        ref_name = None
        if args.ref:
            ref_name = upload_ref(client, Path(args.ref))
            print("uploaded ref as", ref_name)

        for name in names:
            path = WORKFLOWS_DIR / f"{name}.json"
            if not path.exists():
                print(f"SKIP {name}: {path} not found")
                continue
            template = json.loads(path.read_text())
            if needs_ref(template) and not ref_name:
                print(f"SKIP {name}: needs --ref")
                manifest["runs"].append({"workflow": name, "seed": seeds[0], "error": "needs --ref", "files": []})
                continue

            free_vram(client)  # don't let the previous family's weights linger
            for seed in seeds:
                wf = patch(template, args.prompt, seed, ref_name)
                print(f"RUN {name} seed={seed} ...", flush=True)
                run = {"workflow": name, "seed": seed, "files": [], "error": None, "duration_s": 0.0}
                try:
                    images, dur = run_workflow(client, wf, args.timeout)
                    run["duration_s"] = dur
                    for i, img in enumerate(images):
                        fname = f"{name}_s{seed}" + (f"_{i}" if i else "") + ".png"
                        (out_dir / fname).write_bytes(img)
                        run["files"].append(fname)
                    print(f"  ok in {dur:.0f}s -> {len(images)} image(s)")
                except Exception as e:
                    run["error"] = str(e)
                    print(f"  ERROR: {e}")
                manifest["runs"].append(run)

        free_vram(client)

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    write_gallery(out_dir, manifest)
    print("\nDone. Open:", out_dir / "index.html")


if __name__ == "__main__":
    main()
