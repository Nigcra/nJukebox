/**
 * Footer Equalizer Module
 * 
 * Provides audio frequency visualization for the footer equalizer.
 * Displays 256 frequency bars that respond to audio playback.
 * 
 * Features:
 * - Real-time audio frequency analysis
 * - Server loopback spectrum (WASAPI capture on the data server)
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

  // Welche Quellen tatsaechlich am Analyser haengen. Nur fuer die Diagnose.
  let connectedSources = [];

  // Server side loopback spectrum.
  //
  // The Spotify SDK plays DRM protected audio no browser API can tap, and a
  // physical microphone only hears what the speakers emit - with headphones
  // that is nothing. The Go data server captures what the default output
  // device plays (WASAPI loopback) and streams the same 256 byte bands the
  // analyser produces. While these frames are fresh they replace the analyser
  // data; when the stream is gone the analyser sources below take over again.
  const SERVER_SPECTRUM_URL = 'http://127.0.0.1:3001/api/eq/stream';
  const SERVER_SPECTRUM_FRESH_MS = 250;
  let serverSpectrum = null;
  let serverSpectrumTime = 0;
  let serverSpectrumSource = null;
  let serverSpectrumRetryTimer = null;

  function connectServerSpectrum() {
    if (serverSpectrumSource) return;
    try {
      serverSpectrumSource = new EventSource(SERVER_SPECTRUM_URL);
    } catch (e) {
      debugLog('main', '[EQUALIZER] Server spectrum stream not available:', e.message);
      return;
    }
    serverSpectrumSource.onopen = () => {
      debugLog('main', '[EQUALIZER] ✅ Server loopback spectrum connected');
    };
    serverSpectrumSource.onmessage = (event) => {
      const raw = atob(event.data);
      if (!serverSpectrum || serverSpectrum.length !== raw.length) {
        serverSpectrum = new Uint8Array(raw.length);
      }
      for (let i = 0; i < raw.length; i++) {
        serverSpectrum[i] = raw.charCodeAt(i);
      }
      serverSpectrumTime = performance.now();
    };
    serverSpectrumSource.onerror = () => {
      // A closed source never reconnects on its own - that is what a 503 from
      // a platform without loopback support looks like. Retry with a pause
      // instead of hammering; transient drops reconnect via the SSE retry.
      if (serverSpectrumSource && serverSpectrumSource.readyState === EventSource.CLOSED) {
        serverSpectrumSource = null;
        if (!serverSpectrumRetryTimer) {
          serverSpectrumRetryTimer = setTimeout(() => {
            serverSpectrumRetryTimer = null;
            connectServerSpectrum();
          }, 15000);
        }
      }
    };
  }

  function serverSpectrumFresh() {
    return !!serverSpectrum && (performance.now() - serverSpectrumTime) < SERVER_SPECTRUM_FRESH_MS;
  }

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

    // Independent of the AudioContext below: the server spectrum needs neither
    // a user gesture nor a microphone permission.
    connectServerSpectrum();

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

    // Zaehlt, ob mindestens eine Quelle am Analyser haengt. Es werden bewusst
    // alle verfuegbaren verbunden, nicht nur die erste, die gelingt.
    let captured = false;

    // Mikrofon zuerst: es erfasst jede Quelle, lokale Tracks wie Spotify.
    //
    // Bis hier stand der captureStream() des lokalen Audio-Elements davor. Der
    // warf frueher einen Fehler, solange kein Titel geladen war, und der Code
    // fiel auf das Mikrofon durch. Aktuelle Chrome-Versionen liefern stattdessen
    // einen gueltigen, aber stummen Stream - der Aufruf gelingt also immer, das
    // Mikrofon wurde nie mehr erreicht, und bei Spotify blieb der Equalizer
    // stumm, weil Spotify nicht ueber dieses Element spielt.
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

      const micTrack = stream.getAudioTracks()[0];
      connectedSources.push('microphone: ' + (micTrack ? micTrack.label || 'unnamed device' : 'no track'));
      captured = true;

    } catch (e) {
      debugLog('main', '[EQUALIZER] ❌ getUserMedia fehlgeschlagen:', e.message);
      debugLog('main', '[EQUALIZER] ❌ Error name:', e.name);
    }

    // Methode 2: Direkter Mitschnitt des lokalen Audio-Elements.
    //
    // Wird auch dann verbunden, wenn das Mikrofon schon laeuft. Beide Quellen
    // speisen denselben Analyser: das Mikrofon deckt Spotify ab, der Mitschnitt
    // die lokalen Titel. Nur eine von beiden zu nehmen laesst den jeweils
    // anderen Fall stumm.
    if (audioElement && typeof audioElement.captureStream === 'function') {
      try {
        const stream = audioElement.captureStream();
        const source = equalizerAudioCtx.createMediaStreamSource(stream);
        source.connect(equalizerAnalyser);
        debugLog('main', '[EQUALIZER] ✅ Local audio element directly captured (for local tracks)');
        connectedSources.push('local audio element (captureStream)');
        captured = true;
      } catch (e) {
        debugLog('main', '[EQUALIZER] ⚠️ Local audio element not available, trying media element source...');
      }
    }

    if (captured) {
      return true;
    }

    // Methode 3: Lokales Audio-Element als MediaElementSource (letzter Rueckfall)
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
   * Hängt ein weiteres Audio-Element an den Analyser.
   *
   * Die lokale Wiedergabe laeuft ueber zwei Decks, damit ein Titel in den
   * naechsten uebergeblendet werden kann. tryAudioCapture() kennt nur das eine
   * Element, das initEqualizer() bekommen hat - das zweite muss hier nachgereicht
   * werden, sonst bleibt der Equalizer bei jedem Titel stumm, der durch eine
   * Ueberblendung auf dem anderen Deck gelandet ist.
   *
   * @param {HTMLAudioElement} audioElement - Das zusaetzliche Audio-Element
   * @returns {boolean} Ob die Quelle verbunden wurde
   */
  function attachElement(audioElement) {
    if (!equalizerAudioCtx || !equalizerAnalyser || !audioElement) {
      return false;
    }
    if (typeof audioElement.captureStream !== 'function') {
      return false;
    }

    try {
      const stream = audioElement.captureStream();
      const source = equalizerAudioCtx.createMediaStreamSource(stream);
      source.connect(equalizerAnalyser);
      connectedSources.push('local audio element ' + (audioElement.id || 'unnamed') + ' (captureStream)');
      debugLog('main', '[EQUALIZER] ✅ Zusaetzliches Audio-Element verbunden:', audioElement.id);
      return true;
    } catch (e) {
      debugLog('main', '[EQUALIZER] ⚠️ Zusaetzliches Audio-Element nicht verbunden:', e.message);
      return false;
    }
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

        // Fresh server frames win over the analyser: they carry the system
        // output itself, which covers Spotify without any microphone.
        if (serverSpectrumFresh() && serverSpectrum.length === equalizerDataArray.length) {
          equalizerDataArray.set(serverSpectrum);
        }

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

        // window.currentAmplitude is deliberately left unset here.
        //
        // js/visualizer.js multiplies particle speed by (1 + amplitude * 3),
        // adds amplitude * 2.4 to the size pulse and scales the opacity and
        // width of the connection lines by it. Those factors were written
        // against a value no build of this app has ever assigned, so the calm
        // drifting look is the resting state, not a defect. Feeding the real
        // spectrum in turns the particles into fast oversized blobs strung
        // together by visible lines.

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
  // Diagnose fuer die Konsole: window.equalizerDiagnostics()
  //
  // Der Analyser und die Quellen liegen im Modulgueltigkeitsbereich und sind von
  // aussen sonst nicht einsehbar. Die Frage "haengt eine Quelle dran und liefert
  // sie ueberhaupt Pegel" laesst sich damit in einem Aufruf beantworten, statt
  // sie aus dem Verhalten zu erraten.
  function equalizerDiagnostics() {
    if (!equalizerAnalyser || !equalizerDataArray) {
      return { ready: false, reason: 'analyser not initialised' };
    }

    equalizerAnalyser.getByteFrequencyData(equalizerDataArray);

    let max = 0;
    let sum = 0;
    let above5 = 0;
    for (let i = 0; i < equalizerDataArray.length; i++) {
      const value = equalizerDataArray[i];
      sum += value;
      if (value > max) max = value;
      if (value > 5) above5++;
    }

    return {
      ready: true,
      audioContextState: equalizerAudioCtx ? equalizerAudioCtx.state : 'none',
      sources: connectedSources.slice(),
      serverSpectrum: {
        connected: !!serverSpectrumSource && serverSpectrumSource.readyState === EventSource.OPEN,
        fresh: serverSpectrumFresh(),
        lastFrameAgeMs: serverSpectrumTime ? Math.round(performance.now() - serverSpectrumTime) : null
      },
      maxFrequencyValue: max,
      averageFrequencyValue: Math.round((sum / equalizerDataArray.length) * 100) / 100,
      bandsAboveThreshold: above5,
      hasAudioData: above5 > 0,
      isMusicPlaying: typeof isAnyMusicPlaying === 'function' ? isAnyMusicPlaying() : 'unknown',
      currentAmplitude: window.currentAmplitude,
      canvas: equalizerCanvas
        ? { width: equalizerCanvas.width, height: equalizerCanvas.height }
        : null
    };
  }

  window.equalizerDiagnostics = equalizerDiagnostics;

  window.EqualizerModule = {
    init: initEqualizer,
    attachElement: attachElement,
    stop: stopEqualizer,
    resize: resizeEqualizer,
    diagnostics: equalizerDiagnostics
  };
  
})();
