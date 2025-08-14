// Speech Recognition and Word Matching Engine
class SpeechEngine {
    constructor() {
        this.recognition = null;
        this.wordPile = [];
        this.consecutiveNoMatch = 0;
        this.maxConsecutiveNoMatch = 3;
        this.app = null;
    }
    
    startListening(app) {
        this.app = app;
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            app.ui.showFeedback("Your browser doesn't support Speech Recognition", 'error');
            return;
        }
        
        this.createDebugOverlay();
        this.wordPile = [];
        
        if (this.recognition) {
            this.recognition.stop();
        }
        
        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'en-US';
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.maxAlternatives = 5;
        
        this.recognition.onresult = (event) => this.handleSpeechResult(event);
        this.recognition.onerror = (event) => this.handleSpeechError(event);
        this.recognition.onend = () => this.handleSpeechEnd();
        
        this.recognition.start();
    }
    
    handleSpeechResult(event) {
        const latestResult = event.results[event.results.length - 1];
        console.log('Recognition result:', latestResult[0].transcript);
        
        this.updateDebugOverlay(event.results);
        this.addWordsTopile(latestResult);
        
        const expectedWords = this.app.bookData.pages[this.app.currentPageIndex].text.trim().split(' ');
        const foundMatches = this.processWordPile(expectedWords);
        
        this.provideFeedback(foundMatches, latestResult.isFinal, expectedWords);
        this.cleanupWordPile();
    }
    
    addWordsTopile(result) {
        for (let altIndex = 0; altIndex < result.length; altIndex++) {
            const alternative = result[altIndex];
            const transcript = alternative.transcript.trim();
            const confidence = alternative.confidence || 0.5;
            const spokenWords = transcript.split(' ');
            
            spokenWords.forEach(word => {
                if (word.trim()) {
                    this.wordPile.push({ word: word.trim(), confidence });
                }
            });
        }
        
        console.log('Word pile:', this.wordPile.map(w => `"${w.word}"`).join(', '));
    }
    
    processWordPile(expectedWords) {
        let foundMatches = 0;
        
        while (this.app.currentWordIndex < expectedWords.length && this.wordPile.length > 0) {
            const expectedWord = expectedWords[this.app.currentWordIndex];
            let matchFound = false;
            
            console.log(`Looking for: "${expectedWord}" in pile of ${this.wordPile.length} words`);
            
            for (let i = 0; i < this.wordPile.length; i++) {
                const pileWord = this.wordPile[i];
                const similarity = WordMatcher.calculateSimilarity(pileWord.word, expectedWord);
                
                console.log(`  "${pileWord.word}" vs "${expectedWord}" = ${similarity.toFixed(2)}`);
                
                if (similarity >= 0.8) {
                    console.log(`  ✓ MATCH! Removing "${pileWord.word}" and ${i} words before it`);
                    
                    this.wordPile.splice(0, i + 1);
                    foundMatches++;
                    matchFound = true;
                    this.consecutiveNoMatch = 0;
                    break;
                }
            }
            
            if (!matchFound) break;
        }
        
        if (foundMatches > 0) {
            this.app.onWordMatched(foundMatches);
        }
        
        return foundMatches;
    }
    
    provideFeedback(foundMatches, isFinal, expectedWords) {
        if (foundMatches > 0) {
            if (foundMatches === 1 && isFinal) {
                this.app.ui.showFeedback('Good!', 'success');
            } else if (foundMatches > 1) {
                this.app.ui.showFeedback(`Great! ${foundMatches} words!`, 'success');
            }
        } else if (isFinal) {
            this.consecutiveNoMatch++;
            if (this.consecutiveNoMatch >= this.maxConsecutiveNoMatch) {
                this.app.ui.showFeedback(`Let's try the word "${expectedWords[this.app.currentWordIndex]}"`, 'encourage');
                this.consecutiveNoMatch = 0;
            }
        }
    }
    
    cleanupWordPile() {
        if (this.wordPile.length > 15) {
            this.wordPile.splice(0, this.wordPile.length - 15);
        }
        
        console.log(`After processing: currentWordIndex=${this.app.currentWordIndex}, pile size=${this.wordPile.length}`);
    }
    
    handleSpeechError(event) {
        setTimeout(() => {
            if (this.recognition) {
                this.recognition.start();
            }
        }, 1000);
    }
    
    handleSpeechEnd() {
        if (!this.app.bookData?.pages[this.app.currentPageIndex]) return;
        
        const expectedWords = this.app.bookData.pages[this.app.currentPageIndex].text.trim().split(' ');
        if (this.app.currentWordIndex < expectedWords.length) {
            setTimeout(() => {
                if (this.recognition) {
                    this.recognition.start();
                }
            }, 100);
        }
    }
    
    stop() {
        if (this.recognition) {
            this.recognition.stop();
            this.recognition = null;
        }
        this.removeDebugOverlay();
    }
    
    reset() {
        this.wordPile = [];
        this.consecutiveNoMatch = 0;
    }
    
    createDebugOverlay() {
        const existingOverlay = document.getElementById('debug-overlay');
        if (existingOverlay) {
            existingOverlay.remove();
        }

        const overlay = document.createElement('div');
        overlay.id = 'debug-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 15px;
            border-radius: 8px;
            font-family: monospace;
            font-size: 12px;
            z-index: 9999;
            max-width: 300px;
            min-height: 200px;
        `;
        overlay.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 10px;">🎤 Speech Recognition Debug</div>
            <div id="debug-content">Listening...</div>
        `;
        document.body.appendChild(overlay);
    }
    
    removeDebugOverlay() {
        const overlay = document.getElementById('debug-overlay');
        if (overlay) {
            overlay.remove();
        }
    }
    
    updateDebugOverlay(results) {
        const debugContent = document.getElementById('debug-content');
        if (!debugContent) return;

        let html = '<div style="margin-bottom: 10px;"><strong>Current Results:</strong></div>';
        
        if (results && results.length > 0) {
            const latestResult = results[results.length - 1];
            
            html += '<div style="margin-bottom: 8px; color: #4CAF50;">Live Transcript:</div>';
            html += `<div style="margin-bottom: 15px; padding: 5px; background: rgba(255,255,255,0.1); border-radius: 3px;">"${latestResult[0].transcript}"</div>`;
            
            html += '<div style="margin-bottom: 8px; color: #ff9800;">Word Pile:</div>';
            html += `<div style="margin-bottom: 15px; padding: 5px; background: rgba(255,255,255,0.1); border-radius: 3px;">[${this.wordPile.map(w => `"${w.word}"`).join(', ')}]</div>`;
            
            html += '<div style="margin-bottom: 8px; color: #ff9800;">Alternative Hypotheses:</div>';
            
            const alternatives = Array.from(latestResult).slice(0, 5);
            alternatives.forEach((alternative, index) => {
                const confidence = (alternative.confidence * 100).toFixed(1);
                const isTop = index === 0;
                html += `
                    <div style="
                        margin-bottom: 5px; 
                        padding: 3px 6px; 
                        background: ${isTop ? 'rgba(76,175,80,0.3)' : 'rgba(255,255,255,0.1)'}; 
                        border-radius: 3px;
                        border-left: 3px solid ${isTop ? '#4CAF50' : '#666'};
                    ">
                        <div style="display: flex; justify-content: space-between;">
                            <span style="color: ${isTop ? '#4CAF50' : '#ccc'}">#${index + 1}</span>
                            <span style="color: #ff9800;">${confidence}%</span>
                        </div>
                        <div style="word-break: break-word; margin-top: 2px;">
                            "${alternative.transcript}"
                        </div>
                    </div>
                `;
            });

            if (this.app?.bookData?.pages[this.app.currentPageIndex]) {
                const expectedWords = this.app.bookData.pages[this.app.currentPageIndex].text.trim().split(' ');
                const expectedWord = expectedWords[this.app.currentWordIndex] || '(complete)';
                
                html += '<div style="margin-top: 15px; margin-bottom: 8px; color: #2196F3;">Word Analysis:</div>';
                html += `<div style="margin-bottom: 8px;">Looking for: <strong>"${expectedWord}"</strong> (${this.app.currentWordIndex + 1}/${expectedWords.length})</div>`;
            }
        } else {
            html += '<div style="color: #666;">No speech detected</div>';
        }
        
        debugContent.innerHTML = html;
    }
}