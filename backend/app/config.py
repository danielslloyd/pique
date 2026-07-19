from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PIQUE_", env_file=".env", extra="ignore")

    data_dir: Path = REPO_ROOT / "data"
    comfyui_url: str = "http://127.0.0.1:8188"
    ollama_url: str = "http://127.0.0.1:11434"
    tts_url: str = "http://127.0.0.1:8100"
    story_model: str = "gpt-oss:20b"
    # Workflow template names (files in <repo>/workflows/). The streamlined USO sheet
    # is the default; character_sheet_ccc remains available for installs that have
    # the Mickmumpitz custom-node packs + Qwen models.
    sheet_workflow: str = "character_sheet_uso"
    # Qwen-Image 20B + Lightning LoRA promoted 2026-07-19: ~22s/image and clearly
    # better storybook quality than Flux txt2img. Fallback: PIQUE_BASE_WORKFLOW=base_flux_txt2img
    base_workflow: str = "adv_qwen_txt2img_lightning"
    # Kontext promoted after the 2026-07-19 bench: far better identity retention and
    # composition than USO, no reference-duplication artifact. USO variant kept as
    # fallback: PIQUE_SCENE_WORKFLOW=scene_uso_flux
    scene_workflow: str = "adv_kontext_scene"

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "pique.db"


settings = Settings()
