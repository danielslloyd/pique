/**
 * BetaController - drives the experimental Character Studio.
 *
 * Workflow:
 *   1. User uploads 2-3 reference images.
 *   2. User picks a style + optional notes, clicks Generate.
 *   3. We call OpenAI gpt-image-1 (via BetaCharacterService) with all
 *      reference images and a prompt asking for a T-pose + headshot
 *      character sheet on a white background.
 *   4. User reviews the generated sheet, gives the character a name, and
 *      saves it (BetaCharacterStore / IndexedDB).
 *   5. In the "Use" tab, the user can select a saved character, type any
 *      prompt (optionally referencing the character with @name), and we
 *      send the saved character sheet back as a reference image alongside
 *      the prompt to generate a new scene.
 */

class BetaController {
    constructor() {
        this.view = new BetaView();
        this.mode = 'library';
        this.referenceFiles = [];
        this.lastGenerated = null; // { blob, prompt, style }
        this.selectedCharacter = null;
    }

    async init(container) {
        try {
            await betaCharacterStore.init();
            this.view.render(container);
            this.bindGlobalEvents();
            await this.switchMode('library');
        } catch (error) {
            console.error('Beta init error:', error);
            FeedbackManager.show(`Failed to load Beta: ${error.message}`, 'error');
        }
    }

    cleanup() {
        // Nothing persistent to tear down right now.
    }

    bindGlobalEvents() {
        const root = this.view.container;

        root.querySelector('#beta-back-btn').addEventListener('click', () => {
            window.app.returnToLibrary();
        });

        root.querySelectorAll('.beta-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchMode(btn.dataset.mode));
        });

