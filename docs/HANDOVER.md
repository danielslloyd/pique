# Pique — Complete Technical Handover

> **Audience**: future AI assistants (Opus-class and below) and humans working on this codebase.
> Read this whole file before making changes. Everything here was true as of 2026-07-19.
> Cross-references: [workflows/README.md](../workflows/README.md) (image-generation deep dive), root [README.md](../README.md) (quickstart).

## 0. What Pique is

A local-first children's storybook studio + reading tutor for a parent (Dan) and his early-reader child:

1. **Character studio** — create characters from a photo or a text description, in an enforced art style, generate a turnaround sheet with ComfyUI, crop a reference image, write an identity prompt, and **lock** the character.
2. **Story wizard** — locked characters + a theme → a local LLM (Ollama) writes a reading-level-appropriate story → ComfyUI renders one consistent-character scene per page (approve/reroll each) → TTS narration with per-word timestamps is built → the book lands in the library.
3. **Reader** — four modes: **Read** (child reads aloud; speech recognition matches words; picture unlocks), **Listen** (app narrates with word-by-word karaoke highlighting), **Echo** (app reads a sentence, child repeats it), and **Read-back** (fluent replay as a reward after Read completion).

The long-term goal is a public-facing website; the architecture keeps those seams (see §9).

## 1. Repo layout

```
pique/
├── frontend/            Next.js 15 + TypeScript + Tailwind v4 (port 3000)
├── backend/             FastAPI + SQLModel/SQLite (port 8010)  ← NOT 8000 (Windows reserves it)
├── services/tts/        TTS + forced alignment (port 8100) — runs on SYSTEM Python 3.11
├── workflows/           ComfyUI API-format workflow JSONs + README (full docs)
├── scripts/             dev.ps1, import_books.py, workflow_bench.py
├── books/               legacy .rbook fixtures (already imported into the DB)
├── legacy/              the old vanilla-JS app (kept ONLY for its character-export button)
├── data/                gitignored runtime data: pique.db + media/ + bench/
└── docs/                this file
```

External local services (both third-party, user-managed):
- **ComfyUI** (Comfy Desktop app) at `http://127.0.0.1:8188` — image generation.
  Install: `C:\Users\danie\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI`; shared models at `C:\Users\danie\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models` (~90GB of models were downloaded 2026-07-18/19 — inventory in workflows/README.md §2).
- **Ollama** at `http://127.0.0.1:11434` — story LLM. Default model `gpt-oss:20b` (fits 16GB VRAM; `llama3.1:70b` exists but is CPU-slow — deliberately not used).

## 2. Running everything

```powershell
./scripts/dev.ps1     # pings ComfyUI+Ollama, starts backend (:8010), TTS (:8100), frontend (:3000)
```

Manual equivalents:
```powershell
# backend (its own venv, NO torch in it)
cd backend; ./.venv/Scripts/python -m uvicorn app.main:app --port 8010 --reload
# TTS service — SYSTEM python 3.11 (same interpreter Henty uses; torch cu130 + chatterbox + kokoro preinstalled)
cd services/tts; & "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe" -m uvicorn app:app --port 8100
# frontend
cd frontend; npm run dev
```

Tests: `cd backend; ./.venv/Scripts/python -m pytest tests -q` → **34 passing** as of handover.
Frontend type gate: `cd frontend; npx tsc --noEmit`.

