# Pique ComfyUI Workflows — Complete Reference

Everything in this folder is **ComfyUI API-format JSON** (a dict of `node_id → {class_type, inputs, _meta.title}`), runnable via `POST /prompt`. This document explains every workflow, the parameterization contract, the models involved, VRAM behavior on the RTX 5070 Ti (16GB), and how to compare workflows with the bench harness.

---

## 1. The parameterization contract (sentinel titles)

Code never patches workflows by node id — ids change when a workflow is re-exported. Instead, nodes are found by **`_meta.title` sentinels** and by class:

| Sentinel | What gets patched | Handled keys |
|---|---|---|
| title starts with `PROMPT` | the positive prompt text | `text` (CLIPTextEncode), `string` (StringConstantMultiline), `prompt` (TextEncodeQwenImageEdit/Plus) |
| any node with a **literal** `seed`/`noise_seed` input | the seed | `seed`, `noise_seed` (node-link values `["123",0]` are left alone) |
| every `LoadImage` node | the uploaded input image filename | `image` |
| title `SIZE` (convention only) | output resolution | edit manually / not auto-patched |

Two implementations exist and must be kept in sync if the contract changes:
- `backend/app/services/comfy_client.py :: patch_workflow` (used by the app; as of M4 it handles `text`/`string`; if you point the app at a Qwen-Edit workflow, add `prompt` to its key list)
- `scripts/workflow_bench.py :: patch` (already handles all three keys)

**Negative prompts** are intentionally NOT parameterized: Flux runs at `cfg 1.0` where the negative is ignored (Kontext uses `ConditioningZeroOut`), and Qwen uses an empty negative at `cfg 2.5`. Style `negative_prompt` from the DB is currently unused — wire it to the Qwen negative encoder if wanted.

## 2. Model inventory (all under Comfy Desktop's shared models dir)

`C:\Users\danie\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models\`

| File | Folder | Size | Used by |
|---|---|---|---|
| `flux\flux1-dev-fp8.safetensors` | checkpoints | 17.2 GB | base txt2img, USO sheet/scene (all-in-one: unet+clip+vae) |
| `uso-flux1-dit-lora-v1.safetensors` | loras | 478 MB | USO workflows (identity adapter LoRA) |
| `uso-flux1-projector-v1.safetensors` | model_patches | 21 MB | USO workflows (SigCLIP→DiT projector) |
| `sigclip_vision_patch14_384.safetensors` | clip_vision | 856 MB | USO workflows (subject encoder) |
| `flux1-dev-kontext_fp8_scaled.safetensors` | diffusion_models | ~12 GB | Kontext workflows |
| `clip_l.safetensors` + `t5xxl_fp8_e4m3fn_scaled.safetensors` | text_encoders | 0.25 + ~5 GB | Kontext (DualCLIPLoader type=flux) |
| `ae.safetensors` | vae | 335 MB | Kontext (Flux VAE) |
| `qwen_image_fp8_e4m3fn.safetensors` | diffusion_models | ~20 GB | Qwen txt2img |
| `qwen_image_edit_2509_fp8_e4m3fn.safetensors` | diffusion_models | ~20 GB | Qwen-Edit scene |
| `qwen_2.5_vl_7b_fp8_scaled.safetensors` | text_encoders | ~9 GB | all Qwen workflows (CLIPLoader type=qwen_image) |
| `qwen_image_vae.safetensors` | vae | ~250 MB | all Qwen workflows |
| `Qwen-Image-Lightning-4steps-V1.0-bf16.safetensors` | loras | ~1.7 GB | Qwen Lightning variant |
| `4x-UltraSharp.pth` | upscale_models | 67 MB | hi-res USO sheet |

ComfyUI's model-file enums refresh automatically after files land; if a new file doesn't appear, restart ComfyUI from the Comfy Desktop app.

## 3. Workflow catalog

### Production (used by the backend — names configured in `backend/app/config.py`)

**`base_flux_txt2img.json`** (8 nodes) — Flux fp8 checkpoint txt2img, 1024², 20 steps euler/simple, FluxGuidance 3.5, cfg 1.0. Used by the character studio's text path ("Draw my character"), ~30 s warm. Settings key: `base_workflow`.

**`character_sheet_uso.json`** (17 nodes) — the current default sheet generator. Chain: `CheckpointLoaderSimple(flux fp8)` → `LoraLoaderModelOnly(USO DiT LoRA)` → `USOStyleReference(model_patch=USO projector, clip_vision_output=CLIPVisionEncode(SigCLIP, ref image))` producing the patched model; prompt conditioning additionally passes through `ReferenceLatent(VAEEncode(ImageScaleToTotalPixels(ref, 0.26MP)))`; 1536×1024 canvas, 20 steps. Settings key: `sheet_workflow`. ~50 s warm.
*Known behaviors*: the reference image tends to be re-rendered somewhere on the canvas (that's `ReferenceLatent` at work — harmless, croppable); back views are weak; **identity drift is noticeable** (this motivated the advanced set below). Clean, light-background references work dramatically better than dark/busy ones.

**`scene_uso_flux.json`** (17 nodes) — identical graph to the sheet at 1024², scene-oriented default prompt, `pique_scene` output prefix. Used by wizard page-image jobs. Prompt composed by the backend as: `style.master_prompt + all characters' identity_prompts + page.image_prompt`; ref = primary character's `ref_image_path`.

