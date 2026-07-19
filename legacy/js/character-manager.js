/**
 * CharacterManager - Manages character data with IndexedDB persistence
 * Supports storing character images, metadata, and generation history for multi-book consistency
 */

class CharacterManager {
    constructor() {
        this.db = null;
        this.dbName = 'PiqueCharacterDB';
        this.dbVersion = 1;
        this.characters = new Map(); // In-memory cache
    }

    /**
     * Initialize IndexedDB connection
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Characters store
                if (!db.objectStoreNames.contains('characters')) {
                    const characterStore = db.createObjectStore('characters', { keyPath: 'id' });
                    characterStore.createIndex('name', 'name', { unique: false });
                    characterStore.createIndex('createdAt', 'createdAt', { unique: false });
                    characterStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
                }

                // Character images store (separate for better performance)
                if (!db.objectStoreNames.contains('characterImages')) {
                    const imageStore = db.createObjectStore('characterImages', { keyPath: 'id' });
                    imageStore.createIndex('characterId', 'characterId', { unique: false });
                    imageStore.createIndex('variant', 'variant', { unique: false });
                }

                // Generation history store
                if (!db.objectStoreNames.contains('generationHistory')) {
                    const historyStore = db.createObjectStore('generationHistory', {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    historyStore.createIndex('characterId', 'characterId', { unique: false });
                    historyStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    /**
     * Create a new character
     * @param {Object} characterData - Character metadata
     * @param {string} characterData.name - Character name
     * @param {string} characterData.description - Character description
     * @param {Array<string>} characterData.tags - Character tags for organization
     * @param {Object} characterData.attributes - Custom attributes (age, species, etc.)
     * @returns {Promise<string>} Character ID
     */
    async createCharacter(characterData) {
        const character = {
            id: this.generateId(),
            name: characterData.name,
            description: characterData.description || '',
            tags: characterData.tags || [],
            attributes: characterData.attributes || {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            books: [], // List of book IDs this character appears in
            metadata: {
                artStyle: characterData.artStyle || 'children_book',
                primaryImage: null, // ID of primary character image
                totalImages: 0,
                totalGenerations: 0
            }
        };

        await this.saveCharacter(character);
        this.characters.set(character.id, character);
        return character.id;
    }

    /**
     * Save character to IndexedDB
     */
    async saveCharacter(character) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['characters'], 'readwrite');
            const store = transaction.objectStore('characters');
            const request = store.put(character);

