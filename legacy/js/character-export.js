/**
 * character-export.js
 *
 * One-time export utility for the LEGACY Pique app.
 * Adds a small floating "Export characters" button that reads every
 * character (and its images) directly out of IndexedDB and bundles them
 * into a zip file (pique-legacy-characters.zip) for import into the new
 * backend via POST /api/characters/import-legacy.
 *
 * Deliberately standalone: this file does NOT use CharacterManager. It
 * opens PiqueCharacterDB itself with indexedDB.open(), so it works no
 * matter which view/controller is active and whether or not
 * characterManager.init() has run.
 *
 * DB shape (see js/character-manager.js):
 *   characters store (keyPath 'id'):
 *     { id, name, description, tags: [...], attributes: {...},
 *       createdAt, updatedAt, books: [...],
 *       metadata: { artStyle, primaryImage, totalImages, totalGenerations } }
 *
 *   characterImages store (keyPath 'id', index 'characterId'):
 *     { id, characterId, blob, variant, expression, pose,
 *       generatedFrom, workflowId, createdAt, metadata }
 */
(function () {
    'use strict';

    var DB_NAME = 'PiqueCharacterDB';
    var ZIP_FILENAME = 'pique-legacy-characters.zip';

    /**
     * Open PiqueCharacterDB WITHOUT forcing a specific version and WITHOUT
     * creating any object stores. If the database does not already exist,
     * indexedDB.open() will still create an empty version-1 database and
     * fire onupgradeneeded - we detect that case, immediately delete the
     * database we accidentally created, and resolve(null) so the caller can
     * report "no characters" without leaving a stray empty DB behind (which
     * would otherwise block CharacterManager's own future onupgradeneeded
     * from ever running and creating the real object stores).
     */
    function openExistingDatabase() {
        return new Promise(function (resolve, reject) {
            var createdNew = false;
            var request;

            try {
                request = indexedDB.open(DB_NAME);
            } catch (err) {
                reject(err);
                return;
            }

            request.onupgradeneeded = function () {
                // Only fires if the DB didn't already exist (or needs a
                // version bump we don't know about). We don't create any
                // stores here - we just note that this DB is "new".
                createdNew = true;
            };

            request.onsuccess = function () {
                var db = request.result;

                if (createdNew) {
                    db.close();
                    var deleteReq;
                    try {
                        deleteReq = indexedDB.deleteDatabase(DB_NAME);
                    } catch (err) {
                        resolve(null);
                        return;
                    }
                    deleteReq.onsuccess = function () { resolve(null); };
                    deleteReq.onerror = function () { resolve(null); };
                    deleteReq.onblocked = function () { resolve(null); };
                    return;
                }

                resolve(db);
            };

            request.onerror = function () {
                reject(request.error || new Error('Failed to open PiqueCharacterDB'));
            };

            request.onblocked = function () {
                reject(new Error('Opening PiqueCharacterDB was blocked by another connection'));
            };
        });
    }

    function getAllFromStore(db, storeName) {
        return new Promise(function (resolve, reject) {
            try {
                var tx = db.transaction([storeName], 'readonly');
                var store = tx.objectStore(storeName);
                var req = store.getAll();
                req.onsuccess = function () { resolve(req.result || []); };
                req.onerror = function () { reject(req.error); };
            } catch (err) {
                reject(err);
            }
        });
    }

    function sanitizeExt(blob) {
        // Everything is exported as .png per the agreed contract, regardless
        // of the blob's actual mime type - the new backend expects that.
        return 'png';
    }

    async function collectCharacterData() {
        var db = await openExistingDatabase();

        if (!db) {
            return { none: true, reason: 'Pique character database does not exist yet.' };
        }

        if (!db.objectStoreNames.contains('characters')) {
            db.close();
            return { none: true, reason: 'No character data found.' };
        }

        var characters = await getAllFromStore(db, 'characters');

        if (!characters || characters.length === 0) {
            db.close();
            return { none: true, reason: 'No characters have been created yet.' };
        }

        var images = [];
        if (db.objectStoreNames.contains('characterImages')) {
            images = await getAllFromStore(db, 'characterImages');
        }

        db.close();

        return { none: false, characters: characters, images: images };
    }

    function groupImagesByCharacter(images) {
        var map = new Map();
        images.forEach(function (img) {
            if (!img || !img.characterId) return;
            if (!map.has(img.characterId)) map.set(img.characterId, []);
            map.get(img.characterId).push(img);
        });
        return map;
    }

    async function buildZip(characters, images) {
        var zip = new JSZip();
        var imagesFolder = zip.folder('images');
        var imagesByCharacter = groupImagesByCharacter(images);
        var jsonOut = [];

        characters.forEach(function (char, charIndex) {
            var charImages = imagesByCharacter.get(char.id) || [];
            var primaryImageId = char.metadata && char.metadata.primaryImage;
            var primaryImageFilename = null;
            var imageFilenames = [];

            charImages.forEach(function (img, imgIndex) {
                var filename = 'char' + charIndex + '_' + imgIndex + '.' + sanitizeExt(img.blob);
                imageFilenames.push(filename);

                if (img.blob) {
                    imagesFolder.file(filename, img.blob);
                }

                if (primaryImageId && img.id === primaryImageId) {
                    primaryImageFilename = filename;
                }
            });

            jsonOut.push({
                name: char.name || '',
                description: char.description || '',
                tags: Array.isArray(char.tags) ? char.tags : [],
                attributes: (char.attributes && typeof char.attributes === 'object') ? char.attributes : {},
                artStyle: (char.metadata && char.metadata.artStyle) || 'children_book',
                primaryImage: primaryImageFilename,
                images: imageFilenames
            });
        });

        zip.file('characters.json', JSON.stringify(jsonOut, null, 2));

        return zip.generateAsync({ type: 'blob' });
    }

    function downloadBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }

    async function exportLegacyCharacters() {
        try {
            if (typeof indexedDB === 'undefined') {
                alert('IndexedDB is not available in this browser - cannot export characters.');
                return;
            }
            if (typeof JSZip === 'undefined') {
                alert('JSZip failed to load - cannot export characters.');
                return;
            }

            var data = await collectCharacterData();

            if (data.none) {
                alert('No characters found to export.\n\n' + data.reason);
                return;
            }

            var zipBlob = await buildZip(data.characters, data.images);
            downloadBlob(zipBlob, ZIP_FILENAME);
        } catch (err) {
            console.error('Character export failed:', err);
            alert('Character export failed: ' + (err && err.message ? err.message : String(err)));
        }
    }

    function createExportButton() {
        if (document.getElementById('legacy-character-export-btn')) return;

        var btn = document.createElement('button');
        btn.id = 'legacy-character-export-btn';
        btn.type = 'button';
        btn.textContent = '⬇ Export characters';
        btn.title = 'Export all characters from this browser into a zip file';
        btn.style.cssText = [
            'position: fixed',
            'bottom: 16px',
            'right: 16px',
            'z-index: 9999',
            'padding: 8px 14px',
            'background: #6b7280',
            'color: #f9fafb',
            'border: none',
            'border-radius: 6px',
            'font-size: 13px',
            'font-family: system-ui, -apple-system, sans-serif',
            'cursor: pointer',
            'opacity: 0.8',
            'box-shadow: 0 1px 4px rgba(0,0,0,0.3)',
            'transition: opacity 0.15s ease'
        ].join(';');

        btn.addEventListener('mouseenter', function () { btn.style.opacity = '1'; });
        btn.addEventListener('mouseleave', function () { btn.style.opacity = '0.8'; });
        btn.addEventListener('click', function () {
            exportLegacyCharacters();
        });

        document.body.appendChild(btn);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createExportButton);
    } else {
        createExportButton();
    }
})();
