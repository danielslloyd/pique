class LibraryView {
    static render(books) {
        const bookCards = books.map(book => {
            const thumbnail = book.thumbnail ? 
                `<img src="${book.thumbnail}" alt="${book.title}" onerror="this.src='./assets/default-book-cover.jpg'">` :
                `<div class="placeholder-thumbnail">📖</div>`;
            
            const indicators = [
                book.loadError ? '<span class="error-indicator">⚠ Load Error</span>' : '',
                book.isRBook ? '<span class="format-indicator">.rbook</span>' : ''
            ].filter(Boolean).join('');
            
            return TemplateEngine.render(TemplateEngine.templates.bookCard, {
                filename: book.filename,
                title: book.title,
                author: book.author,
                thumbnail,
                indicators,
                errorClass: book.loadError ? 'error' : ''
            });
        }).join('');

        return `
            <div class="library-container">
                <header class="library-header">
                    <h1>Pique</h1>
                    <p>Choose a book to start reading</p>
                </header>
                <div class="books-grid">${bookCards}</div>
                <div class="library-footer">
                    <input type="file" id="book-file-input" accept=".rbook,.zip" style="display: none;">
                    <button onclick="document.getElementById('book-file-input').click()" class="add-book-btn">📁 Load .rbook File</button>
                    <button onclick="window.app.showBookCreator()" class="add-book-btn">➕ Create New Book</button>
                </div>
            </div>`;
    }
}