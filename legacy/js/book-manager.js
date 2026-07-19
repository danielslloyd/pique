// Book Management and File Handling - Fixed Version
class BookManager {
    constructor() {
        this.availableBooks = [];
        this.loadedBooks = new Map(); // Cache for loaded .rbook files
        this.activeBlobUrls = new Set(); // Track active blob URLs
    }
    
    async createThumbnailWithWhiteBackground(imageBlob) {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            
            img.onload = () => {
                const size = Math.min(img.width, img.height);
                canvas.width = size;
                canvas.height = size;
                
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, size, size);
                
                const sourceX = (img.width - size) / 2;
                const sourceY = (img.height - size) / 2;
                
                ctx.drawImage(img, sourceX, sourceY, size, size, 0, 0, size, size);
                
                canvas.toBlob((blob) => {
                    const url = URL.createObjectURL(blob);
                    this.activeBlobUrls.add(url);
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
        console.log('Loading book:', filename);
        
        if (filename.endsWith('.rbook')) {
            const rbookData = await this.loadRBookFile(filename);
            
            // Create a clean book data structure for the player
            const bookData = {
                title: rbookData.metadata.title,
                author: rbookData.metadata.author,
                pages: rbookData.pages.map(page => ({
                    text: page.text,
                    image: page.image // This should be the blob URL
                }))
            };
            
            console.log('Processed book data for player:', bookData);
            console.log('First page image URL:', bookData.pages?.[0]?.image);
            
            return bookData;
        } else {
            // Legacy JSON format
            const res = await fetch(`./books/${filename}`);
            if (!res.ok) throw new Error('Book not found');
            return await res.json();
        }
    }
    
    async loadRBookFile(filename) {
        console.log('Loading .rbook file:', filename);
        
        if (this.loadedBooks.has(filename)) {
            console.log('Returning cached book data for:', filename);
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
            
            console.log('Parsed book metadata:', bookData.metadata);
            console.log('Number of pages:', bookData.pages?.length);
            
            // Extract thumbnail
            const thumbnailFile = zip.file('thumbnail.jpg') || zip.file('thumbnail.png');
            let thumbnailUrl = null;
            
            if (thumbnailFile) {
                const thumbnailBlob = await thumbnailFile.async('blob');
                thumbnailUrl = URL.createObjectURL(thumbnailBlob);
                this.activeBlobUrls.add(thumbnailUrl);
            } else if (bookData.pages && bookData.pages.length > 0) {
                const firstImageName = bookData.pages[0].image;
                const firstImageFile = zip.file(firstImageName);
                if (firstImageFile) {
                    const firstImageBlob = await firstImageFile.async('blob');
                    
                    if (firstImageName.toLowerCase().endsWith('.png')) {
                        thumbnailUrl = await this.createThumbnailWithWhiteBackground(firstImageBlob);
                    } else {
                        thumbnailUrl = URL.createObjectURL(firstImageBlob);
                        this.activeBlobUrls.add(thumbnailUrl);
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
                    const imageUrl = URL.createObjectURL(imageBlob);
                    this.activeBlobUrls.add(imageUrl);
                    imageUrls[imageName] = imageUrl;
                    page.image = imageUrl; // Replace filename with blob URL
                    
                    console.log(`Created blob URL for ${imageName}:`, imageUrl);
                } else {
                    console.warn(`Image file ${imageName} not found in archive`);
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
            console.log('Successfully loaded and cached book:', filename);
            
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
        console.log('Cleaning up BookManager - revoking', this.activeBlobUrls.size, 'blob URLs');
        
        // Clean up blob URLs
        this.activeBlobUrls.forEach(url => {
            URL.revokeObjectURL(url);
        });
        this.activeBlobUrls.clear();
        
        this.loadedBooks.clear();
    }
}