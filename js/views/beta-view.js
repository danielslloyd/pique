/**
 * BetaView - UI for the experimental "Beta" character workflow.
 *
 * Three modes share the same container:
 *   - 'library': list of saved characters + buttons to create / use
 *   - 'create':  upload 2-3 references, pick style, generate, approve+save
 *   - 'use':     prompt + pick saved character, generate scene
 */

class BetaView {
    constructor() {
        this.container = null;
    }

    render(container) {
        this.container = container;
        const apiKey = (window.betaCharacterService && betaCharacterService.getApiKey()) || '';
        const masked = apiKey ? this.maskKey(apiKey) : '';

        container.innerHTML = `
            <div class="beta-page">
                <div class="beta-header">
                    <button class="beta-back-btn" id="beta-back-btn">← Back to Library</button>
                    <div class="beta-title-block">
                        <h1>Character Studio <span class="beta-tag">BETA</span></h1>
                        <p class="subtitle">Build a reusable character from photo references, then prompt new scenes by name.</p>
                    </div>
                </div>

                <div class="beta-settings">
                    <div class="beta-settings-row">
                        <label for="beta-api-key">OpenAI API Key</label>
                        <input
                            type="password"
                            id="beta-api-key"
                            placeholder="${masked || 'sk-...'}"
                            autocomplete="off"
                        />
                        <button id="beta-save-key-btn" class="btn-secondary">Save</button>
                        <button id="beta-test-key-btn" class="btn-secondary">Test</button>
                        <span id="beta-key-status" class="beta-key-status">${apiKey ? 'Key on file' : 'No key set'}</span>
                    </div>
                    <p class="beta-settings-hint">Stored locally in your browser only. Uses the <code>gpt-image-1</code> model with multi-image references.</p>
                </div>

                <div class="beta-tabs">
                    <button class="beta-tab-btn active" data-mode="library">Characters</button>
                    <button class="beta-tab-btn" data-mode="create">+ Create New</button>
                    <button class="beta-tab-btn" data-mode="use">Use Character</button>
                </div>

                <div id="beta-content" class="beta-content"></div>
            </div>
        `;
        return container;
    }

    maskKey(key) {
        if (!key || key.length < 10) return '••••••';
        return key.slice(0, 5) + '••••••' + key.slice(-4);
    }

    setActiveTab(mode) {
        const tabs = this.container.querySelectorAll('.beta-tab-btn');
        tabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    }

    /* ---------------- Library mode ---------------- */

    renderLibrary(characters) {
        const content = this.container.querySelector('#beta-content');
        if (!characters || characters.length === 0) {
            content.innerHTML = `
                <div class="beta-empty">
                    <h2>No characters yet</h2>
                    <p>Create your first character from a few reference photos.</p>
                    <button class="btn-primary" id="beta-empty-create-btn">+ Create Character</button>
                </div>
            `;
            return;
        }

        const cards = characters.map(c => {
            const sheetUrl = c.sheet ? URL.createObjectURL(c.sheet) : '';
            return `
                <div class="beta-card" data-id="${c.id}">
                    <div class="beta-card-thumb">
                        ${sheetUrl
                            ? `<img src="${sheetUrl}" alt="${this.escape(c.name)}" />`
                            : `<div class="beta-card-placeholder">?</div>`}
                    </div>
                    <div class="beta-card-body">
                        <h3>${this.escape(c.name)}</h3>
                        <p class="beta-card-style">${this.escape(c.style || '')}</p>
                        ${c.description ? `<p class="beta-card-desc">${this.escape(c.description)}</p>` : ''}
                    </div>
                    <div class="beta-card-actions">
                        <button class="btn-secondary beta-use-btn" data-id="${c.id}">Use</button>
                        <button class="btn-secondary beta-delete-btn" data-id="${c.id}">Delete</button>
                    </div>
                </div>
            `;
        }).join('');

        content.innerHTML = `<div class="beta-grid">${cards}</div>`;
    }

    /* ---------------- Create mode ---------------- */

