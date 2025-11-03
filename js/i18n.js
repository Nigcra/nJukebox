/**
 * Internationalization (i18n) System for Jukebox
 * Supports multiple languages with dynamic loading and switching
 */

class I18nSystem {
  constructor() {
    this.currentLanguage = 'de'; // Default language
    this.translations = {};
    this.supportedLanguages = ['de', 'en'];
    this.fallbackLanguage = 'en';
    
    // Initialize system
    this.init();
  }

  async init() {
    // Load saved language preference
    const savedLanguage = this.loadLanguagePreference();
    if (savedLanguage && this.supportedLanguages.includes(savedLanguage)) {
      this.currentLanguage = savedLanguage;
    }
    
    // Load initial language files
    await this.loadLanguage(this.currentLanguage);
    
    debugLog('i18n', `[I18N] System initialized with language: ${this.currentLanguage}`);
  }

  /**
   * Load language preference from localStorage
   */
  loadLanguagePreference() {
    try {
      const adminSettings = JSON.parse(localStorage.getItem('adminSettings') || '{}');
      return adminSettings.language || null;
    } catch (error) {
      debugLog('I18N', 'Failed to load language preference:', error);
      return null;
    }
  }

  /**
   * Save language preference to localStorage
   */
  saveLanguagePreference(languageCode) {
    try {
      const adminSettings = JSON.parse(localStorage.getItem('adminSettings') || '{}');
      adminSettings.language = languageCode;
      localStorage.setItem('adminSettings', JSON.stringify(adminSettings));
    } catch (error) {
      debugLog('I18N', 'Failed to save language preference:', error);
    }
  }

