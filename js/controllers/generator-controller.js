/**
 * GeneratorController - Controls the Image Generator page
 * Manages character creation, image generation workflows, and ComfyUI integration
 */

class GeneratorController {
    constructor() {
        this.view = new GeneratorView();
        this.currentCharacter = null;
        this.currentWorkflow = null;
        this.uploadedImage = null;
        this.generatedImages = [];
    }

    /**
     * Initialize the generator page
     */
    async init(container) {
        try {
            // Initialize character manager
            await characterManager.init();

            // Render view
            this.view.render(container);

            // Load and display characters
            await this.loadCharacters();

            // Setup event listeners
            this.setupEventListeners();

            // Test ComfyUI connection on load
            this.testConnection();
        } catch (error) {
            console.error('Generator initialization error:', error);
            this.view.showError(`Failed to initialize: ${error.message}`);
        }
    }

    /**
     * Setup all event listeners
     */
    setupEventListeners() {
        const container = this.view.container;

        // Server settings
        container.querySelector('#comfyui-url').addEventListener('change', (e) => {
            comfyUIService.setServerUrl(e.target.value);
        });

        container.querySelector('#test-connection-btn').addEventListener('click', () => {
            this.testConnection();
        });

        // New character button
        container.querySelector('#new-character-btn').addEventListener('click', () => {
            this.showNewCharacterForm();
        });

        // Character list actions (using event delegation)
        container.querySelector('#character-list').addEventListener('click', (e) => {
            const generateBtn = e.target.closest('.generate-btn');
            const editBtn = e.target.closest('.edit-btn');
            const deleteBtn = e.target.closest('.delete-btn');
            const characterCard = e.target.closest('.character-card');

            if (generateBtn) {
                const characterId = generateBtn.dataset.characterId;
                this.loadCharacterWorkspace(characterId);
            } else if (editBtn) {
                const characterId = editBtn.dataset.characterId;
                this.editCharacter(characterId);
            } else if (deleteBtn) {
                const characterId = deleteBtn.dataset.characterId;
                this.deleteCharacter(characterId);
            } else if (characterCard) {
                const characterId = characterCard.dataset.characterId;
                this.loadCharacterWorkspace(characterId);
            }
        });
    }

    /**
     * Setup workspace event listeners (called after workspace is rendered)
     */
    setupWorkspaceListeners() {
        const container = this.view.container;

        // New character form
        const newCharForm = container.querySelector('#new-character-form');
        if (newCharForm) {
            newCharForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.createCharacter();
            });

