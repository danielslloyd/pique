// Keyboard Event Handling
class KeyboardHandler {
    constructor() {
        this.controller = null;
        this.currentMode = null;
    }
    
    init(controller) {
        this.controller = controller;
        
        // Remove any existing listeners to prevent duplicates
        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler);
        }
        
        // Create bound handler
        this.keydownHandler = (event) => this.handleKeydown(event);
        document.addEventListener('keydown', this.keydownHandler);
    }
    
    handleKeydown(event) {
        // Determine current mode based on app router
        const currentView = window.app?.router?.currentView;
        
        // Ctrl+P or Cmd+P to show picture (only in player mode)
        if ((event.ctrlKey || event.metaKey) && event.key === 'p' && currentView === 'player') {
            event.preventDefault();
            if (this.controller && this.controller.revealPicture) {
                this.controller.revealPicture();
            }
            return;
        }
        
        // Ctrl+S or Cmd+S to skip to next word (only in player mode)
        if ((event.ctrlKey || event.metaKey) && event.key === 's' && currentView === 'player') {
            event.preventDefault();
            if (this.controller && this.controller.skipToNextWord) {
                this.controller.skipToNextWord();
            }
            return;
        }
        
        // Escape key to return to library from player
        if (event.key === 'Escape' && currentView === 'player') {
            if (window.app && window.app.returnToLibrary) {
                window.app.returnToLibrary();
            }
            return;
        }
        
        // Arrow keys for navigation in player mode
        if (currentView === 'player') {
            if (event.key === 'ArrowLeft' && !event.ctrlKey && !event.metaKey) {
                event.preventDefault();
                if (this.controller && this.controller.prevPage) {
                    this.controller.prevPage();
                }
            } else if (event.key === 'ArrowRight' && !event.ctrlKey && !event.metaKey) {
                event.preventDefault();
                if (this.controller && this.controller.nextPage) {
                    this.controller.nextPage();
                }
            }
        }
    }
    
    cleanup() {
        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler);
            this.keydownHandler = null;
        }
        this.controller = null;
    }
}