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

  // Lightning visualization variables
  let lightningBolts = [];
  let lightningFlashes = [];
  let nextLightningTime = 0;
  let backgroundFlashIntensity = 0;
  let energyPulses = [];
  const MAX_LIGHTNING_BOLTS = 6;
  const MAX_ENERGY_PULSES = 20;
  
  // Default visualization settings
  let visualizationSettings = {
    enableSpace: true,
    enableFire: true,
    enableParticles: true,
    enableCircles: true,
    enableLightning: true,
    switchInterval: 30 // seconds
  };
  
  /**
   * Initialize the now-playing visualizer
   * @param {Object} options - Configuration options
   * @param {Function} options.isMusicPlayingCallback - Function to check if music is playing
   * @param {Object} options.settings - Visualization settings
   */
  function initVisualizer(options = {}) {
    nowPlayingVisualizerCanvas = document.getElementById('nowPlayingVisualizerCanvas');
    if (!nowPlayingVisualizerCanvas) {
      console.warn('[VISUALIZER] Canvas element not found');
      return;
    }
    
    nowPlayingVisualizerCtx = nowPlayingVisualizerCanvas.getContext('2d');
    
    // Apply settings if provided
    if (options.settings) {
      visualizationSettings = { ...visualizationSettings, ...options.settings };
    }
    
    // Resize canvas to match container
    function resizeCanvas() {
      const rect = nowPlayingVisualizerCanvas.getBoundingClientRect();
      nowPlayingVisualizerCanvas.width = rect.width;
      nowPlayingVisualizerCanvas.height = rect.height;
      
      // Reinitialize visualization modes when canvas is resized
      initVisualizationModes();
    }
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Listen for visualization settings changes from admin panel
    document.addEventListener('visualizationSettingsChanged', (event) => {
      if (event.detail && event.detail.settings) {
        updateSettings(event.detail.settings);
        debugLog('VISUALIZER', '⚙️ Settings updated from admin panel:', event.detail.settings);
        
        // Restart mode rotation with new settings
        if (visualizationModeChangeInterval) {
          stopVisualizer();
          startVisualizationModeRotation();
          startVisualizerAnimation(options.isMusicPlayingCallback);
        }
      }
    });
    
    // Initialize visualization modes
    initVisualizationModes();
    
    // Start visualization mode rotation
    startVisualizationModeRotation();
    
    // Start animation
    startVisualizerAnimation(options.isMusicPlayingCallback);
    
    debugLog('VISUALIZER', '✅ Now-Playing Visualizer initialized');
  }
  
  /**
   * Start the visualizer animation loop
   */
  function startVisualizerAnimation(isMusicPlayingCallback) {
    if (!nowPlayingVisualizerCtx || !nowPlayingVisualizerCanvas) return;
    
    function checkIfMusicIsPlaying() {
      // Use callback if provided
      if (isMusicPlayingCallback && typeof isMusicPlayingCallback === 'function') {
        return isMusicPlayingCallback();
      }
      
      // Fallback: Check global audio player
      if (window.audioPlayer && !window.audioPlayer.paused && window.audioPlayer.currentTime > 0) {
        return true;
      }
      
      // Check queue
      if (window.currentTrackIndex >= 0 && window.queue && window.queue.length > 0) {
        return true;
      }
      
      return false;
    }
    
    function drawVisualizer() {
      const isMusicPlaying = checkIfMusicIsPlaying();
      nowPlayingVisualizerCtx.clearRect(0, 0, nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height);
      
      if (isMusicPlaying) {
        const time = Date.now() * 0.001;
        
        // Get available visualization modes
        const availableModes = getAvailableVisualizationModes();
        
        // If no modes enabled, show cover-colored background
        if (availableModes.length === 0) {
          drawStaticCoverBackground();
          nowPlayingAnimationFrame = requestAnimationFrame(drawVisualizer);
          return;
        }
        
        // Get current visualization mode name
        const currentModeName = getCurrentVisualizationModeName();
        
        // Switch between visualization modes
        switch (currentModeName) {
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
            try {
              drawCirclesVisualization(time);
            } catch (error) {
              console.error('[VISUALIZER] Error in circles visualization:', error);
              currentVisualizationMode = 0;
            }
            break;
          case 'lightning':
            drawLightningVisualization(time);
            break;
        }
        
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
   * Draw static cover-colored background
   */
  function drawStaticCoverBackground() {
    const centerX = nowPlayingVisualizerCanvas.width / 2;
    const centerY = nowPlayingVisualizerCanvas.height / 2;
    
    const nowPlayingRgb = getComputedStyle(document.documentElement).getPropertyValue('--now-playing-rgb').trim();
    
    if (nowPlayingRgb) {
      const [r, g, b] = nowPlayingRgb.split(',').map(v => parseInt(v.trim()));
      
      const gradient = nowPlayingVisualizerCtx.createRadialGradient(
        centerX, centerY, 0,
        centerX, centerY, 
        Math.max(nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height) * 0.7
      );
      
      gradient.addColorStop(0, `rgba(${Math.floor(r*0.3)}, ${Math.floor(g*0.3)}, ${Math.floor(b*0.3)}, 0.8)`);
      gradient.addColorStop(0.4, `rgba(${Math.floor(r*0.2)}, ${Math.floor(g*0.2)}, ${Math.floor(b*0.2)}, 0.6)`);
      gradient.addColorStop(0.7, `rgba(${Math.floor(r*0.1)}, ${Math.floor(g*0.1)}, ${Math.floor(b*0.1)}, 0.4)`);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0.9)');
      
      nowPlayingVisualizerCtx.fillStyle = gradient;
    } else {
      const gradient = nowPlayingVisualizerCtx.createRadialGradient(
        centerX, centerY, 0,
        centerX, centerY, 
        Math.max(nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height) * 0.7
      );
      
      gradient.addColorStop(0, 'rgba(40, 40, 60, 0.8)');
      gradient.addColorStop(0.4, 'rgba(25, 25, 40, 0.6)');
      gradient.addColorStop(0.7, 'rgba(15, 15, 25, 0.4)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0.9)');
      
      nowPlayingVisualizerCtx.fillStyle = gradient;
    }
    
    nowPlayingVisualizerCtx.fillRect(0, 0, nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height);
  }
  
  /**
   * Draw space visualization with stars
   */
  function drawSpaceVisualization(time) {
    const currentAmplitude = window.currentAmplitude || 0;
    const centerX = nowPlayingVisualizerCanvas.width / 2;
    const centerY = nowPlayingVisualizerCanvas.height / 2;
    
    // Draw animated background
    const nowPlayingRgb = getComputedStyle(document.documentElement).getPropertyValue('--now-playing-rgb').trim();
    
    if (nowPlayingRgb) {
      const [r, g, b] = nowPlayingRgb.split(',').map(v => parseInt(v.trim()));
      
      const gradient = nowPlayingVisualizerCtx.createRadialGradient(
        centerX + Math.sin(time * 0.3) * 50, 
        centerY + Math.cos(time * 0.2) * 30, 
        0,
        centerX, centerY, 
        Math.max(nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height) * 0.8
      );
      
      gradient.addColorStop(0, `rgba(${Math.floor(r*0.3)}, ${Math.floor(g*0.3)}, ${Math.floor(b*0.3)}, 1)`);
      gradient.addColorStop(0.3, `rgba(${Math.floor(r*0.15)}, ${Math.floor(g*0.15)}, ${Math.floor(b*0.15)}, 1)`);
      gradient.addColorStop(0.7, `rgba(${Math.floor(r*0.08)}, ${Math.floor(g*0.08)}, ${Math.floor(b*0.08)}, 1)`);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
      
      nowPlayingVisualizerCtx.fillStyle = gradient;
    } else {
      const gradient = nowPlayingVisualizerCtx.createRadialGradient(
        centerX + Math.sin(time * 0.3) * 50, 
        centerY + Math.cos(time * 0.2) * 30, 
        0,
        centerX, centerY, 
        Math.max(nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height) * 0.8
      );
      
      gradient.addColorStop(0, `hsl(${time * 20 % 360}, 30%, 5%)`);
      gradient.addColorStop(0.5, `hsl(${(time * 15 + 120) % 360}, 20%, 3%)`);
      gradient.addColorStop(1, 'black');
      
      nowPlayingVisualizerCtx.fillStyle = gradient;
    }
    
    nowPlayingVisualizerCtx.fillRect(0, 0, nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height);
    
    // Update and draw stars
    starPulseTime += 0.02;
    
    if (stars.length === 0) {
      initVisualizationModes();
    }
    
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      
      const audioBoost = currentAmplitude * 2;
      star.z -= (star.speed + audioBoost) * 3;
      
      if (star.z <= 0) {
        const coverColors = generateCoverBasedStarColors();
        star.x = Math.random() * nowPlayingVisualizerCanvas.width;
        star.y = Math.random() * nowPlayingVisualizerCanvas.height;
        star.z = 1000;
        star.speed = Math.random() * 2 + 0.5;
        star.brightness = Math.random() * 0.8 + 0.2;
        star.color = coverColors[Math.floor(Math.random() * coverColors.length)];
        star.twinklePhase = Math.random() * Math.PI * 2;
        star.type = Math.random() < 0.85 ? 'normal' : 'supernova';
      }
      
      star.twinklePhase += star.twinkleSpeed;
      
      const x = ((star.x - centerX) * (500 / star.z)) + centerX;
      const y = ((star.y - centerY) * (500 / star.z)) + centerY;
      
      const baseSize = Math.max(0.3, (1000 - star.z) / 400);
      const twinkle = (Math.sin(star.twinklePhase) + 1) * 0.3;
      const audioReactive = currentAmplitude * 0.5;
      const size = baseSize * (1 + twinkle + audioReactive);
      
      const baseBrightness = star.brightness * Math.min(1, (1000 - star.z) / 800);
      const alpha = baseBrightness * (0.7 + twinkle + audioReactive);
      
      if (x >= 0 && x <= nowPlayingVisualizerCanvas.width && 
          y >= 0 && y <= nowPlayingVisualizerCanvas.height) {
        nowPlayingVisualizerCtx.save();
        nowPlayingVisualizerCtx.globalAlpha = Math.min(1, alpha);
        
        if (star.type === 'supernova') {
          const supernovaSize = size * (2 + Math.sin(starPulseTime + i) * 0.5);
          const gradient = nowPlayingVisualizerCtx.createRadialGradient(x, y, 0, x, y, supernovaSize * 3);
          gradient.addColorStop(0, star.color);
          gradient.addColorStop(0.3, star.color + '88');
          gradient.addColorStop(1, star.color + '00');
          
          nowPlayingVisualizerCtx.fillStyle = gradient;
          nowPlayingVisualizerCtx.beginPath();
          nowPlayingVisualizerCtx.arc(x, y, supernovaSize * 3, 0, Math.PI * 2);
          nowPlayingVisualizerCtx.fill();
          
          nowPlayingVisualizerCtx.fillStyle = '#ffffff';
          nowPlayingVisualizerCtx.beginPath();
          nowPlayingVisualizerCtx.arc(x, y, supernovaSize, 0, Math.PI * 2);
          nowPlayingVisualizerCtx.fill();
        } else {
          nowPlayingVisualizerCtx.fillStyle = star.color;
          nowPlayingVisualizerCtx.shadowColor = star.color;
          nowPlayingVisualizerCtx.shadowBlur = size * 4;
          
          nowPlayingVisualizerCtx.beginPath();
          nowPlayingVisualizerCtx.arc(x, y, size, 0, Math.PI * 2);
          nowPlayingVisualizerCtx.fill();
          
          if (size > 2) {
            nowPlayingVisualizerCtx.shadowBlur = 0;
            drawStar(nowPlayingVisualizerCtx, x, y, 5, size * 1.5, size * 0.7, star.color);
          }
        }
        
        if (star.z < 300) {
          nowPlayingVisualizerCtx.globalAlpha = alpha * 0.4;
          nowPlayingVisualizerCtx.shadowBlur = 0;
          const trailX = x + (centerX - x) * 0.15;
          const trailY = y + (centerY - y) * 0.15;
          
          const gradient = nowPlayingVisualizerCtx.createLinearGradient(x, y, trailX, trailY);
          gradient.addColorStop(0, star.color + 'AA');
          gradient.addColorStop(1, star.color + '00');
          
          nowPlayingVisualizerCtx.strokeStyle = gradient;
          nowPlayingVisualizerCtx.lineWidth = size;
          nowPlayingVisualizerCtx.beginPath();
          nowPlayingVisualizerCtx.moveTo(x, y);
          nowPlayingVisualizerCtx.lineTo(trailX, trailY);
          nowPlayingVisualizerCtx.stroke();
        }
        
        nowPlayingVisualizerCtx.restore();
      }
    }
    
    // Add nebula overlay
    nowPlayingVisualizerCtx.save();
    nowPlayingVisualizerCtx.globalAlpha = 0.08;
    const nebulaGradient = nowPlayingVisualizerCtx.createRadialGradient(
      centerX + Math.sin(time * 0.1) * 100, 
      centerY + Math.cos(time * 0.15) * 80, 
      0,
      centerX, centerY, 
      Math.max(nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height) / 2
    );
    
    if (nowPlayingRgb) {
      const [r, g, b] = nowPlayingRgb.split(',').map(v => parseInt(v.trim()));
      nebulaGradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.4)`);
      nebulaGradient.addColorStop(0.5, `rgba(${Math.floor(r*0.8)}, ${Math.floor(g*0.8)}, ${Math.floor(b*0.8)}, 0.2)`);
      nebulaGradient.addColorStop(1, 'transparent');
    } else {
      nebulaGradient.addColorStop(0, `hsl(${time * 10 % 360}, 50%, 30%)`);
      nebulaGradient.addColorStop(0.5, `hsl(${(time * 15 + 120) % 360}, 40%, 20%)`);
      nebulaGradient.addColorStop(1, 'transparent');
    }
    
    nowPlayingVisualizerCtx.fillStyle = nebulaGradient;
    nowPlayingVisualizerCtx.fillRect(0, 0, nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height);
    nowPlayingVisualizerCtx.restore();
  }
  
  /**
   * Draw fire visualization
   */
  function drawFireVisualization(time) {
    const canvasWidth = nowPlayingVisualizerCanvas.width;
    const canvasHeight = nowPlayingVisualizerCanvas.height;
    
    nowPlayingVisualizerCtx.fillStyle = '#000';
    nowPlayingVisualizerCtx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    
    const baseSize = Math.min(canvasWidth, canvasHeight) * 1.6;
    const s = baseSize / 10;
    const borderWidth = baseSize / 50;
    const boxShadowSize = baseSize / 6;
    
    const animationProgress = (time * 0.2) % 1;
    const hueRotation = animationProgress * 360;
    const baseHue = 120;
    const currentHue = (baseHue + hueRotation) % 360;
    
    let shadowIntensity;
    if (animationProgress < 0.2) {
      shadowIntensity = boxShadowSize + (60 - boxShadowSize) * (animationProgress / 0.2);
    } else if (animationProgress < 0.4) {
      shadowIntensity = 60 - 20 * ((animationProgress - 0.2) / 0.2);
    } else if (animationProgress < 0.6) {
      shadowIntensity = 40 + 40 * ((animationProgress - 0.4) / 0.2);
    } else if (animationProgress < 0.8) {
      shadowIntensity = 80 + 20 * ((animationProgress - 0.6) / 0.2);
    } else {
      shadowIntensity = 100 - (100 - boxShadowSize) * ((animationProgress - 0.8) / 0.2);
    }
    
    const turbulenceFreq = 0.02 + 0.015 * Math.sin(time * 0.1);
    const turbulenceScale = 30;
    
    nowPlayingVisualizerCtx.save();
    
    const outerRadius = (baseSize - 2 * s) / 2;
    const wideGlowRadius = outerRadius + shadowIntensity * 2;
    const wideGradient = nowPlayingVisualizerCtx.createRadialGradient(
      centerX, centerY, outerRadius * 0.5,
      centerX, centerY, wideGlowRadius
    );
    wideGradient.addColorStop(0, `hsla(${currentHue}, 100%, 50%, 0.08)`);
    wideGradient.addColorStop(0.3, `hsla(${currentHue}, 100%, 50%, 0.04)`);
    wideGradient.addColorStop(0.7, `hsla(${currentHue}, 100%, 50%, 0.015)`);
    wideGradient.addColorStop(1, 'transparent');
    
    nowPlayingVisualizerCtx.fillStyle = wideGradient;
    nowPlayingVisualizerCtx.beginPath();
    nowPlayingVisualizerCtx.arc(centerX, centerY, wideGlowRadius, 0, Math.PI * 2);
    nowPlayingVisualizerCtx.fill();
    
    nowPlayingVisualizerCtx.beginPath();
    for (let angle = 0; angle <= Math.PI * 2; angle += 0.05) {
      const turbulence = Math.sin(angle * 5 + time * 3) * 
                        Math.sin(angle * 3 + time * 2) * 
                        turbulenceScale;
      const distortedRadius = outerRadius + turbulence;
      
      const x = centerX + Math.cos(angle) * distortedRadius;
      const y = centerY + Math.sin(angle) * distortedRadius;
      
      if (angle === 0) {
        nowPlayingVisualizerCtx.moveTo(x, y);
      } else {
        nowPlayingVisualizerCtx.lineTo(x, y);
      }
    }
    nowPlayingVisualizerCtx.closePath();
    
    const mainGradient = nowPlayingVisualizerCtx.createRadialGradient(
      centerX, centerY, outerRadius - borderWidth,
      centerX, centerY, outerRadius
    );
    mainGradient.addColorStop(0, 'transparent');
    mainGradient.addColorStop(1, `hsla(${currentHue}, 100%, 50%, 0.15)`);
    
    nowPlayingVisualizerCtx.fillStyle = mainGradient;
    nowPlayingVisualizerCtx.fill();
    
    nowPlayingVisualizerCtx.strokeStyle = `hsla(${currentHue}, 100%, 50%, 0.1)`;
    nowPlayingVisualizerCtx.lineWidth = borderWidth;
    nowPlayingVisualizerCtx.stroke();
    
    const innerGlowGradient = nowPlayingVisualizerCtx.createRadialGradient(
      centerX, centerY, 0,
      centerX, centerY, outerRadius - borderWidth
    );
    innerGlowGradient.addColorStop(0, `hsla(${currentHue}, 100%, 50%, 0.05)`);
    innerGlowGradient.addColorStop(0.7, `hsla(${currentHue}, 100%, 50%, 0.015)`);
    innerGlowGradient.addColorStop(1, 'transparent');
    
    nowPlayingVisualizerCtx.fillStyle = innerGlowGradient;
    nowPlayingVisualizerCtx.fill();
    
    const innerRadius = outerRadius - borderWidth * 2;
    nowPlayingVisualizerCtx.beginPath();
    
    for (let angle = 0; angle <= Math.PI * 2; angle += 0.1) {
      const turbulence = Math.sin(angle * 7 + time * 4) * 
                        Math.sin(angle * 4 + time * 2.5) * 
                        (turbulenceScale * 0.3);
      const distortedRadius = innerRadius + turbulence;
      
      const x = centerX + Math.cos(angle) * distortedRadius;
      const y = centerY + Math.sin(angle) * distortedRadius;
      
      if (angle === 0) {
        nowPlayingVisualizerCtx.moveTo(x, y);
      } else {
        nowPlayingVisualizerCtx.lineTo(x, y);
      }
    }
    nowPlayingVisualizerCtx.closePath();
    
    nowPlayingVisualizerCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    nowPlayingVisualizerCtx.lineWidth = borderWidth * 0.5;
    nowPlayingVisualizerCtx.stroke();
    
    nowPlayingVisualizerCtx.restore();
  }
  
  /**
   * Draw particles visualization
   */
  function drawParticlesVisualization(time) {
    const currentAmplitude = window.currentAmplitude || 0;
    
    // Update particles
    for (let i = 0; i < enhancedParticles.length; i++) {
      const particle = enhancedParticles[i];
      
      const audioInfluence = currentAmplitude * 3;
      particle.energy += audioInfluence * 0.1;
      
      particle.x += particle.vx * (1 + audioInfluence);
      particle.y += particle.vy * (1 + audioInfluence);
      
      const basePulse = Math.sin(time * 0.003 + i * 0.1) * 0.5 + 1;
      const audioPulse = audioInfluence * 0.8;
      
      if (particle.x <= 0 || particle.x >= nowPlayingVisualizerCanvas.width) {
        particle.vx *= -0.8;
        particle.x = Math.max(0, Math.min(nowPlayingVisualizerCanvas.width, particle.x));
        particle.energy += 0.2;
      }
      if (particle.y <= 0 || particle.y >= nowPlayingVisualizerCanvas.height) {
        particle.vy *= -0.8;
        particle.y = Math.max(0, Math.min(nowPlayingVisualizerCanvas.height, particle.y));
        particle.energy += 0.2;
      }
      
      particle.life += 0.01;
      if (particle.life > particle.maxLife) {
        particle.x = Math.random() * nowPlayingVisualizerCanvas.width;
        particle.y = Math.random() * nowPlayingVisualizerCanvas.height;
        particle.vx = (Math.random() - 0.5) * 3;
        particle.vy = (Math.random() - 0.5) * 3;
        particle.life = 0;
        particle.hue = Math.random() * 360;
        particle.type = Math.random() < 0.7 ? 'normal' : Math.random() < 0.85 ? 'glowing' : 'explosive';
        particle.energy = Math.random();
      }
      
      particle.energy *= 0.95;
      particle.vx *= 0.99;
      particle.vy *= 0.99;
      
      const alpha = (1 - particle.life / particle.maxLife) * 0.8;
      const size = particle.size * (basePulse + audioPulse) * (1 + particle.energy);
      
      nowPlayingVisualizerCtx.save();
      nowPlayingVisualizerCtx.globalAlpha = alpha;
      
      if (particle.type === 'explosive' && particle.energy > 0.5) {
        const burstSize = size * (1 + particle.energy * 2);
        const gradient = nowPlayingVisualizerCtx.createRadialGradient(
          particle.x, particle.y, 0,
          particle.x, particle.y, burstSize * 2
        );
        gradient.addColorStop(0, `hsla(${particle.hue + time * 0.1}, 100%, 70%, ${alpha})`);
        gradient.addColorStop(0.5, `hsla(${particle.hue + time * 0.1}, 80%, 50%, ${alpha * 0.6})`);
        gradient.addColorStop(1, `hsla(${particle.hue + time * 0.1}, 60%, 30%, 0)`);
        
        nowPlayingVisualizerCtx.fillStyle = gradient;
        nowPlayingVisualizerCtx.beginPath();
        nowPlayingVisualizerCtx.arc(particle.x, particle.y, burstSize * 2, 0, Math.PI * 2);
        nowPlayingVisualizerCtx.fill();
        
        nowPlayingVisualizerCtx.fillStyle = `hsla(${particle.hue}, 100%, 90%, ${alpha})`;
        nowPlayingVisualizerCtx.beginPath();
        nowPlayingVisualizerCtx.arc(particle.x, particle.y, burstSize * 0.5, 0, Math.PI * 2);
        nowPlayingVisualizerCtx.fill();
        
      } else if (particle.type === 'glowing') {
        nowPlayingVisualizerCtx.shadowColor = `hsl(${particle.hue + time * 0.05}, 100%, 60%)`;
        nowPlayingVisualizerCtx.shadowBlur = size * 3;
        
        nowPlayingVisualizerCtx.fillStyle = `hsla(${particle.hue + time * 0.05}, 80%, 70%, ${alpha})`;
        nowPlayingVisualizerCtx.beginPath();
        nowPlayingVisualizerCtx.arc(particle.x, particle.y, size, 0, Math.PI * 2);
        nowPlayingVisualizerCtx.fill();
        
      } else {
        nowPlayingVisualizerCtx.fillStyle = `hsla(${particle.hue + time * 0.02}, 70%, 60%, ${alpha})`;
        nowPlayingVisualizerCtx.beginPath();
        nowPlayingVisualizerCtx.arc(particle.x, particle.y, size, 0, Math.PI * 2);
        nowPlayingVisualizerCtx.fill();
      }
      
      nowPlayingVisualizerCtx.restore();
    }
    
    // Connection lines
    nowPlayingVisualizerCtx.save();
    const maxConnectionDistance = 100 + currentAmplitude * 50;
    
    for (let i = 0; i < enhancedParticles.length; i++) {
      for (let j = i + 1; j < enhancedParticles.length; j++) {
        const p1 = enhancedParticles[i];
        const p2 = enhancedParticles[j];
        
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < maxConnectionDistance) {
          const alpha = (1 - distance / maxConnectionDistance) * 0.3 * (currentAmplitude + 0.2);
          const avgHue = (p1.hue + p2.hue) / 2;
          
          nowPlayingVisualizerCtx.globalAlpha = alpha;
          nowPlayingVisualizerCtx.strokeStyle = `hsl(${avgHue + time * 0.02}, 70%, 60%)`;
          nowPlayingVisualizerCtx.lineWidth = 1 + currentAmplitude * 2;
          
          nowPlayingVisualizerCtx.beginPath();
          nowPlayingVisualizerCtx.moveTo(p1.x, p1.y);
          nowPlayingVisualizerCtx.lineTo(p2.x, p2.y);
          nowPlayingVisualizerCtx.stroke();
        }
      }
    }
    
    nowPlayingVisualizerCtx.restore();
  }
  
  /**
   * Draw circles visualization
   */
  function drawCirclesVisualization(time) {
    nowPlayingVisualizerCtx.clearRect(0, 0, nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height);
    
    const centerX = nowPlayingVisualizerCanvas.width / 2;
    const centerY = nowPlayingVisualizerCanvas.height / 2;
    
    if (time - circlesColorCache.lastUpdate > 2000) {
      const coverColor = getComputedStyle(document.documentElement).getPropertyValue('--now-playing-color').trim() || 'hsl(120, 90%, 50%)';
      
      if (coverColor.includes('hsl')) {
        const hslMatch = coverColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
        if (hslMatch) {
          circlesColorCache.baseHue = parseInt(hslMatch[1]);
          circlesColorCache.baseSat = parseInt(hslMatch[2]);
          circlesColorCache.baseLight = parseInt(hslMatch[3]);
        }
      }
      circlesColorCache.lastUpdate = time;
    }
    
    const baseHue = circlesColorCache.baseHue;
    const baseSat = circlesColorCache.baseSat;
    const baseLight = circlesColorCache.baseLight;
    
    // Rotating shadows
    const shadowTime = time * 0.4;
    const shadowRadius = 300;
    const numShadows = 5;
    
    for (let i = 0; i < numShadows; i++) {
      const angle = (shadowTime + i * (Math.PI * 2 / numShadows)) * 2 * Math.PI;
      const shadowX = centerX + Math.cos(angle) * 80;
      const shadowY = centerY + Math.sin(angle) * 80;
      
      const shadowColors = [
        `hsla(${(baseHue + 60) % 360}, 90%, 70%, 0.4)`,
        `hsla(${(baseHue + 120) % 360}, 85%, 75%, 0.35)`,
        `hsla(${(baseHue + 180) % 360}, 95%, 65%, 0.5)`,
        `hsla(${(baseHue + 240) % 360}, 80%, 60%, 0.3)`,
        `hsla(${(baseHue + 300) % 360}, 100%, 75%, 0.4)`,
      ];
      
      const shadowGradient = nowPlayingVisualizerCtx.createRadialGradient(
        shadowX, shadowY, 0,
        shadowX, shadowY, shadowRadius
      );
      shadowGradient.addColorStop(0, shadowColors[i]);
      shadowGradient.addColorStop(0.3, shadowColors[i].replace(/0\.\d+/, '0.2'));
      shadowGradient.addColorStop(0.7, shadowColors[i].replace(/0\.\d+/, '0.1'));
      shadowGradient.addColorStop(1, 'transparent');
      
      nowPlayingVisualizerCtx.fillStyle = shadowGradient;
      nowPlayingVisualizerCtx.beginPath();
      nowPlayingVisualizerCtx.arc(shadowX, shadowY, shadowRadius, 0, Math.PI * 2);
      nowPlayingVisualizerCtx.fill();
    }
    
    // Outer circle
    const outerRadius = 250;
    const outerGradient = nowPlayingVisualizerCtx.createRadialGradient(
      centerX, centerY, outerRadius * 0.2,
      centerX, centerY, outerRadius
    );
    outerGradient.addColorStop(0, `hsla(${baseHue - 5}, ${baseSat}%, ${baseLight}%, 0.4)`);
    outerGradient.addColorStop(0.5, `hsla(${baseHue - 15}, ${baseSat}%, ${baseLight - 10}%, 0.25)`);
    outerGradient.addColorStop(1, `hsla(${baseHue - 25}, ${baseSat}%, ${baseLight - 20}%, 0.05)`);
    
    nowPlayingVisualizerCtx.fillStyle = outerGradient;
    nowPlayingVisualizerCtx.shadowColor = `hsl(${baseHue}, ${baseSat}%, ${baseLight}%)`;
    nowPlayingVisualizerCtx.shadowBlur = 40;
    nowPlayingVisualizerCtx.beginPath();
    nowPlayingVisualizerCtx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
    nowPlayingVisualizerCtx.fill();
    nowPlayingVisualizerCtx.shadowBlur = 0;
    
    // Inner animated circle
    const animationProgress = (time * 1.5) % 1;
    const innerBaseRadius = 150;
    const innerRadiusVariation = 60;
    const innerRadius = innerBaseRadius + Math.sin(animationProgress * Math.PI * 2) * innerRadiusVariation;
    
    const innerGradient = nowPlayingVisualizerCtx.createRadialGradient(
      centerX, centerY, innerRadius * 0.1,
      centerX, centerY, innerRadius
    );
    innerGradient.addColorStop(0, `hsla(${baseHue + 20}, ${baseSat}%, ${baseLight + 20}%, 0.5)`);
    innerGradient.addColorStop(0.4, `hsla(${baseHue + 10}, ${baseSat}%, ${baseLight + 10}%, 0.3)`);
    innerGradient.addColorStop(1, `hsla(${baseHue}, ${baseSat}%, ${baseLight}%, 0.1)`);
    
    nowPlayingVisualizerCtx.fillStyle = innerGradient;
    nowPlayingVisualizerCtx.shadowColor = `hsl(${baseHue + 20}, ${baseSat}%, ${baseLight + 20}%)`;
    nowPlayingVisualizerCtx.shadowBlur = 25;
    nowPlayingVisualizerCtx.beginPath();
    nowPlayingVisualizerCtx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
    nowPlayingVisualizerCtx.fill();
    nowPlayingVisualizerCtx.shadowBlur = 0;
  }
  
  /**
   * Initialize visualization modes
   */
  function initVisualizationModes() {
    const coverColors = generateCoverBasedStarColors();
    
    // Initialize stars
    stars = [];
    for (let i = 0; i < MAX_STARS; i++) {
      stars.push({
        x: Math.random() * (nowPlayingVisualizerCanvas?.width || 800),
        y: Math.random() * (nowPlayingVisualizerCanvas?.height || 400),
        z: Math.random() * 1000,
        speed: Math.random() * 2 + 0.5,
        brightness: Math.random() * 0.8 + 0.2,
        color: coverColors[Math.floor(Math.random() * coverColors.length)],
        twinklePhase: Math.random() * Math.PI * 2,
        twinkleSpeed: Math.random() * 0.02 + 0.01,
        type: Math.random() < 0.85 ? 'normal' : 'supernova'
      });
    }
    
    // Initialize particles
    enhancedParticles = [];
    for (let i = 0; i < MAX_ENHANCED_PARTICLES; i++) {
      enhancedParticles.push({
        x: Math.random() * (nowPlayingVisualizerCanvas?.width || 800),
        y: Math.random() * (nowPlayingVisualizerCanvas?.height || 400),
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        size: Math.random() * 4 + 2,
        life: Math.random(),
        maxLife: Math.random() * 0.5 + 0.5,
        hue: Math.random() * 360,
        type: Math.random() < 0.7 ? 'normal' : Math.random() < 0.85 ? 'glowing' : 'explosive',
        connections: [],
        energy: Math.random()
      });
    }
    
    // Initialize lightning visualization
    lightningBolts = [];
    lightningFlashes = [];
    nextLightningTime = 0;
    backgroundFlashIntensity = 0;
    energyPulses = [];
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
    
    return ['#ffffff', '#ffdddd', '#ddffdd', '#ddddff', '#ffffdd', '#ffddff', '#ddffff'];
  }
  
  /**
   * Draw star shape
   */
  function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius, color) {
    let rot = Math.PI / 2 * 3;
    let x = cx;
    let y = cy;
    const step = Math.PI / spikes;

    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    
    for (let i = 0; i < spikes; i++) {
      x = cx + Math.cos(rot) * outerRadius;
      y = cy + Math.sin(rot) * outerRadius;
      ctx.lineTo(x, y);
      rot += step;

      x = cx + Math.cos(rot) * innerRadius;
      y = cy + Math.sin(rot) * innerRadius;
      ctx.lineTo(x, y);
      rot += step;
    }
    
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
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
    if (visualizationSettings.enableLightning) availableModes.push('lightning');
    
    if (availableModes.length === 0) {
      return ['space', 'fire', 'particles', 'circles', 'lightning'];
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
        isVisualizationFading = true;
        visualizationFadeAlpha = 1.0;
        
        let fadeSteps = 0;
        const fadeInterval = setInterval(() => {
          fadeSteps++;
          
          if (fadeSteps <= 10) {
            visualizationFadeAlpha = Math.max(0, 1 - (fadeSteps / 10));
          } else if (fadeSteps === 11) {
            currentVisualizationMode = targetVisualizationMode;
          } else if (fadeSteps <= 20) {
            visualizationFadeAlpha = Math.min(1, (fadeSteps - 10) / 10);
          } else {
            isVisualizationFading = false;
            visualizationFadeAlpha = 1.0;
            clearInterval(fadeInterval);
          }
        }, 40);
      }
    }, (visualizationSettings.switchInterval || 30) * 1000);
  }

  /**
   * Draw lightning visualization with electric bolts and energy effects
   */
  function drawLightningVisualization(time) {
    const currentAmplitude = window.currentAmplitude || 0;
    const centerX = nowPlayingVisualizerCanvas.width / 2;
    const centerY = nowPlayingVisualizerCanvas.height / 2;
    
    // Get theme colors
    const nowPlayingRgb = getComputedStyle(document.documentElement).getPropertyValue('--now-playing-rgb').trim();
    let baseColor = { r: 120, g: 180, b: 255 }; // Electric blue default
    
    if (nowPlayingRgb) {
      const [r, g, b] = nowPlayingRgb.split(',').map(v => parseInt(v.trim()));
      baseColor = { r, g, b };
    }
    
    // Dark stormy background with flashes
    const gradient = nowPlayingVisualizerCtx.createRadialGradient(
      centerX, centerY, 0,
      centerX, centerY, Math.max(nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height) * 0.8
    );
    
    const flashIntensity = backgroundFlashIntensity;
    gradient.addColorStop(0, `rgba(${Math.floor(baseColor.r * 0.1 + flashIntensity * 50)}, ${Math.floor(baseColor.g * 0.1 + flashIntensity * 50)}, ${Math.floor(baseColor.b * 0.2 + flashIntensity * 100)}, 1)`);
    gradient.addColorStop(0.3, `rgba(${Math.floor(baseColor.r * 0.05 + flashIntensity * 30)}, ${Math.floor(baseColor.g * 0.05 + flashIntensity * 30)}, ${Math.floor(baseColor.b * 0.15 + flashIntensity * 60)}, 1)`);
    gradient.addColorStop(0.7, `rgba(${Math.floor(flashIntensity * 20)}, ${Math.floor(flashIntensity * 20)}, ${Math.floor(flashIntensity * 40)}, 1)`);
    gradient.addColorStop(1, 'rgba(5, 5, 15, 1)');
    
    nowPlayingVisualizerCtx.fillStyle = gradient;
    nowPlayingVisualizerCtx.fillRect(0, 0, nowPlayingVisualizerCanvas.width, nowPlayingVisualizerCanvas.height);
    
    // Fade background flash
    backgroundFlashIntensity *= 0.9;
    
    // Generate new lightning bolts based on audio
    if (time > nextLightningTime || currentAmplitude > 0.7) {
      if (lightningBolts.length < MAX_LIGHTNING_BOLTS && (Math.random() < 0.3 + currentAmplitude * 0.5)) {
        createLightningBolt(baseColor);
        backgroundFlashIntensity = Math.min(1, backgroundFlashIntensity + 0.3 + currentAmplitude * 0.7);
        nextLightningTime = time + 100 + Math.random() * 500;
      }
    }
    
    // Draw lightning bolts
    nowPlayingVisualizerCtx.shadowBlur = 15;
    nowPlayingVisualizerCtx.shadowColor = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, 0.8)`;
    
    for (let i = lightningBolts.length - 1; i >= 0; i--) {
      const bolt = lightningBolts[i];
      drawLightningBolt(bolt, baseColor);
      
      bolt.life -= 1;
      if (bolt.life <= 0) {
        lightningBolts.splice(i, 1);
      }
    }
    
    nowPlayingVisualizerCtx.shadowBlur = 0;
    
    // Generate energy pulses from center
    if (currentAmplitude > 0.3 && energyPulses.length < MAX_ENERGY_PULSES && Math.random() < 0.4) {
      energyPulses.push({
        x: centerX + (Math.random() - 0.5) * 100,
        y: centerY + (Math.random() - 0.5) * 100,
        radius: 5,
        maxRadius: 50 + currentAmplitude * 100,
        opacity: 0.8,
        speed: 2 + currentAmplitude * 3,
        life: 60
      });
    }
    
    // Draw energy pulses
    for (let i = energyPulses.length - 1; i >= 0; i--) {
      const pulse = energyPulses[i];
      
      nowPlayingVisualizerCtx.beginPath();
      nowPlayingVisualizerCtx.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2);
      
      const pulseGradient = nowPlayingVisualizerCtx.createRadialGradient(
        pulse.x, pulse.y, 0,
        pulse.x, pulse.y, pulse.radius
      );
      
      pulseGradient.addColorStop(0, `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${pulse.opacity})`);
      pulseGradient.addColorStop(0.7, `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${pulse.opacity * 0.3})`);
      pulseGradient.addColorStop(1, `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, 0)`);
      
      nowPlayingVisualizerCtx.fillStyle = pulseGradient;
      nowPlayingVisualizerCtx.fill();
      
      pulse.radius += pulse.speed;
      pulse.opacity *= 0.98;
      pulse.life--;
      
      if (pulse.radius >= pulse.maxRadius || pulse.life <= 0) {
        energyPulses.splice(i, 1);
      }
    }
    
    // Electric grid effect
    if (currentAmplitude > 0.2) {
      drawElectricGrid(baseColor, currentAmplitude, time);
    }
  }
  
  /**
   * Create a new lightning bolt
   */
  function createLightningBolt(baseColor) {
    const startX = Math.random() * nowPlayingVisualizerCanvas.width;
    const startY = Math.random() * nowPlayingVisualizerCanvas.height * 0.3; // Start from top area
    const endX = Math.random() * nowPlayingVisualizerCanvas.width;
    const endY = nowPlayingVisualizerCanvas.height * (0.7 + Math.random() * 0.3); // End in bottom area
    
    const segments = [];
    const numSegments = 8 + Math.floor(Math.random() * 12);
    
    for (let i = 0; i <= numSegments; i++) {
      const progress = i / numSegments;
      const x = startX + (endX - startX) * progress + (Math.random() - 0.5) * 50 * (1 - progress);
      const y = startY + (endY - startY) * progress + (Math.random() - 0.5) * 30;
      segments.push({ x, y });
    }
    
    lightningBolts.push({
      segments,
      thickness: 2 + Math.random() * 3,
      opacity: 0.8 + Math.random() * 0.2,
      life: 10 + Math.floor(Math.random() * 15),
      branches: Math.random() < 0.7 ? createLightningBranches(segments, 2 + Math.floor(Math.random() * 3)) : []
    });
  }
  
  /**
   * Create lightning branches
   */
  function createLightningBranches(mainSegments, numBranches) {
    const branches = [];
    
    for (let b = 0; b < numBranches; b++) {
      const branchStartIndex = Math.floor(mainSegments.length * 0.3 + Math.random() * mainSegments.length * 0.4);
      const startPoint = mainSegments[branchStartIndex];
      
      const branchSegments = [startPoint];
      const branchLength = 3 + Math.floor(Math.random() * 6);
      
      let currentX = startPoint.x;
      let currentY = startPoint.y;
      
      for (let i = 1; i <= branchLength; i++) {
        currentX += (Math.random() - 0.5) * 40;
        currentY += Math.random() * 30 + 10;
        branchSegments.push({ x: currentX, y: currentY });
      }
      
      branches.push({
        segments: branchSegments,
        thickness: 1 + Math.random() * 2,
        opacity: 0.6 + Math.random() * 0.3
      });
    }
    
    return branches;
  }
  
  /**
   * Draw a lightning bolt
   */
  function drawLightningBolt(bolt, baseColor) {
    const fadeOpacity = bolt.life / 25;
    
    // Draw main bolt
    nowPlayingVisualizerCtx.strokeStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${bolt.opacity * fadeOpacity})`;
    nowPlayingVisualizerCtx.lineWidth = bolt.thickness;
    nowPlayingVisualizerCtx.lineCap = 'round';
    nowPlayingVisualizerCtx.lineJoin = 'round';
    
    nowPlayingVisualizerCtx.beginPath();
    nowPlayingVisualizerCtx.moveTo(bolt.segments[0].x, bolt.segments[0].y);
    
    for (let i = 1; i < bolt.segments.length; i++) {
      nowPlayingVisualizerCtx.lineTo(bolt.segments[i].x, bolt.segments[i].y);
    }
    
    nowPlayingVisualizerCtx.stroke();
    
    // Draw glow effect
    nowPlayingVisualizerCtx.strokeStyle = `rgba(255, 255, 255, ${0.8 * fadeOpacity})`;
    nowPlayingVisualizerCtx.lineWidth = Math.max(1, bolt.thickness - 1);
    nowPlayingVisualizerCtx.stroke();
    
    // Draw branches
    for (const branch of bolt.branches) {
      nowPlayingVisualizerCtx.strokeStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${branch.opacity * fadeOpacity * 0.7})`;
      nowPlayingVisualizerCtx.lineWidth = branch.thickness;
      
      nowPlayingVisualizerCtx.beginPath();
      nowPlayingVisualizerCtx.moveTo(branch.segments[0].x, branch.segments[0].y);
      
      for (let i = 1; i < branch.segments.length; i++) {
        nowPlayingVisualizerCtx.lineTo(branch.segments[i].x, branch.segments[i].y);
      }
      
      nowPlayingVisualizerCtx.stroke();
    }
  }
  
  /**
   * Draw electric grid effect
   */
  function drawElectricGrid(baseColor, amplitude, time) {
    const gridSize = 40;
    const width = nowPlayingVisualizerCanvas.width;
    const height = nowPlayingVisualizerCanvas.height;
    
    nowPlayingVisualizerCtx.strokeStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${0.1 + amplitude * 0.3})`;
    nowPlayingVisualizerCtx.lineWidth = 1;
    
    // Animated grid with electric pulses
    for (let x = 0; x <= width; x += gridSize) {
      if (Math.random() < 0.3 + amplitude * 0.5) {
        const offset = Math.sin(time * 0.01 + x * 0.01) * 10;
        nowPlayingVisualizerCtx.beginPath();
        nowPlayingVisualizerCtx.moveTo(x + offset, 0);
        nowPlayingVisualizerCtx.lineTo(x + offset, height);
        nowPlayingVisualizerCtx.stroke();
      }
    }
    
    for (let y = 0; y <= height; y += gridSize) {
      if (Math.random() < 0.3 + amplitude * 0.5) {
        const offset = Math.cos(time * 0.01 + y * 0.01) * 10;
        nowPlayingVisualizerCtx.beginPath();
        nowPlayingVisualizerCtx.moveTo(0, y + offset);
        nowPlayingVisualizerCtx.lineTo(width, y + offset);
        nowPlayingVisualizerCtx.stroke();
      }
    }
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
