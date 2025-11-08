/**
 * Now Playing Visualizer Module
 * 
 * Provides advanced visual effects for the now-playing section.
 * Includes multiple visualization modes: Space, Fire, Particles, and Circles.
 * 
 * Features:
 * - 4 different visualization modes with smooth transitions
 * - Cover-color based theming
 * - Audio-reactive animations
 * - Automatic mode rotation
 * - Performance optimized rendering
 */

(function() {
  'use strict';
  
  // Canvas and context
  let nowPlayingVisualizerCanvas = null;
  let nowPlayingVisualizerCtx = null;
  let nowPlayingAnimationFrame = null;
  
  // Visualization mode system
  let currentVisualizationMode = 0;
  let targetVisualizationMode = 0;
  let isVisualizationFading = false;
  let visualizationFadeAlpha = 1.0;
  let visualizationModeChangeInterval = null;
  
  // Space visualization variables
  let stars = [];
  const MAX_STARS = 150;
  let starPulseTime = 0;
  
  // Particles visualization variables
  let enhancedParticles = [];
  const MAX_ENHANCED_PARTICLES = 80;
  
  // Circles visualization cache
  let circlesColorCache = {
    baseHue: 120,
    baseSat: 90,
    baseLight: 50,
    lastUpdate: 0
  };
  
  // Default visualization settings
  let visualizationSettings = {
    enableSpace: true,
    enableFire: true,
    enableParticles: true,
    enableCircles: true,
    switchInterval: 30 // seconds
  };
  
  /**
   * Initialize the now-playing visualizer
   * @param {Object} options - Configuration options
   * @param {Function} options.isMusicPlayingCallback - Function to check if music is playing
   * @param {Object} options.settings - Visualization settings
   */
  function initVisualizer(options = {}) {
    const nowPlayingContainer = document.querySelector('.now-playing-container');
    
    if (!nowPlayingContainer) {
      debugLog('VISUALIZER', '❌ Now-playing container not found');
      return false;
    }
    
    // Create canvas element
    nowPlayingVisualizerCanvas = document.createElement('canvas');
    nowPlayingVisualizerCanvas.id = 'nowPlayingVisualizer';
    nowPlayingVisualizerCanvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1;
      border-radius: 16px;
      opacity: 0.6;
    `;
    
    // Insert canvas as first child
    nowPlayingContainer.insertBefore(nowPlayingVisualizerCanvas, nowPlayingContainer.firstChild);
    
    nowPlayingVisualizerCtx = nowPlayingVisualizerCanvas.getContext('2d');
    
    // Set canvas dimensions
    updateCanvasSize();
    
    // Handle resize
    const resizeObserver = new ResizeObserver(updateCanvasSize);
    resizeObserver.observe(nowPlayingContainer);
    
    // Apply settings
    if (options.settings) {
      visualizationSettings = { ...visualizationSettings, ...options.settings };
    }
    
    // Initialize visualization modes
    initVisualizationModes();
    
    // Start animation loop
    startVisualization(options.isMusicPlayingCallback);
    
    debugLog('VISUALIZER', '✅ Now-playing visualizer initialized');
    return true;
  }
  
  function updateCanvasSize() {
    if (!nowPlayingVisualizerCanvas) return;
    
    const container = nowPlayingVisualizerCanvas.parentElement;
    const rect = container.getBoundingClientRect();
    
    nowPlayingVisualizerCanvas.width = rect.width;
    nowPlayingVisualizerCanvas.height = rect.height;
  }
  
  function startVisualization(isMusicPlayingCallback) {
    if (nowPlayingAnimationFrame) {
      cancelAnimationFrame(nowPlayingAnimationFrame);
    }
    
    function drawVisualizer(time) {
      if (!nowPlayingVisualizerCanvas || !nowPlayingVisualizerCtx) {
        return;
      }
      
      // Check if music is playing
      const isMusicPlaying = isMusicPlayingCallback ? isMusicPlayingCallback() : true;
      
      if (isMusicPlaying) {
        // Clear canvas
        nowPlayingVisualizerCtx.clearRect(0, 0, nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height);
        
        // Get available modes and current mode
        const availableModes = getAvailableVisualizationModes();
        if (availableModes.length === 0) {
          nowPlayingAnimationFrame = requestAnimationFrame(drawVisualizer);
          return;
        }
        
        const currentMode = availableModes[currentVisualizationMode % availableModes.length];
        
        // Handle mode transitions
        if (targetVisualizationMode !== currentVisualizationMode) {
          if (!isVisualizationFading) {
            isVisualizationFading = true;
            visualizationFadeAlpha = 1.0;
          }
          
          visualizationFadeAlpha -= 0.05;
          
          if (visualizationFadeAlpha <= 0) {
            currentVisualizationMode = targetVisualizationMode;
            isVisualizationFading = false;
            visualizationFadeAlpha = 1.0;
          }
        }
        
        // Draw current visualization mode
        nowPlayingVisualizerCtx.save();
        nowPlayingVisualizerCtx.globalAlpha = visualizationFadeAlpha;
        
        switch (currentMode) {
          case 'space':
            drawSpaceVisualization(time);
            break;
          case 'fire':
            drawFireVisualization(time);
            break;
          case 'particles':
            drawParticlesVisualization(time);
            break;
          case 'circles':
            drawCirclesVisualization(time);
            break;
        }
        
        nowPlayingVisualizerCtx.restore();
        
        // Apply fade effect during transitions
        if (isVisualizationFading && visualizationFadeAlpha < 1.0) {
          const fadeOpacity = 1.0 - visualizationFadeAlpha;
          nowPlayingVisualizerCtx.save();
          nowPlayingVisualizerCtx.fillStyle = `rgba(0, 0, 0, ${fadeOpacity})`;
          nowPlayingVisualizerCtx.fillRect(0, 0, nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height);
          nowPlayingVisualizerCtx.restore();
        }
      }
      
      nowPlayingAnimationFrame = requestAnimationFrame(drawVisualizer);
    }
    
    drawVisualizer();
  }
  
  /**
   * Space visualization with stars and nebula effects
   */
  function drawSpaceVisualization(time) {
    const currentAmplitude = window.currentAmplitude || 0;
    
    // Create space background gradient
    const gradient = nowPlayingVisualizerCtx.createRadialGradient(
      nowPlayingVisualizerCanvas.width / 2, nowPlayingVisualizerCanvas.height / 2, 0,
      nowPlayingVisualizerCanvas.width / 2, nowPlayingVisualizerCanvas.height / 2, 
      Math.max(nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height) * 0.8
    );
    
    // Get cover-based colors
    const starColors = generateCoverBasedStarColors();
    
    gradient.addColorStop(0, starColors[0] || 'rgba(30, 30, 60, 0.8)');
    gradient.addColorStop(0.3, starColors[1] || 'rgba(15, 15, 40, 0.9)');
    gradient.addColorStop(0.7, starColors[2] || 'rgba(10, 10, 30, 0.95)');
    gradient.addColorStop(1, 'rgba(5, 5, 20, 1)');
    
    nowPlayingVisualizerCtx.fillStyle = gradient;
    nowPlayingVisualizerCtx.fillRect(0, 0, nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height);
    
    // Update star pulse
    starPulseTime += 0.02 + currentAmplitude * 0.05;
    
    // Draw stars
    for (const star of stars) {
      const pulseIntensity = Math.sin(starPulseTime + star.pulseOffset) * 0.5 + 0.5;
      const amplitude = currentAmplitude * star.reactivity;
      const finalIntensity = Math.min(1, star.baseIntensity + amplitude + pulseIntensity * 0.3);
      
      const starColor = starColors[star.colorIndex % starColors.length] || star.color;
      
      nowPlayingVisualizerCtx.fillStyle = starColor.replace('1)', `${finalIntensity})`);
      nowPlayingVisualizerCtx.beginPath();
      nowPlayingVisualizerCtx.arc(star.x, star.y, star.size * (0.5 + finalIntensity * 0.5), 0, Math.PI * 2);
      nowPlayingVisualizerCtx.fill();
      
      // Add glow effect for bright stars
      if (finalIntensity > 0.7) {
        nowPlayingVisualizerCtx.shadowBlur = 10;
        nowPlayingVisualizerCtx.shadowColor = starColor;
        nowPlayingVisualizerCtx.fill();
        nowPlayingVisualizerCtx.shadowBlur = 0;
      }
    }
  }
  
  /**
   * Fire visualization with flames and ember effects
   */
  function drawFireVisualization(time) {
    const currentAmplitude = window.currentAmplitude || 0;
    
    // Create fire gradient background
    const gradient = nowPlayingVisualizerCtx.createLinearGradient(0, nowPlayingVisualizerCanvas.height, 0, 0);
    
    // Get cover colors for fire
    const fireColors = generateCoverBasedFireColors();
    
    gradient.addColorStop(0, fireColors[0] || 'rgba(255, 50, 0, 0.8)');
    gradient.addColorStop(0.3, fireColors[1] || 'rgba(255, 100, 0, 0.6)');
    gradient.addColorStop(0.6, fireColors[2] || 'rgba(255, 200, 0, 0.4)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.1)');
    
    nowPlayingVisualizerCtx.fillStyle = gradient;
    nowPlayingVisualizerCtx.fillRect(0, 0, nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height);
    
    // Draw flame effects
    const flameHeight = nowPlayingVisualizerCanvas.height * (0.3 + currentAmplitude * 0.4);
    const flameCount = 8 + Math.floor(currentAmplitude * 12);
    
    for (let i = 0; i < flameCount; i++) {
      const x = (i / flameCount) * nowPlayingVisualizerCanvas.width;
      const waveOffset = Math.sin(time * 0.005 + i * 0.5) * 20;
      const flameSize = 10 + currentAmplitude * 30;
      
      const flameGradient = nowPlayingVisualizerCtx.createRadialGradient(
        x + waveOffset, nowPlayingVisualizerCanvas.height, 0,
        x + waveOffset, nowPlayingVisualizerCanvas.height - flameHeight, flameSize
      );
      
      flameGradient.addColorStop(0, fireColors[3] || 'rgba(255, 255, 0, 0.8)');
      flameGradient.addColorStop(0.5, fireColors[4] || 'rgba(255, 100, 0, 0.6)');
      flameGradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
      
      nowPlayingVisualizerCtx.fillStyle = flameGradient;
      nowPlayingVisualizerCtx.beginPath();
      nowPlayingVisualizerCtx.arc(x + waveOffset, nowPlayingVisualizerCanvas.height - flameHeight/2, flameSize, 0, Math.PI * 2);
      nowPlayingVisualizerCtx.fill();
    }
  }
  
  /**
   * Enhanced particles visualization
   */
  function drawParticlesVisualization(time) {
    const currentAmplitude = window.currentAmplitude || 0;
    
    // Dark background with subtle gradient
    const gradient = nowPlayingVisualizerCtx.createRadialGradient(
      nowPlayingVisualizerCanvas.width / 2, nowPlayingVisualizerCanvas.height / 2, 0,
      nowPlayingVisualizerCanvas.width / 2, nowPlayingVisualizerCanvas.height / 2,
      Math.max(nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height) / 2
    );
    
    const particleColors = generateCoverBasedParticleColors();
    
    gradient.addColorStop(0, particleColors[0] || 'rgba(20, 20, 40, 0.3)');
    gradient.addColorStop(1, 'rgba(5, 5, 15, 0.8)');
    
    nowPlayingVisualizerCtx.fillStyle = gradient;
    nowPlayingVisualizerCtx.fillRect(0, 0, nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height);
    
    // Update and draw particles
    for (const particle of enhancedParticles) {
      // Update particle physics
      particle.x += particle.vx * (1 + currentAmplitude);
      particle.y += particle.vy * (1 + currentAmplitude);
      particle.life--;
      
      // Audio reactive size and opacity
      const audioReactivity = currentAmplitude * particle.reactivity;
      const currentSize = particle.size * (0.5 + audioReactivity * 2);
      const currentOpacity = (particle.life / particle.maxLife) * (0.3 + audioReactivity);
      
      // Wrap around screen edges
      if (particle.x < 0) particle.x = nowPlayingVisualizerCanvas.width;
      if (particle.x > nowPlayingVisualizerCanvas.width) particle.x = 0;
      if (particle.y < 0) particle.y = nowPlayingVisualizerCanvas.height;
      if (particle.y > nowPlayingVisualizerCanvas.height) particle.y = 0;
      
      // Reset particle if life expired
      if (particle.life <= 0) {
        resetParticle(particle);
      }
      
      // Draw particle with glow
      const color = particleColors[particle.colorIndex % particleColors.length] || particle.color;
      nowPlayingVisualizerCtx.fillStyle = color.replace('1)', `${currentOpacity})`);
      
      nowPlayingVisualizerCtx.shadowBlur = 8;
      nowPlayingVisualizerCtx.shadowColor = color;
      
      nowPlayingVisualizerCtx.beginPath();
      nowPlayingVisualizerCtx.arc(particle.x, particle.y, currentSize, 0, Math.PI * 2);
      nowPlayingVisualizerCtx.fill();
      
      nowPlayingVisualizerCtx.shadowBlur = 0;
    }
  }
  
  /**
   * Circles visualization with expanding rings
   */
  function drawCirclesVisualization(time) {
    const currentAmplitude = window.currentAmplitude || 0;
    
    // Update color cache periodically
    if (time - circlesColorCache.lastUpdate > 5000) {
      updateCirclesColorCache();
    }
    
    // Dark gradient background
    const backgroundGradient = nowPlayingVisualizerCtx.createRadialGradient(
      nowPlayingVisualizerCanvas.width / 2, nowPlayingVisualizerCanvas.height / 2, 0,
      nowPlayingVisualizerCanvas.width / 2, nowPlayingVisualizerCanvas.height / 2,
      Math.max(nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height) / 2
    );
    
    backgroundGradient.addColorStop(0, `hsla(${circlesColorCache.baseHue}, ${circlesColorCache.baseSat}%, ${circlesColorCache.baseLight}%, 0.1)`);
    backgroundGradient.addColorStop(1, 'rgba(0, 0, 0, 0.9)');
    
    nowPlayingVisualizerCtx.fillStyle = backgroundGradient;
    nowPlayingVisualizerCtx.fillRect(0, 0, nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height);
    
    // Draw expanding circles based on audio
    const centerX = nowPlayingVisualizerCanvas.width / 2;
    const centerY = nowPlayingVisualizerCanvas.height / 2;
    const maxRadius = Math.min(nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height) / 2;
    
    // Multiple circles with different frequencies
    for (let i = 0; i < 5; i++) {
      const frequency = 0.002 + i * 0.001;
      const phase = i * Math.PI * 0.4;
      const radiusMultiplier = 0.2 + i * 0.15;
      
      const radius = maxRadius * radiusMultiplier * (0.3 + currentAmplitude + Math.sin(time * frequency + phase) * 0.2);
      const opacity = (0.1 + currentAmplitude * 0.3) * (1 - i * 0.15);
      
      const hue = (circlesColorCache.baseHue + i * 30) % 360;
      const saturation = Math.max(30, circlesColorCache.baseSat - i * 10);
      const lightness = Math.min(80, circlesColorCache.baseLight + i * 5);
      
      nowPlayingVisualizerCtx.strokeStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${opacity})`;
      nowPlayingVisualizerCtx.lineWidth = 2 + currentAmplitude * 3;
      
      nowPlayingVisualizerCtx.beginPath();
      nowPlayingVisualizerCtx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      nowPlayingVisualizerCtx.stroke();
    }
  }
  
  /**
   * Initialize visualization modes and particles
   */
  function initVisualizationModes() {
    // Initialize stars for space mode
    stars = [];
    for (let i = 0; i < MAX_STARS; i++) {
      stars.push({
        x: Math.random() * (nowPlayingVisualizerCanvas?.width || 800),
        y: Math.random() * (nowPlayingVisualizerCanvas?.height || 600),
        size: Math.random() * 3 + 1,
        baseIntensity: Math.random() * 0.5 + 0.3,
        reactivity: Math.random() * 0.8 + 0.2,
        pulseOffset: Math.random() * Math.PI * 2,
        colorIndex: Math.floor(Math.random() * 8),
        color: `rgba(255, 255, 255, 1)`
      });
    }
    
    // Initialize enhanced particles
    enhancedParticles = [];
    for (let i = 0; i < MAX_ENHANCED_PARTICLES; i++) {
      enhancedParticles.push(createEnhancedParticle());
    }
  }
  
  function createEnhancedParticle() {
    return {
      x: Math.random() * (nowPlayingVisualizerCanvas?.width || 800),
      y: Math.random() * (nowPlayingVisualizerCanvas?.height || 600),
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      size: Math.random() * 4 + 1,
      life: Math.random() * 300 + 100,
      maxLife: 300,
      reactivity: Math.random() * 0.8 + 0.2,
      colorIndex: Math.floor(Math.random() * 6),
      color: 'rgba(100, 200, 255, 1)'
    };
  }
  
  function resetParticle(particle) {
    particle.x = Math.random() * nowPlayingVisualizerCanvas.width;
    particle.y = Math.random() * nowPlayingVisualizerCanvas.height;
    particle.life = particle.maxLife;
    particle.vx = (Math.random() - 0.5) * 2;
    particle.vy = (Math.random() - 0.5) * 2;
  }
  
  function updateCirclesColorCache() {
    const nowPlayingRgb = getComputedStyle(document.documentElement).getPropertyValue('--now-playing-rgb').trim();
    
    if (nowPlayingRgb) {
      const [r, g, b] = nowPlayingRgb.split(',').map(v => parseInt(v.trim()));
      const { h, s, l } = rgbToHsl(r, g, b);
      
      circlesColorCache.baseHue = h;
      circlesColorCache.baseSat = Math.max(40, s);
      circlesColorCache.baseLight = Math.min(60, Math.max(30, l));
    } else {
      circlesColorCache.baseHue = 220;
      circlesColorCache.baseSat = 70;
      circlesColorCache.baseLight = 50;
    }
    
    circlesColorCache.lastUpdate = Date.now();
  }
  
  /**
   * Get available visualization modes based on settings
   */
  function getAvailableVisualizationModes() {
    const availableModes = [];
    
    if (visualizationSettings.enableSpace) availableModes.push('space');
    if (visualizationSettings.enableFire) availableModes.push('fire');
    if (visualizationSettings.enableParticles) availableModes.push('particles');
    if (visualizationSettings.enableCircles) availableModes.push('circles');
    
    if (availableModes.length === 0) {
      return ['space', 'fire', 'particles', 'circles'];
    }
    
    return availableModes;
  }
  
  /**
   * Get current visualization mode name
   */
  function getCurrentVisualizationModeName() {
    const availableModes = getAvailableVisualizationModes();
    const modeIndex = currentVisualizationMode % availableModes.length;
    return availableModes[modeIndex];
  }
  
  /**
   * Start automatic visualization mode rotation
   */
  function startVisualizationModeRotation() {
    if (visualizationModeChangeInterval) {
      clearInterval(visualizationModeChangeInterval);
    }
    
    visualizationModeChangeInterval = setInterval(() => {
      const availableModes = getAvailableVisualizationModes();
      if (availableModes.length > 1) {
        targetVisualizationMode = (currentVisualizationMode + 1) % availableModes.length;
        debugLog('VISUALIZER', `🎨 Switching to visualization mode: ${availableModes[targetVisualizationMode]}`);
      }
    }, (visualizationSettings.switchInterval || 30) * 1000);
  }

  /**
   * Stop visualizer
   */
  function stopVisualizer() {
    if (nowPlayingAnimationFrame) {
      cancelAnimationFrame(nowPlayingAnimationFrame);
      nowPlayingAnimationFrame = null;
    }
    
    if (visualizationModeChangeInterval) {
      clearInterval(visualizationModeChangeInterval);
      visualizationModeChangeInterval = null;
    }
  }

  /**
   * Update visualization settings
   */
  function updateSettings(newSettings) {
    visualizationSettings = { ...visualizationSettings, ...newSettings };
    
    // Restart mode rotation with new interval
    if (visualizationModeChangeInterval) {
      startVisualizationModeRotation();
    }
  }

  /**
   * Generate star colors based on cover art
   */
  function generateCoverBasedStarColors() {
    const nowPlayingRgb = getComputedStyle(document.documentElement).getPropertyValue('--now-playing-rgb').trim();
    
    if (nowPlayingRgb) {
      const [r, g, b] = nowPlayingRgb.split(',').map(v => parseInt(v.trim()));
      
      return [
        `rgb(${Math.min(255, r + 80)}, ${Math.min(255, g + 80)}, ${Math.min(255, b + 80)})`,
        `rgb(${Math.max(0, r - 30)}, ${Math.max(0, g - 30)}, ${Math.max(0, b - 30)})`,
        `rgb(${r}, ${Math.min(255, g + 50)}, ${Math.min(255, b + 50)})`,
        `rgb(${Math.min(255, r + 50)}, ${g}, ${Math.min(255, b + 50)})`,
        `rgb(${Math.min(255, r + 50)}, ${Math.min(255, g + 50)}, ${b})`,
        `rgb(${Math.min(255, Math.floor(r * 1.5))}, ${Math.min(255, Math.floor(g * 1.3))}, ${Math.min(255, Math.floor(b * 1.2))})`,
        '#ffffff',
        `rgba(${r}, ${g}, ${b}, 0.8)`
      ];
    }
    
    return [
      'rgba(255, 255, 255, 1)',
      'rgba(200, 200, 255, 1)',
      'rgba(255, 200, 200, 1)',
      'rgba(200, 255, 200, 1)',
      'rgba(255, 255, 200, 1)',
      'rgba(255, 200, 255, 1)',
      'rgba(200, 255, 255, 1)',
      'rgba(150, 150, 255, 1)'
    ];
  }
  
  function generateCoverBasedFireColors() {
    const nowPlayingRgb = getComputedStyle(document.documentElement).getPropertyValue('--now-playing-rgb').trim();
    
    if (nowPlayingRgb) {
      const [r, g, b] = nowPlayingRgb.split(',').map(v => parseInt(v.trim()));
      
      return [
        `rgba(${Math.min(255, r + 100)}, ${Math.max(0, g - 50)}, 0, 0.8)`,
        `rgba(${Math.min(255, r + 80)}, ${Math.min(255, g + 20)}, 0, 0.6)`,
        `rgba(${Math.min(255, r + 60)}, ${Math.min(255, g + 60)}, 0, 0.4)`,
        `rgba(${Math.min(255, r + 40)}, ${Math.min(255, g + 40)}, ${Math.max(0, b - 20)}, 0.8)`,
        `rgba(${Math.min(255, r + 20)}, ${Math.min(255, g + 100)}, 0, 0.6)`
      ];
    }
    
    return [
      'rgba(255, 50, 0, 0.8)',
      'rgba(255, 100, 0, 0.6)',
      'rgba(255, 200, 0, 0.4)',
      'rgba(255, 255, 0, 0.8)',
      'rgba(255, 100, 0, 0.6)'
    ];
  }
  
  function generateCoverBasedParticleColors() {
    const nowPlayingRgb = getComputedStyle(document.documentElement).getPropertyValue('--now-playing-rgb').trim();
    
    if (nowPlayingRgb) {
      const [r, g, b] = nowPlayingRgb.split(',').map(v => parseInt(v.trim()));
      
      return [
        `rgba(${r}, ${g}, ${b}, 1)`,
        `rgba(${Math.min(255, r + 50)}, ${g}, ${Math.min(255, b + 50)}, 1)`,
        `rgba(${Math.max(0, r - 20)}, ${Math.min(255, g + 50)}, ${Math.min(255, b + 20)}, 1)`,
        `rgba(${Math.min(255, r + 30)}, ${Math.min(255, g + 30)}, ${Math.max(0, b - 30)}, 1)`,
        `rgba(${Math.min(255, r + 70)}, ${Math.min(255, g + 70)}, ${Math.min(255, b + 70)}, 1)`,
        `rgba(${Math.floor(r * 0.8)}, ${Math.floor(g * 0.8)}, ${Math.min(255, b + 80)}, 1)`
      ];
    }
    
    return [
      'rgba(100, 200, 255, 1)',
      'rgba(150, 150, 255, 1)',
      'rgba(80, 255, 200, 1)',
      'rgba(130, 255, 130, 1)',
      'rgba(255, 150, 200, 1)',
      'rgba(50, 150, 255, 1)'
    ];
  }
  
  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    
    if (max === min) {
      h = s = 0; // achromatic
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    
    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100)
    };
  }

  // Helper function for debug logging
  function debugLog(category, ...args) {
    if (typeof window.debugLog === 'function') {
      window.debugLog(category, ...args);
    } else {
      console.log(`[${category}]`, ...args);
    }
  }
  
  // Export to window object
  window.VisualizerModule = {
    init: initVisualizer,
    stop: stopVisualizer,
    updateSettings: updateSettings,
    initModes: initVisualizationModes,
    getAvailableModes: getAvailableVisualizationModes,
    getCurrentModeName: getCurrentVisualizationModeName
  };

})();