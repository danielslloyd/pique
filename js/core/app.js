// Main App Class - Simplified
class ReadingApp {
    constructor() {
        this.router = new AppRouter();
        this.feedbackManager = FeedbackManager;
    }

    async init() {
        await this.router.navigateTo('library');
    }

    // Navigation methods
    async selectBook(filename, title) {
        try {
            this.feedbackManager.show('Loading book...', 'info');
            
            // Load book data through the library controller's book manager
            const bookData = await this.router.views.library.bookManager.loadBook(filename);
            
            console.log('Loaded book data:', bookData);
            console.log('First page image URL:', bookData.pages?.[0]?.image);
            
            this.router.navigateTo('player', { bookData, title });
            this.feedbackManager.clear();
        } catch (error) {
            this.feedbackManager.show(`Error loading book: ${error.message}`, 'error');
            console.error('Book selection error:', error);
        }
    }

    showBookCreator() {
        this.router.navigateTo('creator', 'selector');
    }

    selectCreationMode(mode) {
        this.router.navigateTo('creator', mode);
    }

    returnToLibrary() {
        // Clean up current view, but preserve book data
        const currentView = this.router.getCurrentView();
        if (currentView && currentView.cleanup) {
            currentView.cleanup();
        }
        
        // Don't cleanup BookManager here - keep blob URLs alive
        this.router.navigateTo('library');
    }

    // Creator methods - delegate to creator controller
    addNewPage() {
        const creatorController = this.router.views.creator;
        if (creatorController && creatorController.addNewPage) {
            creatorController.addNewPage();
        }
    }

    deletePage(index) {
        const creatorController = this.router.views.creator;
        if (creatorController && creatorController.deletePage) {
            creatorController.deletePage(index);
        }
    }

    handlePageImageUpload(pageIndex, event) {
        const creatorController = this.router.views.creator;
        if (creatorController && creatorController.handlePageImageUpload) {
            creatorController.handlePageImageUpload(pageIndex, event);
        }
    }

    updatePageText(pageIndex, text) {
        const creatorController = this.router.views.creator;
        if (creatorController && creatorController.updatePageText) {
            creatorController.updatePageText(pageIndex, text);
        }
    }

    handleThumbnailUpload(event) {
        const creatorController = this.router.views.creator;
        if (creatorController && creatorController.handleThumbnailUpload) {
            creatorController.handleThumbnailUpload(event);
        }
    }

    async generateBook() {
        const creatorController = this.router.views.creator;
        if (creatorController && creatorController.generateBook) {
            await creatorController.generateBook();
        }
    }

    // Player methods - delegate to player controller
    nextPage() {
        const playerController = this.router.views.player;
        if (playerController && playerController.nextPage) {
            playerController.nextPage();
        }
    }

    prevPage() {
        const playerController = this.router.views.player;
        if (playerController && playerController.prevPage) {
            playerController.prevPage();
        }
    }

    onWordMatched(matchCount) {
        const playerController = this.router.views.player;
        if (playerController && playerController.onWordMatched) {
            playerController.onWordMatched(matchCount);
        }
    }

    getCurrentExpectedWord() {
        const playerController = this.router.views.player;
        if (playerController && playerController.getCurrentExpectedWord) {
            return playerController.getCurrentExpectedWord();
        }
        return null;
    }

    revealPicture() {
        const playerController = this.router.views.player;
        if (playerController && playerController.revealPicture) {
            playerController.revealPicture();
        }
    }

    skipToNextWord() {
        const playerController = this.router.views.player;
        if (playerController && playerController.skipToNextWord) {
            playerController.skipToNextWord();
        }
    }

    // Add these methods to your ReadingApp class in app.js:
    showAPISetupStep() {
        const creatorController = this.router.views.creator;
        if (creatorController && creatorController.showAPISetupStep) {
            creatorController.showAPISetupStep();
        }
    }

    proceedToCharacterCreation() {
        const creatorController = this.router.views.creator;
        if (creatorController && creatorController.showCharacterCreationStep) {
            creatorController.showCharacterCreationStep();
        }
    }
}

// Initialize the app when DOM is ready
window.addEventListener('DOMContentLoaded', async () => {
    try {
        window.app = new ReadingApp();
        await window.app.init();
        
        // Add global event listeners for form inputs in creator mode
        document.addEventListener('input', (event) => {
            if (window.app.router.currentView === 'creator' && 
                (event.target.id === 'book-title' || event.target.id === 'book-author')) {
                const creatorController = window.app.router.views.creator;
                if (creatorController && creatorController.updateGenerateButtonState) {
                    creatorController.updateGenerateButtonState();
                }
            }
        });
        
        console.log('Reading app initialized successfully');
    } catch (error) {
        console.error('Failed to initialize app:', error);
        document.getElementById('app-container').innerHTML = `
            <div style="padding: 20px; text-align: center; color: red;">
                <h2>Failed to load application</h2>
                <p>Please check the console for details.</p>
            </div>
        `;
    }
});