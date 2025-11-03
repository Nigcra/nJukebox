// Advanced Theming System for Jukebox
// Automatically detects and manages all CSS custom properties

class AdvancedThemingSystem {
  constructor() {
    // All available CSS custom properties with their categories and REAL values from style.css
    this.cssVariables = {
      'Primary Colors': {
        '--primary-color': '#1DB954',
        '--secondary-color': '#3498db', 
        '--accent-color': '#1ed760'
      },
      'Background Colors': {
        '--background-primary': '#2a2a2a',
        '--background-secondary': '#1f1f1f',
        '--background-tertiary': '#0f0f0f',
        '--background-modal': 'rgba(0, 0, 0, 0.8)',
        '--background-gradient': 'linear-gradient(180deg, #151515 0%, #0f0f0f 100%)',
        '--background-toast': 'rgba(30, 30, 30, 0.95)'
      },
      'Text Colors': {
        '--text-primary': '#f3f3f3',
        '--text-secondary': '#e5e5e5',
        '--text-muted': '#b3b3b3',
        '--text-disabled': '#666666',
        '--text-error': '#e74c3c',
        '--text-subtle': '#999999',
        '--text-dark': '#cccccc'
      },
      'Button Colors': {
        '--button-primary': '#1DB954',
        '--button-primary-hover': '#1ed760',
        '--button-secondary': '#666666',
        '--button-secondary-hover': '#777777',
        '--button-success': '#1DB954',
        '--button-success-hover': '#1ed760',
        '--button-danger': '#e74c3c',
        '--button-danger-hover': '#c0392b',
        '--button-warning': '#f39c12',
        '--button-info': '#3498db'
      },
      'Border Colors': {
        '--border-color': '#333333',
        '--border-hover': '#555555',
        '--border-light': 'rgba(255, 255, 255, 0.1)',
        '--border-success': 'rgba(29, 185, 84, 0.3)',
        '--border-solid': '#444444'
      },
      'Interactive Elements': {
        '--input-background': '#2a2a2a',
        '--progress-background': '#333333',
        '--hover-background': 'rgba(255, 255, 255, 0.05)',
        '--active-background': 'rgba(29, 185, 84, 0.2)',
        '--selection-background': 'rgba(255, 255, 255, 0.1)',
        '--disabled-background': '#666666'
      },
      'Toast & Notifications': {
        '--toast-background': 'rgba(30, 30, 30, 0.95)',
        '--toast-success-border': '#1DB954',
        '--toast-error-border': '#e74c3c',
        '--toast-warning-border': '#f39c12',
        '--toast-info-border': '#3498db'
      }
    };
    
    this.currentTheme = {};
    this.initialized = false;
    
    // Initialize current theme with defaults
    this.resetToDefaults();
  }

  // Reset theme to default values and refresh UI
  async resetToDefaultsAndRefresh() {
    debugLog('theming', '🔄 Resetting theme to defaults...');
    
    // Reset to default values
    this.resetToDefaults();
    
    // Apply to CSS
    this.applyTheme();
    
    // Save to database
    await this.saveTheme();
    
    // Refresh the admin panel to show the new values
    const controlsContainer = document.getElementById('advancedColorControls');
    if (controlsContainer) {
      controlsContainer.innerHTML = this.generateAdminPanel();
      this.setupAdminEventListeners();
      debugLog('theming', '✅ Theme reset complete and admin panel refreshed');
    }
  }

  // Reset theme to default values
  resetToDefaults() {
    this.currentTheme = {};
    Object.values(this.cssVariables).forEach(category => {
      Object.entries(category).forEach(([variable, defaultValue]) => {
        this.currentTheme[variable] = defaultValue;
      });
    });
  }

  // Initialize the theming system
  async initialize() {
    if (this.initialized) return;
    
    try {
      // Load theme from settings
      await this.loadTheme();
      
      // Apply theme to CSS variables
      this.applyTheme();
      
      // Set up event listeners
      this.setupEventListeners();
      
      this.initialized = true;
      debugLog('theming', '🎨 Advanced Theming system initialized with', Object.keys(this.currentTheme).length, 'variables');
    } catch (error) {
      debugLog('THEMING', 'Failed to initialize theming system:', error);
      // Apply default theme as fallback
      this.applyTheme();
    }
  }

  // Load theme from settings database
  async loadTheme() {
    try {
      if (window.settingsAPI) {
        const savedTheme = await window.settingsAPI.getSetting('appearance', 'advancedTheme', {});
        // Merge saved theme with defaults
        Object.entries(savedTheme).forEach(([variable, value]) => {
          if (this.currentTheme.hasOwnProperty(variable)) {
            this.currentTheme[variable] = value;
          }
        });
        debugLog('theming', '🎨 Advanced theme loaded from database');
      }
    } catch (error) {
      debugLog('THEMING', 'Error loading theme:', error);
    }
  }

  // Save theme to settings database
  async saveTheme() {
    try {
      if (window.settingsAPI) {
        await window.settingsAPI.setSetting('appearance', 'advancedTheme', this.currentTheme, 'object', 'Advanced theming configuration');
        debugLog('theming', '🎨 Advanced theme saved to database');
      } else {
        debugLog('THEMING', '⚠️ Settings API not available - theme not saved to database');
      }
    } catch (error) {
      debugLog('THEMING', 'Error saving theme:', error);
    }
  }