            request.onsuccess = () => resolve(character.id);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get character by ID
     */
    async getCharacter(characterId) {
        // Check cache first
        if (this.characters.has(characterId)) {
            return this.characters.get(characterId);
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['characters'], 'readonly');
            const store = transaction.objectStore('characters');
            const request = store.get(characterId);

            request.onsuccess = () => {
                const character = request.result;
                if (character) {
                    this.characters.set(characterId, character);
                }
                resolve(character);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get all characters
     */
    async getAllCharacters() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['characters'], 'readonly');
            const store = transaction.objectStore('characters');
            const request = store.getAll();

            request.onsuccess = () => {
                const characters = request.result;
                // Update cache
                characters.forEach(char => this.characters.set(char.id, char));
                resolve(characters);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Update character metadata
     */
    async updateCharacter(characterId, updates) {
        const character = await this.getCharacter(characterId);
        if (!character) {
            throw new Error(`Character ${characterId} not found`);
        }

        Object.assign(character, updates);
        character.updatedAt = new Date().toISOString();

        await this.saveCharacter(character);
        this.characters.set(characterId, character);
        return character;
    }

    /**
     * Delete character and all associated data
     */
    async deleteCharacter(characterId) {
        const transaction = this.db.transaction(
            ['characters', 'characterImages', 'generationHistory'],
            'readwrite'
        );

        // Delete character
        transaction.objectStore('characters').delete(characterId);

        // Delete all images
        const imageStore = transaction.objectStore('characterImages');
        const imageIndex = imageStore.index('characterId');
        const imageRequest = imageIndex.openCursor(IDBKeyRange.only(characterId));

        imageRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                imageStore.delete(cursor.primaryKey);
                cursor.continue();
            }
        };

        // Delete all generation history
        const historyStore = transaction.objectStore('generationHistory');
        const historyIndex = historyStore.index('characterId');
        const historyRequest = historyIndex.openCursor(IDBKeyRange.only(characterId));

        historyRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                historyStore.delete(cursor.primaryKey);
                cursor.continue();
            }
        };

        this.characters.delete(characterId);

        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * Add image to character
     * @param {string} characterId - Character ID
     * @param {Blob} imageBlob - Image data
     * @param {Object} metadata - Image metadata
     * @returns {Promise<string>} Image ID
     */
    async addCharacterImage(characterId, imageBlob, metadata = {}) {
        const character = await this.getCharacter(characterId);
        if (!character) {
            throw new Error(`Character ${characterId} not found`);
        }

        const imageData = {
            id: this.generateId(),
            characterId: characterId,
            blob: imageBlob,
            variant: metadata.variant || 'default', // e.g., 'neutral', 'happy', 'sad'
            expression: metadata.expression || null,
            pose: metadata.pose || null,
            generatedFrom: metadata.generatedFrom || null, // 'dall-e', 'comfyui', 'upload'
            workflowId: metadata.workflowId || null,
            createdAt: new Date().toISOString(),
            metadata: metadata
        };

        await this.saveImage(imageData);

        // Update character metadata
        character.metadata.totalImages++;
        if (!character.metadata.primaryImage) {
            character.metadata.primaryImage = imageData.id;
        }
        await this.saveCharacter(character);

        return imageData.id;
    }

    /**
     * Save image to IndexedDB
     */
    async saveImage(imageData) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['characterImages'], 'readwrite');
            const store = transaction.objectStore('characterImages');
            const request = store.put(imageData);

            request.onsuccess = () => resolve(imageData.id);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get all images for a character
     */
    async getCharacterImages(characterId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['characterImages'], 'readonly');
            const store = transaction.objectStore('characterImages');
            const index = store.index('characterId');
            const request = index.getAll(characterId);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get specific image by ID
     */
    async getImage(imageId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['characterImages'], 'readonly');
            const store = transaction.objectStore('characterImages');
            const request = store.get(imageId);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Set primary image for character
     */
    async setPrimaryImage(characterId, imageId) {
        const character = await this.getCharacter(characterId);
        const image = await this.getImage(imageId);

        if (!character || !image || image.characterId !== characterId) {
            throw new Error('Invalid character or image ID');
        }

        character.metadata.primaryImage = imageId;
        await this.saveCharacter(character);
        return character;
    }

    /**
     * Record generation history
     */
    async addGenerationRecord(characterId, generationData) {
        const character = await this.getCharacter(characterId);
        if (!character) {
            throw new Error(`Character ${characterId} not found`);
        }

        const record = {
            characterId: characterId,
            timestamp: new Date().toISOString(),
            workflowType: generationData.workflowType || 'unknown',
            workflowData: generationData.workflowData || {},
            prompt: generationData.prompt || '',
            parameters: generationData.parameters || {},
            resultImageIds: generationData.resultImageIds || [],
            cost: generationData.cost || 0,
            provider: generationData.provider || 'unknown', // 'dall-e', 'comfyui', etc.
            success: generationData.success !== false
        };

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['generationHistory', 'characters'], 'readwrite');
            const historyStore = transaction.objectStore('generationHistory');
            const request = historyStore.add(record);

            request.onsuccess = () => {
                // Update character generation count
                character.metadata.totalGenerations++;
                transaction.objectStore('characters').put(character);
            };

            transaction.oncomplete = () => resolve(request.result);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * Get generation history for character
     */
    async getGenerationHistory(characterId, limit = 50) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['generationHistory'], 'readonly');
            const store = transaction.objectStore('generationHistory');
            const index = store.index('characterId');
            const request = index.getAll(characterId);

            request.onsuccess = () => {
                const results = request.result;
                // Sort by timestamp descending and limit
                results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                resolve(results.slice(0, limit));
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Search characters by tag
     */
    async searchByTag(tag) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['characters'], 'readonly');
            const store = transaction.objectStore('characters');
            const index = store.index('tags');
            const request = index.getAll(tag);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Associate character with a book
     */
    async addCharacterToBook(characterId, bookId) {
        const character = await this.getCharacter(characterId);
        if (!character) {
            throw new Error(`Character ${characterId} not found`);
        }

        if (!character.books.includes(bookId)) {
            character.books.push(bookId);
            await this.saveCharacter(character);
        }
        return character;
    }

    /**
     * Get all characters used in a book
     */
    async getCharactersByBook(bookId) {
        const allCharacters = await this.getAllCharacters();
        return allCharacters.filter(char => char.books.includes(bookId));
    }

    /**
     * Generate unique ID
     */
    generateId() {
        return `char_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Export character data (for backup/transfer)
     */
    async exportCharacter(characterId) {
        const character = await this.getCharacter(characterId);
        const images = await this.getCharacterImages(characterId);
        const history = await this.getGenerationHistory(characterId);

        // Convert image blobs to base64 for export
        const imagesWithBase64 = await Promise.all(
            images.map(async (img) => {
                const base64 = await this.blobToBase64(img.blob);
                return { ...img, blob: base64 };
            })
        );

        return {
            character,
            images: imagesWithBase64,
            history,
            exportedAt: new Date().toISOString(),
            version: 1
        };
    }

    /**
     * Import character data
     */
    async importCharacter(exportData) {
        const { character, images, history } = exportData;

        // Generate new ID to avoid conflicts
        const oldId = character.id;
        character.id = this.generateId();
        character.name = `${character.name} (imported)`;

        // Save character
        await this.saveCharacter(character);

        // Import images
        for (const img of images) {
            const blob = await this.base64ToBlob(img.blob);
            const newImageData = { ...img, blob, characterId: character.id };
            await this.saveImage(newImageData);
        }

        // Import history (optional)
        if (history && history.length > 0) {
            for (const record of history) {
                record.characterId = character.id;
                const transaction = this.db.transaction(['generationHistory'], 'readwrite');
                transaction.objectStore('generationHistory').add(record);
            }
        }

        return character.id;
    }

    /**
     * Utility: Blob to Base64
     */
    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Utility: Base64 to Blob
     */
    base64ToBlob(base64) {
        return fetch(base64).then(res => res.blob());
    }

    /**
     * Get database statistics
     */
    async getStats() {
        const characters = await this.getAllCharacters();

        let totalImages = 0;
        let totalGenerations = 0;

        for (const char of characters) {
            totalImages += char.metadata.totalImages || 0;
            totalGenerations += char.metadata.totalGenerations || 0;
        }

        return {
            totalCharacters: characters.length,
            totalImages,
            totalGenerations,
            dbSize: await this.estimateDBSize()
        };
    }

    /**
     * Estimate IndexedDB size (approximate)
     */
    async estimateDBSize() {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            const estimate = await navigator.storage.estimate();
            return {
                usage: estimate.usage,
                quota: estimate.quota,
                usageInMB: (estimate.usage / (1024 * 1024)).toFixed(2),
                quotaInMB: (estimate.quota / (1024 * 1024)).toFixed(2)
            };
        }
        return null;
    }
}

// Export singleton instance
const characterManager = new CharacterManager();
