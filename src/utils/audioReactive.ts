/**
 * Audio Reactive Web Audio API Service
 * Shared AnalyserNode (fftSize 512, smoothingTimeConstant 0.78)
 * Connects <audio> elements via MediaElementSource (stored in WeakMap to avoid re-creation errors).
 */

let sharedCtx: AudioContext | null = null;
let sharedAnalyser: AnalyserNode | null = null;
const sourceNodeMap = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
let activeAudioElement: HTMLMediaElement | null = null;
let isAudioPlaying = false;
let freqArray: Uint8Array<ArrayBuffer> | null = null;

export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedCtx) {
    const AudioCtxClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioCtxClass) {
      try {
        sharedCtx = new AudioCtxClass();
      } catch (e) {
        console.warn('AudioContext creation failed:', e);
      }
    }
  }
  return sharedCtx;
}

export function getSharedAnalyser(): AnalyserNode | null {
  const ctx = getSharedAudioContext();
  if (!ctx) return null;

  if (!sharedAnalyser) {
    try {
      sharedAnalyser = ctx.createAnalyser();
      sharedAnalyser.fftSize = 512;
      sharedAnalyser.smoothingTimeConstant = 0.78;
      freqArray = new Uint8Array(sharedAnalyser.frequencyBinCount);
    } catch (e) {
      console.warn('AnalyserNode creation failed:', e);
    }
  }
  return sharedAnalyser;
}

/**
 * Connects an HTMLAudioElement / HTMLMediaElement to the shared analyser.
 * Re-uses MediaElementAudioSourceNode via WeakMap.
 */
export function connectAudioElement(audioEl: HTMLMediaElement | null): void {
  if (!audioEl) return;

  try {
    const ctx = getSharedAudioContext();
    const analyser = getSharedAnalyser();
    if (!ctx || !analyser) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    if (!sourceNodeMap.has(audioEl)) {
      const source = ctx.createMediaElementSource(audioEl);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      sourceNodeMap.set(audioEl, source);
    }

    activeAudioElement = audioEl;

    // Track playback state
    if (!audioEl.paused && !audioEl.ended) {
      isAudioPlaying = true;
    }

    audioEl.addEventListener('play', () => {
      isAudioPlaying = true;
      activeAudioElement = audioEl;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    });

    audioEl.addEventListener('pause', () => {
      if (activeAudioElement === audioEl) {
        isAudioPlaying = false;
      }
    });

    audioEl.addEventListener('ended', () => {
      if (activeAudioElement === audioEl) {
        isAudioPlaying = false;
      }
    });
  } catch (err) {
    console.warn('Could not connect media element source:', err);
  }
}

export interface AudioReactiveSnapshot {
  freqData: Uint8Array;
  avgEnergy: number;
  isPlaying: boolean;
}

const fallbackFreq = new Uint8Array(256);

/**
 * Reads current frequency data & energy.
 * Safe fallback to idle if blocked or suspended.
 */
export function getAudioReactiveSnapshot(): AudioReactiveSnapshot {
  const analyser = getSharedAnalyser();
  const ctx = getSharedAudioContext();

  if (!analyser || !ctx || ctx.state !== 'running' || !freqArray) {
    return {
      freqData: fallbackFreq,
      avgEnergy: 0,
      isPlaying: false,
    };
  }

  try {
    analyser.getByteFrequencyData(freqArray);

    let sum = 0;
    const barCount = 48;
    for (let i = 0; i < barCount; i++) {
      sum += freqArray[2 + i];
    }
    const avgEnergy = Math.min(1, Math.max(0, sum / (barCount * 255)));

    // Verify whether audio is actually playing and producing signal
    const isPlaying = Boolean(
      isAudioPlaying && (avgEnergy > 0.01 || (activeAudioElement && !activeAudioElement.paused))
    );

    return {
      freqData: freqArray,
      avgEnergy,
      isPlaying,
    };
  } catch {
    return {
      freqData: fallbackFreq,
      avgEnergy: 0,
      isPlaying: false,
    };
  }
}

/**
 * Returns average energy (0.0 to 1.0) to drive hero wave or other components.
 */
export function getSharedAudioEnergy(): number {
  const snapshot = getAudioReactiveSnapshot();
  return snapshot.isPlaying ? snapshot.avgEnergy : 0;
}
