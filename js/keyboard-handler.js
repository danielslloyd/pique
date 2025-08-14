// Keyboard Event Handling
class KeyboardHandler {
    constructor() {
        this.app = null;
    }
    
    init(app) {
        this.app = app;
        document.addEventListener('keydown', (event) => this.handleKeydown(event));
    }
    
    handleKeydown(event) {
        // Ctrl+P or Cmd+P to show picture (only in player mode)
        if ((event.ctrlKey || event.metaKey) && event.key === 'p' && this.app.currentMode === 'player') {
            event.preventDefault();
            this.app.revealPicture();
            return;
        }
        
        // Escape key to return to library from player
        if (event.key === 'Escape' && this.app.currentMode === 'player') {
            this.app.returnToLibrary();
            return;
        }
        
        // Arrow keys for navigation in player mode
        if (this.app.currentMode === 'player') {
            if (event.key === 'ArrowLeft' && !event.ctrlKey && !event.metaKey) {
                event.preventDefault();
                this.app.prevPage();
            } else if (event.key === 'ArrowRight' && !event.ctrlKey && !event.metaKey) {
                event.preventDefault();
                this.app.nextPage();
            }
        }
    }
}