        root.querySelector('#beta-save-key-btn').addEventListener('click', () => this.saveApiKey());
        root.querySelector('#beta-test-key-btn').addEventListener('click', () => this.testApiKey());
        root.querySelector('#beta-api-key').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.saveApiKey();
            }
        });
    }

    saveApiKey() {
        const input = this.view.container.querySelector('#beta-api-key');
        const value = (input.value || '').trim();
        if (!value) {
            this.view.setKeyStatus('Enter a key first', 'error');
            return;
        }
        if (!value.startsWith('sk-')) {
            this.view.setKeyStatus('Should start with "sk-"', 'error');
            return;
        }
        betaCharacterService.setApiKey(value);
        input.value = '';
        input.placeholder = this.view.maskKey(value);
        this.view.setKeyStatus('Saved locally', 'success');
    }

    async testApiKey() {
        try {
            this.view.setKeyStatus('Testing…', 'info');
            await betaCharacterService.testConnection();
            this.view.setKeyStatus('Connection OK', 'success');
        } catch (err) {
            this.view.setKeyStatus(`Failed: ${err.message}`, 'error');
        }
    }

    async switchMode(mode) {
        this.mode = mode;
        this.view.setActiveTab(mode);
        if (mode === 'library') {
            await this.renderLibrary();
        } else if (mode === 'create') {
            this.renderCreate();
        } else if (mode === 'use') {
            await this.renderUse();
        }
    }

    /* ---------------- Library ---------------- */

    async renderLibrary() {
        const characters = await betaCharacterStore.getAllCharacters();
        this.view.renderLibrary(characters);

        const root = this.view.container;
        const emptyCreate = root.querySelector('#beta-empty-create-btn');
        if (emptyCreate) emptyCreate.addEventListener('click', () => this.switchMode('create'));

        root.querySelectorAll('.beta-use-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.pendingUseId = btn.dataset.id;
                this.switchMode('use');
            });
        });

        root.querySelectorAll('.beta-delete-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                const ch = await betaCharacterStore.getCharacter(id);
                if (!ch) return;
                if (!confirm(`Delete character "${ch.name}"? This cannot be undone.`)) return;
                await betaCharacterStore.deleteCharacter(id);
                FeedbackManager.show('Character deleted', 'info');
                await this.renderLibrary();
            });
        });

        root.querySelectorAll('.beta-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                this.pendingUseId = card.dataset.id;
                this.switchMode('use');
            });
        });
    }

    /* ---------------- Create ---------------- */

    renderCreate() {
        this.referenceFiles = [];
        this.lastGenerated = null;
        this.view.renderCreate();
        this.bindCreateEvents();
    }

    bindCreateEvents() {
        const root = this.view.container;

        const fileInput = root.querySelector('#beta-ref-input');
        const uploadArea = root.querySelector('#beta-upload-area');

        fileInput.addEventListener('change', (e) => this.addReferenceFiles(e.target.files));

        ['dragenter', 'dragover'].forEach(evt => {
            uploadArea.addEventListener(evt, (e) => {
                e.preventDefault();
                uploadArea.classList.add('drag-over');
            });
        });
        ['dragleave', 'drop'].forEach(evt => {
            uploadArea.addEventListener(evt, (e) => {
                e.preventDefault();
                uploadArea.classList.remove('drag-over');
            });
        });
        uploadArea.addEventListener('drop', (e) => {
            const files = e.dataTransfer?.files;
            if (files) this.addReferenceFiles(files);
        });

        root.querySelector('#beta-ref-previews').addEventListener('click', (e) => {
            const btn = e.target.closest('.beta-ref-remove');
            if (!btn) return;
            const idx = parseInt(btn.dataset.idx, 10);
            if (!Number.isNaN(idx)) this.removeReferenceFile(idx);
        });

        root.querySelector('#beta-generate-btn').addEventListener('click', () => this.generateSheet());

        root.querySelector('#beta-save-btn').addEventListener('click', () => this.saveCharacter());
        root.querySelector('#beta-regen-btn').addEventListener('click', () => this.generateSheet());
        root.querySelector('#beta-discard-btn').addEventListener('click', () => {
            this.lastGenerated = null;
            this.view.hideResultPreview();
        });
    }

    addReferenceFiles(fileList) {
        const incoming = Array.from(fileList || []);
        for (const file of incoming) {
            if (!file.type.startsWith('image/')) continue;
            if (file.size > 15 * 1024 * 1024) {
                FeedbackManager.show(`${file.name} is over 15MB`, 'error');
                continue;
            }
            if (this.referenceFiles.length >= 4) {
                FeedbackManager.show('Up to 4 references', 'info');
                break;
            }
            this.referenceFiles.push(file);
        }
        this.view.renderReferencePreviews(this.referenceFiles);
    }

    removeReferenceFile(idx) {
        this.referenceFiles.splice(idx, 1);
        this.view.renderReferencePreviews(this.referenceFiles);
    }

    async generateSheet() {
        if (!betaCharacterService.hasApiKey()) {
            this.view.setGenerateStatus('Add your OpenAI API key above first.', 'error');
            return;
        }
        if (this.referenceFiles.length === 0) {
            this.view.setGenerateStatus('Add at least one reference image.', 'error');
            return;
        }

        const root = this.view.container;
        const style = root.querySelector('#beta-style-select').value;
        const notes = root.querySelector('#beta-extra-notes').value;
        const generateBtn = root.querySelector('#beta-generate-btn');

        generateBtn.disabled = true;
        this.view.setGenerateStatus('Generating character sheet… this may take 20-60 seconds.', 'info');

        try {
            const { blob, prompt } = await betaCharacterService.generateCharacterSheet(
                this.referenceFiles,
                style,
                notes
            );
            this.lastGenerated = { blob, prompt, style };
            this.view.showResultPreview(blob);
            this.view.setGenerateStatus('Done! Review below and save.', 'success');
        } catch (err) {
            console.error('Character sheet generation failed:', err);
            this.view.setGenerateStatus(`Generation failed: ${err.message}`, 'error');
        } finally {
            generateBtn.disabled = false;
        }
    }

    async saveCharacter() {
        if (!this.lastGenerated) {
            FeedbackManager.show('Nothing to save yet', 'error');
            return;
        }
        const root = this.view.container;
        const name = root.querySelector('#beta-char-name').value.trim();
        const description = root.querySelector('#beta-char-desc').value.trim();
        if (!name) {
            FeedbackManager.show('Give the character a name first', 'error');
            return;
        }

        const existing = await betaCharacterStore.findByName(name);
        if (existing) {
            if (!confirm(`A character named "${name}" already exists. Overwrite saved sheet?`)) return;
            await betaCharacterStore.deleteCharacter(existing.id);
        }

        try {
            await betaCharacterStore.createCharacter({
                name,
                description,
                style: this.lastGenerated.style,
                sheetBlob: this.lastGenerated.blob,
                sheetPrompt: this.lastGenerated.prompt,
                referenceBlobs: this.referenceFiles.slice()
            });
            FeedbackManager.show(`Saved character "${name}"`, 'success');
            this.lastGenerated = null;
            this.referenceFiles = [];
            await this.switchMode('library');
        } catch (err) {
            console.error('Save failed:', err);
            FeedbackManager.show(`Save failed: ${err.message}`, 'error');
        }
    }

    /* ---------------- Use ---------------- */

    async renderUse() {
        const characters = await betaCharacterStore.getAllCharacters();
        const initialId = this.pendingUseId || (characters[0] && characters[0].id) || null;
        this.pendingUseId = null;
        this.view.renderUse(characters, initialId);

        const root = this.view.container;

        const emptyCreate = root.querySelector('#beta-empty-create-btn');
        if (emptyCreate) {
            emptyCreate.addEventListener('click', () => this.switchMode('create'));
            return;
        }

        const select = root.querySelector('#beta-use-char');
        const refresh = async () => {
            const id = select.value;
            this.selectedCharacter = await betaCharacterStore.getCharacter(id);
            this.view.renderUseCharacterCard(this.selectedCharacter);
        };
        select.addEventListener('change', refresh);
        await refresh();

        root.querySelector('#beta-use-generate-btn').addEventListener('click', () => this.generateScene());
    }

    /**
     * Resolve which character to use for a prompt. If the prompt mentions an
     * @name that matches a saved character, prefer that. Otherwise fall back
     * to the explicitly selected character.
     */
    async resolveCharacterFromPrompt(promptText) {
        if (!promptText) return this.selectedCharacter;
        const match = promptText.match(/@([\w-]+(?:\s+[\w-]+)*)/);
        if (match) {
            const found = await betaCharacterStore.findByName(match[1]);
            if (found) return found;
        }
        return this.selectedCharacter;
    }

    async generateScene() {
        if (!betaCharacterService.hasApiKey()) {
            this.view.showUseStatus('Add your OpenAI API key above first.', 'error');
            return;
        }
        const root = this.view.container;
        const promptText = root.querySelector('#beta-use-prompt').value.trim();
        const style = root.querySelector('#beta-use-style').value;
        const button = root.querySelector('#beta-use-generate-btn');

        if (!promptText) {
            this.view.showUseStatus('Type a prompt first.', 'error');
            return;
        }

        const character = await this.resolveCharacterFromPrompt(promptText);
        if (!character) {
            this.view.showUseStatus('No character selected.', 'error');
            return;
        }

        const referenceBlobs = [character.sheet, ...(character.references || [])].filter(Boolean).slice(0, 4);
        if (referenceBlobs.length === 0) {
            this.view.showUseStatus('That character has no reference images stored.', 'error');
            return;
        }

        button.disabled = true;
        this.view.showUseStatus(`Generating scene with "${character.name}"…`, 'info');

        try {
            const { blob } = await betaCharacterService.generateWithCharacter(
                referenceBlobs,
                promptText,
                character.name,
                style
            );
            this.view.showUseResult(blob);
            this.view.showUseStatus('Done.', 'success');
        } catch (err) {
            console.error('Scene generation failed:', err);
            this.view.showUseStatus(`Generation failed: ${err.message}`, 'error');
        } finally {
            button.disabled = false;
        }
    }
}
