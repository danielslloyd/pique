// Main App Controller
class ReadingApp {
    constructor() {
        this.currentPageIndex = 0;
        this.bookData = null;
        this.currentWordIndex = 0;
        this.hasPlayedSuccessSound = false;
        this.currentMode = 'library'; // 'library', 'player', or 'creator'
        
        this.bookManager = new BookManager();
        this.speechEngine = new SpeechEngine();
        this.ui = new UIManager();
        this.keyboard = new KeyboardHandler();
        this.bookCreator = new BookCreator();
        
        this.init();
    }
    
    async init() {
        await this.bookManager.loadAvailableBooks();
        this.ui.showLibrary(this.bookManager.availableBooks);
        this.keyboard.init(this);
    }
    
    async selectBook(filename, title) {
        try {
            this.ui.showFeedback('Loading book...', 'info');
            
            this.bookData = await this.bookManager.loadBook(filename);
            this.currentPageIndex = 0;
            document.title = `Reading: ${title}`;
            
            this.showPlayer();
            this.ui.updateBookTitle(this.bookData.title || title);
            this.ui.clearFeedback();
            
        } catch (error) {
            this.ui.showFeedback(`Error loading book: ${error.message}`, 'error');
            console.error('Book selection error:', error);
        }
    }
    
    showPlayer() {
        this.currentMode = 'player';
        this.ui.showPlayer();
        this.attachPlayerEvents();
        this.showPage(this.currentPageIndex);
    }
    
    showBookCreator() {
        this.currentMode = 'creator';
        this.bookCreator.reset();
        this.ui.showBookCreator();
        document.title = 'Create New Book - Reading Library';
        
        // Add initial page
        this.addNewPage();
    }
    
    addNewPage() {
        const pageIndex = this.bookCreator.pages.length;
        this.bookCreator.addPage(null, '');
        this.ui.addPageEditor(pageIndex);
        this.updateGenerateButtonState();
    }
    
    deletePage(pageIndex) {
        if (this.bookCreator.pages.length <= 1) {
            this.ui.showFeedback('A book must have at least one page!', 'error');
            return;
        }
        
        this.bookCreator.deletePage(pageIndex);
        this.ui.removePageEditor(pageIndex);
        this.ui.updatePageNumbers();
        this.updateGenerateButtonState();
    }
    
    handlePageImageUpload(pageIndex, event) {
        const file = event.target.files[0];
        if (!file) return;
        
        // Validate file type
        if (!file.type.startsWith('image/')) {
            this.ui.showFeedback('Please select a valid image file', 'error');
            return;
        }
        
        // Update the page with new image
        this.bookCreator.updatePage(pageIndex, file, this.bookCreator.pages[pageIndex]?.text || '');
        this.ui.updatePageEditor(pageIndex, this.bookCreator.pages[pageIndex]);
        this.updateGenerateButtonState();
        
        // Clear the input so the same file can be selected again
        event.target.value = '';
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
        
        // Validate file type
        if (!file.type.startsWith('image/')) {
            this.ui.showFeedback('Please select a valid image file', 'error');
            return;
        }
        
        this.bookCreator.setThumbnail(file);
        const imageUrl = URL.createObjectURL(file);
        this.ui.updateThumbnailPreview(imageUrl);
        
        // Clear the input
        event.target.value = '';
    }
    
    updateGenerateButtonState() {
        const title = document.getElementById('book-title')?.value.trim();
        const author = document.getElementById('book-author')?.value.trim();
        const hasValidPages = this.bookCreator.pages.length > 0 && 
                            this.bookCreator.pages.some(page => page.imageFile && page.text.trim());
        
        const canGenerate = title && author && hasValidPages;
        this.ui.updateGenerateButton(canGenerate);
    }
    
    async generateBook() {
        try {
            // Get metadata from form
            const title = document.getElementById('book-title')?.value.trim();
            const author = document.getElementById('book-author')?.value.trim();
            const description = document.getElementById('book-description')?.value.trim();
            
            if (!title || !author) {
                this.ui.showFeedback('Please fill in title and author', 'error');
                return;
            }
            
            if (this.bookCreator.pages.length === 0) {
                this.ui.showFeedback('Please add at least one page', 'error');
                return;
            }
            
            // Check if all pages have both image and text
            const invalidPages = this.bookCreator.pages.filter(page => !page.imageFile || !page.text.trim());
            if (invalidPages.length > 0) {
                this.ui.showFeedback('All pages must have both an image and text', 'error');
                return;
            }
            
            this.ui.showFeedback('Generating book file...', 'info');
            
            // Set metadata
            this.bookCreator.setMetadata(title, author, description);
            
            // Generate and download the .rbook file
            const filename = await this.bookCreator.generateRBookFile();
            
            this.ui.showFeedback(`Book "${filename}" generated and downloaded!`, 'success');
            
            // Return to library after a delay
            setTimeout(() => {
                this.returnToLibrary();
            }, 2000);
            
        } catch (error) {
            this.ui.showFeedback(`Error generating book: ${error.message}`, 'error');
            console.error('Book generation error:', error);
        }
    }
    
