// AI Image Generation Service
class AIImageService {
    constructor() {
        this.openaiApiKey = null;
        this.baseUrl = 'https://api.openai.com/v1';
        this.provider = 'openai';
    }

    // Set API key
    setApiKey(apiKey) {
        this.openaiApiKey = apiKey;
    }

    // Generate image for children's book character
    async generateCharacterImage(description, quality = 'standard') {
        const prompt = this.buildCharacterPrompt(description);
        return await this.generateImage(prompt, {
            quality: quality
        });
    }

    // Generate scene/background image
    async generateSceneImage(description, characterDescription = '') {
        const prompt = this.buildScenePrompt(description, characterDescription);
        return await this.generateImage(prompt, {
            quality: 'standard'
        });
    }

    // Build optimized prompts for children's books
    buildCharacterPrompt(description, style = 'children_book') {
        const stylePrompts = {
            'bold_cartoon': 'bold cartoon style, vibrant colors, thick outlines, exaggerated features, playful and energetic, animation-inspired',
            'realistic': 'realistic illustration style, detailed textures, natural lighting, lifelike proportions, high detail',
            'ghibli': 'Studio Ghibli style, soft watercolor textures, whimsical, gentle colors, hand-drawn animation aesthetic, magical atmosphere',
            'children_book': 'children\'s book illustration style, cute, friendly, colorful, simple shapes, clean background, perfect for young readers'
        };

        const baseStyle = stylePrompts[style] || stylePrompts['children_book'];
        return `${description}, ${baseStyle}, high quality, safe for kids, G-rated`;
    }

    buildScenePrompt(description, characterDescription) {
        let prompt = `${description}, children's book illustration style, bright cheerful colors, safe environment`;
        
        if (characterDescription) {
            prompt += `, featuring ${characterDescription}`;
        }
        
        return `${prompt}, high quality illustration, perfect for children's story, G-rated, family-friendly`;
    }

    // Main image generation function
    async generateImage(prompt, options = {}) {
        const config = {
            width: options.width || 1024,
            height: options.height || 1024,
            quality: options.quality || 'standard',
            ...options
        };

        try {
            return await this.generateWithOpenAI(prompt, config);
        } catch (error) {
            console.error('Image generation failed:', error);
            throw new Error(`Failed to generate image: ${error.message}`);
        }
    }

    // OpenAI DALL-E implementation
    async generateWithOpenAI(prompt, config) {
        const response = await fetch(`${this.baseUrl}/images/generations`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.openaiApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'dall-e-3',
                prompt: prompt,
                n: 1,
                size: '1024x1024',
                quality: config.quality || 'standard',
                style: 'natural' // Better for children's books
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
        }

        const data = await response.json();
        const cost = config.quality === 'hd' ? 0.17 : 0.04;
        
        return {
            url: data.data[0].url,
            revisedPrompt: data.data[0].revised_prompt, // DALL-E 3 enhances prompts
            provider: 'openai',
            cost: cost,
            model: 'dall-e-3'
        };
    }

