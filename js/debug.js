// Debug system module for Jukebox
// Provides debugging functionality with category-based filtering

let isDebuggingEnabled = false; // Default disabled - will be set by admin settings

// Store original console.log for system messages
const originalConsoleLog = console.log;

// Override console.log to filter debug messages
console.log = function(...args) {
  // Check if this is a debug message (starts with [CATEGORY])
  if (args.length > 0 && typeof args[0] === 'string' && args[0].match(/^\[[A-Z0-9-]+\]/)) {
    // Only show if debugging is enabled
    if (isDebuggingEnabled) {
      originalConsoleLog.apply(console, args);
    }
  } else {
    // Always show non-debug messages
    originalConsoleLog.apply(console, args);
  }
};

// Global debug function - only logs if debugging is enabled
function debugLog(category, ...args) {
  if (isDebuggingEnabled) {
    originalConsoleLog(`[${category.toUpperCase()}]`, ...args);
  }
}

// Legacy debug function for backward compatibility
function debug(category, ...args) {
  debugLog(category, ...args);
}

// Enable/disable debugging
function enableDebugging() {
  const oldState = isDebuggingEnabled;
  isDebuggingEnabled = true;
  debugLog('DEBUG', 'Debugging enabled');
  
  if (!oldState && typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('debugStateChanged', {
      detail: { enabled: true, source: 'manual', oldState }
    }));
  }
}

function disableDebugging() {
  const oldState = isDebuggingEnabled;
  debugLog('DEBUG', 'Debugging disabled');
  isDebuggingEnabled = false;
  
  if (oldState && typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('debugStateChanged', {
      detail: { enabled: false, source: 'manual', oldState }
    }));
  }
}

// Set debugging state programmatically (protected from override)
function setDebuggingState(enabled, source = 'manual') {
  const oldState = isDebuggingEnabled;
  isDebuggingEnabled = enabled;
  
  if (oldState !== enabled) {
    debugLog('SYSTEM', `Debugging ${enabled ? 'enabled' : 'disabled'} by ${source}`);
    
    // Update data server
    updateDataServerDebugStatus();
    
    // Save to Settings API if not from Settings API itself
    if (source !== 'settings-api') {
      saveDebuggingStatus();
    }
    
    // Dispatch event for UI updates
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('debugStateChanged', {
        detail: { enabled, source, oldState }
      }));
    }
  }
}

// Check if debugging is currently enabled
function isDebuggingActive() {
  return isDebuggingEnabled;
}

// Load debugging status from Settings API (called by admin panel)
async function loadDebuggingStatus() {
  try {
    if (window.settingsAPI) {
      const debuggingEnabled = await window.settingsAPI.getSetting('admin', 'debuggingEnabled', false);
      isDebuggingEnabled = debuggingEnabled;
      debugLog('SYSTEM', 'Debugging status loaded from Settings API:', isDebuggingEnabled ? 'ACTIVE' : 'INACTIVE');
    } else {
      // Fallback to localStorage
      const settings = JSON.parse(localStorage.getItem('adminSettings') || '{}');
      isDebuggingEnabled = settings.debuggingEnabled || false;
      debugLog('SYSTEM', 'Debugging status loaded from localStorage:', isDebuggingEnabled ? 'ACTIVE' : 'INACTIVE');
    }
    
    // Update data server debug status
    updateDataServerDebugStatus();
  } catch (error) {
    console.warn('Failed to load debugging status:', error);
    // Fallback to localStorage
    try {
      const settings = JSON.parse(localStorage.getItem('adminSettings') || '{}');
      isDebuggingEnabled = settings.debuggingEnabled || false;
    } catch (fallbackError) {
      console.warn('Failed to load from localStorage fallback:', fallbackError);
    }
  }
}

