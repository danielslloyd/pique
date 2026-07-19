// Creator View - Renders book creation interfaces
class CreatorView {
    static renderModeSelector() {
        return `
            <div class="creator-container">
                <header class="creator-header">
                    <h1>Create New Book</h1>
                    <p>Choose how you'd like to create your reading book</p>
                </header>
                
                <div class="creation-mode-selector">
                    <div class="mode-card" onclick="window.app.selectCreationMode('manual')">
                        <div class="mode-icon">📝</div>
                        <h3>Manual Creation</h3>
                        <p>Upload your own images and write text manually</p>
                    </div>
                    <div class="mode-card" onclick="window.app.selectCreationMode('ai')">
                        <div class="mode-icon">🤖</div>
                        <h3>AI-Powered Creation</h3>
                        <p>Create a character and let AI generate story and images</p>
                    </div>
                </div>
                
                <footer class="creator-footer">
                    <button onclick="window.app.returnToLibrary()" class="creator-btn secondary">← Back to Library</button>
                </footer>
            </div>`;
    }

    static renderManualCreator() {
        return `
            <div class="creator-container">
                <header class="creator-header">
                    <h1>Manual Book Creation</h1>
                    <p>Build your own reading book with images and text</p>
                </header>
                
                <main class="creator-main">
                    ${FormComponents.renderBookMetadata()}
                    ${FormComponents.renderPagesSection()}
                    ${FormComponents.renderThumbnailSection()}
                </main>
                
                <footer class="creator-footer">
                    <button onclick="window.app.returnToLibrary()" class="creator-btn secondary">Cancel</button>
                    <button onclick="window.app.generateBook()" class="creator-btn primary" id="generate-book-btn">
                        📚 Generate .rbook File
                    </button>
                </footer>
            </div>`;
    }

    static renderAICreator() {
        return `
            <div class="creator-container">
                <header class="creator-header">
                    <h1>AI-Powered Book Creation</h1>
                    <p>Create a character and generate your story automatically</p>
                </header>
                
                <div id="ai-creation-steps">
                    <!-- Step content will be dynamically inserted -->
                </div>
                
                <footer class="creator-footer" id="ai-creator-footer">
                    <button onclick="window.app.returnToLibrary()" class="creator-btn secondary">Cancel</button>
                </footer>
            </div>`;
    }
}