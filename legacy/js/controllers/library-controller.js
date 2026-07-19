// Library Controller - Manages the book library view
class LibraryController {
    constructor() {
        this.bookManager = new BookManager();
    }

    async init() {
        console.log('Initializing library controller...');
        try {
            await this.bookManager.loadAvailableBooks();
            console.log('Books loaded:', this.bookManager.availableBooks);
            this.render();
        } catch (error) {
            console.error('Error initializing library:', error);
            FeedbackManager.show('Error loading library', 'error');
            this.render(); // Render empty library
        }
    }

    render() {
        console.log('Rendering library with books:', this.bookManager.availableBooks);
        DOM.$('app-container').innerHTML = LibraryView.render(this.bookManager.availableBooks);
        this.attachEvents();
    }

    attachEvents() {
        const fileInput = DOM.$('book-file-input');
        if (fileInput) {
            fileInput.onchange = (e) => this.handleBookUpload(e);
        }
    }

    async handleBookUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            FeedbackManager.show('Loading book...', 'info');
            
            const bookInfo = await this.bookManager.handleBookUpload(file);
            this.bookManager.availableBooks.push(bookInfo);
            
            this.render(); // Re-render with new book
            FeedbackManager.show(`Book "${bookInfo.title}" loaded successfully!`, 'success');
            
        } catch (error) {
            FeedbackManager.show(`Error loading book: ${error.message}`, 'error');
            console.error('Book upload error:', error);
        }
        
        event.target.value = ''; // Clear file input
    }

    cleanup() {
        // DON'T clean up book manager resources when navigating to player
        // The player needs the blob URLs to remain active
        console.log('Library controller cleanup - preserving book data for player');
        
        // Only clean up if we're actually leaving the app entirely
        // The BookManager cleanup will be handled by the main app cleanup
    }
}