**`character_sheet_ccc.json`** (191 nodes) — the original Mickmumpitz "Consistent Character Creator" template, kept for reference. **DOES NOT RUN on this machine**: needs 6 custom-node packs (KJNodes, ComfyUI-GGUF, Florence2, controlnet_aux, Impact-Pack, AdvancedLivePortrait) and Qwen-Image GGUF + aux models that are not installed. To revive it: install those packs via ComfyUI Manager, download its models, set `PIQUE_SHEET_WORKFLOW=character_sheet_ccc`. Its prompt node is `515` (`StringConstantMultiline`, title starting `PROMPT`), input images patch via LoadImage like everything else.

### Advanced / experimental (`adv_*` — compare with the bench harness, promote by changing config)

**`adv_kontext_scene.json`** — **FLUX.1 Kontext dev** — **PROMOTED to the production scene workflow on 2026-07-19** (config default `scene_workflow`), after the bench showed far better identity retention and composition than USO with no ref-duplication artifact (~35 s/scene warm on the 5070 Ti, much faster than feared). Kontext is an *editing* model: the reference image is VAE-encoded (after `FluxKontextImageScale` normalizes to its preferred ~1MP resolutions) and used BOTH as `ReferenceLatent` conditioning and as the sampler's starting latent (`denoise 1.0`); the prompt is an instruction ("Place this exact character in …"). Guidance 2.5, 20 steps, negative = `ConditioningZeroOut`. **Output size = (normalized) reference size** — a square ref crop yields a square scene. Identity retention is typically far better than USO. fp8 ~12GB weights + T5 → expect moderate offloading, ~1–3 min/image.
*Prompting tips*: imperative instructions work best; state what must stay the same ("keeping the character exactly the same") and what changes (setting, pose, action). Avoid re-describing the character's appearance in detail — that fights the reference.

**`adv_kontext_sheet.json`** — Kontext with a 1536×1024 empty canvas as the sampler latent (instead of edit-in-place) + a turnaround-sheet instruction prompt, 24 steps. This trades some Kontext edit-faithfulness for a proper wide sheet layout. If identity suffers vs. the scene variant, switch `latent_image` on the KSampler back to node `6` (encoded ref) and accept ref-sized output.

**`adv_qwen_txt2img.json`** — **Qwen-Image 20B** (fp8), the "bigger model" for from-scratch generation: `UNETLoader` → `ModelSamplingAuraFlow(shift 3.1)`, `CLIPLoader(type=qwen_image)` with Qwen2.5-VL 7B as text encoder, 1328² native resolution, 20 steps, **cfg 2.5 with a real (empty) negative**. Exceptional prompt adherence and layout control; renders legible text if asked. 20GB weights + 9GB encoder on 16GB VRAM → heavy offloading; **expect several minutes per image**. No identity reference — use for base characters, covers, style exploration.

**`adv_qwen_txt2img_lightning.json`** — same + Lightning 4-step LoRA (`cfg 1.0`, 4 steps). **PROMOTED to the production base-image workflow on 2026-07-19** (config default `base_workflow`): ~22 s/image on the 5070 Ti with clearly better storybook quality than Flux txt2img. The full 20-step variant (~80 s) is marginally cleaner if wanted.

