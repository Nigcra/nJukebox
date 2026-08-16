// crossfade.js
// Transitions between two consecutive tracks, for local files and Spotify alike
// Version: 2026.08.16
//
// What is possible depends on the source, and the difference is not a matter of
// effort:
//
//   local -> local      real crossfade, the two decks overlap
//   local <-> Spotify   real crossfade, two independent outputs
//   Spotify -> Spotify  fade out, then fade in - no overlap
//
// A Spotify account plays exactly one stream. Starting the next title stops the
// current one on the spot, and the Web Playback SDK hands out no audio signal
// that could be mixed - the stream is DRM protected, a GainNode never sees it.
// setVolume() is the only handle there is, so a Spotify to Spotify change is a
// fade through silence. Everything else really does overlap.

(function () {
  'use strict';

  const MAX_SECONDS = 12;

  // Wall clock drives the ramp, this is only how often it is sampled. An
  // interval and not requestAnimationFrame on purpose: a jukebox tab spends most
  // of its life in the background, and rAF stops there - a fade would freeze
  // half way and leave a title stuck at silence.
  const TICK_MS = 40;

  // Arming the Spotify fade timer earlier than this is pointless, the poll
  // re-arms it every second anyway.
  const SPOTIFY_ARM_HORIZON_MS = 15000;

  let masterVolume = 0.7;
  let transitionActive = false;

  // Gain per output, 0..1. What is actually set is masterVolume * shape(gain),
  // so the volume slider keeps working during a fade and the fade keeps its
  // shape - the two are separate factors and never overwrite each other.
  const localGains = new Map(); // HTMLAudioElement -> gain
  let spotifyGain = 1;

  const ramps = new Map(); // target -> ramp state

  // setVolume() is asynchronous. Firing one per tick would queue up dozens of
  // calls; only the newest value is worth sending, so a busy call parks it.
  let spotifyVolumeBusy = false;
  let spotifyPendingGain = null;

  const clamp01 = (value) => Math.max(0, Math.min(1, value));

  // Equal power: one side follows sin, the other cos, and together they stay at
  // a constant perceived loudness. A linear pair dips audibly in the middle,
  // which is exactly the hole a crossfade is supposed to avoid.
  const shape = (gain) => Math.sin(clamp01(gain) * Math.PI / 2);

  function log(...args) {
    if (typeof debugLog === 'function') {
      debugLog('audio', '[CROSSFADE]', ...args);
    }
  }

  // Volume application

  function applyLocal(deck, gain) {
    if (!deck) return;
    const value = clamp01(gain);
    localGains.set(deck, value);
    try {
      deck.volume = clamp01(masterVolume * shape(value));
    } catch (error) {
      log('setting the deck volume failed:', error);
    }
  }

  function pushSpotifyVolume(gain) {
    const player = window.spotifyPlayer;
    if (!player || typeof player.setVolume !== 'function') {
      spotifyVolumeBusy = false;
      return;
    }

    spotifyVolumeBusy = true;
    Promise.resolve(player.setVolume(clamp01(masterVolume * shape(gain))))
      .catch((error) => log('Spotify setVolume failed:', error))
      .then(() => {
        spotifyVolumeBusy = false;
        if (spotifyPendingGain === null) return;
        const next = spotifyPendingGain;
        spotifyPendingGain = null;
        pushSpotifyVolume(next);
      });
  }

  function applySpotify(gain) {
    spotifyGain = clamp01(gain);
    if (spotifyVolumeBusy) {
      spotifyPendingGain = spotifyGain;
      return;
    }
    pushSpotifyVolume(spotifyGain);
  }

  function apply(target, gain) {
    if (target === 'spotify') {
      applySpotify(gain);
    } else {
      applyLocal(target, gain);
    }
  }

  function currentGain(target) {
    if (target === 'spotify') return spotifyGain;
    const gain = localGains.get(target);
    return typeof gain === 'number' ? gain : 1;
  }

  // Ramps

  function cancelRamp(target) {
    const state = ramps.get(target);
    if (!state) return;
    clearInterval(state.timer);
    ramps.delete(target);
    const resolve = state.resolve;
    state.resolve = null;
    if (resolve) resolve(false);
  }

  // Ramps one output from its current gain to `to` over `ms`. Resolves true
  // when it arrived, false when something cancelled it on the way.
  function ramp(target, to, ms) {
    cancelRamp(target);

    const from = currentGain(target);
    if (!(ms > 0)) {
      apply(target, to);
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const started = performance.now();
      const state = { resolve: resolve, timer: null };

      state.timer = setInterval(() => {
        // Progress comes from the clock, not from the tick count. A throttled
        // background tab then takes coarser steps but still finishes on time.
        const progress = Math.min(1, (performance.now() - started) / ms);
        apply(target, from + (to - from) * progress);
        if (progress < 1) return;

        clearInterval(state.timer);
        ramps.delete(target);
        const done = state.resolve;
        state.resolve = null;
        if (done) done(true);
      }, TICK_MS);

      ramps.set(target, state);
    });
  }

  // Configuration

  function configuredSeconds() {
    const config = window.AUTO_DJ_CONFIG;
    const raw = config ? Number.parseFloat(config.crossfadeSeconds) : NaN;
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.min(MAX_SECONDS, raw));
  }

  // A fade must not eat the title it is fading. Anything that would not fit
  // three times into the running time is shortened instead of being skipped -
  // a jingle of eight seconds still gets a transition, just a shorter one.
  function secondsForDuration(durationSeconds) {
    const seconds = configuredSeconds();
    if (seconds <= 0) return 0;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return seconds;
    return Math.min(seconds, durationSeconds / 3);
  }

  // Queue helpers - the same source test js/audio.js uses to route a track.
  function trackKind(track) {
    if (!track) return null;
    if (track.type === 'spotify' || track.uri || track.spotify_uri || track.isSpotify) return 'spotify';
    if (track.type === 'server' || track.streamUrl || track.path || track.file_path) return 'local';
    return null;
  }

  function queueEntry(offset) {
    const queue = window.queue;
    const index = window.currentTrackIndex;
    if (!Array.isArray(queue) || typeof index !== 'number' || index < 0) return null;
    return queue[index + offset] || null;
  }

  const currentTrack = () => queueEntry(0);
  const nextTrack = () => queueEntry(1);

  // Transition

  function releaseDeck(deck) {
    try {
      deck.pause();
      deck.currentTime = 0;
      deck.removeAttribute('src');
      deck.load();
    } catch (error) {
      log('releasing the outgoing deck failed:', error);
    }
    // Back to full gain, so the next hard cut on this deck is not silent.
    applyLocal(deck, 1);
  }

  // Fades the outgoing source out and tears it down afterwards. Returns false
  // when the ramp was cancelled on the way.
  //
  // The teardown must not run in that case. A skip or a stop pressed during a
  // transition cancels the ramp and starts something new right away - releasing
  // the deck or pausing Spotify at that point would hit the title that has just
  // taken over, not the one this fade was winding down.
  async function fadeOut(kind, deck, ms, incoming) {
    if (kind === 'local') {
      const completed = await ramp(deck, 0, ms);
      if (!completed) return false;
      releaseDeck(deck);
      return true;
    }

    const completed = await ramp('spotify', 0, ms);
    if (!completed) return false;

    // Spotify is only paused when something else takes over. For a Spotify to
    // Spotify change the next play request replaces the stream by itself, and
    // pausing in between would just add a second stop.
    if (incoming === 'spotify') return true;

    if (window.spotifyPlayer) {
      try {
        await window.spotifyPlayer.pause();
      } catch (error) {
        log('pausing Spotify after the fade failed:', error);
      }
    }
    window.isSpotifyCurrentlyPlaying = false;
    if (typeof window.stopSpotifyProgressUpdates === 'function') {
      window.stopSpotifyProgressUpdates();
    }
    return true;
  }

  function fadeIn(kind, ms) {
    if (kind === 'local') {
      const deck = typeof window.getActiveAudioDeck === 'function' ? window.getActiveAudioDeck() : null;
      if (!deck) return Promise.resolve(false);
      return ramp(deck, 1, ms);
    }
    return ramp('spotify', 1, ms);
  }

  // Hands the queue over to the next entry with a fade. Returns true when it
  // took the transition over, false when the caller has to fall back to the
  // hard cut it has always done.
  async function crossfadeToNext(durationSeconds) {
    if (transitionActive) return false;
    if (typeof window.skipTrack !== 'function') return false;

    const outgoing = trackKind(currentTrack());
    const incoming = trackKind(nextTrack());
    if (!outgoing || !incoming) return false;

    const seconds = secondsForDuration(durationSeconds);
    if (seconds <= 0) return false;

    // The outgoing deck has to be remembered before the queue advances: from
    // then on the active deck is the incoming one.
    const outgoingDeck = outgoing === 'local' && typeof window.getActiveAudioDeck === 'function'
      ? window.getActiveAudioDeck()
      : null;
    if (outgoing === 'local' && !outgoingDeck) return false;

    transitionActive = true;
    window.crossfadeInProgress = true;
    const ms = Math.round(seconds * 1000);
    log(`${outgoing} -> ${incoming} over ${seconds.toFixed(1)}s`);

    try {
      if (outgoing === 'spotify' && incoming === 'spotify') {
        // No overlap to be had here, see the note at the top of the file.
        const faded = await fadeOut(outgoing, outgoingDeck, ms, incoming);
        // Cancelled means a skip or a stop got in first and is already playing
        // whatever comes next. Advancing again here would drop a title.
        if (!faded) return false;
        window.skipTrack({ crossfade: true });
        await fadeIn(incoming, ms);
      } else {
        // Two independent outputs, so both really do sound at once.
        const fadingOut = fadeOut(outgoing, outgoingDeck, ms, incoming);
        window.skipTrack({ crossfade: true });
        const fadingIn = fadeIn(incoming, ms);
        await Promise.all([fadingOut, fadingIn]);
      }
    } catch (error) {
      log('transition failed:', error);
    } finally {
      transitionActive = false;
      window.crossfadeInProgress = false;
    }

    return true;
  }

  // Called from the timeupdate of the active deck, roughly four times a second.
  // That is accurate enough to start a fade on; waiting for "ended" is not,
  // because by then there is nothing left to fade out.
  function considerLocalTransition(deck) {
    if (transitionActive || !deck || deck.paused) return;
    if (!Number.isFinite(deck.duration) || deck.duration <= 0) return;
    if (typeof window.getActiveAudioDeck === 'function' && window.getActiveAudioDeck() !== deck) return;

    const seconds = secondsForDuration(deck.duration);
    if (seconds <= 0) return;
    if (deck.duration - deck.currentTime > seconds) return;
    if (!nextTrack()) return;

    crossfadeToNext(deck.duration);
  }

  // How many milliseconds are left before a Spotify fade has to start, or null
  // when this title gets no transition at all. js/spotify.js turns it into a
  // timer, because its state poll runs once a second and a fade started up to a
  // second late loses that second at the end of the title.
  function spotifyFadeLeadMs(positionMs, durationMs) {
    if (transitionActive) return null;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
    if (!Number.isFinite(positionMs) || positionMs < 0) return null;

    const seconds = secondsForDuration(durationMs / 1000);
    if (seconds <= 0) return null;
    if (!nextTrack()) return null;

    const lead = durationMs - positionMs - seconds * 1000;
    if (lead > SPOTIFY_ARM_HORIZON_MS) return null;
    return Math.max(0, lead);
  }

  // Volume

  function reapply() {
    localGains.forEach((gain, deck) => applyLocal(deck, gain));
    applySpotify(spotifyGain);
  }

  function setMasterVolume(volume) {
    const parsed = Number.parseFloat(volume);
    if (!Number.isFinite(parsed)) return;
    masterVolume = clamp01(parsed);
    reapply();
  }

  const getMasterVolume = () => masterVolume;

  // Sets a gain outright and drops any fade running on that output. Used to put
  // an incoming source at silence before it starts.
  function setGain(target, gain) {
    cancelRamp(target);
    apply(target, gain);
  }

  function registerDeck(deck) {
    if (deck && !localGains.has(deck)) applyLocal(deck, 1);
  }

  // Every teardown of playback ends here: no fade survives, and every output is
  // back at full gain so nothing can stay stuck at silence.
  function abort() {
    Array.from(ramps.keys()).forEach(cancelRamp);
    localGains.forEach((gain, deck) => applyLocal(deck, 1));
    applySpotify(1);
    transitionActive = false;
    window.crossfadeInProgress = false;
  }

  window.crossfadeInProgress = false;

  window.CrossfadeEngine = {
    configuredSeconds,
    secondsForDuration,
    crossfadeToNext,
    considerLocalTransition,
    spotifyFadeLeadMs,
    setMasterVolume,
    getMasterVolume,
    setGain,
    registerDeck,
    reapply,
    abort,
    isTransitionActive: () => transitionActive
  };
})();