  // Apply theme to CSS variables
  applyTheme() {
    const root = document.documentElement;
    Object.entries(this.currentTheme).forEach(([variable, value]) => {
      root.style.setProperty(variable, value);
    });
    
    // Force CSS refresh by toggling a dummy class
    root.classList.add('theme-updated');
    setTimeout(() => {
      root.classList.remove('theme-updated');
    }, 10);
    
    debugLog('theming', '🎨 Theme applied to CSS variables');
  }

  // Update a single color and apply it immediately
  async updateColor(variable, value) {
    debugLog('theming', `🎨 Attempting to update ${variable} to ${value}`);
    
    if (!this.currentTheme.hasOwnProperty(variable)) {
      debugLog('THEMING', `❌ Variable ${variable} not found in theme`);
      return;
    }
    
    try {
      // Update theme
      this.currentTheme[variable] = value;
      debugLog('theming', `✅ Updated theme object for ${variable}`);
      
      // Apply immediately to CSS
      document.documentElement.style.setProperty(variable, value);
      debugLog('theming', `✅ Applied ${variable} to CSS root element`);
      
      // Save to database
      await this.saveTheme();
      debugLog('theming', `✅ Color update complete for ${variable}`);
      
    } catch (error) {
      debugLog('THEMING', '❌ Error in updateColor:', error);
    }
  }

  // Get current value of a CSS variable
  getColor(variable) {
    return this.currentTheme[variable] || '';
  }

  // Set up event listeners for admin panel
  setupEventListeners() {
    // This will be called from admin panel
    document.addEventListener('theme-color-changed', (event) => {
      const { variable, value } = event.detail;
      this.updateColor(variable, value);
    });
  }

  // Generate admin panel HTML for all color controls (compact design)
  generateAdminPanel() {
    let html = '<div class="advanced-theming-panel">';
    
    // Create a flat array of all colors
    const allColors = [];
    Object.entries(this.cssVariables).forEach(([categoryName, variables]) => {
      Object.entries(variables).forEach(([variable, defaultValue]) => {
        allColors.push({
          variable,
          defaultValue,
          category: categoryName,
          currentValue: this.currentTheme[variable]
        });
      });
    });

    // Compact grid layout
    html += `
      <div class="theming-compact-grid">
    `;
    
    allColors.forEach(({ variable, currentValue }) => {
      const displayName = this.getDisplayName(variable);
      const colorValue = this.normalizeHexColor(currentValue);
      
      html += `
        <div class="theming-compact-control" title="${displayName}">
          <input 
            type="color" 
            id="${variable}" 
            data-variable="${variable}" 
            value="${colorValue}" 
            class="theme-color-picker-compact"
            style="background-color: ${colorValue};"
          >
          <span class="theming-compact-label">${displayName}</span>
        </div>
      `;
    });
    
    html += `
      </div>
      <div class="theming-actions">
        <button type="button" class="btn btn-secondary" onclick="window.advancedTheming.resetToDefaultsAndRefresh()" style="background: var(--button-secondary); color: var(--text-primary); border: 1px solid var(--border-color); padding: 8px 16px; border-radius: 6px; cursor: pointer; transition: all 0.2s ease;">
          🔄 Auf Standard zurücksetzen
        </button>
      </div>
    `;
    
    return html;
  }

  // Convert display name from CSS variable
  getDisplayName(variable) {
    return variable
      .replace('--', '')
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // Normalize hex colors to 6-digit format for HTML color inputs
  normalizeHexColor(color) {
    // Skip non-hex colors (rgba, rgb, etc.)
    if (!color.startsWith('#')) {
      return '#000000'; // Default for non-hex colors
    }
    
    // Convert 3-digit to 6-digit hex
    if (color.length === 4) {
      return '#' + color.slice(1).split('').map(c => c + c).join('');
    }
    
    // Already 6-digit or other format
    if (color.length === 7) {
      return color;
    }
    
    // Fallback
    return '#000000';
  }

  // Setup admin panel event listeners (compact version)
  setupAdminEventListeners() {
    // Compact color picker change events
    document.addEventListener('change', (event) => {
      if (event.target.classList.contains('theme-color-picker-compact')) {
        const variable = event.target.dataset.variable;
        const value = event.target.value;
        
        // Update the background color of the picker to show current color
        event.target.style.backgroundColor = value;
        
        this.updateColor(variable, value);
      }
    });

    // Show tooltip with current color value on hover
    document.addEventListener('mouseover', (event) => {
      if (event.target.classList.contains('theme-color-picker-compact')) {
        const variable = event.target.dataset.variable;
        const currentValue = this.currentTheme[variable];
        event.target.title = `${this.getDisplayName(variable)}: ${currentValue}`;
      }
    });
  }
}

// Create global instance
window.advancedTheming = new AdvancedThemingSystem();

// Note: Initialization will be handled by HTML script to ensure proper timing