    renderCreate() {
        const content = this.container.querySelector('#beta-content');
        content.innerHTML = `
            <div class="beta-create">
                <div class="beta-create-step">
                    <h2>1. Upload 2-3 reference images</h2>
                    <p class="beta-step-hint">Photos, drawings, or existing renders that show the character. More angles = better consistency.</p>
                    <input type="file" id="beta-ref-input" accept="image/*" multiple hidden />
                    <label for="beta-ref-input" class="beta-upload-area" id="beta-upload-area">
                        <div class="beta-upload-icon">+</div>
                        <span>Click to add images (up to 4)</span>
                    </label>
                    <div id="beta-ref-previews" class="beta-ref-previews"></div>
                </div>

                <div class="beta-create-step">
                    <h2>2. Pick a style</h2>
                    <select id="beta-style-select" class="beta-select">
                        <option value="children_book">Children's Book</option>
                        <option value="bold_cartoon">Bold Cartoon</option>
                        <option value="ghibli">Studio Ghibli</option>
                        <option value="anime">Anime</option>
                        <option value="pixar">Pixar 3D</option>
                        <option value="realistic">Realistic Illustration</option>
                        <option value="watercolor">Watercolor</option>
                        <option value="comic">Comic Book</option>
                    </select>
                    <label for="beta-extra-notes" class="beta-label-mt">Optional notes (clothing, age, vibe…)</label>
                    <textarea id="beta-extra-notes" rows="2" placeholder="e.g. wearing a red raincoat, around 8 years old"></textarea>
                </div>

                <div class="beta-create-step">
                    <h2>3. Generate character sheet</h2>
                    <p class="beta-step-hint">A T-pose and a headshot of the same character on a white background.</p>
                    <button id="beta-generate-btn" class="btn-primary btn-large">Generate Character Sheet</button>
                    <div id="beta-generate-status" class="beta-status"></div>
                </div>

                <div id="beta-result-block" class="beta-create-step beta-result-block hidden">
                    <h2>4. Review & save</h2>
                    <div id="beta-result-preview" class="beta-result-preview"></div>
                    <div class="beta-result-actions">
                        <div class="beta-form-group">
                            <label for="beta-char-name">Character name</label>
                            <input type="text" id="beta-char-name" placeholder="e.g. Captain Whiskers" />
                        </div>
                        <div class="beta-form-group">
                            <label for="beta-char-desc">Short description (optional)</label>
                            <input type="text" id="beta-char-desc" placeholder="e.g. brave gray tabby in a red cape" />
                        </div>
                        <div class="beta-result-buttons">
                            <button id="beta-save-btn" class="btn-primary">Save Character</button>
                            <button id="beta-regen-btn" class="btn-secondary">Regenerate</button>
                            <button id="beta-discard-btn" class="btn-secondary">Discard</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderReferencePreviews(files) {
        const container = this.container.querySelector('#beta-ref-previews');
        if (!container) return;
        if (!files || files.length === 0) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = files.map((file, idx) => {
            const url = URL.createObjectURL(file);
            return `
                <div class="beta-ref-thumb" data-idx="${idx}">
                    <img src="${url}" alt="reference ${idx + 1}" />
                    <button class="beta-ref-remove" data-idx="${idx}" title="Remove">✕</button>
                </div>
            `;
        }).join('');
    }

    showResultPreview(blob) {
        const block = this.container.querySelector('#beta-result-block');
        const preview = this.container.querySelector('#beta-result-preview');
        block.classList.remove('hidden');
        const url = URL.createObjectURL(blob);
        preview.innerHTML = `<img src="${url}" alt="Generated character sheet" />`;
        block.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    hideResultPreview() {
        const block = this.container.querySelector('#beta-result-block');
        if (block) {
            block.classList.add('hidden');
            const preview = this.container.querySelector('#beta-result-preview');
            if (preview) preview.innerHTML = '';
        }
    }

    setGenerateStatus(message, type = 'info') {
        const el = this.container.querySelector('#beta-generate-status');
        if (!el) return;
        el.textContent = message || '';
        el.className = `beta-status ${type}`;
    }

    /* ---------------- Use mode ---------------- */

    renderUse(characters, selectedId = null) {
        const content = this.container.querySelector('#beta-content');
        if (!characters || characters.length === 0) {
            content.innerHTML = `
                <div class="beta-empty">
                    <h2>No characters to use</h2>
                    <p>Create a character first, then come back to prompt scenes with it.</p>
                    <button class="btn-primary" id="beta-empty-create-btn">+ Create Character</button>
                </div>
            `;
            return;
        }

        const options = characters.map(c => `
            <option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${this.escape(c.name)}</option>
        `).join('');

        content.innerHTML = `
            <div class="beta-use">
                <div class="beta-use-left">
                    <div class="beta-form-group">
                        <label for="beta-use-char">Character</label>
                        <select id="beta-use-char" class="beta-select">${options}</select>
                    </div>

                    <div id="beta-use-character-card" class="beta-use-character-card"></div>

                    <div class="beta-form-group">
                        <label for="beta-use-prompt">
                            Prompt
                            <span class="beta-prompt-hint">— reference the character by name or use <code>@name</code></span>
                        </label>
                        <textarea
                            id="beta-use-prompt"
                            rows="5"
                            placeholder="e.g. @Whiskers exploring a glowing mushroom forest at dusk, wide cinematic shot"
                        ></textarea>
                    </div>

                    <div class="beta-form-group">
                        <label for="beta-use-style">Style</label>
                        <select id="beta-use-style" class="beta-select">
                            <option value="children_book">Children's Book</option>
                            <option value="bold_cartoon">Bold Cartoon</option>
                            <option value="ghibli">Studio Ghibli</option>
                            <option value="anime">Anime</option>
                            <option value="pixar">Pixar 3D</option>
                            <option value="realistic">Realistic Illustration</option>
                            <option value="watercolor">Watercolor</option>
                            <option value="comic">Comic Book</option>
                        </select>
                    </div>

                    <button id="beta-use-generate-btn" class="btn-primary btn-large">Generate Image</button>
                    <div id="beta-use-status" class="beta-status"></div>
                </div>

                <div class="beta-use-right">
                    <h3>Result</h3>
                    <div id="beta-use-result" class="beta-use-result">
                        <div class="beta-use-placeholder">Your generated image will appear here.</div>
                    </div>
                </div>
            </div>
        `;
    }

    renderUseCharacterCard(character) {
        const card = this.container.querySelector('#beta-use-character-card');
        if (!card) return;
        if (!character) {
            card.innerHTML = '';
            return;
        }
        const sheetUrl = character.sheet ? URL.createObjectURL(character.sheet) : '';
        card.innerHTML = `
            <div class="beta-use-card-thumb">
                ${sheetUrl ? `<img src="${sheetUrl}" alt="${this.escape(character.name)}" />` : ''}
            </div>
            <div class="beta-use-card-info">
                <strong>${this.escape(character.name)}</strong>
                <span class="beta-use-card-style">${this.escape(character.style || '')}</span>
                ${character.description ? `<p>${this.escape(character.description)}</p>` : ''}
            </div>
        `;
    }

    showUseStatus(message, type = 'info') {
        const el = this.container.querySelector('#beta-use-status');
        if (!el) return;
        el.textContent = message || '';
        el.className = `beta-status ${type}`;
    }

    showUseResult(blob) {
        const result = this.container.querySelector('#beta-use-result');
        if (!result) return;
        const url = URL.createObjectURL(blob);
        result.innerHTML = `
            <img src="${url}" alt="Generated scene" />
            <a href="${url}" download="pique-scene.png" class="btn-secondary beta-download-btn">Download</a>
        `;
    }

    /* ---------------- helpers ---------------- */

    setKeyStatus(text, type = 'info') {
        const el = this.container.querySelector('#beta-key-status');
        if (!el) return;
        el.textContent = text;
        el.className = `beta-key-status ${type}`;
    }

    escape(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}