    showPage(index) {
        const page = this.bookData.pages[index];
        this.currentWordIndex = 0;
        this.hasPlayedSuccessSound = false;
        
        this.ui.updatePageDisplay(page, index);
        this.ui.updateNavigation(index, this.bookData.pages.length);
        this.ui.clearFeedback();
        
        this.speechEngine.startListening(this);
    }
    
    returnToLibrary() {
        this.speechEngine.stop();
        
        // Clean up book creator resources
        if (this.currentMode === 'creator') {
            this.bookCreator.cleanup();
        }
        
        this.reset();
        document.title = 'Reading Library';
        this.ui.showLibrary(this.bookManager.availableBooks);
    }
    
    reset() {
        this.currentPageIndex = 0;
        this.bookData = null;
        this.currentWordIndex = 0;
        this.hasPlayedSuccessSound = false;
        this.currentMode = 'library';
        this.speechEngine.reset();
    }
    
    attachPlayerEvents() {
        document.getElementById('prev-page').addEventListener('click', () => this.prevPage());
        document.getElementById('next-page').addEventListener('click', () => this.nextPage());
    }
    
    nextPage() {
        if (this.currentPageIndex < this.bookData.pages.length - 1) {
            this.currentPageIndex++;
            this.showPage(this.currentPageIndex);
        } else {
            this.ui.showFeedback("🎊 Congratulations! You've finished the book!", 'success');
            this.ui.playSuccessSound();
            
            setTimeout(() => {
                this.returnToLibrary();
            }, 3000);
        }
    }
    
    prevPage() {
        if (this.currentPageIndex > 0) {
            this.currentPageIndex--;
            this.showPage(this.currentPageIndex);
        }
    }
    
    onWordMatched(matchCount) {
        this.currentWordIndex += matchCount;
        this.ui.updateTextHighlight(
            this.bookData.pages[this.currentPageIndex].text, 
            this.currentWordIndex
        );
        
        // Check if page is complete
        const expectedWords = this.bookData.pages[this.currentPageIndex].text.trim().split(' ');
        if (this.currentWordIndex >= expectedWords.length) {
            this.ui.showPageComplete();
            
            if (!this.hasPlayedSuccessSound) {
                this.ui.showFeedback('🎉 Page complete! Picture unlocked!', 'success');
                this.ui.playSuccessSound();
                this.hasPlayedSuccessSound = true;
                this.speechEngine.stop();
            }
        }
    }
    
    getCurrentExpectedWord() {
        if (!this.bookData?.pages[this.currentPageIndex]) return null;
        const words = this.bookData.pages[this.currentPageIndex].text.trim().split(' ');
        return words[this.currentWordIndex] || null;
    }
    
    revealPicture() {
        if (this.currentMode === 'player') {
            this.ui.showPageComplete();
            this.ui.showFeedback('🖼️ Picture revealed!', 'success');
            this.ui.playSuccessSound();
        }
    }
    
    skipToNextWord() {
        if (this.currentMode === 'player' && this.bookData?.pages[this.currentPageIndex]) {
            const expectedWords = this.bookData.pages[this.currentPageIndex].text.trim().split(' ');
            if (this.currentWordIndex < expectedWords.length) {
                this.currentWordIndex++;
                this.ui.updateTextHighlight(
                    this.bookData.pages[this.currentPageIndex].text, 
                    this.currentWordIndex
                );
                this.ui.showFeedback('⏭️ Skipped word!', 'info');
                
                // Check if page is complete after skipping
                if (this.currentWordIndex >= expectedWords.length) {
                    this.ui.showPageComplete();
                    if (!this.hasPlayedSuccessSound) {
                        this.ui.showFeedback('🎉 Page complete! Picture unlocked!', 'success');
                        this.ui.playSuccessSound();
                        this.hasPlayedSuccessSound = true;
                        this.speechEngine.stop();
                    }
                }
            }
        }
    }
}

// Initialize the app
window.addEventListener('DOMContentLoaded', () => {
    window.app = new ReadingApp();
    
    // Add event listeners for form inputs in creator mode
    document.addEventListener('input', (event) => {
        if (window.app.currentMode === 'creator' && 
            (event.target.id === 'book-title' || event.target.id === 'book-author')) {
            window.app.updateGenerateButtonState();
        }
    });
});