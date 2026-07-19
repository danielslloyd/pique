# ComfyUI Workflow Integration Guide

## Overview

This guide explains how to integrate arbitrary ComfyUI workflow JSON files into the Pique web application. You'll learn how to export workflows from ComfyUI, understand their structure, and map them to interactive web interfaces.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [ComfyUI Workflow Basics](#comfyui-workflow-basics)
3. [Exporting Workflows from ComfyUI](#exporting-workflows-from-comfyui)
4. [Understanding Workflow JSON Structure](#understanding-workflow-json-structure)
5. [Mapping Workflows to Web Interface](#mapping-workflows-to-web-interface)
6. [Creating Custom Workflow Pages](#creating-custom-workflow-pages)
7. [Parameter Mapping](#parameter-mapping)
8. [Advanced Features](#advanced-features)
9. [Troubleshooting](#troubleshooting)
10. [Examples](#examples)

---

## Prerequisites

### Required Software

- **ComfyUI**: Running locally or on a server
  - Download: https://github.com/comfyanonymous/ComfyUI
  - Default URL: `http://127.0.0.1:8188`

- **Models**: Required models for your workflow
  - Stable Diffusion checkpoints
  - VAE models
  - LoRA files
  - Any custom nodes

### Knowledge Requirements

- Basic understanding of ComfyUI node-based workflows
- Familiarity with JSON structure
- Basic JavaScript knowledge (for advanced customization)

---

## ComfyUI Workflow Basics

### What is a ComfyUI Workflow?

ComfyUI workflows are node-based pipelines that process images through various AI models and operations. Each workflow consists of:

- **Nodes**: Individual processing units (e.g., image loaders, samplers, encoders)
- **Connections**: Data flow between nodes
- **Parameters**: Configurable values for each node

### Workflow Types

Common workflow types in Pique:

1. **Character Sheet Generation**: Creates multiple character expressions/poses
2. **Image Upscaling**: Enhances image resolution
3. **Style Transfer**: Applies artistic styles to images
4. **Image-to-Image**: Transforms images while preserving content
5. **Custom Workflows**: Any ComfyUI workflow you create

---

## Exporting Workflows from ComfyUI

### Step 1: Create Your Workflow in ComfyUI

1. Open ComfyUI in your browser (`http://127.0.0.1:8188`)
2. Build your workflow using nodes
3. Test the workflow to ensure it works correctly

### Step 2: Export the Workflow

#### Method A: API Format (Recommended)

1. Click the **"Save (API Format)"** button in ComfyUI
2. This saves the workflow as a JSON file with only the execution data
3. Place the JSON file in your Pique project directory

**Example filename**: `my_character_workflow.json`

#### Method B: Full Workflow Format

1. Click the **"Save"** button for the complete workflow
2. Includes UI positioning and metadata
3. Larger file size but contains all information

**Note**: Pique's ComfyUI service works with both formats, but API format is cleaner.

### Step 3: Verify the Export

Open the JSON file and verify it contains:

```json
{
  "1": {
    "inputs": { ... },
    "class_type": "LoadImage"
  },
  "2": {
    "inputs": { ... },
    "class_type": "CLIPTextEncode"
  },
  ...
}
```

---

## Understanding Workflow JSON Structure

### Node Structure

Each node in a ComfyUI workflow has this structure:

```json
"NODE_ID": {
  "inputs": {
    "parameter_name": value,
    "connected_input": ["SOURCE_NODE_ID", OUTPUT_INDEX]
  },
  "class_type": "NodeClassName",
  "_meta": {
    "title": "Node Display Name"
  }
}
```

### Key Components

#### 1. Node ID
- String key (usually numeric: "1", "2", "3", etc.)
- Used to reference nodes in connections

#### 2. Inputs Object
Contains two types of data:

**Direct Values:**
```json
"inputs": {
  "seed": 123456,
  "steps": 20,
  "cfg": 7.0,
  "sampler_name": "euler"
}
```

**Node Connections:**
```json
"inputs": {
  "model": ["4", 0],  // From node "4", output index 0
  "positive": ["6", 0],
  "negative": ["7", 0]
}
```

#### 3. Class Type
- Identifies the node's function
- Examples: `LoadImage`, `KSampler`, `SaveImage`, `VAEDecode`

### Common Node Types

| Node Class | Purpose | Key Inputs |
|------------|---------|------------|
| `LoadImage` | Load input images | `image` (filename) |
| `SaveImage` | Save output images | `images`, `filename_prefix` |
| `CLIPTextEncode` | Encode text prompts | `text`, `clip` |
| `KSampler` | Run diffusion sampling | `seed`, `steps`, `cfg`, `sampler_name` |
| `VAEDecode` | Decode latent to image | `samples`, `vae` |
| `VAEEncode` | Encode image to latent | `pixels`, `vae` |
| `CheckpointLoaderSimple` | Load AI model | `ckpt_name` |
| `EmptyLatentImage` | Create blank latent | `width`, `height`, `batch_size` |
| `UpscaleModelLoader` | Load upscale model | `model_name` |

---

## Mapping Workflows to Web Interface

### The ComfyUIService Class

Pique provides `ComfyUIService` (`js/comfyui-service.js`) to handle workflow integration.

### Basic Workflow Loading

```javascript
// Load workflow from JSON file
const workflow = await comfyUIService.loadWorkflow('/path/to/workflow.json');

// Parse workflow structure
console.log(workflow.metadata);
// {
//   totalNodes: 24,
//   nodeTypes: { "LoadImage": 2, "KSampler": 4, ... },
//   inputs: [...],
//   outputs: [...],
//   parameters: Map(...)
// }
```

### Automatic Parameter Extraction

The service automatically extracts configurable parameters:

```javascript
workflow.metadata.parameters.forEach((params, nodeId) => {
  params.forEach(param => {
    console.log({
      nodeId: param.nodeId,
      key: param.key,
      type: param.type,       // 'number', 'text', 'select'
      label: param.label,     // Human-readable name
      value: param.value,     // Current value
      min: param.min,         // For numbers
      max: param.max
    });
  });
});
```

### Identifying Input/Output Nodes

```javascript
// Find nodes that accept image inputs
const inputNodes = workflow.metadata.inputs;
// [{ id: "1", type: "LoadImage", inputs: {...} }]

// Find nodes that produce outputs
const outputNodes = workflow.metadata.outputs;
// [{ id: "23", type: "SaveImage", inputs: {...} }]
```

---

## Creating Custom Workflow Pages

### Step 1: Add Workflow to Project

Place your workflow JSON in the project root or a dedicated folder:

```
/home/user/pique/
  ├── workflows/
  │   ├── character_sheet.json
  │   ├── upscale_4x.json
  │   └── style_transfer.json
  └── ...
```

### Step 2: Load Workflow in Generator Controller

Edit `js/controllers/generator-controller.js`:

```javascript
async loadMyCustomWorkflow() {
  const workflow = await comfyUIService.loadWorkflow('/workflows/character_sheet.json');
  this.currentWorkflow = workflow;

  // Render UI based on workflow
  this.renderWorkflowParameters(workflow);
}
```

### Step 3: Create UI Elements

The `GeneratorView` class can dynamically render parameters:

```javascript
renderWorkflowParameters(workflow) {
  const paramsContainer = document.querySelector('#workflow-parameters');
  const allParams = [];

  // Collect parameters from all nodes
  for (const [nodeId, params] of workflow.metadata.parameters) {
    allParams.push(...params);
  }

  // Render each parameter
  paramsContainer.innerHTML = allParams.map(param => {
    return this.createParameterInput(param);
  }).join('');
}

createParameterInput(param) {
  const inputId = `param-${param.nodeId}-${param.key}`;

  switch (param.type) {
    case 'number':
      return `
        <div class="param-group">
          <label for="${inputId}">${param.label}</label>
          <input
            type="number"
            id="${inputId}"
            value="${param.value}"
            min="${param.min || ''}"
            max="${param.max || ''}"
            step="${param.step || 1}"
            data-node="${param.nodeId}"
            data-key="${param.key}"
          />
        </div>
      `;

    case 'text':
      return `
        <div class="param-group">
          <label for="${inputId}">${param.label}</label>
          <textarea
            id="${inputId}"
            data-node="${param.nodeId}"
            data-key="${param.key}"
          >${param.value}</textarea>
        </div>
      `;

    case 'select':
      return `
        <div class="param-group">
          <label for="${inputId}">${param.label}</label>
          <select
            id="${inputId}"
            data-node="${param.nodeId}"
            data-key="${param.key}"
          >
            <option value="${param.value}">${param.value}</option>
          </select>
        </div>
      `;
  }
}
```

### Step 4: Collect User Input

```javascript
collectParameters() {
  const parameters = {};
  const inputs = document.querySelectorAll('[data-node]');

  inputs.forEach(input => {
    const nodeId = input.dataset.node;
    const key = input.dataset.key;

    if (!parameters[nodeId]) {
      parameters[nodeId] = {};
    }

    const value = input.type === 'number'
      ? parseFloat(input.value)
      : input.value;

    parameters[nodeId][key] = value;
  });

  return parameters;
}
```

### Step 5: Execute Workflow

```javascript
async executeCustomWorkflow() {
  const workflow = this.currentWorkflow;
  const parameters = this.collectParameters();
  const inputImage = this.uploadedImage; // Blob from file upload

  const result = await comfyUIService.executeWorkflow(
    workflow,
    inputImage,
    parameters,
    (progress) => {
      // Update progress UI
      this.updateProgress(progress.progress, progress.status);
    }
  );

  if (result.success) {
    // Display generated images
    result.images.forEach(img => {
      this.displayImage(img.blob);
    });
  }
}
```

---

## Parameter Mapping

### Automatic Parameter Detection

The `ComfyUIService` automatically detects these parameter types:

| Parameter Key | Type | Description |
|---------------|------|-------------|
| `seed` | number | Random seed (0 to MAX_SAFE_INTEGER) |
| `steps` | number | Sampling steps (1-150) |
| `cfg` | number | CFG scale (0-30, step 0.1) |
| `denoise` | number | Denoise strength (0-1, step 0.01) |
| `width` | number | Image width (64-4096, step 64) |
| `height` | number | Image height (64-4096, step 64) |
| `sampler_name` | select | Sampler algorithm |
| `scheduler` | select | Noise scheduler |
| `text` | text | Text prompt |

### Custom Parameter Definitions

To add custom parameter mappings, edit `js/comfyui-service.js`:

```javascript
extractParameters(nodeId, node) {
  const parameterTypes = {
    // ... existing mappings ...

    // Add custom parameters
    'my_custom_param': {
      type: 'number',
      label: 'Custom Parameter',
      min: 0,
      max: 100,
      step: 1
    },

    'expression_type': {
      type: 'select',
      label: 'Expression',
      options: ['neutral', 'happy', 'sad', 'surprised']
    }
  };

  // ... rest of function
}
```

### Node-Specific Parameter Handling

For complex workflows, you might want node-specific handling:

```javascript
// Override parameters for specific node types
if (node.class_type === 'ExpressionEditor') {
  params.push({
    nodeId: nodeId,
    key: 'expression',
    type: 'select',
    label: 'Facial Expression',
    options: ['neutral', 'smile', 'frown', 'surprise', 'blink'],
    value: inputs.expression || 'neutral'
  });
}
```

---

## Advanced Features

### 1. Multi-Output Workflows

Some workflows generate multiple images. Handle them properly:

```javascript
const result = await comfyUIService.executeWorkflow(workflow, inputImage, params);

result.images.forEach((image, index) => {
  console.log(`Image ${index}:`);
  console.log(`- Filename: ${image.filename}`);
  console.log(`- Node ID: ${image.nodeId}`);
  console.log(`- Blob size: ${image.blob.size} bytes`);

  // Save each variant
  await characterManager.addCharacterImage(characterId, image.blob, {
    variant: `pose_${index}`,
    nodeId: image.nodeId
  });
});
```

### 2. Workflow Presets

Create presets for common use cases:

```javascript
const presets = {
  character_sheet: {
    workflowPath: '/workflows/character_sheet.json',
    defaultParams: {
      '5': { seed: 42, steps: 25, cfg: 7.5 },
      '6': { text: 'character turnaround sheet, multiple poses' }
    }
  },

  upscale_2x: {
    workflowPath: '/workflows/upscale.json',
    defaultParams: {
      '3': { upscale_factor: 2 }
    }
  }
};

async function loadPreset(presetName) {
  const preset = presets[presetName];
  const workflow = await comfyUIService.loadWorkflow(preset.workflowPath);

  // Apply default parameters
  const instance = comfyUIService.createWorkflowInstance(
    workflow,
    preset.defaultParams
  );

  return instance;
}
```

### 3. Workflow Chaining

Execute multiple workflows in sequence:

```javascript
async function chainWorkflows(image, workflows) {
  let currentImage = image;

  for (const workflow of workflows) {
    const result = await comfyUIService.executeWorkflow(
      workflow,
      currentImage,
      workflow.parameters
    );

    // Use first output as input for next workflow
    currentImage = result.images[0].blob;
  }

  return currentImage;
}

// Example: Generate, then upscale
const final = await chainWorkflows(inputImage, [
  { workflow: characterWorkflow, parameters: {...} },
  { workflow: upscaleWorkflow, parameters: {...} }
]);
```

### 4. Real-Time Progress with WebSocket

For live progress updates:

```javascript
// Connect to ComfyUI WebSocket
comfyUIService.connectWebSocket((message) => {
  if (message.type === 'progress') {
    const percent = (message.value / message.max) * 100;
    updateProgressBar(percent);
  }

  if (message.type === 'executing' && message.data.node) {
    showStatus(`Processing node: ${message.data.node}`);
  }
});

// Execute workflow (progress updates via WebSocket)
await comfyUIService.executeWorkflow(workflow, image, params);

// Disconnect when done
comfyUIService.disconnectWebSocket();
```

### 5. Batch Processing

Process multiple images with the same workflow:

```javascript
async function batchProcess(images, workflow, parameters) {
  const results = [];

  for (let i = 0; i < images.length; i++) {
    // Update seed for variety
    const batchParams = { ...parameters };
    if (batchParams['5']) {
      batchParams['5'].seed = parameters['5'].seed + i;
    }

    const result = await comfyUIService.executeWorkflow(
      workflow,
      images[i],
      batchParams
    );

    results.push(result);
  }

  return results;
}
```

---

## Troubleshooting

### Common Issues

#### 1. "Failed to connect to ComfyUI server"

**Causes:**
- ComfyUI is not running
- Wrong server URL
- CORS issues

**Solutions:**
```javascript
// Test connection
const result = await comfyUIService.testConnection();
console.log(result);

// Try different URL
comfyUIService.setServerUrl('http://192.168.1.100:8188');

// For CORS issues, start ComfyUI with:
// python main.py --listen 0.0.0.0 --port 8188 --enable-cors-header
```

#### 2. "Image upload failed"

**Causes:**
- Image file too large
- Unsupported format
- Disk space issues

**Solutions:**
```javascript
// Compress image before upload
async function compressImage(blob, maxSize = 2048) {
  const img = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');

  let { width, height } = img;
  if (width > maxSize || height > maxSize) {
    const ratio = Math.min(maxSize / width, maxSize / height);
    width *= ratio;
    height *= ratio;
  }

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  return new Promise(resolve => {
    canvas.toBlob(resolve, 'image/png');
  });
}
```

#### 3. "Workflow execution timeout"

**Causes:**
- Complex workflow taking too long
- Server overloaded
- Network issues

**Solutions:**
```javascript
// Increase timeout in comfyui-service.js
async pollForCompletion(promptId, progressCallback = null) {
  const maxAttempts = 600; // Increase from 300 to 600 (10 minutes)
  // ... rest of function
}
```

#### 4. "Missing models or custom nodes"

**Causes:**
- Workflow requires models not installed in ComfyUI
- Custom nodes not installed

**Solutions:**
1. Check workflow for required models:
```javascript
// Extract model requirements
function getRequiredModels(workflow) {
  const models = {
    checkpoints: [],
    loras: [],
    vae: [],
    upscale: []
  };

  for (const [id, node] of Object.entries(workflow.raw)) {
    if (node.class_type === 'CheckpointLoaderSimple') {
      models.checkpoints.push(node.inputs.ckpt_name);
    }
    if (node.class_type === 'LoraLoader') {
      models.loras.push(node.inputs.lora_name);
    }
    // ... etc
  }

  return models;
}
```

2. Install required models in ComfyUI's directories:
   - Checkpoints: `ComfyUI/models/checkpoints/`
   - LoRAs: `ComfyUI/models/loras/`
   - VAE: `ComfyUI/models/vae/`

---

## Examples

### Example 1: Simple Character Generation

**Workflow**: Single character image from text description

```javascript
// 1. Load workflow
const workflow = await comfyUIService.loadWorkflow('/workflows/simple_character.json');

// 2. Set parameters
const params = {
  '6': { text: 'A friendly cartoon cat wearing a red hat' },
  '3': { seed: 12345, steps: 20, cfg: 7.0 }
};

// 3. Execute (no input image needed)
const result = await comfyUIService.executeWorkflow(workflow, null, params);

// 4. Save result
const imageBlob = result.images[0].blob;
await characterManager.addCharacterImage(characterId, imageBlob, {
  variant: 'base',
  generatedFrom: 'comfyui'
});
```

### Example 2: Character Sheet with Multiple Poses

**Workflow**: Generates 4 poses from a single image

```javascript
// 1. User uploads reference image
const refImage = await uploadImageFile();

// 2. Load character sheet workflow
const workflow = await comfyUIService.loadWorkflow('/251007_MICKMUMPITZ_CCC_3-6_ADV_DL.json');

// 3. Configure for 4 poses
const params = {
  '5': { seed: 42, steps: 25, cfg: 7.5, denoise: 0.75 },
  '14': { text: 'character turnaround, front view, side view, back view, three-quarter view' }
};

// 4. Execute
const result = await comfyUIService.executeWorkflow(workflow, refImage, params);

// 5. Save each pose
const poses = ['front', 'side', 'back', 'three_quarter'];
result.images.forEach((img, i) => {
  characterManager.addCharacterImage(characterId, img.blob, {
    variant: poses[i],
    pose: poses[i]
  });
});
```

### Example 3: Image Upscaling

**Workflow**: 4x upscale with enhancement

```javascript
const upscaleWorkflow = await comfyUIService.loadWorkflow('/workflows/upscale_4x.json');

const params = {
  '2': { upscale_factor: 4 },
  '5': { denoise: 0.3 } // Light denoising during upscale
};

const result = await comfyUIService.executeWorkflow(
  upscaleWorkflow,
  lowResImage,
  params
);

const upscaledImage = result.images[0].blob;
```

### Example 4: Custom Workflow with Dynamic UI

**Creating a flexible UI for any workflow:**

```javascript
class CustomWorkflowHandler {
  async loadAndRenderWorkflow(workflowPath) {
    // Load workflow
    const workflow = await comfyUIService.loadWorkflow(workflowPath);

    // Analyze structure
    console.log(`Workflow has ${workflow.metadata.totalNodes} nodes`);
    console.log('Node types:', workflow.metadata.nodeTypes);

    // Render UI for all parameters
    const container = document.getElementById('dynamic-params');
    container.innerHTML = '';

    for (const [nodeId, params] of workflow.metadata.parameters) {
      const section = document.createElement('div');
      section.className = 'param-section';
      section.innerHTML = `<h3>Node ${nodeId}</h3>`;

      params.forEach(param => {
        section.appendChild(this.createInput(param));
      });

      container.appendChild(section);
    }

    return workflow;
  }

  createInput(param) {
    const div = document.createElement('div');
    div.className = 'param-group';

    const label = document.createElement('label');
    label.textContent = param.label;
    div.appendChild(label);

    let input;
    if (param.type === 'number') {
      input = document.createElement('input');
      input.type = 'number';
      input.value = param.value;
      input.min = param.min;
      input.max = param.max;
      input.step = param.step || 1;
    } else if (param.type === 'text') {
      input = document.createElement('textarea');
      input.value = param.value;
      input.rows = 3;
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = param.value;
    }

    input.dataset.nodeId = param.nodeId;
    input.dataset.key = param.key;
    div.appendChild(input);

    return div;
  }
}
```

---

## Best Practices

### 1. Workflow Organization

```
/workflows/
  ├── character/
  │   ├── basic_character.json
  │   ├── character_sheet.json
  │   └── expression_variants.json
  ├── upscale/
  │   ├── 2x_upscale.json
  │   └── 4x_upscale.json
  └── style/
      ├── anime_style.json
      └── realistic_style.json
```

### 2. Version Control

Include workflow metadata:

```json
{
  "_pique_metadata": {
    "version": "1.0",
    "name": "Character Sheet Generator",
    "description": "Generates 4 character poses",
    "author": "Your Name",
    "created": "2025-01-15",
    "requiredModels": [
      "sd_xl_base_1.0.safetensors",
      "sd_xl_vae.safetensors"
    ]
  },
  "1": { ... },
  "2": { ... }
}
```

### 3. Error Handling

Always wrap workflow execution in try-catch:

```javascript
try {
  const result = await comfyUIService.executeWorkflow(workflow, image, params);

  if (!result.success) {
    throw new Error(result.error);
  }

  // Process results
} catch (error) {
  console.error('Workflow execution failed:', error);

  // Show user-friendly error
  showError(`Generation failed: ${error.message}`);

  // Log for debugging
  await logWorkflowError(workflow, params, error);
}
```

### 4. Performance Optimization

```javascript
// Cache workflows
const workflowCache = new Map();

async function getCachedWorkflow(path) {
  if (!workflowCache.has(path)) {
    const workflow = await comfyUIService.loadWorkflow(path);
    workflowCache.set(path, workflow);
  }
  return workflowCache.get(path);
}

// Compress large images before upload
async function optimizeForWorkflow(blob) {
  const maxSize = 1024; // Max dimension
  const maxFileSize = 2 * 1024 * 1024; // 2MB

  if (blob.size > maxFileSize) {
    return await compressImage(blob, maxSize);
  }

  return blob;
}
```

---

## Summary

You now have everything needed to:

1. ✅ Export workflows from ComfyUI
2. ✅ Understand workflow JSON structure
3. ✅ Load workflows into Pique
4. ✅ Create dynamic UI for parameters
5. ✅ Execute workflows with custom inputs
6. ✅ Handle results and errors
7. ✅ Build custom workflow pages

### Next Steps

1. Create your first workflow in ComfyUI
2. Export it and test in Pique
3. Customize the UI for your specific use case
4. Build a library of reusable workflows

### Resources

- ComfyUI Documentation: https://github.com/comfyanonymous/ComfyUI
- ComfyUI Custom Nodes: https://github.com/ltdrdata/ComfyUI-Manager
- Pique Source Code: `/home/user/pique/js/comfyui-service.js`

---

**Questions or issues?** Check the troubleshooting section or examine the example workflows included in this project.
