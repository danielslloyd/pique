/**
 * ComfyUIService - Service for integrating ComfyUI workflows
 * Handles workflow parsing, parameter mapping, and API communication
 */

class ComfyUIService {
    constructor() {
        this.serverUrl = localStorage.getItem('comfyui_server_url') || 'http://127.0.0.1:8188';
        this.workflows = new Map(); // Cached workflow definitions
        this.clientId = this.generateClientId();
        this.ws = null; // WebSocket connection for real-time updates
        this.activeGenerations = new Map(); // Track active generation jobs
    }

    /**
     * Set ComfyUI server URL
     */
    setServerUrl(url) {
        this.serverUrl = url.replace(/\/$/, ''); // Remove trailing slash
        localStorage.setItem('comfyui_server_url', this.serverUrl);
    }

    /**
     * Get current server URL
     */
    getServerUrl() {
        return this.serverUrl;
    }

    /**
     * Test connection to ComfyUI server
     */
    async testConnection() {
        try {
            const response = await fetch(`${this.serverUrl}/system_stats`);
            if (!response.ok) {
                throw new Error(`Server responded with ${response.status}`);
            }
            const stats = await response.json();
            return {
                success: true,
                stats,
                message: 'Connected successfully'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                message: `Failed to connect: ${error.message}`
            };
        }
    }

    /**
     * Load and parse workflow from JSON file
     * @param {string} workflowPath - Path to workflow JSON file
     * @returns {Promise<Object>} Parsed workflow object
     */
    async loadWorkflow(workflowPath) {
        try {
            const response = await fetch(workflowPath);
            if (!response.ok) {
                throw new Error(`Failed to load workflow: ${response.statusText}`);
            }
            const workflowData = await response.json();
            const workflow = this.parseWorkflow(workflowData);
            this.workflows.set(workflowPath, workflow);
            return workflow;
        } catch (error) {
            console.error('Error loading workflow:', error);
            throw error;
        }
    }

    /**
     * Parse workflow JSON and extract metadata
     * @param {Object} workflowData - Raw workflow JSON
     * @returns {Object} Parsed workflow with metadata
     */
    parseWorkflow(workflowData) {
        const nodes = workflowData;
        const nodeTypes = {};
        const inputs = [];
        const outputs = [];
        const parameters = new Map();

        // Analyze each node
        for (const [nodeId, node] of Object.entries(nodes)) {
            const nodeType = node.class_type;

            // Count node types
            nodeTypes[nodeType] = (nodeTypes[nodeType] || 0) + 1;

            // Identify input nodes (LoadImage, etc.)
            if (this.isInputNode(nodeType)) {
                inputs.push({
                    id: nodeId,
                    type: nodeType,
                    inputs: node.inputs
                });
            }

            // Identify output nodes (SaveImage, etc.)
            if (this.isOutputNode(nodeType)) {
                outputs.push({
                    id: nodeId,
                    type: nodeType,
                    inputs: node.inputs
                });
            }

            // Extract configurable parameters
            const params = this.extractParameters(nodeId, node);
            if (params.length > 0) {
                parameters.set(nodeId, params);
            }
        }

        return {
            raw: nodes,
            metadata: {
                totalNodes: Object.keys(nodes).length,
                nodeTypes,
                inputs,
                outputs,
                parameters
            }
        };
    }

    /**
     * Check if node is an input node
     */
    isInputNode(nodeType) {
        const inputTypes = ['LoadImage', 'LoadImageMask', 'CLIPTextEncode', 'TextEncodeQwenImageEditPlus'];
        return inputTypes.includes(nodeType);
    }

    /**
     * Check if node is an output node
     */
    isOutputNode(nodeType) {
        const outputTypes = ['SaveImage', 'PreviewImage'];
        return outputTypes.includes(nodeType);
    }

    /**
     * Extract configurable parameters from a node
     */
    extractParameters(nodeId, node) {
        const params = [];
        const inputs = node.inputs || {};

        // Common parameter mappings
        const parameterTypes = {
            'seed': { type: 'number', label: 'Seed', min: 0, max: Number.MAX_SAFE_INTEGER },
            'steps': { type: 'number', label: 'Steps', min: 1, max: 150 },
            'cfg': { type: 'number', label: 'CFG Scale', min: 0, max: 30, step: 0.1 },
            'sampler_name': { type: 'select', label: 'Sampler' },
            'scheduler': { type: 'select', label: 'Scheduler' },
            'denoise': { type: 'number', label: 'Denoise', min: 0, max: 1, step: 0.01 },
            'text': { type: 'text', label: 'Prompt' },
            'width': { type: 'number', label: 'Width', min: 64, max: 4096, step: 64 },
            'height': { type: 'number', label: 'Height', min: 64, max: 4096, step: 64 }
        };

        for (const [key, value] of Object.entries(inputs)) {
            if (typeof value === 'number' || typeof value === 'string') {
                const paramDef = parameterTypes[key] || {
                    type: typeof value === 'number' ? 'number' : 'text',
                    label: this.humanizeLabel(key)
                };

                params.push({
                    nodeId,
                    key,
                    value,
                    ...paramDef
                });
            }
        }

        return params;
    }