**`adv_qwen_edit_scene.json`** — **Qwen-Image-Edit-2509 20B**: subject-preserving editing via `TextEncodeQwenImageEditPlus` (the encoder consumes the reference image(s) directly along with the prompt + VAE; supports up to `image1..image3` — a second character's ref could go in `image2` for two-character scenes, wire it in if needed). Sampler starts from the encoded reference, denoise 1.0, cfg 2.5, 20 steps. **Benched 2026-07-19: excellent** — the most expressive/dynamic result of the whole suite (Pip splash test), perfect identity, ~94 s warm on the 5070 Ti vs Kontext's ~35 s. Kontext remains the scene default on speed; switch with `PIQUE_SCENE_WORKFLOW=adv_qwen_edit_scene` if its look wins for you (prompt phrasing "Show this exact character …, keeping the character identical" — the backend's editing-model prompt path already matches on `qwen_edit` in the workflow name).

**`adv_uso_hires_sheet.json`** — the current USO sheet at 28 steps + `4x-UltraSharp` model upscale + 0.5× lanczos downscale (net 2×, crisper lines). Same identity behavior as the base USO sheet, better pixel quality. Cheap upgrade if USO stays the default.

## 4. VRAM reality on the RTX 5070 Ti (16 GB)

- ComfyUI (Comfy Desktop) auto-offloads weights to system RAM when VRAM is short — big models RUN but slow down. The 20B Qwen models offload heavily: first generation includes minutes of model load; subsequent same-model runs are much faster. Switching between model families (Flux ↔ Kontext ↔ Qwen) evicts/reloads — the app and the bench call `POST /free {"unload_models":true,"free_memory":true}` between families on purpose.
- Ollama competes for the same VRAM. The backend's GPU coordinator evicts Ollama (`keep_alive: 0`) before ComfyUI phases and frees ComfyUI before LLM/TTS phases. The bench harness also evicts Ollama at start.
- The TTS service (Kokoro ~0.5GB, Chatterbox ~3GB, MMS aligner ~1GB) lazy-loads and exposes `POST /unload`.

## 5. Bench harness — comparing workflows

```powershell
# From repo root. ComfyUI must be running. Long timeout is intentional (offloaded 20B models).
backend\.venv\Scripts\python scripts\workflow_bench.py --all `
  --prompt "a small cheerful orange fox wearing a blue scarf, soft watercolor children's book illustration" `
  --ref data\media\characters\2\ref.png --seeds 7,42

# Just the two subject-editing contenders:
backend\.venv\Scripts\python scripts\workflow_bench.py `
  --workflows adv_kontext_scene,adv_qwen_edit_scene `
  --prompt "Place this exact character on a pirate ship deck at sunset, storybook illustration" `
  --ref data\media\characters\2\ref.png --seeds 7
```

Output: `data/bench/<timestamp>/index.html` — a grid of workflow × seed with per-run timings; `manifest.json` holds the raw data. Workflows with a `LoadImage` node are skipped (and marked) if `--ref` is missing. Runs are sequential with VRAM frees between workflows.

**Promoting a winner**: set `PIQUE_SHEET_WORKFLOW=<name>` / `PIQUE_BASE_WORKFLOW=<name>` env vars (or edit `backend/app/config.py` defaults; a scene workflow config key `scene_workflow` may need adding if you promote a scene workflow — as of M4 the scene job hardcodes `scene_uso_flux`, check `backend/app/routers/books.py`). If you promote a **Qwen-Edit** workflow into the app, first extend `comfy_client.patch_workflow` to also set the `prompt` input key (see §1).

## 6. Adding a new workflow

1. Build it in the ComfyUI UI, or write API JSON directly.
2. If building in the UI: enable dev mode → "Save (API format)". Titles are preserved.
3. Retitle the parameter nodes: positive prompt node → `PROMPT`, keep seeds literal, canvas node → `SIZE` (convention).
4. Validate against the live server: every `class_type` must exist in `GET /object_info`, and every model filename must appear in the corresponding loader's enum (the backend runs this check before jobs; the bench surfaces queue-time 400s with the missing node/model name).
5. Drop the file in `workflows/`, run it through the bench, compare, promote via config.

## 7. Known limitations & ideas not yet built

- **Multi-character scenes**: USO/Kontext workflows take ONE reference. Qwen-Edit-Plus natively accepts `image2`/`image3` (unwired). Alternative approach: `ImageStitch` the two ref crops side-by-side into one reference image — works surprisingly well with Kontext ("the two characters shown in the reference").
- **Face restoration / detailer**: needs Impact-Pack custom nodes (not installed) — the biggest missing piece vs. the Mickmumpitz pipeline.
- **True fixed-pose sheets**: DWPose/ControlNet conditioning (controlnet_aux pack + a Flux pose ControlNet) would give deterministic 3-view layouts instead of prompt-begged ones.
- **Style transfer onto photos**: Kontext with instruction "redraw this photo as a <style> illustration, same person" is an excellent first step for the photo path — try it in the bench against the USO sheet with a real photo.
