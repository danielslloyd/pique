// Player Controller - Manages the book reading interface
class PlayerController {
    constructor() {
        this.currentPageIndex = 0;
        this.bookData = null;
        this.currentWordIndex = 0;
        this.hasPlayedSuccessSound = false;
        this.speechEngine = new SpeechEngine();
        this.keyboard = new KeyboardHandler();
    }

    async render(data) {
        console.log('Player controller render with data:', data);
        
        // Extract book data from the navigation data
        this.bookData = data.bookData;
        this.currentPageIndex = 0;
        this.currentWordIndex = 0;
        this.hasPlayedSuccessSound = false;
        
        if (!this.bookData || !this.bookData.pages) {
            console.error('No book data provided to player');
            FeedbackManager.show('Error: No book data available', 'error');
            return;
        }

        // Render the player interface
        DOM.$('app-container').innerHTML = PlayerView.render();
        this.attachEvents();
        
        // Update book title and show first page
        this.updateBookTitle(data.title || this.bookData.title || 'Unknown Book');
        this.showPage(0);
    }

    attachEvents() {
        const prevBtn = DOM.$('prev-page');
        const nextBtn = DOM.$('next-page');
        
        if (prevBtn) prevBtn.onclick = () => this.prevPage();
        if (nextBtn) nextBtn.onclick = () => this.nextPage();
        
        this.keyboard.init(this);
    }

    showPage(index) {
        if (!this.bookData?.pages || index < 0 || index >= this.bookData.pages.length) {
            console.error('Invalid page index or no pages available');
            return;
        }

        const page = this.bookData.pages[index];
        this.currentPageIndex = index;
        this.currentWordIndex = 0;
        this.hasPlayedSuccessSound = false;
        
        console.log('Showing page:', index, page);
        
        // Update page display
        this.updatePageDisplay(page, index);
        this.updateNavigation(index, this.bookData.pages.length);
        FeedbackManager.clear();
        
        // Start speech recognition
        this.speechEngine.startListening(this);
    }

    updatePageDisplay(page, pageIndex) {
        console.log('Updating page display for page:', pageIndex);
        console.log('Page data:', page);
        console.log('Image URL:', page.image);
        console.log('Image URL type:', typeof page.image);
        console.log('Image URL starts with blob:', page.image?.startsWith('blob:'));
        
        this.updateTextHighlight(page.text, 0);
        
        const img = DOM.$('page-image');
        const placeholder = DOM.$('image-placeholder');
        
        if (img && page.image) {
            console.log('Setting image src to:', page.image);
            
            // Test if the blob URL is still valid
            fetch(page.image)
                .then(response => {
                    console.log('Blob URL fetch test response:', response.status, response.statusText);
                    if (!response.ok) {
                        console.error('Blob URL is not accessible:', response.status);
                    }
                })
                .catch(error => {
                    console.error('Blob URL fetch test failed:', error);
                });
            
            img.src = page.image;
            img.style.display = 'none';
            
            // Add error handling for image loading
            img.onerror = (event) => {
                console.error('Image failed to load:', page.image);
                console.error('Error event:', event);
                if (placeholder) {
                    placeholder.innerHTML = '<p>❌ Image failed to load</p>';
                }
            };
            
            img.onload = () => {
                console.log('Image loaded successfully:', page.image);
            };
        } else {
            console.warn('No image element found or no image URL provided');
            console.log('img element:', img);
            console.log('page.image:', page.image);
        }
        
        if (placeholder) {
            placeholder.style.display = 'flex';
            placeholder.innerHTML = '<p>🎯 Read the text aloud to unlock the picture!</p>';
        }
    }

    updateBookTitle(title) {
        const bookTitleElement = DOM.$('book-title');
        if (bookTitleElement) {
            bookTitleElement.textContent = title;
        }
    }

    updateNavigation(currentIndex, totalPages) {
        const prevBtn = DOM.$('prev-page');
        const nextBtn = DOM.$('next-page');
        const counter = DOM.$('page-counter');
        
        if (!prevBtn || !nextBtn || !counter) return;
        
        counter.textContent = `Page ${currentIndex + 1}/${totalPages}`;
        
        DOM.toggleClass(prevBtn, 'hidden', currentIndex === 0);
        DOM.toggleClass(nextBtn, 'hidden', currentIndex === totalPages - 1);
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
        
        const textElement = DOM.$('page-text');
        if (textElement) {
            textElement.innerHTML = highlighted.join('');
        }
    }

