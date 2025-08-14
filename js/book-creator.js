// Book Creator Functionality
class BookCreator {
    constructor() {
        this.pages = [];
        this.metadata = {
            title: '',
            author: '',
            description: ''
        };
        this.thumbnailBlob = null;
    }

    reset() {
        this.pages = [];
        this.metadata = {
            title: '',
            author: '',
            description: ''
        };
        this.thumbnailBlob = null;
    }

    addPage(imageFile, text) {
        const pageId = `page${this.pages.length + 1}`;
        this.pages.push({
            id: pageId,
            imageFile: imageFile,
            imageName: imageFile ? `${pageId}.${this.getFileExtension(imageFile.name)}` : null,
            text: text.trim(),
            imageUrl: imageFile ? URL.createObjectURL(imageFile) : null
        });
    }

    updatePage(index, imageFile, text) {
        if (index >= 0 && index < this.pages.length) {
            const page = this.pages[index];
            if (imageFile) {
                // Clean up old URL
                if (page.imageUrl) {
                    URL.revokeObjectURL(page.imageUrl);
                }
                page.imageFile = imageFile;
                page.imageName = `page${index + 1}.${this.getFileExtension(imageFile.name)}`;
                page.imageUrl = URL.createObjectURL(imageFile);
            }
            if (text !== undefined) {
                page.text = text.trim();
            }
        }
    }

    deletePage(index) {
        if (index >= 0 && index < this.pages.length) {
            // Clean up image URL
            if (this.pages[index].imageUrl) {
                URL.revokeObjectURL(this.pages[index].imageUrl);
            }
            
            this.pages.splice(index, 1);
            // Renumber remaining pages
            this.pages.forEach((page, i) => {
                const newPageId = `page${i + 1}`;
                page.id = newPageId;
                if (page.imageFile) {
                    page.imageName = `${newPageId}.${this.getFileExtension(page.imageFile.name)}`;
                }
            });
        }
    }

    setMetadata(title, author, description) {
        this.metadata = { title, author, description };
    }

    setThumbnail(imageFile) {
        this.thumbnailBlob = imageFile;
    }

    async createThumbnailFromImage(imageFile) {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            
            img.onload = () => {
                canvas.width = 150;
                canvas.height = 150;
                
                // Fill with white background
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, 150, 150);
                
                // Calculate aspect ratio and positioning
                const size = Math.min(img.width, img.height);
                const sourceX = (img.width - size) / 2;
                const sourceY = (img.height - size) / 2;
                
                // Draw the cropped image
                ctx.drawImage(img, sourceX, sourceY, size, size, 0, 0, 150, 150);
                
                canvas.toBlob((blob) => {
                    resolve(blob);
                }, 'image/jpeg', 0.9);
            };
            
            img.src = URL.createObjectURL(imageFile);
        });
    }

    getFileExtension(filename) {
        return filename.split('.').pop().toLowerCase();
    }

    async generateRBookFile() {
        if (this.pages.length === 0) {
            throw new Error('No pages added to the book');
        }

        if (!this.metadata.title || !this.metadata.author) {
            throw new Error('Title and author are required');
        }

        const zip = new JSZip();

        // Create book.json
        const bookData = {
            metadata: {
                id: this.sanitizeFilename(this.metadata.title),
                title: this.metadata.title,
                author: this.metadata.author,
                description: this.metadata.description
            },
            pages: this.pages.map(page => ({
                image: page.imageName,
                text: page.text
            }))
        };

        zip.file('book.json', JSON.stringify(bookData, null, 2));

        // Add page images
        for (const page of this.pages) {
            if (page.imageFile) {
                zip.file(page.imageName, page.imageFile);
            }
        }

        // Add thumbnail
        if (this.thumbnailBlob) {
            zip.file('thumbnail.jpg', this.thumbnailBlob);
        } else if (this.pages.length > 0 && this.pages[0].imageFile) {
            // Use first page as thumbnail
            const thumbnailBlob = await this.createThumbnailFromImage(this.pages[0].imageFile);
            zip.file('thumbnail.jpg', thumbnailBlob);
        }

        // Generate zip file
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        
        // Download the file
        const filename = `${this.sanitizeFilename(this.metadata.title)}.rbook`;
        this.downloadBlob(zipBlob, filename);

        return filename;
    }

    sanitizeFilename(str) {
        return str.toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    cleanup() {
        // Clean up all object URLs
        this.pages.forEach(page => {
            if (page.imageUrl) {
                URL.revokeObjectURL(page.imageUrl);
            }
        });
    }
}