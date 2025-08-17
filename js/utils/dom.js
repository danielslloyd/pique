// DOM Helper Utilities
class DOM {
    static $(id) { 
        return document.getElementById(id); 
    }
    
    static create(tag, attrs = {}, content = '') {
        const el = document.createElement(tag);
        Object.assign(el, attrs);
        if (content) el.innerHTML = content;
        return el;
    }
    
    static show(el) { 
        if (el) el.style.display = 'block'; 
    }
    
    static hide(el) { 
        if (el) el.style.display = 'none'; 
    }
    
    static toggle(el, condition) { 
        if (el) el.style.display = condition ? 'block' : 'none'; 
    }
    
    static addClass(el, className) { 
        if (el) el.classList.add(className); 
    }
    
    static removeClass(el, className) { 
        if (el) el.classList.remove(className); 
    }
    
    static toggleClass(el, className, condition) {
        if (el) {
            if (condition) {
                el.classList.add(className);
            } else {
                el.classList.remove(className);
            }
        }
    }
}