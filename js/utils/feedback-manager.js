// User Feedback Management
class FeedbackManager {
    static show(message, type = 'info') {
        this.clear();
        
        const feedback = DOM.create('div', {
            id: 'feedback',
            textContent: message
        });
        
        feedback.style.cssText = this.getStyles(type);
        document.body.appendChild(feedback);
        
        setTimeout(() => this.clear(), 2000);
    }

    static clear() {
        const existing = DOM.$('feedback');
        if (existing) existing.remove();
    }

    static getStyles(type) {
        const baseStyle = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 10px 20px;
            border-radius: 25px;
            font-weight: bold;
            font-size: 1.1rem;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;
        
        const colors = {
            success: 'background: #27ae60; color: white;',
            error: 'background: #e74c3c; color: white;',
            encourage: 'background: #f39c12; color: white;',
            info: 'background: #3498db; color: white;'
        };
        
        return baseStyle + (colors[type] || colors.info);
    }

    static playSuccessSound() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.1);
            oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.2);
            
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
        } catch (error) {
            // Silently fail if audio context is not available
            console.warn('Audio context not available for success sound');
        }
    }
}