    showPageComplete() {
        console.log('Showing page complete - revealing image');
        
        const img = DOM.$('page-image');
        const placeholder = DOM.$('image-placeholder');
        
        console.log('Image element:', img);
        console.log('Placeholder element:', placeholder);
        console.log('Image src:', img?.src);
        
        if (img && placeholder) {
            // Hide placeholder first
            placeholder.style.display = 'none';
            // Show image with proper sizing
            img.style.display = 'block';
            console.log('Image should now be visible');
        } else {
            console.error('Could not find image or placeholder elements');
            if (!img) console.error('Image element not found');
            if (!placeholder) console.error('Placeholder element not found');
        }
    }

    nextPage() {
        if (!this.bookData?.pages) {
            console.error('No book data available for navigation');
            return;
        }
        
        if (this.currentPageIndex < this.bookData.pages.length - 1) {
            this.currentPageIndex++;
            this.showPage(this.currentPageIndex);
        } else {
            FeedbackManager.show("🎊 Congratulations! You've finished the book!", 'success');
            FeedbackManager.playSuccessSound();
            
            setTimeout(() => {
                window.app.returnToLibrary();
            }, 3000);
        }
    }

    prevPage() {
        if (!this.bookData?.pages) {
            console.error('No book data available for navigation');
            return;
        }
        
        if (this.currentPageIndex > 0) {
            this.currentPageIndex--;
            this.showPage(this.currentPageIndex);
        }
    }

    onWordMatched(matchCount) {
        this.currentWordIndex += matchCount;
        this.updateTextHighlight(
            this.bookData.pages[this.currentPageIndex].text, 
            this.currentWordIndex
        );
        
        // Check if page is complete
        const expectedWords = this.bookData.pages[this.currentPageIndex].text.trim().split(' ');
        if (this.currentWordIndex >= expectedWords.length) {
            this.showPageComplete();
            
            if (!this.hasPlayedSuccessSound) {
                FeedbackManager.show('🎉 Page complete! Picture unlocked!', 'success');
                FeedbackManager.playSuccessSound();
                this.hasPlayedSuccessSound = true;
                this.speechEngine.stop();
            }
        }
    }

    getCurrentExpectedWord() {
        if (!this.bookData?.pages[this.currentPageIndex]) return null;
        const words = this.bookData.pages[this.currentPageIndex].text.trim().split(' ');
        return words[this.currentWordIndex] || null;
    }

    revealPicture() {
        this.showPageComplete();
        FeedbackManager.show('🖼️ Picture revealed!', 'success');
        FeedbackManager.playSuccessSound();
    }

    skipToNextWord() {
        if (!this.bookData?.pages[this.currentPageIndex]) return;
        
        const expectedWords = this.bookData.pages[this.currentPageIndex].text.trim().split(' ');
        if (this.currentWordIndex < expectedWords.length) {
            this.currentWordIndex++;
            this.updateTextHighlight(
                this.bookData.pages[this.currentPageIndex].text, 
                this.currentWordIndex
            );
            FeedbackManager.show('⭐ Skipped word!', 'info');
            
            // Check if page is complete after skipping
            if (this.currentWordIndex >= expectedWords.length) {
                this.showPageComplete();
                if (!this.hasPlayedSuccessSound) {
                    FeedbackManager.show('🎉 Page complete! Picture unlocked!', 'success');
                    FeedbackManager.playSuccessSound();
                    this.hasPlayedSuccessSound = true;
                    this.speechEngine.stop();
                }
            }
        }
    }

    cleanup() {
        // Stop speech recognition
        if (this.speechEngine) {
            this.speechEngine.stop();
        }
        
        // Reset state
        this.currentPageIndex = 0;
        this.bookData = null;
        this.currentWordIndex = 0;
        this.hasPlayedSuccessSound = false;
        
        if (this.speechEngine) {
            this.speechEngine.reset();
        }
    }
}