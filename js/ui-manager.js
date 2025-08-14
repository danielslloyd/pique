// UI Management and Display Functions
class UIManager {
    showLibrary(availableBooks) {
        const appContainer = document.getElementById('app-container');
        
        appContainer.innerHTML = `
            <div class="library-container">
                <header class="library-header">
                    <h1>Pique</h1>
                    <p>Choose a book to start reading</p>
                </header>
                
                <div class="books-grid" id="books-grid">
                    ${availableBooks.map(book => `
                        <div class="book-card ${book.loadError ? 'error' : ''}" onclick="window.app.selectBook('${book.filename}', '${book.title}')">
                            <div class="book-thumbnail">
                                ${book.thumbnail ? 
                                    `<img src="${book.thumbnail}" alt="${book.title}" onerror="this.src='./assets/default-book-cover.jpg'">` :
                                    `<div class="placeholder-thumbnail">📖</div>`
                                }
                            </div>
                            <div class="book-info">
                                <h3>${book.title}</h3>
                                <p>${book.author}</p>
                                ${book.loadError ? '<span class="error-indicator">⚠ Load Error</span>' : ''}
                                ${book.isRBook ? '<span class="format-indicator">.rbook</span>' : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
                
                <div class="library-footer">
                    <input type="file" id="book-file-input" accept=".rbook,.zip" style="display: none;" onchange="this.handleBookUpload(event)">
                    <button onclick="document.getElementById('book-file-input').click()" class="add-book-btn">📁 Load .rbook File</button>
                    <button onclick="window.app.showBookCreator()" class="add-book-btn">➕ Create New Book</button>
                </div>
            </div>
        `;
        
        // Attach file upload handler
        const fileInput = document.getElementById('book-file-input');
        fileInput.onchange = (event) => this.handleBookUpload(event);
    }
    
    showBookCreator() {
        const appContainer = document.getElementById('app-container');
        
        appContainer.innerHTML = `
            <div class="creator-container">
                <header class="creator-header">
                    <h1>✏️ Create New Book</h1>
                    <p>Build your own reading book with images and text</p>
                </header>
                
                <main class="creator-main">
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
                    </section>
                    
                    <section class="pages-section">
                        <h2>Pages</h2>
                        <div class="pages-list" id="pages-list">
                            <!-- Pages will be added here -->
                        </div>
                        <button onclick="window.app.addNewPage()" class="add-page-btn">
                            ➕ Add New Page
                        </button>
                    </section>
                    
                    <section class="thumbnail-section">
                        <h2>Book Thumbnail</h2>
                        <div class="thumbnail-upload">
                            <div class="thumbnail-preview" id="thumbnail-preview">
                                <div class="thumbnail-preview-placeholder">
                                    150×150<br>Thumbnail
                                </div>
                            </div>
                            <div class="thumbnail-controls">
                                <p>Upload a custom thumbnail or leave blank to use the first page image.</p>
                                <input type="file" id="thumbnail-input" accept="image/*" onchange="window.app.handleThumbnailUpload(event)">
                                <label for="thumbnail-input" class="file-input-label">Choose Thumbnail</label>
                            </div>
                        </div>
                    </section>
                </main>
                
                <footer class="creator-footer">
                    <button onclick="window.app.returnToLibrary()" class="creator-btn secondary">Cancel</button>
                    <button onclick="window.app.generateBook()" class="creator-btn primary" id="generate-book-btn">
                        📚 Generate .rbook File
                    </button>
                </footer>
            </div>
        `;
    }
    
    addPageEditor(pageIndex) {
        const pagesList = document.getElementById('pages-list');
        if (!pagesList) return;
        
        const pageDiv = document.createElement('div');
        pageDiv.className = 'page-editor';
        pageDiv.id = `page-editor-${pageIndex}`;
        
        pageDiv.innerHTML = `
            <div class="page-editor-header">
                <h3>Page ${pageIndex + 1}</h3>
                <button onclick="window.app.deletePage(${pageIndex})" class="delete-page-btn">🗑️ Delete</button>
            </div>
            <div class="page-editor-content">
                <div class="page-image-upload">
                    <div class="image-upload-area" id="image-upload-${pageIndex}" onclick="document.getElementById('image-input-${pageIndex}').click()">
                        <div class="upload-placeholder">
                            <p>📷 Click to upload image</p>
                            <p>JPG, PNG supported</p>
                        </div>
                    </div>
                    <input type="file" id="image-input-${pageIndex}" accept="image/*" onchange="window.app.handlePageImageUpload(${pageIndex}, event)">
                </div>
                <div class="page-text-input">
                    <textarea id="text-input-${pageIndex}" placeholder="Enter the text for this page..." onchange="window.app.updatePageText(${pageIndex}, this.value)"></textarea>
                </div>
            </div>
        `;
        
        pagesList.appendChild(pageDiv);
    }
    
    updatePageEditor(pageIndex, page) {
        const imageUploadArea = document.getElementById(`image-upload-${pageIndex}`);
        const textInput = document.getElementById(`text-input-${pageIndex}`);
        
        if (imageUploadArea && page.imageUrl) {
            imageUploadArea.classList.add('has-image');
            imageUploadArea.innerHTML = `<img src="${page.imageUrl}" alt="Page ${pageIndex + 1}" class="uploaded-image">`;
        }
        
        if (textInput) {
            textInput.value = page.text;
        }
    }
    
    removePageEditor(pageIndex) {
        const pageEditor = document.getElementById(`page-editor-${pageIndex}`);
        if (pageEditor) {
            pageEditor.remove();
        }
    }
    
    updatePageNumbers() {
        const pageEditors = document.querySelectorAll('.page-editor');
        pageEditors.forEach((editor, index) => {
            const header = editor.querySelector('.page-editor-header h3');
            if (header) {
                header.textContent = `Page ${index + 1}`;
            }
            
            // Update IDs and event handlers
            editor.id = `page-editor-${index}`;
            
            const deleteBtn = editor.querySelector('.delete-page-btn');
            if (deleteBtn) {
                deleteBtn.onclick = () => window.app.deletePage(index);
            }
            
            const imageUpload = editor.querySelector('.image-upload-area');
            const imageInput = editor.querySelector('input[type="file"]');
            const textInput = editor.querySelector('textarea');
            
            if (imageUpload) imageUpload.id = `image-upload-${index}`;
            if (imageInput) {
                imageInput.id = `image-input-${index}`;
                imageInput.onchange = (e) => window.app.handlePageImageUpload(index, e);
                imageUpload.onclick = () => imageInput.click();
            }
            if (textInput) {
                textInput.id = `text-input-${index}`;
                textInput.onchange = (e) => window.app.updatePageText(index, e.target.value);
            }
        });
    }
    
    updateThumbnailPreview(imageUrl) {
        const thumbnailPreview = document.getElementById('thumbnail-preview');
        if (thumbnailPreview) {
            if (imageUrl) {
                thumbnailPreview.innerHTML = `<img src="${imageUrl}" alt="Thumbnail" style="width: 100%; height: 100%; object-fit: cover;">`;
            } else {
                thumbnailPreview.innerHTML = `
                    <div class="thumbnail-preview-placeholder">
                        150×150<br>Thumbnail
                    </div>
                `;
            }
        }
    }
    
    updateGenerateButton(enabled) {
        const generateBtn = document.getElementById('generate-book-btn');
        if (generateBtn) {
            generateBtn.disabled = !enabled;
        }
    }
    
    showPlayer() {
        const appContainer = document.getElementById('app-container');
        
        appContainer.innerHTML = `
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
                        <div class="image-placeholder">
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
            </div>
        `;
    }
    
    updatePageDisplay(page, pageIndex) {
        this.updateTextHighlight(page.text, 0);
        const img = document.getElementById('page-image');
        const placeholder = document.querySelector('.image-placeholder');
        
        if (img) {
            img.src = page.image;
            img.style.display = 'none';
        }
        if (placeholder) {
            placeholder.style.display = 'flex';
        }
    }
    
    updateBookTitle(title) {
        const bookTitleElement = document.getElementById('book-title');
        if (bookTitleElement) {
            bookTitleElement.textContent = title;
        }
    }
    
    updateNavigation(currentIndex, totalPages) {
        const prevBtn = document.getElementById('prev-page');
        const nextBtn = document.getElementById('next-page');
        const counter = document.getElementById('page-counter');
        
        if (!prevBtn || !nextBtn || !counter) return;
        
        counter.textContent = `Page ${currentIndex + 1}/${totalPages}`;
        
        if (currentIndex === 0) {
            prevBtn.classList.add('hidden');
        } else {
            prevBtn.classList.remove('hidden');
        }
        
        if (currentIndex === totalPages - 1) {
            nextBtn.classList.add('hidden');
        } else {
            nextBtn.classList.remove('hidden');
        }
    }
    
    updateTextHighlight(fullText, matchedWordsCount) {
        const words = fullText.match(/\S+/g) || [];
        const afterWord = [];
        
        let lastIndex = 0;
        words.forEach(word => {
            const wordStart = fullText.indexOf(word, lastIndex);
            const wordEnd = wordStart + word.length;
            const nextWordMatch = fullText.substring(wordEnd).match(/\S/);
            const spaceAfter = nextWordMatch 
                ? fullText.substring(wordEnd, wordEnd + fullText.substring(wordEnd).indexOf(nextWordMatch[0]))
                : fullText.substring(wordEnd);
            afterWord.push(spaceAfter);
            lastIndex = wordEnd;
        });
        
        const highlighted = words.map((word, i) => {
            const space = afterWord[i] || '';
            if (i < matchedWordsCount) {
                return `<span style="color:green; font-weight:bold;">${word}</span>${space}`;
            } else if (i === matchedWordsCount) {
                return `<span style="background-color:#ffffcc;">${word}</span>${space}`;
            }
            return word + space;
        });
        
        const textElement = document.getElementById('page-text');
        if (textElement) {
            textElement.innerHTML = highlighted.join('');
        }
    }
    
    showPageComplete() {
        const img = document.getElementById('page-image');
        const placeholder = document.querySelector('.image-placeholder');
        
        if (img && placeholder) {
            // Hide placeholder first
            placeholder.style.display = 'none';
            // Show image with proper sizing
            img.style.display = 'block';
        }
    }
    
    showFeedback(message, type = 'info') {
        this.clearFeedback();
        
        const feedback = document.createElement('div');
        feedback.id = 'feedback';
        feedback.textContent = message;
        feedback.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 10px 20px;
            border-radius: 25px;
            font-weight: bold;
            font-size: 1.1rem;
            z-index: 1000;
            animation: slideIn 0.3s ease;
            ${type === 'success' ? 'background: #27ae60; color: white;' : 
              type === 'error' ? 'background: #e74c3c; color: white;' :
              type === 'encourage' ? 'background: #f39c12; color: white;' :
              'background: #3498db; color: white;'}
        `;
        
        document.body.appendChild(feedback);
        setTimeout(() => this.clearFeedback(), 2000);
    }
    
    clearFeedback() {
        const existing = document.getElementById('feedback');
        if (existing) existing.remove();
    }
    
    playSuccessSound() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.1);
            oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.2);
            
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
        } catch (error) {
            // Silently fail if audio context is not available
        }
    }
    
    async handleBookUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        try {
            this.showFeedback('Loading book...', 'info');
            
            const bookInfo = await window.app.bookManager.handleBookUpload(file);
            window.app.bookManager.availableBooks.push(bookInfo);
            
            this.showLibrary(window.app.bookManager.availableBooks);
            this.showFeedback(`Book "${bookInfo.title}" loaded successfully!`, 'success');
            
        } catch (error) {
            this.showFeedback(`Error loading book: ${error.message}`, 'error');
            console.error('Book upload error:', error);
        }
        
        event.target.value = '';
    }
}