// Save debugging status to Settings API (with localStorage fallback)
async function saveDebuggingStatus() {
  try {
    if (window.settingsAPI) {
      const success = await window.settingsAPI.setSetting('admin', 'debuggingEnabled', isDebuggingEnabled, 'boolean');
      if (success) {
        debugLog('SYSTEM', 'Debugging status saved to Settings API:', isDebuggingEnabled ? 'ACTIVE' : 'INACTIVE');
      } else {
        throw new Error('Settings API save failed');
      }
    } else {
      // Fallback to localStorage
      const settings = JSON.parse(localStorage.getItem('adminSettings') || '{}');
      settings.debuggingEnabled = isDebuggingEnabled;
      localStorage.setItem('adminSettings', JSON.stringify(settings));
      debugLog('SYSTEM', 'Debugging status saved to localStorage:', isDebuggingEnabled ? 'ACTIVE' : 'INACTIVE');
    }
    
    // Update data server debug status
    updateDataServerDebugStatus();
  } catch (error) {
    console.warn('Failed to save debugging status to Settings API, using localStorage:', error);
    try {
      // Fallback to localStorage
      const settings = JSON.parse(localStorage.getItem('adminSettings') || '{}');
      settings.debuggingEnabled = isDebuggingEnabled;
      localStorage.setItem('adminSettings', JSON.stringify(settings));
      updateDataServerDebugStatus();
    } catch (fallbackError) {
      console.warn('Failed to save debugging status:', fallbackError);
    }
  }
}

// Toggle debugging on/off
async function toggleDebugging() {
  const oldState = isDebuggingEnabled;
  isDebuggingEnabled = !isDebuggingEnabled;
  await saveDebuggingStatus();
  
  // Update UI if debugging toggle exists
  const debugToggle = document.getElementById('debugToggle');
  if (debugToggle) {
    debugToggle.checked = isDebuggingEnabled;
  }
  
  // Dispatch event for UI updates
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('debugStateChanged', {
      detail: { enabled: isDebuggingEnabled, source: 'toggle', oldState }
    }));
  }
  
  // Show immediate feedback
  if (isDebuggingEnabled) {
    console.log('🐛 DEBUGGING ACTIVATED - All debug output will be shown');
    debugLog('SYSTEM', 'Debugging turned on');
    debugLog('SYSTEM', 'Available debug categories: SYSTEM, DATA-API, SPOTIFY, AUDIO, QUEUE, UI, COVER');
  } else {
    console.log('🔇 DEBUGGING DEACTIVATED - Debug output will be suppressed');
  }
}

// Get current debugging state
function getDebuggingState() {
  return isDebuggingEnabled;
}

// Send debug status to data server
async function updateDataServerDebugStatus() {
  try {
    await fetch('http://localhost:3001/api/debug-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: isDebuggingEnabled })
    });
    debugLog('SYSTEM', 'Data server debug status updated:', isDebuggingEnabled);
  } catch (error) {
    console.warn('Could not send debug status to data server:', error.message);
  }
}

// Export functions for use in other modules
if (typeof window !== 'undefined') {
  window.debugLog = debugLog;
  window.debug = debug;
  window.enableDebugging = enableDebugging;
  window.disableDebugging = disableDebugging;
  window.setDebuggingState = setDebuggingState;
  window.isDebuggingEnabled = isDebuggingActive;
  window.loadDebuggingStatus = loadDebuggingStatus;
  window.saveDebuggingStatus = saveDebuggingStatus;
  window.toggleDebugging = toggleDebugging;
  window.updateDataServerDebugStatus = updateDataServerDebugStatus;
  window.getDebuggingState = getDebuggingState;
  window.isDebuggingEnabled = () => isDebuggingEnabled;
}

// Auto-load debugging status when module loads - wait for admin settings
if (typeof window !== 'undefined') {
  // Don't auto-initialize - let admin panel handle debug state
  // The admin panel will call setDebuggingState() when settings are loaded
  console.log('🐛 Debug system loaded - waiting for admin settings to set state');
}

// ES6 exports removed for compatibility - functions are available globally via window object
