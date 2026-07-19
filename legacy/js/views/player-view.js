// Player View - Renders the book reading interface
class PlayerView {
    static render() {
        return `
            <div class="player-container">
                <header class="player-header">
                    <div class="left">
                        <button onclick="window.app.returnToLibrary()" class="back-btn">← Library</button>
                    </div>
                    <div class="center">
                        <div id="book-title" class="book-title">Loading Book...</div>
                    </div>
                    <div class="right">
                        <div class="recording-indicator">
                            <div class="recording-dot"></div>
                            <span>REC</span>
                        </div>
                    </div>
                </header>
                
                <main class="player-content">
                    <div class="image-section">
                        <img id="page-image" class="page-image" style="display: none;" alt="Page illustration">
                        <div class="image-placeholder" id="image-placeholder">
                            <p>🎯 Read the text aloud to unlock the picture!</p>
                        </div>
                    </div>
                    
                    <div class="text-section">
                        <div id="page-text" class="page-text">Loading...</div>
                    </div>
                </main>
                
                <footer class="player-footer">
                    <div class="navigation">
                        <button id="prev-page" class="nav-btn hidden">← Previous</button>
                        <span id="page-counter">Page 1/1</span>
                        <button id="next-page" class="nav-btn">Next →</button>
                    </div>
                </footer>
            </div>`;
    }
}