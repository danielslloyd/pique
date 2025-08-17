class CreatorController {
    constructor() {
        this.bookCreator = new BookCreator();
        this.mode = null; // 'manual' or 'ai'
    }

    render(mode = 'selector') {
        this.mode = mode;
        switch (mode) {
            case 'selector':
                DOM.$('app-container').innerHTML = CreatorView.renderModeSelector();
                break;
            case 'manual':
                DOM.$('app-container').innerHTML = CreatorView.renderManualCreator();
                this.addNewPage(); // Add initial page
                break;
            case 'ai':
                // AI creation flow
                break;
        }
    }

    addNewPage() {
        const pageIndex = this.bookCreator.pages.length;
        this.bookCreator.addPage(null, '');
        
        const pageEditor = TemplateEngine.render(TemplateEngine.templates.pageEditor, {
            index: pageIndex,
            pageNumber: pageIndex + 1
        });
        
        DOM.$('pages-list').insertAdjacentHTML('beforeend', pageEditor);
    }
}