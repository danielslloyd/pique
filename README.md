# Pique — Children's Storybook Studio & Reading App

Create characters (from a photo or a description), lock them in, generate an illustrated
storybook with a local LLM + ComfyUI, then read it together: the app narrates with
word-by-word highlighting (Listen), listens while the child reads to unlock each picture
(Read), and coaches in between (Echo, Read-back).

## Layout

| Path | What |
|---|---|
| `frontend/` | Next.js app (library, reader, character studio, story wizard) |
| `backend/` | FastAPI orchestrator :8010 — DB, books, jobs, ComfyUI/Ollama clients, ASR |
| `services/tts/` | Standalone TTS + forced-alignment service :8100 (Kokoro / Chatterbox + MMS_FA) |
| `workflows/` | ComfyUI API-format workflow templates |
| `books/` | Legacy `.rbook` files (import fixtures) |
| `legacy/` | The previous vanilla-JS app (kept for reference + one-time character export) |
| `data/` | Runtime data: SQLite DB + media (gitignored) |
| `scripts/` | `dev.ps1` (start everything), `import_books.py` |

## External services (local)

- **ComfyUI** at `http://127.0.0.1:8188` (image generation)
- **Ollama** at `http://127.0.0.1:11434` (story generation, default model `gpt-oss:20b`)

## Dev quickstart

```powershell
./scripts/dev.ps1   # starts backend, TTS service, frontend; pings ComfyUI/Ollama
```

Frontend: http://localhost:3000 · Backend API: http://localhost:8010/docs

## Documentation

- **[docs/HANDOVER.md](docs/HANDOVER.md)** — complete technical reference (read this first)
- **[workflows/README.md](workflows/README.md)** — every ComfyUI workflow, model inventory, bench harness
- **[CLAUDE.md](CLAUDE.md)** — condensed rules for AI assistants

Compare image workflows: `backend\.venv\Scripts\python scripts\workflow_bench.py --all --prompt "..." --ref <image>`
→ HTML gallery in `data/bench/<timestamp>/index.html`.
