/**
 * Footer Equalizer Module
 * 
 * Provides audio frequency visualization for the footer equalizer.
 * Displays 256 frequency bars that respond to audio playback.
 * 
 * Features:
 * - Real-time audio frequency analysis
 * - System audio capture (microphone fallback)
 * - Local audio element capture for MP3 files
 * - Smooth bar animations with rainbow color scheme
 * - Automatic activation/deactivation based on playback state
 */

(function() {
  'use strict';
  
  // Equalizer state
  let equalizerAudioCtx = null;
  let equalizerAnalyser = null;
  let equalizerDataArray = null;
  let equalizerBufferLength = 0;
  let equalizerAnimationFrame = null;
  let equalizerBarHeights = [];

  // Canvas references
  let equalizerCanvas = null;
  let equalizerCtx = null;

  /**
   * Initialize the footer equalizer
   * @param {HTMLCanvasElement} canvas - The canvas element for the equalizer
   * @param {HTMLAudioElement} audioElement - The audio player element
   * @param {Function} isMusicPlayingCallback - Function to check if music is playing
   */
  async function initEqualizer(canvas, audioElement, isMusicPlayingCallback) {
    debugLog('main', '[EQUALIZER] 🚀 STARTING INITIALIZATION');
    debugLog('EQUALIZER', '🚀 Initialisierung gestartet...');
    
    equalizerCanvas = canvas;
    equalizerCtx = canvas.getContext('2d');
    
    try {
      // AudioContext for equalizer
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      equalizerAudioCtx = new AudioCtx();
      debugLog('EQUALIZER', 'AudioContext erstellt, Status:', equalizerAudioCtx.state);
      
      // AudioContext muss durch User-Interaktion gestartet werden
      if (equalizerAudioCtx.state === 'suspended') {
        debugLog('main', '[EQUALIZER] AudioContext suspended - warte auf User-Interaktion');
        // Warte auf erste User-Interaktion
        document.addEventListener('click', async () => {
          if (equalizerAudioCtx.state === 'suspended') {
            await equalizerAudioCtx.resume();
            debugLog('main', '[EQUALIZER] AudioContext nach User-Interaktion gestartet');
          }
        }, { once: true });
      }
      
      // Analyzer for detailed frequency analysis
      equalizerAnalyser = equalizerAudioCtx.createAnalyser();
      equalizerAnalyser.fftSize = 512; // 256 frequency bands
      equalizerAnalyser.smoothingTimeConstant = 0.8;
      equalizerBufferLength = equalizerAnalyser.frequencyBinCount;
      equalizerDataArray = new Uint8Array(equalizerBufferLength);
      
      debugLog('EQUALIZER', 'Initialized with', equalizerBufferLength, 'frequency bands');
      
      // Canvas-Check
      if (!equalizerCanvas) {
        console.error('[EQUALIZER] ❌ Canvas-Element nicht gefunden!');
        return;
      }
      
      debugLog('EQUALIZER', 'Canvas gefunden:', equalizerCanvas.width, 'x', equalizerCanvas.height);
      
      // Equalizer-Animation sofort starten
      debugLog('EQUALIZER', 'Starte Animation...');
      startEqualizerAnimation(isMusicPlayingCallback);
      
      // System-Audio-Capture nach kurzer Verzögerung versuchen
      setTimeout(async () => {
        debugLog('main', '[EQUALIZER] Versuche Audio-Capture...');
        const success = await tryAudioCapture(audioElement);
        if (success) {
          debugLog('main', '[EQUALIZER] 🎉 Audio-Capture erfolgreich aktiviert!');
        } else {
          debugLog('main', '[EQUALIZER] ⚠️ System audio not available - creating silent audio source for analyser');
          // Fallback: Erstelle eine stille Audio-Quelle damit der Analyser nicht leer bleibt
          try {
            const oscillator = equalizerAudioCtx.createOscillator();
            const gainNode = equalizerAudioCtx.createGain();
            gainNode.gain.value = 0; // Stumm schalten
            oscillator.connect(gainNode);
            gainNode.connect(equalizerAnalyser);
            oscillator.start();
          } catch (e) {
            console.warn('[EQUALIZER] Konnte keine Fallback-Audio-Quelle erstellen:', e);
          }
        }
      }, 2000);
      
    } catch (error) {
      console.error('[EQUALIZER] ❌ Fehler bei der Initialisierung:', error);
      // Fallback zu einfacher Animation ohne Audio
      debugLog('main', '[EQUALIZER] Starte Fallback-Animation...');
      startEqualizerAnimation(isMusicPlayingCallback);
    }
  }

  /**
   * Try to capture audio from various sources
   * @param {HTMLAudioElement} audioElement - The audio player element
   * @returns {Promise<boolean>} Success status
   */
  async function tryAudioCapture(audioElement) {
    debugLog('main', '[EQUALIZER] Versuche System-Audio zu erfassen...');
    
    // Zuerst versuchen, lokales Audio-Element direkt zu nutzen (bessere Qualität für lokale Tracks)
    if (audioElement && typeof audioElement.captureStream === 'function') {
      try {
        const stream = audioElement.captureStream();
        const source = equalizerAudioCtx.createMediaStreamSource(stream);
        source.connect(equalizerAnalyser);
        debugLog('main', '[EQUALIZER] ✅ Local audio element directly captured (for local tracks)');
        return true;
      } catch (e) {
        debugLog('main', '[EQUALIZER] ⚠️ Local audio element not available, trying system audio...');
      }
    }
    
    // Fallback: Mikrofon mit Desktop-Audio (funktioniert für alle Audio-Quellen!)
    try {
      debugLog('main', '[EQUALIZER-AUDIO] Requesting microphone permission...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
          sampleRate: 44100
        }
      });
      
      debugLog('main', '[EQUALIZER-AUDIO] ✅ getUserMedia succeeded! Stream active:', stream.active);
      debugLog('main', '[EQUALIZER-AUDIO] Audio tracks:', stream.getAudioTracks().length);
      
      if (stream.getAudioTracks().length > 0) {
        const track = stream.getAudioTracks()[0];
        debugLog('main', '[EQUALIZER-AUDIO] Track label:', track.label);
        debugLog('main', '[EQUALIZER-AUDIO] Track enabled:', track.enabled);
        debugLog('main', '[EQUALIZER-AUDIO] Track muted:', track.muted);
        debugLog('main', '[EQUALIZER-AUDIO] Track readyState:', track.readyState);
      }
      
      const source = equalizerAudioCtx.createMediaStreamSource(stream);
      source.connect(equalizerAnalyser);
      
      debugLog('main', '[EQUALIZER] ✅ Mikrofon als System-Audio aktiviert (erfasst alle Audio-Quellen: lokale Tracks + Spotify)');
      
      // Test: Check if we're actually getting data
      setTimeout(() => {
        const testArray = new Uint8Array(equalizerAnalyser.frequencyBinCount);
        equalizerAnalyser.getByteFrequencyData(testArray);
        let maxVal = 0;
        for (let i = 0; i < testArray.length; i++) {
          if (testArray[i] > maxVal) maxVal = testArray[i];
        }
        debugLog('main', '[EQUALIZER-AUDIO] Test read after connection - max frequency value:', maxVal);
      }, 1000);
      
      return true;
      
    } catch (e) {
      debugLog('main', '[EQUALIZER] ❌ getUserMedia fehlgeschlagen:', e.message);
      debugLog('main', '[EQUALIZER] ❌ Error name:', e.name);
    }
    
    // Methode 2: Lokales Audio-Element (nur für lokale Tracks als Fallback)
    try {
      if (audioElement) {
        const source = equalizerAudioCtx.createMediaElementSource(audioElement);
        source.connect(equalizerAnalyser);
        equalizerAnalyser.connect(equalizerAudioCtx.destination);
        
        debugLog('main', '[EQUALIZER] 🎵 Lokales Audio-Element verbunden (nur lokale Tracks)');
        return true;
      }
    } catch (e) {
      debugLog('main', '[EQUALIZER] ❌ Audio-Element-Verbindung fehlgeschlagen:', e.message);
    }
    
    debugLog('main', '[EQUALIZER] ❌ Alle Audio-Capture-Methoden fehlgeschlagen');
    return false;
  }

  /**
   * Start the equalizer animation loop
   * @param {Function} isMusicPlayingCallback - Function to check if music is playing
   */
  function startEqualizerAnimation(isMusicPlayingCallback) {
    debugLog('main', '[EQUALIZER] 🎬 Animation gestartet');
    
    function drawEqualizer() {
      if (!equalizerCanvas || !equalizerCtx) {
        console.error('[EQUALIZER] Canvas or Context not available!');
        return;
      }
      
      equalizerCtx.clearRect(0, 0, equalizerCanvas.width, equalizerCanvas.height);
      
      let hasAudioData = false;
      let isMusicPlaying = false;
      
      // Use callback to check if music is playing
      if (isMusicPlayingCallback && typeof isMusicPlayingCallback === 'function') {
        isMusicPlaying = isMusicPlayingCallback();
      }
      
      if (equalizerAnalyser && equalizerDataArray) {
        // Echte Audio-Daten abrufen (funktioniert für ALLE Audio-Quellen wenn System-Audio aktiviert)
        equalizerAnalyser.getByteFrequencyData(equalizerDataArray);
        
        // Debug: Check if we're getting any data at all
        let maxValue = 0;
        let activeDataPoints = 0;
        
        // Prüfen ob echte Audio-Daten vorhanden sind
        for (let i = 0; i < equalizerDataArray.length; i++) {
          const value = equalizerDataArray[i];
          if (value > maxValue) maxValue = value;
          if (value > 5) { // Mindest-Threshold um Rauschen zu ignorieren
            hasAudioData = true;
            activeDataPoints++;
          }
        }
        
        if (hasAudioData && isMusicPlaying) {
          // Echte Audio-Visualisierung mit vielen Balken (nur wenn Musik gespielt wird)
          const numBars = 256; // Ursprüngliche Balkenanzahl
          const barWidth = equalizerCanvas.width / numBars;
          
          // Initialize bar heights array if needed
          if (equalizerBarHeights.length !== numBars) {
            equalizerBarHeights = new Array(numBars).fill(0);
          }
          
          let x = 0;
          
          for (let i = 0; i < numBars; i++) {
            // Sample-Index berechnen (alle Frequenzbänder nutzen)
            const sampleIndex = Math.floor((i / numBars) * equalizerBufferLength);
            const value = equalizerDataArray[sampleIndex];
            const targetPercent = Math.max(0, (value - 5) / 250); // Threshold anwenden
            
            // Smooth transition für echte Audio-Daten
            const currentHeight = equalizerBarHeights[i] || 0;
            const smoothingFactor = 0.15; // Responsiver wie ursprünglich
            equalizerBarHeights[i] = currentHeight + (targetPercent - currentHeight) * smoothingFactor;
            
            const barHeight = equalizerCanvas.height * equalizerBarHeights[i] * 0.9;
            
            // Regenbogen-Farbschema über das gesamte Spektrum
            const hue = (i / numBars) * 360; // 0-360° für volles Spektrum
            const saturation = 70 + (equalizerBarHeights[i] * 30);
            const lightness = 40 + (equalizerBarHeights[i] * 30);
            
            equalizerCtx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
            equalizerCtx.fillRect(x, equalizerCanvas.height - barHeight, Math.max(1, barWidth - 1), barHeight);
            
            x += barWidth;
          }
        }
      }
      
      // Footer-Equalizer: Nur bei aktiver Musikwiedergabe anzeigen
      if (!isMusicPlaying) {
        // Canvas leer lassen und Bar-Heights zurücksetzen wenn keine Musik gespielt wird
        if (equalizerBarHeights && equalizerBarHeights.length > 0) {
          // Sanfter Übergang zur Ruhe
          for (let i = 0; i < equalizerBarHeights.length; i++) {
            equalizerBarHeights[i] *= 0.95; // Langsam abklingen lassen
          }
        }
        // Debug: Why is equalizer not showing?
        if (equalizerCanvas && equalizerCtx) {
          const now = Date.now();
          if (!window.lastEqualizerDebug || (now - window.lastEqualizerDebug) > 5000) {
            debugLog('main', '[EQUALIZER] Not drawing - isMusicPlaying:', isMusicPlaying, 'hasAudioData:', hasAudioData);
            window.lastEqualizerDebug = now;
          }
        }
      }
      
      equalizerAnimationFrame = requestAnimationFrame(drawEqualizer);
    }
    
    drawEqualizer();
  }

  /**
   * Stop the equalizer animation
   */
  function stopEqualizer() {
    if (equalizerAnimationFrame) {
      cancelAnimationFrame(equalizerAnimationFrame);
      equalizerAnimationFrame = null;
    }
    
    if (equalizerAudioCtx && equalizerAudioCtx.state !== 'closed') {
      equalizerAudioCtx.close();
    }
  }

  /**
   * Resize the equalizer canvas
   * @param {number} width - New width
   * @param {number} height - New height
   */
  function resizeEqualizer(width, height) {
    if (equalizerCanvas) {
      equalizerCanvas.width = width;
      equalizerCanvas.height = height;
    }
  }

  // Helper function for debug logging (will use global debugLog if available)
  function debugLog(category, ...args) {
    if (typeof window.debugLog === 'function') {
      window.debugLog(category, ...args);
    } else {
      console.log(`[${category}]`, ...args);
    }
  }
  
  // Export to window object
  window.EqualizerModule = {
    init: initEqualizer,
    stop: stopEqualizer,
    resize: resizeEqualizer
  };
  
})();
