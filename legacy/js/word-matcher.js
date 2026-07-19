// Word Matching and Similarity Algorithms
class WordMatcher {
    static normalizeWord(word) {
        return word.toLowerCase()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    
    static calculateSimilarity(word1, word2) {
        const w1 = this.normalizeWord(word1);
        const w2 = this.normalizeWord(word2);
        
        if (w1 === w2) return 1.0;
        
        // Check homophones
        if (this.areHomophones(w1, w2)) return 1.0;
        
        // Check phonetic similarity
        const phoneticSimilarity = this.getPhoneticSimilarity(w1, w2);
        if (phoneticSimilarity >= 0.9) return phoneticSimilarity;
        
        // Calculate Levenshtein distance similarity
        return this.getLevenshteinSimilarity(w1, w2);
    }
    
    static areHomophones(w1, w2) {
        const homophones = {
            'there': ['their', 'theyre'],
            'their': ['there', 'theyre'],
            'theyre': ['there', 'their'],
            'to': ['too', 'two', '2'],
            'too': ['to', 'two', '2'],
            'two': ['to', 'too', '2'],
            '2': ['to', 'too', 'two'],
            'your': ['youre'],
            'youre': ['your'],
            'its': ['its'],
            'its': ['its'],
            'here': ['hear'],
            'hear': ['here'],
            'where': ['wear'],
            'wear': ['where'],
            'no': ['know'],
            'know': ['no'],
            'by': ['bye', 'buy'],
            'bye': ['by', 'buy'],
            'buy': ['by', 'bye'],
            'for': ['four', '4'],
            'four': ['for', '4'],
            '4': ['four', 'for'],
            'one': ['won', '1'],
            'won': ['one', '1'],
            '1': ['one', 'won'],
            'wear': ['where'],
            'where': ['wear'],
            'where\'s': ['wears'],
            'wears': ['where\'s'],
            'right': ['write'],
            'write': ['right'],
            'see': ['sea'],
            'sea': ['see'],
            'three': ['3'],
            '3': ['three'],
            'five': ['5'],
            '5': ['five'],
            'six': ['6'],
            '6': ['six'],
            'seven': ['7'],
            '7': ['seven'],
            'eight': ['8', 'ate'],
            '8': ['eight', 'ate'],
            'ate': ['eight', '8'],
            'nine': ['9'],
            '9': ['nine'],
            'ten': ['10'],
            '10': ['ten'],
            'zero': ['0'],
            '0': ['zero']
        };
        
        return homophones[w1]?.includes(w2) || false;
    }
    
    static getPhoneticSimilarity(w1, w2) {
        const phoneticMap = {
            'th': 'd', 'f': 'p', 'v': 'b', 's': 'sh', 'z': 's',
            'r': 'w', 'l': 'w', 'ing': 'in', 'ed': 'd'
        };
        
        let p1 = w1, p2 = w2;
        for (let [from, to] of Object.entries(phoneticMap)) {
            p1 = p1.replace(new RegExp(from, 'g'), to);
            p2 = p2.replace(new RegExp(from, 'g'), to);
        }
        
        if (p1 === p2) return 0.9;
        
        return this.getLevenshteinSimilarity(p1, p2);
    }
    
    static getLevenshteinSimilarity(str1, str2) {
        const maxLen = Math.max(str1.length, str2.length);
        if (maxLen === 0) return 1.0;
        
        const distance = this.levenshteinDistance(str1, str2);
        return 1 - (distance / maxLen);
    }
    
    static levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }
}