    // Convert image URL to blob for local storage
    async downloadImageAsBlob(imageUrl) {
        try {
            // Try direct fetch first
            const response = await fetch(imageUrl, {
                mode: 'cors',
                cache: 'no-cache'
            });
            
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.status}`);
            }
            return await response.blob();
            
        } catch (error) {
            console.warn('Direct fetch failed, trying proxy method:', error);
            
            // Fallback: create image element and convert to canvas
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                
                img.onload = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        
                        canvas.width = img.width;
                        canvas.height = img.height;
                        
                        ctx.drawImage(img, 0, 0);
                        
                        canvas.toBlob((blob) => {
                            if (blob) {
                                resolve(blob);
                            } else {
                                reject(new Error('Failed to convert image to blob'));
                            }
                        }, 'image/png');
                        
                    } catch (canvasError) {
                        reject(new Error(`Canvas conversion failed: ${canvasError.message}`));
                    }
                };
                
                img.onerror = () => {
                    reject(new Error('Failed to load image for conversion'));
                };
                
                img.src = imageUrl;
            });
        }
    }
}

// Integration with your existing book creator
class AIBookCreator {
    constructor() {
        this.aiImageService = new AIImageService();
        this.generatedImages = new Map();
    }

    // Initialize with API key
    setupImageGeneration(apiKey) {
        this.aiImageService.setApiKey(apiKey);
    }

    // Generate character image and store locally
    async generateAndStoreCharacterImage(description, quality = 'standard') {
        try {
            FeedbackManager.show('Generating character image...', 'info');
            
            const result = await this.aiImageService.generateCharacterImage(description, quality);
            
            // Skip blob download due to CORS issues, use URL directly
            this.generatedImages.set('character', {
                blob: null, // Will be handled later if needed
                url: result.url, // Use OpenAI URL directly
                originalUrl: result.url,
                cost: result.cost,
                provider: result.provider,
                revisedPrompt: result.revisedPrompt
            });

            FeedbackManager.show('Character image generated successfully!', 'success');
            return result.url; // Return OpenAI URL directly
            
        } catch (error) {
            FeedbackManager.show(`Error generating character: ${error.message}`, 'error');
            throw error;
        }
    }

    // Generate story page images
    async generateStoryPage(pageNumber, sceneDescription, characterDescription) {
        try {
            FeedbackManager.show(`Generating image for page ${pageNumber}...`, 'info');
            
            const result = await this.aiImageService.generateSceneImage(sceneDescription, characterDescription);
            const blob = await this.aiImageService.downloadImageAsBlob(result.url);
            const blobUrl = URL.createObjectURL(blob);
            
            this.generatedImages.set(`page_${pageNumber}`, {
                blob,
                url: blobUrl,
                originalUrl: result.url,
                cost: result.cost,
                provider: result.provider
            });

            return blobUrl;
            
        } catch (error) {
            FeedbackManager.show(`Error generating page ${pageNumber}: ${error.message}`, 'error');
            throw error;
        }
    }

    // Get total generation cost
    getTotalCost() {
        let total = 0;
        for (const [key, data] of this.generatedImages) {
            total += data.cost || 0;
        }
        return total.toFixed(4);
    }

    // Clean up blob URLs when done
    cleanup() {
        for (const [key, data] of this.generatedImages) {
            if (data.url && data.url.startsWith('blob:')) {
                URL.revokeObjectURL(data.url);
            }
        }
        this.generatedImages.clear();
    }
}

// Example usage functions for your app
class ImageGenerationUI {
    static renderAPISetup() {
        return `
            <div class="ai-step">
                <div class="step-header">
                    <div class="step-number">🔑</div>
                    <h2>Setup OpenAI Image Generation</h2>
                    <p>Enter your OpenAI API key to generate beautiful children's book illustrations</p>
                </div>
                
                <div class="form-group">
                    <label for="api-key">OpenAI API Key</label>
                    <input type="password" id="api-key" placeholder="sk-...">
                    <small>
                        Get your API key from <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com</a><br>
                        Cost: $0.04 per standard image, $0.17 per HD image
                    </small>
                </div>
                
                <div class="form-group">
                    <label for="usage-limit">Monthly Usage Limit (Optional)</label>
                    <select id="usage-limit">
                        <option value="5">$5 (125 standard images)</option>
                        <option value="10" selected>$10 (250 standard images)</option>
                        <option value="25">$25 (625 standard images)</option>
                        <option value="50">$50 (1,250 standard images)</option>
                    </select>
                    <small>Set this in your OpenAI billing settings for peace of mind</small>
                </div>
                
                <button onclick="window.aiImageSetup.testConnection()" class="creator-btn primary">
                    Test API Connection
                </button>
            </div>
        `;
    }

    static renderCharacterCreation() {
        return `
            <div class="ai-step">
                <div class="step-header">
                    <div class="step-number">🎨</div>
                    <h2>Create Your Character</h2>
                    <p>Describe your main character and generate their image</p>
                </div>
                
                <div class="character-upload-section">
                    <div class="character-preview" id="ai-character-preview">
                        <div class="character-placeholder">
                            <div class="upload-icon">🎭</div>
                            <p>Character will appear here</p>
                        </div>
                    </div>
                    
                    <div class="character-controls">
                        <div class="form-group">
                            <label for="character-description">Character Description</label>
                            <textarea id="character-description" 
                                placeholder="A friendly blue dragon with small wings and a big smile, wearing a red hat"
                                oninput="window.aiImageSetup.updateFullPrompt()">
                            </textarea>
                        </div>
                        
                        <div class="form-group">
                            <label for="reference-image">Reference Image (Optional)</label>
                            <input type="file" id="reference-image" accept="image/*" onchange="window.aiImageSetup.handleReferenceImage(event)">
                            <small>Upload a reference image to help describe the character</small>
                            <div id="reference-preview" style="margin-top: 10px; display: none;">
                                <img id="reference-img" style="max-width: 200px; max-height: 200px; border-radius: 4px;">
                                <p id="reference-description" style="margin-top: 5px; font-style: italic; color: #666;"></p>
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label for="art-style-select">Art Style</label>
                            <select id="art-style-select" onchange="window.aiImageSetup.updateFullPrompt()">
                                <option value="children_book">Small Children's Book Style (Simple Shapes)</option>
                                <option value="bold_cartoon">Bold Cartoon Style</option>
                                <option value="realistic">Realistic Illustration Style</option>
                                <option value="ghibli">Studio Ghibli Style</option>
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label for="full-prompt">Full AI Prompt</label>
                            <textarea id="full-prompt" rows="6"
                                placeholder="This will show the complete prompt sent to DALL-E">
                            </textarea>
                            <small>Edit this to control exactly what gets sent to DALL-E</small>
                        </div>
                        
                        <div class="form-group">
                            <label for="image-quality">Image Quality</label>
                            <select id="image-quality">
                                <option value="standard">Standard Quality ($0.04 per image)</option>
                                <option value="hd">HD Quality ($0.17 per image)</option>
                            </select>
                        </div>
                        
                        <button onclick="window.aiImageSetup.generateCharacter()" 
                                class="creator-btn primary" id="generate-character-btn">
                            Generate Character
                        </button>
                        
                        <div class="form-group" style="margin-top: 20px;">
                            <label>Or upload your own character image:</label>
                            <input type="file" id="character-upload" accept="image/*" onchange="window.aiImageSetup.handleCharacterUpload(event)" style="margin-top: 8px;">
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

// Global setup object for the UI
window.aiImageSetup = {
    aiBookCreator: new AIBookCreator(),
    apiKeyStored: false,
    
    async testConnection() {
        const apiKey = document.getElementById('api-key').value;
        
        if (!apiKey) {
            FeedbackManager.show('Please enter your OpenAI API key', 'error');
            return;
        }
        
        if (!apiKey.startsWith('sk-')) {
            FeedbackManager.show('OpenAI API keys start with "sk-"', 'error');
            return;
        }
        
        try {
            // Store the API key
            this.aiBookCreator.setupImageGeneration(apiKey);
            
            // Test with a simple API call to check credentials
            FeedbackManager.show('Testing API connection...', 'info');
            
            const response = await fetch('https://api.openai.com/v1/models', {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });
            
            if (response.ok) {
                this.apiKeyStored = true;
                FeedbackManager.show('✅ OpenAI API connection successful!', 'success');
                
                // Enable the next button
                const proceedBtn = document.getElementById('proceed-btn');
                if (proceedBtn) {
                    proceedBtn.disabled = false;
                }
            } else {
                throw new Error(`API returned ${response.status}`);
            }
            
        } catch (error) {
            console.error('API test failed:', error);
            this.apiKeyStored = false;
            FeedbackManager.show(`❌ Connection failed: Invalid API key or network error`, 'error');
        }
    },
    
    async generateCharacter() {
        const description = document.getElementById('character-description').value;
        const quality = document.getElementById('art-style').value;
        
        if (!description) {
            FeedbackManager.show('Please describe your character', 'error');
            return;
        }
        
        // Build the full prompt and show it to the user
        const basePrompt = this.aiBookCreator.aiImageService.buildCharacterPrompt(description);
        const fullPromptField = document.getElementById('full-prompt');
        if (fullPromptField) {
            fullPromptField.value = basePrompt;
        }
        
        try {
            // Use the full prompt from the text area if available, otherwise use the built prompt
            const finalPrompt = fullPromptField?.value || basePrompt;
            
            FeedbackManager.show('Generating character image...', 'info');
            
            // Generate directly with the final prompt
            const result = await this.aiBookCreator.aiImageService.generateImage(finalPrompt, { quality: quality });
            
            // Store the result
            this.aiBookCreator.generatedImages.set('character', {
                blob: null,
                url: result.url,
                originalUrl: result.url,
                cost: result.cost,
                provider: result.provider,
                revisedPrompt: result.revisedPrompt
            });
            
            // Update UI with generated image
            const preview = document.getElementById('ai-character-preview');
            preview.innerHTML = `<img src="${result.url}" alt="Generated character" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">`;
            
            // Show cost and enhanced prompt
            const cost = this.aiBookCreator.getTotalCost();
            
            let message = `Character generated! Cost: ${cost}`;
            if (result.revisedPrompt) {
                message += `\n\nDALL-E enhanced your prompt: "${result.revisedPrompt}"`;
                // Update the full prompt field with DALL-E's revision
                if (fullPromptField) {
                    fullPromptField.value = result.revisedPrompt;
                }
            }
            
            FeedbackManager.show(message, 'success');
            
        } catch (error) {
            console.error('Character generation failed:', error);
        }
    },

    // Handle manual character image upload as fallback
    handleCharacterUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const preview = document.getElementById('ai-character-preview');
            preview.innerHTML = `<img src="${e.target.result}" alt="Uploaded character" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">`;
            
            // Store for the book creation process
            this.aiBookCreator.generatedImages.set('character', {
                blob: file,
                url: e.target.result,
                cost: 0,
                provider: 'manual'
            });

            FeedbackManager.show('Character image uploaded successfully!', 'success');
        };
        reader.readAsDataURL(file);
    }
};

// Export for use in your existing app
window.AIImageService = AIImageService;
window.AIBookCreator = AIBookCreator;
window.ImageGenerationUI = ImageGenerationUI;