### ⚠ Operational gotchas (each of these bit us at least once)
- **Port 8000 is unusable** on this machine (http.sys owns it) — backend lives on **8010**. It's hardcoded in `frontend/next.config.ts` (API rewrite proxy) and `frontend/lib/api.ts` (`MEDIA_BASE`).
- **Never run `npm run build` while `next dev` is running** — they share `.next/` and the dev server wedges into a broken fallback state (serves `fallback/pages/_app.js` chunks, pages stop hydrating with NO console errors). Fix: kill the dev server, `rm -rf frontend/.next`, restart. Use `npx tsc --noEmit` as the CI gate instead.
- **Stopping `npm run dev` can orphan the node child** holding port 3000 — if a fresh dev server lands on 3001, kill the PID listening on 3000 (`netstat -ano | findstr :3000`).
- **uvicorn `--reload` sometimes wedges** after multi-file edits (last reload never completes). If an endpoint 404s that should exist, restart the backend.
- Media (images/audio) is served by the **backend** with Range support; the frontend uses absolute `http://localhost:8010/media/...` URLs (`mediaUrl()` helper). Never proxy media through Next.
- **WebSockets do not pass through the Next `/api` rewrite** — the Whisper provider connects directly to `ws://localhost:8010/ws/asr`.
- The console `[Errno 13] ... socket ... forbidden` uvicorn error = Windows reserved-port collision; pick another port.

## 3. Backend (FastAPI, `backend/app/`)

### 3.1 Structure
```
app/main.py            app factory; CORS for :3000; lifespan creates tables + seeds 5 style presets
app/config.py          pydantic-settings, env prefix PIQUE_ (e.g. PIQUE_STORY_MODEL, PIQUE_SHEET_WORKFLOW)
app/db.py              SQLite engine (WAL + foreign_keys pragmas), get_session dependency
app/models.py          ALL tables (SQLModel). family_id column everywhere (default 1) for future multi-tenant
app/routers/           books, characters, styles, stories, narrations, word_audio, jobs, media, asr
app/services/          storage, rbook_import, comfy_client, job_runner, gpu_coordinator,
                       ollama_client, story_prompts, tts_client, textproc
app/asr/whisper_stream.py   faster-whisper rolling-window session (CPU int8 by default)
```

### 3.2 Database schema (SQLite `data/pique.db`; keep Postgres-portable)
- `styles(id, name, is_preset, master_prompt, negative_prompt, thumbnail_path, family_id, created_at)` — 5 presets seeded at startup: storybook_watercolor, bold_cartoon, ghibli_soft, paper_cutout, realistic_illustration. Presets are read-only via API; custom styles are created as clones.
- `characters(id, name, description, attributes_json, style_id, status: draft|locked, identity_prompt, source_photo_path, ref_image_path, sheet_image_path, seed, locked_at, ...)`
- `character_images(character_id, kind: source_photo|base_candidate|sheet|sheet_extra|ref_crop, path, seed)`
- `books(id, title, author, description, status: draft|generating|ready, source: imported|wizard|legacy, reading_level: pre-k|k|1st, style_id, thumbnail_path, story_model)`
- `book_characters(book_id, character_id)` — M:N; "first" character = lowest id = the USO/Kontext reference subject.
- `pages(book_id, page_no [unique together], text, image_prompt, image_path, image_seed, image_status: pending|candidate|approved)`
- `narrations(book_id, page_id, engine, voice_id, audio_path, duration_s, sample_rate)` + `word_timings(narration_id, word_index, word, start_ms, end_ms)` — one timing row PER TOKEN of the page text, aligned by index.
- `word_audio_cache(word, engine, voice_id → composite PK, audio_path)`
- `jobs(id uuid-hex, kind: base_image|sheet|scene|narration, status: queued|running|done|error, progress 0..1, payload_json, result_json, error)`

