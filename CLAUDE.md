# CLAUDE.md — Pique

**Read [docs/HANDOVER.md](docs/HANDOVER.md) before changing anything** — it is the complete
technical reference (architecture, every endpoint, schemas, gotchas, verification state).
Image-generation specifics live in [workflows/README.md](workflows/README.md).

## TL;DR
Local children's storybook studio + reading tutor. Three processes:
- `frontend/` Next.js 15 on **:3000** (`npm run dev`)
- `backend/` FastAPI on **:8010** (`backend/.venv/Scripts/python -m uvicorn app.main:app --port 8010 --reload`, run from `backend/`)
- `services/tts/` TTS+alignment on **:8100** — runs on **system Python 3.11** (NOT a venv; shares Henty's validated GPU stack)

External: ComfyUI (Comfy Desktop) on :8188, Ollama on :11434. Start everything: `./scripts/dev.ps1`.

## Hard rules learned the hard way
- Port 8000 is Windows-reserved here; the backend is on **8010** (also baked into `frontend/next.config.ts` + `frontend/lib/api.ts`).
- **NEVER run `npm run build` while the dev server is running** — shared `.next/` corrupts it (pages silently stop hydrating). Gate with `npx tsc --noEmit` instead.
- Media is served by the backend with Range support (`http://localhost:8010/media/...`); never proxy it through Next.
- WebSockets bypass the Next `/api` rewrite — connect straight to `ws://localhost:8010/ws/asr`.
- One tokenizer rule everywhere (`/\S+/` runs): `frontend/lib/tokenize.ts` ↔ `backend/app/services/textproc.py` must stay in parity (tests exist).
- Recognition must be `pause()`d whenever any app audio plays, `resume()`d ~300ms after.
- Don't upgrade numpy past 2.2.x on the system Python (breaks Chatterbox/numba).
- TTS/ComfyUI/Ollama share one 16GB GPU — GPU work goes through `gpu.phase('comfy'|'llm'|'tts')` (backend `services/gpu_coordinator.py`).

## Tests
`cd backend && ./.venv/Scripts/python -m pytest tests -q` (34 green at handover) · `cd frontend && npx tsc --noEmit`

## Owner preferences
- Delegate big implementation chunks to Opus/Sonnet subagents; review diffs.
- UX steers hard toward curated presets; custom options behind "advanced" affordances.
- Image quality beats speed (big models OK on the 16GB card). Scene workflow default is Flux Kontext (`adv_kontext_scene`); compare candidates with `scripts/workflow_bench.py`.
- Commit only when asked.
