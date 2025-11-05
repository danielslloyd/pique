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

    // Text generation for story pages
    async generateStoryText(storySummary, pageNumber, totalPages, readingLevel = null, phonicsSounds = [], characterDescription = '') {
        const prompt = this.buildStoryTextPrompt(storySummary, pageNumber, totalPages, readingLevel, phonicsSounds, characterDescription);

        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a children\'s book author specializing in age-appropriate, engaging stories. You write clear, simple text perfect for young readers.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: 0.8,
                    max_tokens: 200
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
            }

            const data = await response.json();
            const generatedText = data.choices[0].message.content.trim();

            return {
                text: generatedText,
                cost: this.calculateTextGenerationCost(data.usage),
                model: 'gpt-4o-mini'
            };

        } catch (error) {
            console.error('Text generation failed:', error);
            throw new Error(`Failed to generate text: ${error.message}`);
        }
    }

    buildStoryTextPrompt(storySummary, pageNumber, totalPages, readingLevel, phonicsSounds, characterDescription) {
        let prompt = `Write the text for page ${pageNumber} of ${totalPages} for a children's book.\n\n`;
        prompt += `Story Summary: ${storySummary}\n\n`;

        if (characterDescription) {
            prompt += `Main Character: ${characterDescription}\n\n`;
        }

        if (readingLevel) {
            const readingLevelGuidance = {
                'pre-k': 'Use very simple 2-4 word sentences. Focus on basic concepts and repetition.',
                'kindergarten': 'Use simple 4-6 word sentences. Include basic sight words and simple vocabulary.',
                'grade-1': 'Use clear 5-8 word sentences. Include common sight words and simple descriptive words.',
                'grade-2': 'Use varied 6-10 word sentences. Include more descriptive language and simple compound sentences.',
                'grade-3': 'Use 8-12 word sentences with more complex vocabulary. Include varied sentence structures.'
            };
            prompt += `Reading Level: ${readingLevel}\nGuidance: ${readingLevelGuidance[readingLevel]}\n\n`;
        }

        if (phonicsSounds && phonicsSounds.length > 0) {
            prompt += `Emphasize these phonics sounds: ${phonicsSounds.join(', ')}\n`;
            prompt += `Try to include 2-3 words that feature these sounds naturally in the story.\n\n`;
        }

        prompt += `Requirements:\n`;
        prompt += `- Write engaging text appropriate for page ${pageNumber} of the story arc\n`;
        prompt += `- Keep it concise (2-3 sentences max)\n`;
        prompt += `- Make it age-appropriate and exciting for children\n`;
        prompt += `- The text should work well with an illustration\n`;

        if (pageNumber === 1) {
            prompt += `- This is the FIRST page, so introduce the character and setting\n`;
        } else if (pageNumber === totalPages) {
            prompt += `- This is the FINAL page, so provide a satisfying conclusion\n`;
        } else {
            prompt += `- This is a MIDDLE page, so advance the story naturally\n`;
        }

        prompt += `\nReturn ONLY the text for this page, no titles or labels.`;

        return prompt;
    }

    calculateTextGenerationCost(usage) {
        // GPT-4o-mini pricing: $0.150 per 1M input tokens, $0.600 per 1M output tokens
        const inputCost = (usage.prompt_tokens / 1000000) * 0.150;
        const outputCost = (usage.completion_tokens / 1000000) * 0.600;
        return inputCost + outputCost;
    }
}

// Integration with your existing book creator
class AIBookCreator {
    constructor() {
        this.aiImageService = new AIImageService();
        this.generatedImages = new Map();
        this.generatedPages = [];
        this.storyPlan = null;
        this.totalCost = 0;
    }

    // Initialize with API key
    setupImageGeneration(apiKey) {
        this.aiImageService.setApiKey(apiKey);
    }

    // Store story planning data
    setStoryPlan(storySummary, numPages, readingLevel, phonicsSounds, characterDescription) {
        this.storyPlan = {
            storySummary,
            numPages,
            readingLevel,
            phonicsSounds,
            characterDescription
        };
    }

    // Generate text for a specific page
    async generatePageText(pageNumber) {
        if (!this.storyPlan) {
            throw new Error('Story plan not set. Call setStoryPlan first.');
        }

        const { storySummary, numPages, readingLevel, phonicsSounds, characterDescription } = this.storyPlan;

        try {
            const result = await this.aiImageService.generateStoryText(
                storySummary,
                pageNumber,
                numPages,
                readingLevel,
                phonicsSounds,
                characterDescription
            );

            this.totalCost += result.cost;
            return result.text;

        } catch (error) {
            throw new Error(`Failed to generate text for page ${pageNumber}: ${error.message}`);
        }
    }

