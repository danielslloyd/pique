// Library View - Renders the book library interface
class LibraryView {
    static render(books) {
        const bookCards = books.map(book => {
            // Ensure all properties exist with defaults
            const safeBook = {
                filename: book.filename || '',
                title: book.title || 'Untitled',
                author: book.author || 'Unknown Author',
                thumbnail: book.thumbnail || null,
                loadError: book.loadError || false,
                isRBook: book.isRBook || false
            };
            
            const thumbnail = safeBook.thumbnail ? 
                `<img src="${safeBook.thumbnail}" alt="${safeBook.title}" onerror="this.src='./assets/default-book-cover.jpg'">` :
                `<div class="placeholder-thumbnail">📖</div>`;
            
            const indicators = [
                safeBook.loadError ? '<span class="error-indicator">⚠ Load Error</span>' : '',
                safeBook.isRBook ? '<span class="format-indicator">.rbook</span>' : ''
            ].filter(Boolean).join('');
            
            const errorClass = safeBook.loadError ? 'error' : '';
            
            return `
                <div class="book-card ${errorClass}" onclick="window.app.selectBook('${safeBook.filename}', '${safeBook.title}')">
                    <div class="book-thumbnail">${thumbnail}</div>
                    <div class="book-info">
                        <h3>${safeBook.title}</h3>
                        <p>${safeBook.author}</p>
                        ${indicators}
                    </div>
                </div>`;
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