// App Router - Manages navigation between views
class AppRouter {
    constructor() {
        this.currentView = 'library';
        this.views = {
            library: new LibraryController(),
            player: new PlayerController(),
            creator: new CreatorController()
        };
    }

    async navigateTo(view, data = {}) {
        console.log(`Navigating to ${view} with data:`, data);
        
        // Don't cleanup the library controller when going to player
        // because it contains the BookManager with active blob URLs
        if (!(this.currentView === 'library' && view === 'player')) {
            const currentViewController = this.views[this.currentView];
            if (currentViewController && currentViewController.cleanup) {
                console.log(`Cleaning up ${this.currentView} controller`);
                currentViewController.cleanup();
            }
        } else {
            console.log('Skipping library cleanup to preserve blob URLs for player');
        }

        this.currentView = view;
        const viewController = this.views[view];
        
        if (!viewController) {
            console.error(`View controller for '${view}' not found`);
            return;
        }

        try {
            if (view === 'library') {
                await viewController.init();
            } else {
                await viewController.render(data);
            }
            
            // Update page title
            this.updatePageTitle(view, data);
            
        } catch (error) {
            console.error(`Error navigating to ${view}:`, error);
            FeedbackManager.show(`Error loading ${view}: ${error.message}`, 'error');
        }
    }

    getCurrentView() {
        return this.views[this.currentView];
    }

    updatePageTitle(view, data) {
        switch (view) {
            case 'library':
                document.title = 'Reading Library';
                break;
            case 'player':
                document.title = `Reading: ${data.title || 'Book'}`;
                break;
            case 'creator':
                document.title = 'Create New Book - Reading Library';
                break;
            default:
                document.title = 'Reading Library';
        }
    }
}