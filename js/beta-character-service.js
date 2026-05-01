/**
 * BetaCharacterService - Cloud image generation using OpenAI gpt-image-1
 *
 * gpt-image-1 accepts multiple reference images via the /v1/images/edits
 * multipart endpoint, which is exactly what we need for:
 *   1. Generating a character sheet (T-pose + headshot on white) from 2-3
 *      reference photos.
 *   2. Generating new scene images by passing the saved character sheet back
 *      in as a reference along with a new text prompt.
 */

class BetaCharacterService {
    constructor() {
        this.apiKey = localStorage.getItem('beta_openai_api_key') || null;
        this.model = 'gpt-image-1';
        this.editsUrl = 'https://api.openai.com/v1/images/edits';
        this.modelsUrl = 'https://api.openai.com/v1/models';
    }

    setApiKey(apiKey) {
        this.apiKey = apiKey;
        if (apiKey) {
            localStorage.setItem('beta_openai_api_key', apiKey);
        } else {
            localStorage.removeItem('beta_openai_api_key');
        }
    }

    getApiKey() {
        return this.apiKey;
    }

    hasApiKey() {
        return !!(this.apiKey && this.apiKey.startsWith('sk-'));
    }

    async testConnection() {
        if (!this.hasApiKey()) {
            throw new Error('No API key set');
        }
        const response = await fetch(this.modelsUrl, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });
        if (!response.ok) {
            throw new Error(`API check failed (${response.status})`);
        }
        return true;
    }

    /**
     * Style descriptors merged into the prompt sent to gpt-image-1.
     */
    getStylePrompt(styleKey) {
        const styles = {
            children_book: "soft children's book illustration style, warm friendly tones, clean line work",
            bold_cartoon: 'bold cartoon style, vibrant colors, thick outlines, expressive features',
            ghibli: 'Studio Ghibli inspired style, soft watercolor textures, hand-drawn animation aesthetic',
            realistic: 'realistic illustration, detailed textures, natural lighting, lifelike proportions',
            anime: 'modern anime style, clean line art, cel-shaded, expressive eyes',
            pixar: '3D Pixar-style render, soft volumetric lighting, expressive stylized features',
            watercolor: 'loose watercolor painting style, soft washes, paper texture',
            comic: 'comic book style, dynamic ink lines, halftone shading'
        };
        return styles[styleKey] || styles.children_book;
    }

    /**
     * Build the prompt used to create a character sheet from reference photos.
     */
    buildCharacterSheetPrompt(styleKey, extraNotes = '') {
        const style = this.getStylePrompt(styleKey);
        const lines = [
            'Create a single character reference sheet on a pure solid white background (#FFFFFF, no shadows, no gradients, no scenery).',
            'The sheet contains exactly two views of the SAME character, side by side:',
            '  • LEFT: a full-body T-pose (arms straight out horizontally, legs together, facing forward, neutral expression).',
            '  • RIGHT: a clean headshot / portrait of the same character, shoulders up, facing forward, neutral expression.',
            'Both views must depict the identical character with consistent proportions, clothing, colors, and features, matching the people / characters in the supplied reference images.',
            `Render in this style: ${style}.`,
            'No text, no labels, no borders, no watermarks. Pure white background everywhere outside the character.'
        ];
        if (extraNotes && extraNotes.trim()) {
            lines.push(`Additional direction: ${extraNotes.trim()}`);
        }
        return lines.join('\n');
    }

    /**
     * Generate a character sheet (T-pose + headshot) from 2-3 reference files.
     * @param {File[]} referenceFiles - 1..4 image File/Blob objects
     * @param {string} styleKey - one of the keys returned by getStylePrompt
     * @param {string} extraNotes - optional freeform direction
     * @param {string} size - '1024x1024' | '1536x1024' | '1024x1536' | 'auto'
     * @returns {Promise<{blob: Blob, prompt: string}>}
     */
    async generateCharacterSheet(referenceFiles, styleKey, extraNotes = '', size = '1536x1024') {
        if (!this.hasApiKey()) {
            throw new Error('OpenAI API key not set. Add one in the Beta tab settings.');
        }
        if (!referenceFiles || referenceFiles.length === 0) {
            throw new Error('At least one reference image is required.');
        }

        const prompt = this.buildCharacterSheetPrompt(styleKey, extraNotes);

        const formData = new FormData();
        formData.append('model', this.model);
        formData.append('prompt', prompt);
        formData.append('size', size);
        formData.append('n', '1');
        formData.append('background', 'opaque');

        referenceFiles.forEach((file, idx) => {
            const name = file.name || `reference_${idx}.png`;
            formData.append('image[]', file, name);
        });

        const blob = await this.callImagesEdits(formData);
        return { blob, prompt };
    }

    /**
     * Generate a new scene/pose for a saved character. The character's saved
     * sheet (and optional original references) get sent back as reference
     * images along with the user's new prompt.
     * @param {Blob[]} characterReferenceBlobs - reference blobs from storage
     * @param {string} userPrompt - the user's free-form prompt
     * @param {string} characterName - inserted into prompt for clarity
     * @param {string} styleKey - style for the new image
     * @param {string} size - target size
     */
    async generateWithCharacter(characterReferenceBlobs, userPrompt, characterName, styleKey, size = '1024x1024') {
        if (!this.hasApiKey()) {
            throw new Error('OpenAI API key not set.');
        }
        if (!characterReferenceBlobs || characterReferenceBlobs.length === 0) {
            throw new Error('No character reference images available.');
        }
        if (!userPrompt || !userPrompt.trim()) {
            throw new Error('Prompt is empty.');
        }

        const style = this.getStylePrompt(styleKey);
        const prompt = [
            `Depict the character named "${characterName}" shown in the reference images.`,
            'Preserve the character\'s exact appearance: face, proportions, clothing, colors, and distinguishing features.',
            `Scene / action: ${userPrompt.trim()}`,
            `Render in this style: ${style}.`
        ].join('\n');

        const formData = new FormData();
        formData.append('model', this.model);
        formData.append('prompt', prompt);
        formData.append('size', size);
        formData.append('n', '1');

        characterReferenceBlobs.forEach((blob, idx) => {
            const file = new File([blob], `character_ref_${idx}.png`, { type: blob.type || 'image/png' });
            formData.append('image[]', file);
        });

        const resultBlob = await this.callImagesEdits(formData);
        return { blob: resultBlob, prompt };
    }

    /**
     * Low-level call to the images/edits endpoint. Returns a Blob.
     */
    async callImagesEdits(formData) {
        const response = await fetch(this.editsUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiKey}` },
            body: formData
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            let message = `OpenAI API error ${response.status}`;
            try {
                const errJson = JSON.parse(errText);
                if (errJson?.error?.message) message = errJson.error.message;
            } catch (_) {
                if (errText) message = errText;
            }
            throw new Error(message);
        }

        const data = await response.json();
        const item = data?.data?.[0];
        if (!item) {
            throw new Error('No image returned from API');
        }

        if (item.b64_json) {
            return this.base64ToBlob(item.b64_json, 'image/png');
        }
        if (item.url) {
            const imgResp = await fetch(item.url);
            if (!imgResp.ok) throw new Error('Could not download generated image');
            return await imgResp.blob();
        }
        throw new Error('Unrecognized response shape from API');
    }

    base64ToBlob(b64, mime = 'image/png') {
        const binary = atob(b64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: mime });
    }
}

window.betaCharacterService = new BetaCharacterService();
