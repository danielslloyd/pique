class FormComponents {
    static renderBookMetadata() {
        return `
            <section class="book-metadata-section">
                <h2>Book Information</h2>
                <div class="form-group">
                    <label for="book-title">Title *</label>
                    <input type="text" id="book-title" placeholder="Enter book title" required>
                </div>
                <div class="form-group">
                    <label for="book-author">Author *</label>
                    <input type="text" id="book-author" placeholder="Enter author name" required>
                </div>
                <div class="form-group">
                    <label for="book-description">Description</label>
                    <textarea id="book-description" placeholder="Optional description of your book"></textarea>
                </div>
            </section>`;
    }

    static renderPagesSection() {
        return `
            <section class="pages-section">
                <h2>Pages</h2>
                <div class="pages-list" id="pages-list"></div>
                <button onclick="window.app.addNewPage()" class="add-page-btn">➕ Add New Page</button>
            </section>`;
    }

    static renderThumbnailSection() {
        return `
            <section class="thumbnail-section">
                <h2>Book Thumbnail</h2>
                <div class="thumbnail-upload">
                    <div class="thumbnail-preview" id="thumbnail-preview">
                        <div class="thumbnail-preview-placeholder">150×150<br>Thumbnail</div>
                    </div>
                    <div class="thumbnail-controls">
                        <p>Upload a custom thumbnail or leave blank to use the first page image.</p>
                        <input type="file" id="thumbnail-input" accept="image/*" onchange="window.app.handleThumbnailUpload(event)">
                        <label for="thumbnail-input" class="file-input-label">Choose Thumbnail</label>
                    </div>
                </div>
            </section>`;
    }
}