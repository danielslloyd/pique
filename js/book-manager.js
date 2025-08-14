// Book Management and File Handling
class BookManager {
    constructor() {
        this.availableBooks = [];
        this.loadedBooks = new Map(); // Cache for loaded .rbook files
    }
    
    async createThumbnailWithWhiteBackground(imageBlob) {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            
            img.onload = () => {
                // Set canvas size to be square (use the smaller dimension for crop)
                const size = Math.min(img.width, img.height);
                canvas.width = size;
                canvas.height = size;
                
                // Fill with white background first
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, size, size);
                
                // Calculate positioning to center and crop the image
                const sourceX = (img.width - size) / 2;
                const sourceY = (img.height - size) / 2;
                
                // Draw the cropped image to fill the entire canvas
                ctx.drawImage(img, sourceX, sourceY, size, size, 0, 0, size, size);
                
                // Convert to blob and create URL
                canvas.toBlob((blob) => {
                    const url = URL.createObjectURL(blob);
                    resolve(url);
                }, 'image/jpeg', 0.9);
            };
            
            img.src = URL.createObjectURL(imageBlob);
        });
    }
    
    async loadAvailableBooks() {
        try {
            const bookFiles = await this.scanForRBookFiles();
            
            if (bookFiles.length > 0) {
                this.availableBooks = await Promise.all(
                    bookFiles.map(filename => this.loadBookMetadata(filename))
                );
            } else {
                // Fallback for development - legacy format
                this.availableBooks = [
                    {
                        id: 'sample-book',
                        title: 'Sample Reading Book',
                        author: 'Demo Author',
                        filename: 'sampleBook.json',
                        thumbnail: './books/sampleBook/page1-square.jpg',
                        isLegacy: true
                    }
                ];
            }
        } catch (error) {
            console.warn('Could not load books, using defaults');
            this.availableBooks = [
                {
                    id: 'sample-book',
                    title: 'Sample Reading Book', 
                    author: 'Demo Author',
                    filename: 'sampleBook.json',
                    thumbnail: './books/sampleBook/page1-square.jpg',
                    isLegacy: true
                }
            ];
        }
    }
    
    async scanForRBookFiles() {
        try {
            const response = await fetch('./books/available-books.json');
            if (response.ok) {
                const files = await response.json();
                return files.filter(f => f.endsWith('.rbook'));
            }
        } catch (error) {
            console.warn('No book manifest found');
        }
        
        // Fallback: try known book files
        const knownBooks = ['sample-book.rbook', 'adventure-tales.rbook', 'animal-friends.rbook'];
        const availableBooks = [];
        
        for (const bookFile of knownBooks) {
            try {
                const response = await fetch(`./books/${bookFile}`, { method: 'HEAD' });
                if (response.ok) {
                    availableBooks.push(bookFile);
                }
            } catch (e) {
                // Book doesn't exist, skip
            }
        }
        
        return availableBooks;
    }
    
    async loadBookMetadata(rbookFilename) {
        try {
            const bookData = await this.loadRBookFile(rbookFilename);
            return {
                id: bookData.metadata.id,
                title: bookData.metadata.title,
                author: bookData.metadata.author,
                description: bookData.metadata.description || '',
                filename: rbookFilename,
                thumbnail: bookData.thumbnailUrl,
                isRBook: true
            };
        } catch (error) {
            console.error(`Failed to load metadata for ${rbookFilename}:`, error);
            return {
                id: rbookFilename.replace('.rbook', ''),
                title: rbookFilename.replace('.rbook', '').replace('-', ' '),
                author: 'Unknown Author',
                filename: rbookFilename,
                thumbnail: null,
                isRBook: true,
                loadError: true
            };
        }
    }
    
    async loadBook(filename) {
        if (filename.endsWith('.rbook')) {
            const rbookData = await this.loadRBookFile(filename);
            return {
                title: rbookData.metadata.title,
                author: rbookData.metadata.author,
                pages: rbookData.pages
            };
        } else {
            // Legacy JSON format
            const res = await fetch(`./books/${filename}`);
            if (!res.ok) throw new Error('Book not found');
            return await res.json();
        }
    }
    
    async loadRBookFile(filename) {
        if (this.loadedBooks.has(filename)) {
            return this.loadedBooks.get(filename);
        }
        
        try {
            const response = await fetch(`./books/${filename}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const arrayBuffer = await response.arrayBuffer();
            const zip = await JSZip.loadAsync(arrayBuffer);
            
            // Extract book.json
            const bookJsonFile = zip.file('book.json');
            if (!bookJsonFile) throw new Error('book.json not found in .rbook file');
            
            const bookJsonText = await bookJsonFile.async('text');
            const bookData = JSON.parse(bookJsonText);
            
            // Extract thumbnail or use first image as fallback
            const thumbnailFile = zip.file('thumbnail.jpg') || zip.file('thumbnail.png');
            let thumbnailUrl = null;
            
            if (thumbnailFile) {
                const thumbnailBlob = await thumbnailFile.async('blob');
                thumbnailUrl = URL.createObjectURL(thumbnailBlob);
            } else if (bookData.pages && bookData.pages.length > 0) {
                // Use first page image as thumbnail with proper PNG handling
                const firstImageName = bookData.pages[0].image;
                const firstImageFile = zip.file(firstImageName);
                if (firstImageFile) {
                    const firstImageBlob = await firstImageFile.async('blob');
                    
                    // If it's a PNG, ensure transparency is preserved
                    if (firstImageName.toLowerCase().endsWith('.png')) {
                        thumbnailUrl = await this.createThumbnailWithWhiteBackground(firstImageBlob);
                    } else {
                        thumbnailUrl = URL.createObjectURL(firstImageBlob);
                    }
                }
            }
            
            // Extract all images and create object URLs
            const imageUrls = {};
            for (const page of bookData.pages) {
                const imageName = page.image;
                const imageFile = zip.file(imageName);
                if (imageFile) {
                    const imageBlob = await imageFile.async('blob');
                    imageUrls[imageName] = URL.createObjectURL(imageBlob);
                    page.image = imageUrls[imageName];
                }
            }
            
            const result = {
                metadata: bookData.metadata || {
                    id: filename.replace('.rbook', ''),
                    title: bookData.title || 'Untitled Book',
                    author: bookData.author || 'Unknown Author'
                },
                pages: bookData.pages,
                thumbnailUrl,
                imageUrls
            };
            
            this.loadedBooks.set(filename, result);
            return result;
            
        } catch (error) {
            console.error(`Error loading .rbook file ${filename}:`, error);
            throw error;
        }
    }
    
    async handleBookUpload(file) {
        const tempFilename = file.name.endsWith('.rbook') ? file.name : file.name + '.rbook';
        const arrayBuffer = await file.arrayBuffer();
        const blob = new Blob([arrayBuffer]);
        
        // Temporarily override fetch for this file
        const originalFetch = window.fetch;
        window.fetch = function(url, options) {
            if (url === `./books/${tempFilename}`) {
                return Promise.resolve(new Response(blob));
            }
            return originalFetch(url, options);
        };
        
        try {
            const bookData = await this.loadRBookFile(tempFilename);
            
            const bookInfo = {
                id: bookData.metadata.id,
                title: bookData.metadata.title,
                author: bookData.metadata.author,
                description: bookData.metadata.description || '',
                filename: tempFilename,
                thumbnail: bookData.thumbnailUrl,
                isRBook: true,
                isUploaded: true
            };
            
            this.availableBooks.push(bookInfo);
            return bookInfo;
            
        } finally {
            window.fetch = originalFetch;
        }
    }
    
    cleanup() {
        // Clean up blob URLs
        this.loadedBooks.forEach((bookData) => {
            if (bookData.thumbnailUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(bookData.thumbnailUrl);
            }
            if (bookData.imageUrls) {
                Object.values(bookData.imageUrls).forEach(url => {
                    if (url.startsWith('blob:')) {
                        URL.revokeObjectURL(url);
                    }
                });
            }
        });
        this.loadedBooks.clear();
    }
}