    // Generate all story pages (text only)
    async generateAllStoryPages() {
        if (!this.storyPlan) {
            throw new Error('Story plan not set. Call setStoryPlan first.');
        }

        this.generatedPages = [];

        for (let i = 1; i <= this.storyPlan.numPages; i++) {
            try {
                FeedbackManager.show(`Generating text for page ${i} of ${this.storyPlan.numPages}...`, 'info');
                const text = await this.generatePageText(i);

                this.generatedPages.push({
                    pageNumber: i,
                    text: text,
                    imageUrl: null,
                    imageBlob: null
                });

            } catch (error) {
                FeedbackManager.show(`Error generating page ${i}: ${error.message}`, 'error');
                throw error;
            }
        }

        return this.generatedPages;
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
        let total = this.totalCost || 0;
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
        this.generatedPages = [];
        this.storyPlan = null;
        this.totalCost = 0;
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

    static renderStoryPlanning() {
        return `
            <div class="ai-step">
                <div class="step-header">
                    <div class="step-number">📖</div>
                    <h2>Plan Your Story</h2>
                    <p>Describe your story and let AI generate the pages</p>
                </div>

                <div class="form-group">
                    <label for="story-summary">Story Summary *</label>
                    <textarea id="story-summary" rows="4"
                        placeholder="A brave knight goes on an adventure to find a magical treasure in a mysterious forest. Along the way, they meet friendly animals who help them solve riddles."
                        required></textarea>
                    <small>Briefly describe what happens in your story (2-3 sentences)</small>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label for="num-pages">Number of Pages *</label>
                        <select id="num-pages">
                            <option value="4">4 pages</option>
                            <option value="6">6 pages</option>
                            <option value="8" selected>8 pages</option>
                            <option value="10">10 pages</option>
                            <option value="12">12 pages</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label for="reading-level">Reading Level (Optional)</label>
                        <select id="reading-level">
                            <option value="">No preference</option>
                            <option value="pre-k">Pre-K (Ages 3-4)</option>
                            <option value="kindergarten">Kindergarten (Ages 5-6)</option>
                            <option value="grade-1" selected>Grade 1 (Ages 6-7)</option>
                            <option value="grade-2">Grade 2 (Ages 7-8)</option>
                            <option value="grade-3">Grade 3 (Ages 8-9)</option>
                        </select>
                    </div>
                </div>

                <div class="form-group">
                    <label>Phonics Sounds to Emphasize (Optional)</label>
                    <div class="phonics-sounds-grid" id="phonics-sounds">
                        <label class="phonics-checkbox">
                            <input type="checkbox" value="short-a"> Short A (cat, hat)
                        </label>
                        <label class="phonics-checkbox">
                            <input type="checkbox" value="short-e"> Short E (bed, red)
                        </label>
                        <label class="phonics-checkbox">
                            <input type="checkbox" value="short-i"> Short I (pig, big)
                        </label>
                        <label class="phonics-checkbox">
                            <input type="checkbox" value="short-o"> Short O (dog, log)
                        </label>
                        <label class="phonics-checkbox">
                            <input type="checkbox" value="short-u"> Short U (bug, rug)
                        </label>
                        <label class="phonics-checkbox">
                            <input type="checkbox" value="long-a"> Long A (cake, make)
                        </label>
                        <label class="phonics-checkbox">
                            <input type="checkbox" value="long-e"> Long E (tree, bee)
                        </label>
                        <label class="phonics-checkbox">
                            <input type="checkbox" value="long-i"> Long I (bike, like)
                        </label>
                        <label class="phonics-checkbox">
                            <input type="checkbox" value="long-o"> Long O (boat, coat)
                        </label>
                        <label class="phonics-checkbox">
                            <input type="checkbox" value="long-u"> Long U (flute, cute)
                        </label>
                        <label class="phonics-checkbox">
                            <input type="checkbox" value="ch"> CH (chair, chip)
                        </label>
                        <label class="phonics-checkbox">
                            <input type="checkbox" value="sh"> SH (ship, shop)
                        </label>
                        <label class="phonics-checkbox">
                            <input type="checkbox" value="th"> TH (this, that)
                        </label>
                        <label class="phonics-checkbox">
                            <input type="checkbox" value="wh"> WH (when, what)
                        </label>
                        <label class="phonics-checkbox">
                            <input type="checkbox" value="bl"> BL blend (blue, black)
                        </label>
                        <label class="phonics-checkbox">
                            <input type="checkbox" value="cl"> CL blend (clap, clean)
                        </label>
                        <label class="phonics-checkbox">
                            <input type="checkbox" value="fl"> FL blend (flag, fly)
                        </label>
                        <label class="phonics-checkbox">
                            <input type="checkbox" value="st"> ST blend (stop, star)
                        </label>
                    </div>
                    <small>Select sounds you'd like the story to focus on for phonics practice</small>
                </div>

                <div class="story-plan-summary" style="margin-top: 20px; padding: 15px; background: #f5f5f5; border-radius: 6px;">
                    <p><strong>Character:</strong> <span id="character-summary">Not yet created</span></p>
                    <p><strong>Estimated Cost:</strong> Text generation is very affordable (~$0.001 per page with GPT-4o-mini)</p>
                </div>
            </div>
        `;
    }

    static renderStoryReview(pages) {
        let pagesHtml = pages.map((page, index) => `
            <div class="story-page-review" id="page-review-${index}">
                <div class="page-review-header">
                    <h3>Page ${page.pageNumber}</h3>
                    <button onclick="window.aiImageSetup.regeneratePage(${index})" class="creator-btn secondary small">
                        🔄 Regenerate
                    </button>
                </div>
                <div class="page-review-content">
                    <textarea id="page-text-${index}" rows="3" class="page-text-editor">${page.text}</textarea>
                </div>
                ${page.imageUrl ? `
                    <div class="page-image-preview">
                        <img src="${page.imageUrl}" alt="Page ${page.pageNumber}">
                    </div>
                ` : ''}
            </div>
        `).join('');

        return `
            <div class="ai-step">
                <div class="step-header">
                    <div class="step-number">✏️</div>
                    <h2>Review & Edit Story Pages</h2>
                    <p>Review the generated text and make any edits before generating images</p>
                </div>

                <div class="story-pages-review">
                    ${pagesHtml}
                </div>

                <div class="review-actions" style="margin-top: 20px; text-align: center;">
                    <p class="info-text">You can edit any text directly. Changes will be saved automatically.</p>
                </div>
            </div>
        `;
    }
}

// Global setup object for the UI
window.aiImageSetup = {
    aiBookCreator: new AIBookCreator(),
    apiKeyStored: false,
    
    updateFullPrompt() {
        const description = document.getElementById('character-description').value;
        const style = document.getElementById('art-style-select').value;
        const fullPromptField = document.getElementById('full-prompt');
        
        if (description && fullPromptField) {
            let fullPrompt = this.aiBookCreator.aiImageService.buildCharacterPrompt(description, style);
            
            // Add reference image description if available
            if (this.referenceImageDescription) {
                fullPrompt += `. Reference style: ${this.referenceImageDescription}`;
            }
            
            fullPromptField.value = fullPrompt;
        }
    },

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
        const fullPromptField = document.getElementById('full-prompt');
        const quality = document.getElementById('image-quality').value;
        
        if (!fullPromptField || !fullPromptField.value.trim()) {
            FeedbackManager.show('Please enter a character description', 'error');
            return;
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
    },

    // Generate story pages based on planning inputs
    async generateStoryPages() {
        const storySummary = document.getElementById('story-summary')?.value.trim();
        const numPages = parseInt(document.getElementById('num-pages')?.value || 8);
        const readingLevel = document.getElementById('reading-level')?.value;

        // Get selected phonics sounds
        const phonicsCheckboxes = document.querySelectorAll('#phonics-sounds input[type="checkbox"]:checked');
        const phonicsSounds = Array.from(phonicsCheckboxes).map(cb => cb.value);

        if (!storySummary) {
            FeedbackManager.show('Please enter a story summary', 'error');
            return false;
        }

        // Get character description from the character creation step
        const characterData = this.aiBookCreator.generatedImages.get('character');
        const characterDescription = document.getElementById('character-description')?.value.trim() || '';

        try {
            // Set the story plan
            this.aiBookCreator.setStoryPlan(
                storySummary,
                numPages,
                readingLevel || null,
                phonicsSounds,
                characterDescription
            );

            // Generate all pages
            const pages = await this.aiBookCreator.generateAllStoryPages();

            FeedbackManager.show(`Successfully generated ${pages.length} pages! Total cost: $${this.aiBookCreator.getTotalCost()}`, 'success');

            return pages;

        } catch (error) {
            console.error('Story generation failed:', error);
            FeedbackManager.show(`Failed to generate story: ${error.message}`, 'error');
            return null;
        }
    },

    // Regenerate a specific page
    async regeneratePage(pageIndex) {
        if (!this.aiBookCreator.generatedPages || pageIndex >= this.aiBookCreator.generatedPages.length) {
            FeedbackManager.show('Invalid page index', 'error');
            return;
        }

        const page = this.aiBookCreator.generatedPages[pageIndex];

        try {
            FeedbackManager.show(`Regenerating page ${page.pageNumber}...`, 'info');

            const newText = await this.aiBookCreator.generatePageText(page.pageNumber);

            // Update the page
            this.aiBookCreator.generatedPages[pageIndex].text = newText;

            // Update the textarea
            const textarea = document.getElementById(`page-text-${pageIndex}`);
            if (textarea) {
                textarea.value = newText;
            }

            FeedbackManager.show(`Page ${page.pageNumber} regenerated successfully!`, 'success');

        } catch (error) {
            console.error('Page regeneration failed:', error);
            FeedbackManager.show(`Failed to regenerate page: ${error.message}`, 'error');
        }
    },

    // Update page text from the review interface
    updatePageText(pageIndex, newText) {
        if (this.aiBookCreator.generatedPages && pageIndex < this.aiBookCreator.generatedPages.length) {
            this.aiBookCreator.generatedPages[pageIndex].text = newText;
        }
    }
};

// Export for use in your existing app
window.AIImageService = AIImageService;
window.AIBookCreator = AIBookCreator;
window.ImageGenerationUI = ImageGenerationUI;