    /**
     * Convert snake_case to Human Readable
     */
    humanizeLabel(key) {
        return key
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    /**
     * Create a workflow instance with custom parameters
     * @param {Object} workflow - Parsed workflow
     * @param {Object} parameterOverrides - Custom parameter values
     * @returns {Object} Workflow ready for execution
     */
    createWorkflowInstance(workflow, parameterOverrides = {}) {
        const instance = JSON.parse(JSON.stringify(workflow.raw)); // Deep clone

        // Apply parameter overrides
        for (const [nodeId, params] of Object.entries(parameterOverrides)) {
            if (instance[nodeId]) {
                instance[nodeId].inputs = {
                    ...instance[nodeId].inputs,
                    ...params
                };
            }
        }

        return instance;
    }

    /**
     * Upload image to ComfyUI server
     * @param {Blob|File} imageBlob - Image data
     * @param {string} filename - Filename
     * @returns {Promise<Object>} Upload result
     */
    async uploadImage(imageBlob, filename = 'input.png') {
        const formData = new FormData();
        formData.append('image', imageBlob, filename);
        formData.append('overwrite', 'true');

        try {
            const response = await fetch(`${this.serverUrl}/upload/image`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }

            const result = await response.json();
            return {
                success: true,
                filename: result.name,
                subfolder: result.subfolder || '',
                type: result.type || 'input'
            };
        } catch (error) {
            console.error('Image upload error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Queue workflow for execution
     * @param {Object} workflowInstance - Workflow to execute
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} Execution result
     */
    async queueWorkflow(workflowInstance, options = {}) {
        const prompt = {
            prompt: workflowInstance,
            client_id: this.clientId
        };

        try {
            const response = await fetch(`${this.serverUrl}/prompt`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(prompt)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Queue failed: ${errorText}`);
            }

            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            const promptId = result.prompt_id;
            this.activeGenerations.set(promptId, {
                promptId,
                status: 'queued',
                startedAt: Date.now(),
                workflow: workflowInstance
            });

            return {
                success: true,
                promptId,
                message: 'Workflow queued successfully'
            };
        } catch (error) {
            console.error('Queue workflow error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get workflow execution history
     */
    async getHistory(promptId = null) {
        try {
            const url = promptId
                ? `${this.serverUrl}/history/${promptId}`
                : `${this.serverUrl}/history`;

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch history: ${response.statusText}`);
            }

            const history = await response.json();
            return history;
        } catch (error) {
            console.error('Get history error:', error);
            throw error;
        }
    }

    /**
     * Download generated image from server
     * @param {string} filename - Image filename
     * @param {string} subfolder - Subfolder (optional)
     * @param {string} type - Image type ('output', 'input', 'temp')
     * @returns {Promise<Blob>} Image blob
     */
    async downloadImage(filename, subfolder = '', type = 'output') {
        try {
            const params = new URLSearchParams({
                filename,
                subfolder,
                type
            });

            const response = await fetch(`${this.serverUrl}/view?${params}`);
            if (!response.ok) {
                throw new Error(`Download failed: ${response.statusText}`);
            }

            const blob = await response.blob();
            return blob;
        } catch (error) {
            console.error('Download image error:', error);
            throw error;
        }
    }

    /**
     * Get output images from completed workflow
     * @param {string} promptId - Prompt ID
     * @returns {Promise<Array>} Array of image blobs
     */
    async getOutputImages(promptId) {
        try {
            const history = await this.getHistory(promptId);
            const promptData = history[promptId];

            if (!promptData) {
                throw new Error('Prompt not found in history');
            }

            const outputs = promptData.outputs;
            const images = [];

            // Extract all images from outputs
            for (const [nodeId, output] of Object.entries(outputs)) {
                if (output.images) {
                    for (const image of output.images) {
                        const blob = await this.downloadImage(
                            image.filename,
                            image.subfolder || '',
                            image.type || 'output'
                        );
                        images.push({
                            blob,
                            filename: image.filename,
                            nodeId,
                            subfolder: image.subfolder,
                            type: image.type
                        });
                    }
                }
            }

            return images;
        } catch (error) {
            console.error('Get output images error:', error);
            throw error;
        }
    }

    /**
     * Poll for workflow completion
     * @param {string} promptId - Prompt ID to monitor
     * @param {Function} progressCallback - Called with progress updates
     * @returns {Promise<Object>} Completion result with images
     */
    async pollForCompletion(promptId, progressCallback = null) {
        const maxAttempts = 300; // 5 minutes max (1 second intervals)
        let attempts = 0;

        return new Promise(async (resolve, reject) => {
            const poll = async () => {
                attempts++;

                try {
                    const history = await this.getHistory(promptId);
                    const promptData = history[promptId];

                    if (promptData) {
                        // Workflow completed
                        const images = await this.getOutputImages(promptId);

                        this.activeGenerations.delete(promptId);

                        resolve({
                            success: true,
                            promptId,
                            images,
                            outputs: promptData.outputs,
                            status: promptData.status
                        });
                        return;
                    }

                    // Check if max attempts reached
                    if (attempts >= maxAttempts) {
                        reject(new Error('Polling timeout: workflow did not complete'));
                        return;
                    }

                    // Update progress
                    if (progressCallback) {
                        progressCallback({
                            status: 'processing',
                            attempts,
                            maxAttempts
                        });
                    }

                    // Continue polling
                    setTimeout(poll, 1000);
                } catch (error) {
                    reject(error);
                }
            };

            poll();
        });
    }

    /**
     * Execute workflow end-to-end with image input
     * @param {Object} workflow - Parsed workflow
     * @param {Blob} inputImage - Input image
     * @param {Object} parameters - Custom parameters
     * @param {Function} progressCallback - Progress updates
     * @returns {Promise<Object>} Result with generated images
     */
    async executeWorkflow(workflow, inputImage = null, parameters = {}, progressCallback = null) {
        try {
            // Step 1: Upload input image if provided
            let uploadedFilename = null;
            if (inputImage) {
                if (progressCallback) progressCallback({ status: 'uploading', progress: 10 });

                const uploadResult = await this.uploadImage(inputImage, 'input_character.png');
                if (!uploadResult.success) {
                    throw new Error(`Image upload failed: ${uploadResult.error}`);
                }
                uploadedFilename = uploadResult.filename;

                // Update LoadImage nodes with uploaded filename
                const loadImageNodes = workflow.metadata.inputs.filter(n => n.type === 'LoadImage');
                for (const node of loadImageNodes) {
                    if (!parameters[node.id]) {
                        parameters[node.id] = {};
                    }
                    parameters[node.id].image = uploadedFilename;
                }
            }

            // Step 2: Create workflow instance with parameters
            if (progressCallback) progressCallback({ status: 'preparing', progress: 20 });
            const workflowInstance = this.createWorkflowInstance(workflow, parameters);

            // Step 3: Queue workflow
            if (progressCallback) progressCallback({ status: 'queuing', progress: 30 });
            const queueResult = await this.queueWorkflow(workflowInstance);

            if (!queueResult.success) {
                throw new Error(`Failed to queue workflow: ${queueResult.error}`);
            }

            // Step 4: Poll for completion
            if (progressCallback) progressCallback({ status: 'generating', progress: 40 });
            const result = await this.pollForCompletion(queueResult.promptId, (pollProgress) => {
                if (progressCallback) {
                    const progress = 40 + Math.min(pollProgress.attempts / pollProgress.maxAttempts * 50, 50);
                    progressCallback({ ...pollProgress, progress });
                }
            });

            if (progressCallback) progressCallback({ status: 'completed', progress: 100 });

            return result;
        } catch (error) {
            console.error('Execute workflow error:', error);
            throw error;
        }
    }

    /**
     * Get workflow suggestions based on use case
     * @param {string} useCase - Use case identifier
     * @returns {Object} Suggested workflow configuration
     */
    getWorkflowSuggestions(useCase) {
        const suggestions = {
            'character_sheet': {
                description: 'Generate consistent character expressions and poses',
                parameters: {
                    expressions: ['neutral', 'happy', 'sad', 'surprised', 'angry'],
                    poses: ['front', 'side', 'back', 'three_quarter'],
                    outputCount: 4
                }
            },
            'scene_generation': {
                description: 'Generate scene with character placement',
                parameters: {
                    backgroundStyle: 'detailed',
                    characterCount: 1,
                    scenery: 'indoor'
                }
            },
            'upscale': {
                description: 'Upscale and enhance existing image',
                parameters: {
                    scaleFactor: 2,
                    denoise: 0.3
                }
            }
        };

        return suggestions[useCase] || null;
    }

    /**
     * Generate unique client ID
     */
    generateClientId() {
        return `pique_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Connect WebSocket for real-time updates (optional)
     */
    connectWebSocket(onMessage) {
        const wsUrl = this.serverUrl.replace('http', 'ws') + '/ws';

        this.ws = new WebSocket(`${wsUrl}?clientId=${this.clientId}`);

        this.ws.onopen = () => {
            console.log('ComfyUI WebSocket connected');
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (onMessage) {
                onMessage(data);
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onclose = () => {
            console.log('ComfyUI WebSocket disconnected');
        };
    }

    /**
     * Disconnect WebSocket
     */
    disconnectWebSocket() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

// Export singleton instance
const comfyUIService = new ComfyUIService();
