// Creator Controller - Manages book creation interface
class CreatorController {
    constructor() {
        this.bookCreator = new BookCreator();
        this.mode = null;
        this.aiCreationData = null;
    }

    async render(mode = 'selector') {
        console.log('Creator controller render with mode:', mode);
        this.mode = mode;
        
        switch (mode) {
            case 'selector':
                this.renderModeSelector();
                break;
            case 'manual':
                this.renderManualCreator();
                break;
            case 'ai':
                this.renderAICreator();
                break;
            default:
                console.warn('Unknown creator mode:', mode);
                this.renderModeSelector();
        }
    }

    renderModeSelector() {
        DOM.$('app-container').innerHTML = CreatorView.renderModeSelector();
    }

    renderManualCreator() {
        DOM.$('app-container').innerHTML = CreatorView.renderManualCreator();
        this.addNewPage(); // Add initial page
    }

    renderAICreator() {
        DOM.$('app-container').innerHTML = CreatorView.renderAICreator();
        this.showAPISetupStep();
    }

    showAPISetupStep() {
        const stepsContainer = DOM.$('ai-creation-steps');
        if (!stepsContainer) return;
        
        stepsContainer.innerHTML = ImageGenerationUI.renderAPISetup();
        this.updateFooterForStep('api-setup');
    }

    showCharacterCreationStep() {
        const stepsContainer = DOM.$('ai-creation-steps');
        if (!stepsContainer) return;
        
        stepsContainer.innerHTML = ImageGenerationUI.renderCharacterCreation();
        this.updateFooterForStep('character');
    }

    updateFooterForStep(step) {
        const footer = DOM.$('ai-creator-footer');
        if (!footer) return;
        
        switch (step) {
            case 'api-setup':
                footer.innerHTML = `
                    <button onclick="window.app.returnToLibrary()" class="creator-btn secondary">Cancel</button>
                    <button onclick="window.app.proceedToCharacterCreation()" class="creator-btn primary" id="proceed-btn">
                        Next: Create Character
                    </button>
                `;
                break;
            case 'character':
                footer.innerHTML = `
                    <button onclick="window.app.showAPISetupStep()" class="creator-btn secondary">← Back</button>
                    <button onclick="window.app.proceedToStoryPlanning()" class="creator-btn primary" id="next-step-btn">
                        Next: Plan Story
                    </button>
                `;
                break;
            // ... rest of your existing cases
        }
    }

    // Manual creator methods
    addNewPage() {
        const pageIndex = this.bookCreator.pages.length;
        this.bookCreator.addPage(null, '');
        
        const pageEditor = TemplateEngine.render(TemplateEngine.templates.pageEditor, {
            index: pageIndex,
            pageNumber: pageIndex + 1
        });
        
        const pagesList = DOM.$('pages-list');
        if (pagesList) {
            pagesList.insertAdjacentHTML('beforeend', pageEditor);
        }
        
        this.updateGenerateButtonState();
    }

    deletePage(pageIndex) {
        if (this.bookCreator.pages.length <= 1) {
            FeedbackManager.show('A book must have at least one page!', 'error');
            return;
        }
        
        this.bookCreator.deletePage(pageIndex);
        this.removePageEditor(pageIndex);
        this.updatePageNumbers();
        this.updateGenerateButtonState();
    }

    removePageEditor(pageIndex) {
        const pageEditor = DOM.$(`page-editor-${pageIndex}`);
        if (pageEditor) {
            pageEditor.remove();
        }
    }

    updatePageNumbers() {
        const pageEditors = document.querySelectorAll('.page-editor');
        pageEditors.forEach((editor, index) => {
            const header = editor.querySelector('.page-editor-header h3');
            if (header) {
                header.textContent = `Page ${index + 1}`;
            }
            
            editor.id = `page-editor-${index}`;
            
            const deleteBtn = editor.querySelector('.delete-page-btn');
            if (deleteBtn) {
                deleteBtn.onclick = () => window.app.deletePage(index);
            }
            
            const imageUpload = editor.querySelector('.image-upload-area');
            const imageInput = editor.querySelector('input[type="file"]');
            const textInput = editor.querySelector('textarea');
            
            if (imageUpload) imageUpload.id = `image-upload-${index}`;
            if (imageInput) {
                imageInput.id = `image-input-${index}`;
                imageInput.onchange = (e) => window.app.handlePageImageUpload(index, e);
                if (imageUpload) {
                    imageUpload.onclick = () => imageInput.click();
                }
            }
            if (textInput) {
                textInput.id = `text-input-${index}`;
                textInput.onchange = (e) => window.app.updatePageText(index, e.target.value);
            }
        });
    }

    handlePageImageUpload(pageIndex, event) {
        const file = event.target.files[0];
        if (!file) return;
        
        if (!file.type.startsWith('image/')) {
            FeedbackManager.show('Please select a valid image file', 'error');
            return;
        }
        
        this.bookCreator.updatePage(pageIndex, file, this.bookCreator.pages[pageIndex]?.text || '');
        this.updatePageEditor(pageIndex, this.bookCreator.pages[pageIndex]);
        this.updateGenerateButtonState();
        
        event.target.value = '';
    }