            container.querySelector('#cancel-form-btn')?.addEventListener('click', () => {
                this.view.renderGenerationWorkspace({ name: 'Select a character', description: '' });
            });
        }

        // Image upload
        const inputImage = container.querySelector('#input-image');
        if (inputImage) {
            inputImage.addEventListener('change', (e) => {
                this.handleImageUpload(e.target.files[0]);
            });

            // Drag and drop
            const uploadArea = container.querySelector('#image-upload-area');
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.classList.add('drag-over');
            });

            uploadArea.addEventListener('dragleave', () => {
                uploadArea.classList.remove('drag-over');
            });

            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.classList.remove('drag-over');
                const file = e.dataTransfer.files[0];
                if (file && file.type.startsWith('image/')) {
                    this.handleImageUpload(file);
                }
            });

            // Remove image
            container.querySelector('#remove-image-btn')?.addEventListener('click', () => {
                this.removeUploadedImage();
            });
        }

        // Workflow selection
        const workflowRadios = container.querySelectorAll('input[name="workflow"]');
        workflowRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.handleWorkflowChange(e.target.value);
            });
        });

        // Custom workflow upload
        const workflowFile = container.querySelector('#workflow-file');
        if (workflowFile) {
            workflowFile.addEventListener('change', (e) => {
                this.loadCustomWorkflow(e.target.files[0]);
            });
        }

        // Generate button
        const generateBtn = container.querySelector('#generate-btn');
        if (generateBtn) {
            generateBtn.addEventListener('click', () => {
                this.generateImages();
            });
        }

        // Result actions
        const resultsGrid = container.querySelector('#results-grid');
        if (resultsGrid) {
            resultsGrid.addEventListener('click', (e) => {
                const saveBtn = e.target.closest('.save-image-btn');
                const downloadBtn = e.target.closest('.download-image-btn');

                if (saveBtn) {
                    const index = parseInt(saveBtn.dataset.index);
                    this.saveGeneratedImage(index);
                } else if (downloadBtn) {
                    const index = parseInt(downloadBtn.dataset.index);
                    this.downloadImage(index);
                }
            });
        }

        // Gallery actions
        const gallery = container.querySelector('#character-gallery');
        if (gallery) {
            gallery.addEventListener('click', (e) => {
                const setPrimaryBtn = e.target.closest('.set-primary-btn');
                if (setPrimaryBtn) {
                    const imageId = setPrimaryBtn.dataset.imageId;
                    this.setPrimaryImage(imageId);
                }
            });
        }
    }

    /**
     * Test connection to ComfyUI server
     */
    async testConnection() {
        try {
            this.view.showConnectionStatus('info', 'Testing connection...');
            const result = await comfyUIService.testConnection();

            if (result.success) {
                this.view.showConnectionStatus('success', `✓ Connected to ComfyUI (${result.stats.system.os})`, false);
            } else {
                this.view.showConnectionStatus('error', `✗ ${result.message}`, true);
            }
        } catch (error) {
            this.view.showConnectionStatus('error', `✗ Connection failed: ${error.message}`, true);
        }
    }

    /**
     * Load all characters and display them
     */
    async loadCharacters() {
        try {
            const characters = await characterManager.getAllCharacters();
            this.view.renderCharacterList(characters);

            // Load thumbnail images
            for (const char of characters) {
                if (char.metadata.primaryImage) {
                    const image = await characterManager.getImage(char.metadata.primaryImage);
                    if (image) {
                        const imgElement = document.getElementById(`char-thumb-${char.id}`);
                        if (imgElement) {
                            imgElement.src = URL.createObjectURL(image.blob);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error loading characters:', error);
            this.view.showError(`Failed to load characters: ${error.message}`);
        }
    }

    /**
     * Show new character form
     */
    showNewCharacterForm() {
        this.view.renderNewCharacterForm();
        this.setupWorkspaceListeners();
    }

    /**
     * Create a new character
     */
    async createCharacter() {
        try {
            const name = document.getElementById('char-name').value.trim();
            const description = document.getElementById('char-description').value.trim();
            const tagsInput = document.getElementById('char-tags').value.trim();
            const artStyle = document.getElementById('char-art-style').value;

            if (!name) {
                this.view.showError('Character name is required');
                return;
            }

            const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];

            const characterId = await characterManager.createCharacter({
                name,
                description,
                tags,
                artStyle,
                attributes: {}
            });

            this.view.showSuccess(`Character "${name}" created successfully!`);

            // Reload character list
            await this.loadCharacters();

            // Load the new character's workspace
            this.loadCharacterWorkspace(characterId);
        } catch (error) {
            console.error('Error creating character:', error);
            this.view.showError(`Failed to create character: ${error.message}`);
        }
    }

    /**
     * Load character workspace for generation
     */
    async loadCharacterWorkspace(characterId) {
        try {
            const character = await characterManager.getCharacter(characterId);
            if (!character) {
                throw new Error('Character not found');
            }

            this.currentCharacter = character;
            this.view.renderGenerationWorkspace(character);
            this.view.renderDefaultParameters();
            this.setupWorkspaceListeners();

            // Load character gallery
            await this.view.renderCharacterGallery(characterId);
        } catch (error) {
            console.error('Error loading workspace:', error);
            this.view.showError(`Failed to load workspace: ${error.message}`);
        }
    }

    /**
     * Handle image upload
     */
    handleImageUpload(file) {
        if (!file || !file.type.startsWith('image/')) {
            this.view.showError('Please select a valid image file');
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            this.view.showError('Image size must be less than 10MB');
            return;
        }

        this.uploadedImage = file;

        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => {
            const preview = this.view.container.querySelector('#image-preview');
            const img = this.view.container.querySelector('#preview-img');
            preview.classList.remove('hidden');
            img.src = e.target.result;

            // Enable generate button
            this.view.container.querySelector('#generate-btn').disabled = false;
        };
        reader.readAsDataURL(file);
    }

    /**
     * Remove uploaded image
     */
    removeUploadedImage() {
        this.uploadedImage = null;
        const preview = this.view.container.querySelector('#image-preview');
        preview.classList.add('hidden');
        this.view.container.querySelector('#generate-btn').disabled = true;
    }

    /**
     * Handle workflow type change
     */
    handleWorkflowChange(workflowType) {
        const customUpload = this.view.container.querySelector('#custom-workflow-upload');

        if (workflowType === 'custom') {
            customUpload.classList.remove('hidden');
        } else {
            customUpload.classList.add('hidden');
            this.view.renderDefaultParameters();
        }
    }

    /**
     * Load custom workflow JSON
     */
    async loadCustomWorkflow(file) {
        if (!file) return;

        try {
            const text = await file.text();
            const workflowData = JSON.parse(text);
            this.currentWorkflow = comfyUIService.parseWorkflow(workflowData);

            this.view.showSuccess('Custom workflow loaded successfully');

            // Render workflow parameters
            this.renderWorkflowParameters(this.currentWorkflow);
        } catch (error) {
            console.error('Error loading workflow:', error);
            this.view.showError(`Failed to load workflow: ${error.message}`);
        }
    }

    /**
     * Render workflow parameters dynamically
     */
    renderWorkflowParameters(workflow) {
        const paramsContainer = this.view.container.querySelector('#workflow-parameters');
        const allParams = [];

        // Collect all parameters from workflow
        for (const [nodeId, params] of workflow.metadata.parameters) {
            allParams.push(...params);
        }

        if (allParams.length === 0) {
            paramsContainer.innerHTML = '<p>No configurable parameters found in workflow</p>';
            return;
        }

        paramsContainer.innerHTML = allParams.map(param => {
            const inputId = `param-${param.nodeId}-${param.key}`;

            if (param.type === 'select') {
                return `
                    <div class="param-group">
                        <label for="${inputId}">${param.label}</label>
                        <select id="${inputId}" data-node="${param.nodeId}" data-key="${param.key}">
                            <option value="${param.value}">${param.value}</option>
                        </select>
                    </div>
                `;
            } else if (param.type === 'text') {
                return `
                    <div class="param-group">
                        <label for="${inputId}">${param.label}</label>
                        <textarea
                            id="${inputId}"
                            data-node="${param.nodeId}"
                            data-key="${param.key}"
                            rows="2"
                        >${param.value}</textarea>
                    </div>
                `;
            } else {
                return `
                    <div class="param-group">
                        <label for="${inputId}">${param.label}</label>
                        <input
                            type="number"
                            id="${inputId}"
                            data-node="${param.nodeId}"
                            data-key="${param.key}"
                            value="${param.value}"
                            min="${param.min || ''}"
                            max="${param.max || ''}"
                            step="${param.step || '1'}"
                        />
                    </div>
                `;
            }
        }).join('');
    }

    /**
     * Generate images using selected workflow
     */
    async generateImages() {
        if (!this.uploadedImage) {
            this.view.showError('Please upload an image first');
            return;
        }

        if (!this.currentCharacter) {
            this.view.showError('No character selected');
            return;
        }

        try {
            // Get selected workflow type
            const workflowType = this.view.container.querySelector('input[name="workflow"]:checked').value;

            // Get workflow
            let workflow;
            if (workflowType === 'custom' && this.currentWorkflow) {
                workflow = this.currentWorkflow;
            } else if (workflowType === 'character_sheet') {
                // Load default character sheet workflow
                workflow = await comfyUIService.loadWorkflow('/251007_MICKMUMPITZ_CCC_3-6_ADV_DL.json');
            } else {
                this.view.showError('Please select or load a workflow');
                return;
            }

            // Collect parameters
            const parameters = this.collectParameters();

            // Disable generate button
            const generateBtn = this.view.container.querySelector('#generate-btn');
            generateBtn.disabled = true;

            // Execute workflow
            const result = await comfyUIService.executeWorkflow(
                workflow,
                this.uploadedImage,
                parameters,
                (progress) => {
                    this.view.updateProgress(
                        progress.progress || 0,
                        this.getProgressText(progress.status)
                    );
                }
            );

            if (result.success) {
                this.generatedImages = result.images;
                this.view.displayResults(result.images);
                this.view.hideProgress();
                this.view.showSuccess(`Successfully generated ${result.images.length} image(s)!`);

                // Record generation in history
                await characterManager.addGenerationRecord(this.currentCharacter.id, {
                    workflowType: workflowType,
                    prompt: this.currentCharacter.description,
                    parameters: parameters,
                    resultImageIds: [],
                    provider: 'comfyui',
                    success: true
                });
            } else {
                throw new Error(result.error || 'Generation failed');
            }
        } catch (error) {
            console.error('Generation error:', error);
            this.view.hideProgress();
            this.view.showError(`Generation failed: ${error.message}`);
        } finally {
            // Re-enable generate button
            const generateBtn = this.view.container.querySelector('#generate-btn');
            if (generateBtn) generateBtn.disabled = false;
        }
    }

    /**
     * Collect parameters from UI
     */
    collectParameters() {
        const parameters = {};
        const paramInputs = this.view.container.querySelectorAll('[data-node]');

        paramInputs.forEach(input => {
            const nodeId = input.dataset.node;
            const key = input.dataset.key;

            if (!parameters[nodeId]) {
                parameters[nodeId] = {};
            }

            const value = input.type === 'number' ? parseFloat(input.value) : input.value;
            parameters[nodeId][key] = value;
        });

        return parameters;
    }

    /**
     * Get progress text based on status
     */
    getProgressText(status) {
        const messages = {
            'uploading': 'Uploading image...',
            'preparing': 'Preparing workflow...',
            'queuing': 'Queueing generation...',
            'generating': 'Generating images...',
            'processing': 'Processing...',
            'completed': 'Complete!'
        };
        return messages[status] || 'Processing...';
    }

    /**
     * Save generated image to character
     */
    async saveGeneratedImage(index) {
        if (!this.generatedImages[index]) {
            this.view.showError('Image not found');
            return;
        }

        try {
            const image = this.generatedImages[index];

            await characterManager.addCharacterImage(
                this.currentCharacter.id,
                image.blob,
                {
                    variant: 'generated',
                    generatedFrom: 'comfyui',
                    workflowId: image.nodeId
                }
            );

            this.view.showSuccess('Image saved to character!');

            // Refresh gallery
            await this.view.renderCharacterGallery(this.currentCharacter.id);
            this.setupWorkspaceListeners();

            // Reload characters to update counts
            await this.loadCharacters();
        } catch (error) {
            console.error('Error saving image:', error);
            this.view.showError(`Failed to save image: ${error.message}`);
        }
    }

    /**
     * Download generated image
     */
    downloadImage(index) {
        if (!this.generatedImages[index]) {
            this.view.showError('Image not found');
            return;
        }

        const image = this.generatedImages[index];
        const url = URL.createObjectURL(image.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentCharacter.name}_${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * Set primary image for character
     */
    async setPrimaryImage(imageId) {
        try {
            await characterManager.setPrimaryImage(this.currentCharacter.id, imageId);
            this.view.showSuccess('Primary image updated!');

            // Reload characters to update thumbnail
            await this.loadCharacters();
        } catch (error) {
            console.error('Error setting primary image:', error);
            this.view.showError(`Failed to set primary image: ${error.message}`);
        }
    }

    /**
     * Edit character (stub for future implementation)
     */
    async editCharacter(characterId) {
        this.view.showError('Edit feature coming soon!');
    }

    /**
     * Delete character
     */
    async deleteCharacter(characterId) {
        const character = await characterManager.getCharacter(characterId);
        if (!character) return;

        if (!confirm(`Are you sure you want to delete "${character.name}"? This will remove all associated images and cannot be undone.`)) {
            return;
        }

        try {
            await characterManager.deleteCharacter(characterId);
            this.view.showSuccess(`Character "${character.name}" deleted`);

            // Reload character list
            await this.loadCharacters();

            // Clear workspace if this was the current character
            if (this.currentCharacter && this.currentCharacter.id === characterId) {
                this.currentCharacter = null;
                this.view.container.querySelector('#workspace-content').innerHTML = `
                    <div class="workspace-empty">
                        <p>Character deleted. Select another character or create a new one.</p>
                    </div>
                `;
            }
        } catch (error) {
            console.error('Error deleting character:', error);
            this.view.showError(`Failed to delete character: ${error.message}`);
        }
    }

    /**
     * Cleanup on page exit
     */
    cleanup() {
        // Revoke any blob URLs
        if (this.generatedImages) {
            this.generatedImages.forEach(img => {
                if (img.url) URL.revokeObjectURL(img.url);
            });
        }

        // Disconnect WebSocket if connected
        comfyUIService.disconnectWebSocket();
    }
}