  /**
   * Load translations for a specific language
   */
  async loadLanguage(languageCode) {
    if (!this.supportedLanguages.includes(languageCode)) {
      debugLog('I18N', `Unsupported language: ${languageCode}, using fallback: ${this.fallbackLanguage}`);
      languageCode = this.fallbackLanguage;
    }

    try {
      const response = await fetch(`locales/${languageCode}.json`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const translations = await response.json();
      this.translations[languageCode] = translations;
      
      debugLog('i18n', `[I18N] Loaded translations for: ${languageCode}`);
      return translations;
    } catch (error) {
      debugLog('I18N', `Failed to load language file ${languageCode}.json:`, error);
      
      // Load fallback language if current language fails
      if (languageCode !== this.fallbackLanguage) {
        debugLog('i18n', `[I18N] Loading fallback language: ${this.fallbackLanguage}`);
        return this.loadLanguage(this.fallbackLanguage);
      }
      
      throw error;
    }
  }

  /**
   * Change current language
   */
  async changeLanguage(languageCode) {
    if (languageCode === this.currentLanguage) {
      debugLog('i18n', `[I18N] Language already set to: ${languageCode}`);
      return;
    }

    // Load language if not cached
    if (!this.translations[languageCode]) {
      await this.loadLanguage(languageCode);
    }

    this.currentLanguage = languageCode;
    this.saveLanguagePreference(languageCode);
    
    // Update UI
    this.updateUI();
    
    // Emit language change event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('languageChanged', { 
        detail: { language: languageCode } 
      }));
    }
  }

  /**
   * Get translation by key path (e.g., 'ui.buttons.play')
   */
  t(keyPath, fallback = null) {
    if (!keyPath) {
      debugLog('I18N', 'Empty key path provided');
      return fallback || keyPath;
    }

    const currentTranslations = this.translations[this.currentLanguage];
    if (!currentTranslations) {
      debugLog('I18N', `No translations loaded for: ${this.currentLanguage}`);
      return fallback || keyPath;
    }

    // Navigate through nested object using key path
    const keys = keyPath.split('.');
    let value = currentTranslations;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        // Key not found, try fallback language
        const fallbackTranslations = this.translations[this.fallbackLanguage];
        if (fallbackTranslations && this.currentLanguage !== this.fallbackLanguage) {
          debugLog('I18N', `Key '${keyPath}' not found in ${this.currentLanguage}, using fallback`);
          return this.getFallbackTranslation(keyPath, fallback);
        }
        
        debugLog('I18N', `Translation key not found: ${keyPath}`);
        return fallback || keyPath;
      }
    }

    return value;
  }

  /**
   * Get translation from fallback language
   */
  getFallbackTranslation(keyPath, fallback = null) {
    const fallbackTranslations = this.translations[this.fallbackLanguage];
    if (!fallbackTranslations) {
      return fallback || keyPath;
    }

    const keys = keyPath.split('.');
    let value = fallbackTranslations;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return fallback || keyPath;
      }
    }

    return value;
  }

  /**
   * Get available languages with metadata
   */
  getAvailableLanguages() {
    return this.supportedLanguages.map(code => {
      const translations = this.translations[code];
      return {
        code,
        name: translations?.meta?.language || code,
        flag: translations?.meta?.flag || '🌐',
        loaded: !!translations
      };
    });
  }

  /**
   * Get current language info
   */
  getCurrentLanguage() {
    const translations = this.translations[this.currentLanguage];
    return {
      code: this.currentLanguage,
      name: translations?.meta?.language || this.currentLanguage,
      flag: translations?.meta?.flag || '🌐'
    };
  }

  /**
   * Update UI elements with current translations
   */
  updateUI() {
    // Update elements with data-i18n attribute
    const i18nElements = document.querySelectorAll('[data-i18n]');
    
    i18nElements.forEach(element => {
      const key = element.getAttribute('data-i18n');
      
      // Skip elements with empty or null data-i18n attributes
      if (!key || key.trim() === '') {
        return;
      }
      
      const translation = this.t(key);
      
      if (element.tagName === 'INPUT' && element.type === 'text') {
        element.placeholder = translation;
      } else {
        element.textContent = translation;
      }
    });

    // Update elements with data-i18n-title attribute
    document.querySelectorAll('[data-i18n-title]').forEach(element => {
      const key = element.getAttribute('data-i18n-title');
      
      // Skip elements with empty or null data-i18n-title attributes
      if (!key || key.trim() === '') {
        return;
      }
      
      const translation = this.t(key);
      element.title = translation;
    });

    // Update elements with data-i18n-placeholder attribute
    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
      const key = element.getAttribute('data-i18n-placeholder');
      
      // Skip elements with empty or null data-i18n-placeholder attributes
      if (!key || key.trim() === '') {
        return;
      }
      
      const translation = this.t(key);
      element.placeholder = translation;
    });

    // Update Spotify status UI if function exists
    if (typeof updateSpotifyStatusUI === 'function') {
      updateSpotifyStatusUI();
    }
  }

  /**
   * Debug translation function - includes language prefix
   */
  td(keyPath, fallback = null) {
    const translation = this.t(`debug.${keyPath}`, fallback);
    return `[${this.currentLanguage.toUpperCase()}] ${translation}`;
  }
}

// Create global i18n instance
window.i18n = new I18nSystem();
window.i18nSystem = window.i18n; // Legacy alias for compatibility

// Initialize immediately with saved language preference
const savedLanguage = window.i18n.loadLanguagePreference();
const initialLanguage = savedLanguage || 'de';

// Load the initial language synchronously if possible
window.i18n.currentLanguage = initialLanguage;

// Initialize properly when ready
const initializeI18n = async () => {
  try {
    await window.i18n.changeLanguage(initialLanguage);
    
    // Emit initialization complete event
    window.dispatchEvent(new CustomEvent('i18nInitialized', { 
      detail: { language: window.i18n.currentLanguage } 
    }));
  } catch (error) {
    debugLog('I18N', 'Initialization failed:', error);
  }
};

// Initialize when DOM is ready, or immediately if already ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeI18n);
} else {
  // DOM is already ready
  initializeI18n();
}

// Convenience functions for global access
window.t = (key, fallback) => window.i18n.t(key, fallback);
window.td = (key, fallback) => window.i18n.td(key, fallback);

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = I18nSystem;
}