    updatePageEditor(pageIndex, page) {
        const imageUploadArea = DOM.$(`image-upload-${pageIndex}`);
        const textInput = DOM.$(`text-input-${pageIndex}`);
        
        if (imageUploadArea && page.imageUrl) {
            imageUploadArea.classList.add('has-image');
            imageUploadArea.innerHTML = `<img src="${page.imageUrl}" alt="Page ${pageIndex + 1}" class="uploaded-image">`;
        }
        
        if (textInput) {
            textInput.value = page.text;
        }
    }

    updatePageText(pageIndex, text) {
        if (this.bookCreator.pages[pageIndex]) {
            this.bookCreator.updatePage(pageIndex, null, text);
            this.updateGenerateButtonState();
        }
    }

    handleThumbnailUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        if (!file.type.startsWith('image/')) {
            FeedbackManager.show('Please select a valid image file', 'error');
            return;
        }
        
        this.bookCreator.setThumbnail(file);
        const imageUrl = URL.createObjectURL(file);
        this.updateThumbnailPreview(imageUrl);
        
        event.target.value = '';
    }

    updateThumbnailPreview(imageUrl) {
        const thumbnailPreview = DOM.$('thumbnail-preview');
        if (thumbnailPreview) {
            if (imageUrl) {
                thumbnailPreview.innerHTML = `<img src="${imageUrl}" alt="Thumbnail" style="width: 100%; height: 100%; object-fit: cover;">`;
            } else {
                thumbnailPreview.innerHTML = `
                    <div class="thumbnail-preview-placeholder">
                        150×150<br>Thumbnail
                    </div>
                `;
            }
        }
    }

    updateGenerateButtonState() {
        const title = DOM.$('book-title')?.value.trim();
        const author = DOM.$('book-author')?.value.trim();
        const hasValidPages = this.bookCreator.pages.length > 0 && 
                            this.bookCreator.pages.some(page => page.imageFile && page.text.trim());
        
        const canGenerate = title && author && hasValidPages;
        const generateBtn = DOM.$('generate-book-btn');
        if (generateBtn) {
            generateBtn.disabled = !canGenerate;
        }
    }

    async generateBook() {
        try {
            const title = DOM.$('book-title')?.value.trim();
            const author = DOM.$('book-author')?.value.trim();
            const description = DOM.$('book-description')?.value.trim();
            
            if (!title || !author) {
                FeedbackManager.show('Please fill in title and author', 'error');
                return;
            }
            
            if (this.bookCreator.pages.length === 0) {
                FeedbackManager.show('Please add at least one page', 'error');
                return;
            }
            
            const invalidPages = this.bookCreator.pages.filter(page => !page.imageFile || !page.text.trim());
            if (invalidPages.length > 0) {
                FeedbackManager.show('All pages must have both an image and text', 'error');
                return;
            }
            
            FeedbackManager.show('Generating book file...', 'info');
            
            this.bookCreator.setMetadata(title, author, description);
            const filename = await this.bookCreator.generateRBookFile();
            
            FeedbackManager.show(`Book "${filename}" generated and downloaded!`, 'success');
            
            setTimeout(() => {
                window.app.returnToLibrary();
            }, 2000);
            
        } catch (error) {
            FeedbackManager.show(`Error generating book: ${error.message}`, 'error');
            console.error('Book generation error:', error);
        }
    }

    // AI creator methods - simplified implementations
    handleCharacterImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        if (!file.type.startsWith('image/')) {
            FeedbackManager.show('Please select a valid image file', 'error');
            return;
        }
        
        this.aiCreationData.characterImage = file;
        
        const preview = DOM.$('character-preview');
        const imageUrl = URL.createObjectURL(file);
        if (preview) {
            preview.innerHTML = `<img src="${imageUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 6px;">`;
        }
        
        const generateBtn = DOM.$('generate-character-btn');
        if (generateBtn) {
            generateBtn.disabled = false;
        }
        
        event.target.value = '';
    }

    async generateCharacterDesign() {
        FeedbackManager.show('AI generation is not implemented yet. This would generate a character design.', 'info');
        
        // Mock implementation - would call AI service
        setTimeout(() => {
            FeedbackManager.show('AI features require additional setup', 'encourage');
        }, 1000);
    }

    cleanup() {
        if (this.bookCreator) {
            this.bookCreator.cleanup();
        }
        this.aiCreationData = null;
    }

    renderAISetup() {
        return ImageGenerationUI.renderAPISetup();
    }

    renderAICharacter() {
        return ImageGenerationUI.renderCharacterCreation();
    }

    showAPISetupStep() {
        const stepsContainer = DOM.$('ai-creation-steps');
        if (!stepsContainer) return;
        
        stepsContainer.innerHTML = ImageGenerationUI.renderAPISetup();
        this.updateFooterForStep('api-setup');
    }

    proceedToCharacterCreation() {
        this.showCharacterCreationStep();
    }

    proceedToStoryPlanning() {
        // Future implementation for story planning
        FeedbackManager.show('Story planning step coming soon!', 'info');
    }
}