### 3.3 API surface (complete)
Books/library:
- `GET /api/books`, `GET /api/books/{id}` (pages include `image_prompt`, `image_seed`), `DELETE /api/books/{id}`
- `POST /api/books/import-rbook` (multipart) — legacy ZIP format: `book.json {metadata{...}, pages[{text, image}]}` + images + thumbnail.jpg
Wizard:
- `POST /api/books/wizard {title, character_ids, reading_level, pages[{text,image_prompt}]}` → draft book (validates: characters locked + share ONE style)
- `POST /api/books/{id}/pages/{n}/image {seed?, prompt_override?}` → `{job_id}` — scene generation; prompt = `style.master_prompt + identity_prompts + (override|page.image_prompt)`; ref = first character's ref crop; sets `candidate`
- `POST /api/books/{id}/pages/{n}/approve`; `PATCH /api/books/{id}/pages/{n} {text?, image_prompt?}` (draft books only)
- `POST /api/books/{id}/finalize {engine, voice}` → `{job_id}` — requires all approved; builds per-page narration + pre-warms word-audio for every unique word; draft→generating→ready (reset to draft on error)
Stories (Ollama; slow endpoints, 60-180s):
- `POST /api/stories/draft {character_ids, theme, reading_level, page_count, model?}` → `{title, pages[{page_no,text,image_prompt}]}` — JSON-schema-constrained (`format` param), level heuristics validated (`story_prompts.validate_level`), one auto-retry naming violations
- `POST /api/stories/revise {title, pages, page_no, instruction, reading_level, character_ids}` → `{page}`
Characters:
- CRUD at `/api/characters`; create = multipart (name, description, style_id, photo?)
- `POST /{id}/base-image {prompt_override?, seed?, count=2}` → job (text path, Flux txt2img)
- `POST /{id}/sheet {seed?, source_image_id?}` → job (input = chosen candidate or source photo; workflow from `settings.sheet_workflow`)
- `POST /{id}/ref-crop {image_id, x,y,w,h fractions}` (Pillow crop → ref image)
- `POST /{id}/identity-prompt` → drafts 1-2 sentence visual descriptor via Ollama vision (`qwen3-vl:8b` on the sheet) → text-model fallback → template fallback; never hard-fails
- `POST /{id}/lock {ref_image_id?, identity_prompt?}` (requires ref + identity; 409 if locked), `POST /{id}/unlock` (409 if in a book)
- `POST /api/characters/import-legacy` (zip from the legacy app's export button)
Styles: `GET/POST /api/styles`, `PATCH/DELETE /api/styles/{id}` (409 on presets / referenced)
Narration/help: `GET /api/books/{id}/pages/{n}/narration?engine&voice&build=true` (lazily builds, 503 if TTS down) → `{audio_url, duration_s, words[{i,word,start_ms,end_ms}]}`; `POST /api/narrations/build`; `GET /api/word-audio/{word}?engine&voice` (cache-through, speed 0.85)
ASR: `GET /api/asr/capabilities`; `WS /ws/asr` (protocol in §6)
Jobs: `GET /api/jobs/{id}` — poll every 2s; no WebSocket
Media: `GET /media/{path}` (Range-capable FileResponse; traversal-guarded)

### 3.4 GPU coordination (`services/gpu_coordinator.py`)
Single 16GB GPU shared by ComfyUI, Ollama, TTS. `async with gpu.phase('comfy'|'llm'|'tts')`:
an `asyncio.Lock` lane; on phase CHANGE it best-effort evicts the others first
(comfy→evict Ollama + unload TTS; llm→free ComfyUI + unload TTS; tts→free ComfyUI + evict Ollama).
Same-phase reacquisition skips transitions. Whisper ASR intentionally runs on CPU (int8) and is NOT gated.
ComfyUI free = `POST /free {"unload_models":true,"free_memory":true}`; Ollama evict = generate with `keep_alive:0`; TTS = `POST :8100/unload`.

### 3.5 Text/token pipeline — THE invariant
One tokenization rule everywhere: **tokens are `/\S+/` runs**.
- Frontend: `frontend/lib/tokenize.ts` (display + normalized forms + char offsets)
- Backend: `services/textproc.py` (same rule; plus MMS-aligner charset splitting)
Narration word-timings are mapped back to display tokens by `textproc.map_spans_to_tokens`:
a token may produce several aligner words ("manta-ray." → manta+ray → union span) or none ("2" → zero-length timing interpolated from neighbors). `word_timings.word_index` == frontend token index. If you change tokenization, change BOTH sides and the parity tests (`backend/tests/test_textproc.py`).

## 4. TTS service (`services/tts/`, port 8100)

Runs on the **system Python 3.11** — the same interpreter as the sibling Henty project, whose GPU stack (torch 2.12.0+cu130 for the Blackwell RTX 5070 Ti, chatterbox-tts 0.1.7, kokoro, numpy 2.2.6) is already installed and validated. Do NOT create a venv for it; do NOT upgrade numpy past 2.2.x (numba/chatterbox break).

- Engines: **Kokoro-82M** (`af_heart` default voice, fast, ~0.5GB) and **Chatterbox** (voice cloning from a `.wav` in `services/tts/voices/`, upload via `POST /voices`).
- **Forced alignment**: torchaudio `MMS_FA` (ported from Henty, but returning ALL per-word spans instead of discarding them). `POST /synthesize {text, engine, voice, ref_audio?, speed, align}` → `{sample_rate, duration_s, words[{word,start_s,end_s}], audio_b64}`. Stateless — the backend owns storage.
- **Carrier trick** (from Henty): Chatterbox garbles inputs <40 chars, so short texts are wrapped in fixed carrier sentences, generated, then the target span is cut back out via alignment. Kokoro doesn't need it.
- `POST /unload` drops all models + empties CUDA cache (called by the GPU coordinator).
- MMS_FA weights are **CC-BY-NC** — fine for personal use; swap the aligner before commercializing.

## 5. Frontend (Next.js 15, `frontend/`)

Routes: `/` (library) · `/read/[bookId]` (the reader) · `/characters`, `/characters/new`, `/characters/[id]` (studio) · `/create` (wizard) · `/settings`.
State: TanStack Query for all server data; zustand for the live reading session (`stores/readerStore.ts`) and the wizard draft (`stores/wizardStore.ts`, persisted to localStorage key `pique-wizard`).
Job pattern: POST returns `{job_id}` → `useQuery` polling `/api/jobs/{id}` every 2s until done/error.

### 5.1 The reading system (the heart of the app)
- `lib/tokenize.ts` — THE tokenizer (see §3.5).
- `lib/word-match.ts` — kid-tuned matching: exact/homophone for length≤3 words (+ acceptance if the word appears exactly in any recognition alternative), edit distance ≤1 for len 4-5, ≤2 for len≥6; symmetric "kid-speech" canonicalization (th↔d, r↔w, l↔w, ing↔in, optional trailing s) applied to BOTH sides; homophone table incl. number words. `relaxed` option loosens one notch after word-help plays.
- `lib/match-controller.ts` — the word-pile engine: every recognition hypothesis word is appended to a pile; a cursor walks expected words; **two-word lookahead** lets word N be skipped (marked `assisted`, still counts for unlock) when N+1/N+2 match — interim hypotheses may only trigger lookahead on EXACT matches; stuck detection after 2 no-progress finals emits `stuck`; `relaxWord()` + `forceAdvance()` support the help flow.
- `lib/recognition/` — `types.ts` (RecognitionProvider interface: start/pause/resume/stop + hypothesis/status callbacks), `webspeech.ts` (Chrome Web Speech; exponential-backoff restarts 250ms→4s — NEVER a fixed 100ms loop; alternatives flattened into the pile), `whisper.ts` (M5: mic → AudioWorklet → 16k Int16 → WS → faster-whisper partials), `index.ts` (tier selection via localStorage `pique-asr-tier`: auto/webspeech/whisper).
- **Mutual exclusion rule (critical!)**: recognition MUST be paused whenever any app audio plays, and resumed ~300ms after it ends — otherwise the app "hears" its own TTS. Word-help audio goes through `lib/audio-manager.ts` (single shared element, onStart→provider.pause(), onEnd→provider.resume()); Listen/Echo narration never runs concurrently with recognition.
- Reader modes in `app/read/[bookId]/page.tsx`: Read (match + unlock + tap-word help + auto-help on stuck → 2nd stuck on same word = assisted auto-advance), Listen (`components/reader/ListenController.tsx` — rAF + **120ms interval fallback** for highlight sync; the interval matters: rAF starves in backgrounded/non-painting tabs while audio keeps playing), Echo (`EchoController.tsx` — per-sentence: play narration slice → child repeats → ≥70% pass), Read-back (Listen replay after Read completion + solo/assisted stars).
- Timing lookup: `lib/timing.ts findWordIndexAt(ms, spans)` binary search (rightmost span with start_ms ≤ ms).

### 5.2 Studio & wizard UIs
- Studio detail page has a dependency-free drag-crop over the sheet (letterbox-corrected fractional coords → `POST ref-crop`).
- Style picker: preset cards foregrounded; "Customize style…" disclosure creates a custom style (clone-of-preset) — **deliberate UX: steer hard toward presets** (user preference).
- Wizard: 5 steps (stars → idea → story → pictures → finish), localStorage-persisted, one-job-at-a-time client-side gate during picture generation, "Paint all remaining" sequential queue.

## 6. Speech recognition tiers

1. **Web Speech API** (default; Chrome-only, cloud-backed): provider in `webspeech.ts`. Known good after M1 fixes.
2. **Whisper** (local, offline-capable): backend `app/asr/whisper_stream.py` — faster-whisper `small.en`, **CPU int8** (deliberate: never competes for VRAM; a modern CPU keeps up with the ~1s cadence). Rolling 6s window, re-transcribed when ≥1s of new audio arrives, with the page text as `initial_prompt` (biases toward expected words). WS protocol: text `{"type":"start","expected_text":...}` → `{"type":"ready"}` → binary Int16 16kHz mono frames → `{"type":"partial","words":[{word,confidence}],"text":...}` (each partial is a FULL re-transcription, which the pile-based matcher tolerates) → `{"type":"stop"}`.
   GPU decoding: set `PIQUE_WHISPER_DEVICE=cuda` (needs cuDNN 9 DLLs on PATH — not installed by default).

## 7. Image generation (summary — full details in workflows/README.md)

- Client: `services/comfy_client.py` (upload → patch → queue → poll history → fetch outputs; `validate_workflow` against `/object_info`). Patch contract: PROMPT-titled nodes (`text`/`string`/`prompt` keys), literal seeds, all LoadImage nodes.
- Active workflows (configurable via `PIQUE_BASE_WORKFLOW` / `PIQUE_SHEET_WORKFLOW` / `PIQUE_SCENE_WORKFLOW`), after the 2026-07-19 bench promotions: base = `adv_qwen_txt2img_lightning` (Qwen 20B + Lightning, ~22s, beat Flux clearly), sheet = `character_sheet_uso` (unchanged, pending a Kontext-sheet bake-off), scene = `adv_kontext_scene` (beat USO decisively). Fallbacks: `base_flux_txt2img`, `scene_uso_flux`.
- **Quality history (user feedback!)**: USO output was judged underwhelming; the `adv_*` workflows (Flux **Kontext** dev editing, **Qwen-Image 20B**, **Qwen-Image-Edit-2509**, hi-res USO) were built to beat it. The bench (`scripts/workflow_bench.py`, HTML gallery in `data/bench/<ts>/index.html`) showed Kontext dramatically better on identity + composition, so it is now the scene default; book #3's pages were regenerated with it (seeds 701-704). **The sheet workflow is still USO** — bench `adv_kontext_sheet` with its real turnaround prompt before promoting sheets too. Qwen-Edit-2509 remains unbenched (model downloaded) and may be even stronger.
- Scene prompt composition is model-aware (`backend/app/routers/books.py`): editing models (kontext/qwen_edit in the workflow name) get instruction-style prompts ("Place this exact character in… keeping the character exactly the same") WITHOUT identity re-description; USO-style workflows get `style + identities + scene`.
- Kontext output size follows the (normalized ~1MP) reference image size — Pip's portrait ref crop yields portrait pages, which the reader's object-contain layout handles fine.
- Known USO artifact (why it lost): the reference image gets re-rendered on the canvas; Kontext doesn't have this failure mode.
- The original Mickmumpitz CCC workflow (`character_sheet_ccc.json`) is preserved but NON-FUNCTIONAL here (needs 6 custom-node packs + Qwen GGUF models not installed).

## 8. Current data state (what's in the DB right now)

- Books: #1 "These are Animals" (8p, imported), #2 "Michael the Ninja Turtle" (10p, imported), #3 "Pip's Rainy Day Adventure" (4p, wizard-generated end-to-end, status ready).
- Characters: #2 "Pip" (locked, watercolor fox, has sheet + ref crop — the canonical test character), #3 "Roo" (draft, bold_cartoon kangaroo from the photo-path test).
- All 18 imported pages + book #3 narrated with Kokoro `af_heart`; ~105+ words in the word-audio cache.
- Test artifacts from verification live in `data/media/`; `data/bench/` holds workflow-bench outputs.

## 9. Public-deployment seams (design intent, NOT built)

- Every table has `family_id` (default 1); routers can grow a `get_current_family()` dependency for auth.
- ComfyUI/Ollama/TTS are URL-configured HTTP services — swappable for hosted GPU endpoints; the `jobs` table is the seam for a real queue.
- All media I/O goes through `services/storage.py` — replace with S3/R2 by reimplementing one class.
- WebSpeech tier costs nothing server-side (public default); Whisper is the self-hosted tier.
- SQLite→Postgres = connection string + migration (schema is portable).
- MMS_FA aligner license (CC-BY-NC) must be replaced before commercial use.

## 10. Verification status & open items

Verified live end-to-end (2026-07-18/19): rbook import; Read-mode rendering (mic matching needs a human); Listen highlight sync (word sweep confirmed); TTS synthesis + alignment; word-audio caching; character text path (base→sheet); photo path; ref-crop; lock guards; identity prompts (real Ollama); story drafting (real gpt-oss:20b, level-checked); full wizard pipeline (book #3); GPU phase transitions without OOM. Backend suite: 34 tests green.

**Open items for the next session:**
1. **Human mic testing** of Read/Echo modes (never possible in the sandboxed browser pane — it blocks mic capture and doesn't paint, so rAF/media behave oddly there; test in real Chrome). Echo's state machine and the friendly mic-denied message were verified visually; the listening loop was not.
2. **Remaining workflow bake-offs** (scene + base already promoted to Kontext/Qwen-Lightning): (a) `adv_kontext_sheet` with its real turnaround prompt vs `character_sheet_uso` — promote `PIQUE_SHEET_WORKFLOW` if better; (b) `adv_qwen_edit_scene` vs `adv_kontext_scene` (model downloaded; unbenched); (c) Kontext for the PHOTO path ("redraw this photo as <style>, same person") — likely much better than USO's photo handling. Voice-preference note: settings changes apply on next reader mount (controllers snapshot once).
3. **Legacy character migration**: user must open the OLD app at its ORIGINAL origin (IndexedDB is origin-scoped), click "⬇ Export characters", then "Import legacy characters" on /characters.
4. Chatterbox voice cloning is wired but untested end-to-end (upload a parent voice sample via TTS `POST /voices`, choose engine=chatterbox in settings).
5. Multi-character scenes: only the FIRST character is the image reference; others ride on identity prompts. Qwen-Edit-Plus's `image2`/`image3` inputs or `ImageStitch` are the upgrade paths.
6. Nothing is committed to git yet this session (user was asked to commit historically; the whole overhaul sits in the working tree — **commit early next session**).
7. `styles.negative_prompt` is stored but unused by workflows (Flux ignores negatives at cfg 1; wire to Qwen if desired).
8. Read-mode completion currently only pauses recognition; a full session summary/analytics (per-word struggle tracking) is a natural next feature.

## 11. House rules / user preferences (from the project owner)

- Delegate implementation to Opus/Sonnet subagents where possible; review their diffs (Fable orchestrated this build).
- UX: steer users hard toward curated presets; custom options tucked behind advanced affordances.
- Image quality > speed: oversized models running slowly on the 16GB card are acceptable.
- Commit only when asked. Do not run `npm run build` next to a live dev server (see §2).
