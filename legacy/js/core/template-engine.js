// Template Engine - Simple template rendering system
class TemplateEngine {
    static render(template, data = {}) {
        return template.replace(/\{\{(\w+)\}\}/g, (match, key) => data[key] || '');
    }
    
    static templates = {
        pageEditor: `
            <div class="page-editor" id="page-editor-{{index}}">
                <div class="page-editor-header">
                    <h3>Page {{pageNumber}}</h3>
                    <button onclick="window.app.deletePage({{index}})" class="delete-page-btn">Delete</button>
                </div>
                <div class="page-editor-content">
                    <div class="page-image-upload">
                        <div class="image-upload-area" id="image-upload-{{index}}" onclick="document.getElementById('image-input-{{index}}').click()">
                            <div class="upload-placeholder">
                                <p>Click to upload image</p>
                                <p>JPG, PNG supported</p>
                            </div>
                        </div>
                        <input type="file" id="image-input-{{index}}" accept="image/*" onchange="window.app.handlePageImageUpload({{index}}, event)">
                    </div>
                    <div class="page-text-input">
                        <textarea id="text-input-{{index}}" placeholder="Enter the text for this page..." onchange="window.app.updatePageText({{index}}, this.value)"></textarea>
                    </div>
                </div>
            </div>`
    };
}