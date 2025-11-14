/**
 * GeneratorView - UI rendering for Image Generation page
 */

class GeneratorView {
    constructor() {
        this.container = null;
    }

    /**
     * Render the main generator view
     */
    render(container) {
        this.container = container;

        container.innerHTML = `
            <div class="generator-page">
                <div class="generator-header">
                    <h1>Character & Image Generator</h1>
                    <p class="subtitle">Generate consistent character sheets from images using ComfyUI workflows</p>
                </div>

                <!-- Settings Panel -->
                <div class="settings-panel">
                    <h2>ComfyUI Server Settings</h2>
                    <div class="server-config">
                        <div class="input-group">
                            <label for="comfyui-url">Server URL:</label>
                            <input
                                type="text"
                                id="comfyui-url"
                                placeholder="http://127.0.0.1:8188"
                                value="${comfyUIService.getServerUrl()}"
                            />
                            <button id="test-connection-btn" class="btn-secondary">Test Connection</button>
                        </div>
                        <div id="connection-status" class="status-message"></div>
                    </div>
                </div>

                <!-- Main Content Area -->
                <div class="generator-content">
                    <!-- Left Panel: Character Management -->
                    <div class="character-panel">
                        <div class="panel-header">
                            <h2>Your Characters</h2>
                            <button id="new-character-btn" class="btn-primary">+ New Character</button>
                        </div>
                        <div id="character-list" class="character-list">
                            <div class="loading">Loading characters...</div>
                        </div>
                    </div>

                    <!-- Right Panel: Generation Workspace -->
                    <div class="workspace-panel">
                        <div id="workspace-content">
                            <!-- Will be populated based on user action -->
                            <div class="workspace-empty">
                                <svg width="100" height="100" viewBox="0 0 100 100" fill="none">
                                    <circle cx="50" cy="50" r="45" stroke="#ccc" stroke-width="2"/>
                                    <path d="M50 30 L50 70 M30 50 L70 50" stroke="#ccc" stroke-width="2"/>
                                </svg>
                                <p>Select a character or create a new one to get started</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        return container;
    }

    /**
     * Render character list
     */
    renderCharacterList(characters) {
        const listElement = this.container.querySelector('#character-list');

        if (characters.length === 0) {
            listElement.innerHTML = `
                <div class="empty-state">
                    <p>No characters yet. Create your first character to get started!</p>
                </div>
            `;
            return;
        }

        listElement.innerHTML = characters.map(char => `
            <div class="character-card" data-character-id="${char.id}">
                <div class="character-thumbnail">
                    ${char.metadata.primaryImage
                        ? `<img id="char-thumb-${char.id}" src="" alt="${char.name}" />`
                        : `<div class="placeholder-thumb">${char.name.charAt(0).toUpperCase()}</div>`
                    }
                </div>
                <div class="character-info">
                    <h3>${char.name}</h3>
                    <p class="character-stats">
                        ${char.metadata.totalImages || 0} images •
                        ${char.books.length} books
                    </p>
                    <div class="character-tags">
                        ${char.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
                    </div>
                </div>
                <div class="character-actions">
                    <button class="btn-icon generate-btn" data-character-id="${char.id}" title="Generate Images">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10 3v14m7-7H3"/>
                        </svg>
                    </button>
                    <button class="btn-icon edit-btn" data-character-id="${char.id}" title="Edit Character">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
                        </svg>
                    </button>
                    <button class="btn-icon delete-btn" data-character-id="${char.id}" title="Delete Character">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');
    }

    /**
     * Render new character form
     */
    renderNewCharacterForm() {
        const workspace = this.container.querySelector('#workspace-content');
        workspace.innerHTML = `
            <div class="form-container">
                <h2>Create New Character</h2>
                <form id="new-character-form">
                    <div class="form-group">
                        <label for="char-name">Character Name *</label>
                        <input type="text" id="char-name" required placeholder="e.g., Captain Whiskers" />
                    </div>

                    <div class="form-group">
                        <label for="char-description">Description</label>
                        <textarea
                            id="char-description"
                            rows="3"
                            placeholder="Describe your character's appearance, personality, etc."
                        ></textarea>
                    </div>

                    <div class="form-group">
                        <label for="char-tags">Tags (comma-separated)</label>
                        <input type="text" id="char-tags" placeholder="e.g., hero, cat, adventure" />
                    </div>

                    <div class="form-group">
                        <label for="char-art-style">Art Style</label>
                        <select id="char-art-style">
                            <option value="children_book">Children's Book</option>
                            <option value="bold_cartoon">Bold Cartoon</option>
                            <option value="ghibli">Studio Ghibli</option>
                            <option value="realistic">Realistic</option>
                        </select>
                    </div>

                    <div class="form-actions">
                        <button type="submit" class="btn-primary">Create Character</button>
                        <button type="button" id="cancel-form-btn" class="btn-secondary">Cancel</button>
                    </div>
                </form>
            </div>
        `;
    }

    /**
     * Render generation workspace for a character
     */
    renderGenerationWorkspace(character) {
        const workspace = this.container.querySelector('#workspace-content');
        workspace.innerHTML = `
            <div class="generation-workspace">
                <div class="workspace-header">
                    <h2>${character.name}</h2>
                    <p>${character.description || 'No description'}</p>
                </div>

                <!-- Image Upload Section -->
                <div class="upload-section">
                    <h3>Input Image</h3>
                    <div class="image-upload-area" id="image-upload-area">
                        <input type="file" id="input-image" accept="image/*" hidden />
                        <label for="input-image" class="upload-label">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="17 8 12 3 7 8"/>
                                <line x1="12" y1="3" x2="12" y2="15"/>
                            </svg>
                            <span>Click to upload image or drag and drop</span>
                            <span class="upload-hint">PNG, JPG up to 10MB</span>
                        </label>
                        <div id="image-preview" class="image-preview hidden">
                            <img id="preview-img" src="" alt="Preview" />
                            <button id="remove-image-btn" class="btn-icon-small">✕</button>
                        </div>
                    </div>
                </div>

                <!-- Workflow Selection -->
                <div class="workflow-section">
                    <h3>Generation Workflow</h3>
                    <div class="workflow-options">
                        <label class="workflow-option">
                            <input type="radio" name="workflow" value="character_sheet" checked />
                            <div class="option-content">
                                <strong>Character Sheet</strong>
                                <p>Generate multiple expressions and poses</p>
                            </div>
                        </label>
                        <label class="workflow-option">
                            <input type="radio" name="workflow" value="upscale" />
                            <div class="option-content">
                                <strong>Upscale & Enhance</strong>
                                <p>Improve image quality and resolution</p>
                            </div>
                        </label>
                        <label class="workflow-option">
                            <input type="radio" name="workflow" value="custom" />
                            <div class="option-content">
                                <strong>Custom Workflow</strong>
                                <p>Load your own ComfyUI workflow JSON</p>
                            </div>
                        </label>
                    </div>
                    <div id="custom-workflow-upload" class="hidden">
                        <input type="file" id="workflow-file" accept=".json" />
                    </div>
                </div>

                <!-- Parameters Section -->
                <div class="parameters-section">
                    <h3>Generation Parameters</h3>
                    <div id="workflow-parameters" class="parameters-grid">
                        <!-- Will be populated based on workflow selection -->
                    </div>
                </div>

                <!-- Action Buttons -->
                <div class="generation-actions">
                    <button id="generate-btn" class="btn-primary btn-large" disabled>
                        Generate Images
                    </button>
                </div>

                <!-- Progress Section -->
                <div id="generation-progress" class="progress-section hidden">
                    <div class="progress-bar">
                        <div class="progress-fill" id="progress-fill"></div>
                    </div>
                    <p class="progress-text" id="progress-text">Preparing...</p>
                </div>

                <!-- Results Section -->
                <div id="generation-results" class="results-section hidden">
                    <h3>Generated Images</h3>
                    <div id="results-grid" class="results-grid">
                        <!-- Generated images will appear here -->
                    </div>
                </div>

                <!-- Character Images Gallery -->
                <div class="gallery-section">
                    <h3>Character Image Gallery</h3>
                    <div id="character-gallery" class="image-gallery">
                        <div class="loading">Loading images...</div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render default parameters for character sheet workflow
     */
    renderDefaultParameters() {
        const paramsContainer = this.container.querySelector('#workflow-parameters');
        paramsContainer.innerHTML = `
            <div class="param-group">
                <label for="param-seed">Seed</label>
                <input type="number" id="param-seed" value="${Math.floor(Math.random() * 1000000)}" />
            </div>
            <div class="param-group">
                <label for="param-steps">Steps</label>
                <input type="number" id="param-steps" value="20" min="1" max="150" />
            </div>
            <div class="param-group">
                <label for="param-cfg">CFG Scale</label>
                <input type="number" id="param-cfg" value="7" min="0" max="30" step="0.1" />
            </div>
            <div class="param-group">
                <label for="param-denoise">Denoise</label>
                <input type="number" id="param-denoise" value="0.75" min="0" max="1" step="0.05" />
            </div>
        `;
    }

    /**
     * Update progress bar
     */
    updateProgress(progress, text) {
        const progressSection = this.container.querySelector('#generation-progress');
        const progressFill = this.container.querySelector('#progress-fill');
        const progressText = this.container.querySelector('#progress-text');

        progressSection.classList.remove('hidden');
        progressFill.style.width = `${progress}%`;
        progressText.textContent = text;
    }

    /**
     * Hide progress bar
     */
    hideProgress() {
        const progressSection = this.container.querySelector('#generation-progress');
        progressSection.classList.add('hidden');
    }

    /**
     * Display generated images
     */
    displayResults(images) {
        const resultsSection = this.container.querySelector('#generation-results');
        const resultsGrid = this.container.querySelector('#results-grid');

        resultsSection.classList.remove('hidden');
        resultsGrid.innerHTML = images.map((img, index) => `
            <div class="result-image">
                <img src="${URL.createObjectURL(img.blob)}" alt="Generated ${index + 1}" />
                <div class="result-actions">
                    <button class="btn-secondary save-image-btn" data-index="${index}">
                        Save to Character
                    </button>
                    <button class="btn-secondary download-image-btn" data-index="${index}">
                        Download
                    </button>
                </div>
            </div>
        `).join('');
    }

    /**
     * Render character image gallery
     */
    async renderCharacterGallery(characterId) {
        const gallery = this.container.querySelector('#character-gallery');

        try {
            const images = await characterManager.getCharacterImages(characterId);

            if (images.length === 0) {
                gallery.innerHTML = `
                    <div class="empty-state">
                        <p>No images yet. Generate some images to populate the gallery!</p>
                    </div>
                `;
                return;
            }

            gallery.innerHTML = images.map((img, index) => {
                const url = URL.createObjectURL(img.blob);
                return `
                    <div class="gallery-image" data-image-id="${img.id}">
                        <img src="${url}" alt="${img.variant || 'Character image'}" />
                        <div class="image-info">
                            <span class="variant-badge">${img.variant || 'default'}</span>
                            <button class="btn-icon-small set-primary-btn" data-image-id="${img.id}" title="Set as primary">
                                ⭐
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (error) {
            gallery.innerHTML = `
                <div class="error-state">
                    <p>Error loading gallery: ${error.message}</p>
                </div>
            `;
        }
    }

    /**
     * Show connection status
     */
    showConnectionStatus(status, message, isError = false) {
        const statusElement = this.container.querySelector('#connection-status');
        statusElement.className = `status-message ${isError ? 'error' : 'success'}`;
        statusElement.textContent = message;
    }

    /**
     * Show error message
     */
    showError(message) {
        const workspace = this.container.querySelector('#workspace-content');
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-banner';
        errorDiv.innerHTML = `
            <strong>Error:</strong> ${message}
            <button class="close-btn">✕</button>
        `;
        workspace.insertBefore(errorDiv, workspace.firstChild);

        errorDiv.querySelector('.close-btn').addEventListener('click', () => {
            errorDiv.remove();
        });

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.remove();
            }
        }, 5000);
    }

    /**
     * Show success message
     */
    showSuccess(message) {
        const workspace = this.container.querySelector('#workspace-content');
        const successDiv = document.createElement('div');
        successDiv.className = 'success-banner';
        successDiv.innerHTML = `
            ${message}
            <button class="close-btn">✕</button>
        `;
        workspace.insertBefore(successDiv, workspace.firstChild);

        successDiv.querySelector('.close-btn').addEventListener('click', () => {
            successDiv.remove();
        });

        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.remove();
            }
        }, 3000);
    }
}
