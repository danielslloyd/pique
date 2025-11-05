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
            case 'story-planning':
                footer.innerHTML = `
                    <button onclick="window.app.showCharacterCreationStep()" class="creator-btn secondary">← Back</button>
                    <button onclick="window.app.generateStoryFromPlan()" class="creator-btn primary" id="generate-story-btn">
                        Generate Story Pages
                    </button>
                `;
                break;
            case 'story-review':
                footer.innerHTML = `
                    <button onclick="window.app.showStoryPlanningStep()" class="creator-btn secondary">← Back to Planning</button>
                    <button onclick="window.app.proceedToImageGeneration()" class="creator-btn primary" id="finalize-story-btn">
                        Next: Generate Images
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

    showStoryPlanningStep() {
        const stepsContainer = DOM.$('ai-creation-steps');
        if (!stepsContainer) return;

        stepsContainer.innerHTML = ImageGenerationUI.renderStoryPlanning();
        this.updateFooterForStep('story-planning');

        // Update character summary if available
        const characterDescription = document.getElementById('character-description')?.value.trim();
        const characterSummary = DOM.$('character-summary');
        if (characterSummary && characterDescription) {
            characterSummary.textContent = characterDescription.substring(0, 100) + (characterDescription.length > 100 ? '...' : '');
        }
    }

    proceedToStoryPlanning() {
        this.showStoryPlanningStep();
    }

    async generateStoryFromPlan() {
        const generateBtn = DOM.$('generate-story-btn');
        if (generateBtn) {
            generateBtn.disabled = true;
            generateBtn.textContent = 'Generating...';
        }

        try {
            const pages = await window.aiImageSetup.generateStoryPages();

            if (pages && pages.length > 0) {
                this.showStoryReviewStep(pages);
            }
        } catch (error) {
            console.error('Story generation error:', error);
            FeedbackManager.show(`Failed to generate story: ${error.message}`, 'error');
        } finally {
            if (generateBtn) {
                generateBtn.disabled = false;
                generateBtn.textContent = 'Generate Story Pages';
            }
        }
    }

    showStoryReviewStep(pages) {
        const stepsContainer = DOM.$('ai-creation-steps');
        if (!stepsContainer) return;

        stepsContainer.innerHTML = ImageGenerationUI.renderStoryReview(pages);
        this.updateFooterForStep('story-review');

        // Add event listeners to text areas for auto-saving edits
        pages.forEach((page, index) => {
            const textarea = DOM.$(`page-text-${index}`);
            if (textarea) {
                textarea.addEventListener('input', (e) => {
                    window.aiImageSetup.updatePageText(index, e.target.value);
                });
            }
        });
    }

    async proceedToImageGeneration() {
        const pages = window.aiImageSetup.aiBookCreator.generatedPages;

        if (!pages || pages.length === 0) {
            FeedbackManager.show('No story pages found. Please generate story first.', 'error');
            return;
        }

        // Here you would implement image generation for each page
        // For now, let's create a final book with the text and character image
        try {
            FeedbackManager.show('Preparing your book...', 'info');

            // Get character image
            const characterData = window.aiImageSetup.aiBookCreator.generatedImages.get('character');

            if (!characterData || !characterData.blob) {
                FeedbackManager.show('Character image not found. Please create a character first.', 'error');
                return;
            }

            // Clear existing book creator and add pages
            this.bookCreator.reset();

            // For now, use the character image for all pages
            // In future, you could generate unique images per page
            for (const page of pages) {
                this.bookCreator.addPage(characterData.blob, page.text);
            }

            // Set metadata
            const title = prompt('Enter book title:', 'My AI Generated Story');
            const author = prompt('Enter author name:', 'Young Author');

            if (!title || !author) {
                FeedbackManager.show('Title and author are required', 'error');
                return;
            }

            const storySummary = window.aiImageSetup.aiBookCreator.storyPlan?.storySummary || '';
            this.bookCreator.setMetadata(title, author, storySummary);

            // Generate the book
            const filename = await this.bookCreator.generateRBookFile();

            const totalCost = window.aiImageSetup.aiBookCreator.getTotalCost();
            FeedbackManager.show(`Book "${filename}" generated! Total AI cost: $${totalCost}`, 'success');

            setTimeout(() => {
                window.app.returnToLibrary();
            }, 2000);

        } catch (error) {
            console.error('Book finalization error:', error);
            FeedbackManager.show(`Failed to create book: ${error.message}`, 'error');
        }
    }
}