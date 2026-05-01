/**
 * BetaCharacterStore - separate IndexedDB store for the Beta character workflow.
 *
 * Uses its own database so it does not collide with the existing
 * CharacterManager (PiqueCharacterDB). Each character record stores:
 *   - id, name, description, style, createdAt
 *   - sheet:      Blob of the generated T-pose + headshot character sheet
 *   - sheetMeta:  { prompt, sourceFilenames }
 *   - references: Blob[] of the original user-uploaded reference images
 */

class BetaCharacterStore {
    constructor() {
        this.db = null;
        this.dbName = 'PiqueBetaCharacterDB';
        this.dbVersion = 1;
        this.storeName = 'betaCharacters';
    }

    async init() {
        if (this.db) return;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.dbName, this.dbVersion);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
                this.db = req.result;
                resolve();
            };
            req.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                    store.createIndex('name', 'name', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
            };
        });
    }

    generateId() {
        return `beta_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }

    async saveCharacter(character) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([this.storeName], 'readwrite');
            const store = tx.objectStore(this.storeName);
            const req = store.put(character);
            req.onsuccess = () => resolve(character.id);
            req.onerror = () => reject(req.error);
        });
    }

    async createCharacter({ name, description, style, sheetBlob, sheetPrompt, referenceBlobs }) {
        await this.init();
        const character = {
            id: this.generateId(),
            name: name.trim(),
            description: (description || '').trim(),
            style: style || 'children_book',
            sheet: sheetBlob,
            sheetMeta: { prompt: sheetPrompt || '' },
            references: referenceBlobs || [],
            createdAt: new Date().toISOString()
        };
        await this.saveCharacter(character);
        return character;
    }

    async getCharacter(id) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([this.storeName], 'readonly');
            const req = tx.objectStore(this.storeName).get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    async getAllCharacters() {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([this.storeName], 'readonly');
            const req = tx.objectStore(this.storeName).getAll();
            req.onsuccess = () => {
                const list = req.result || [];
                list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                resolve(list);
            };
            req.onerror = () => reject(req.error);
        });
    }

    async deleteCharacter(id) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([this.storeName], 'readwrite');
            const req = tx.objectStore(this.storeName).delete(id);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async findByName(name) {
        if (!name) return null;
        const all = await this.getAllCharacters();
        const lower = name.trim().toLowerCase();
        return all.find(c => c.name.toLowerCase() === lower) || null;
    }
}

window.betaCharacterStore = new BetaCharacterStore();
