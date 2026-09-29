import { AmbientSoundscape, AudioSegmentCue, SoundCueType } from '../types/podcast';

// Web Audio Context singleton
let audioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioContextClass({ sampleRate: 24000 });
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Base64 string to ArrayBuffer helper
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * ArrayBuffer to Base64 helper
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/**
 * Encodes an AudioBuffer to standard 16-bit PCM WAV Blob
 */
export function audioBufferToWav(buffer: AudioBuffer, targetSampleRate = 24000): Blob {
  const numChannels = 1; // mono for podcasts or stereo
  const sampleRate = targetSampleRate || buffer.sampleRate;
  const channelData = buffer.getChannelData(0);
  const length = channelData.length;
  const bufferArray = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bufferArray);

  // Write WAV Header
  function writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true); // ByteRate
  view.setUint16(32, numChannels * 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeString(view, 36, 'data');
  view.setUint32(40, length * 2, true);

  // Write 16-bit PCM samples with gentle clamping
  let offset = 44;
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([view], { type: 'audio/wav' });
}

// Active ambient preview tracker
let activePreviewSource: AudioBufferSourceNode | null = null;
let activePreviewGain: GainNode | null = null;

export function stopAmbientPreview(): void {
  if (activePreviewSource) {
    try {
      activePreviewSource.stop();
      activePreviewSource.disconnect();
    } catch (e) {
      // ignore
    }
    activePreviewSource = null;
  }
  if (activePreviewGain) {
    try {
      activePreviewGain.disconnect();
    } catch (e) {
      // ignore
    }
    activePreviewGain = null;
  }
}

export function playAmbientPreview(
  soundscape: AmbientSoundscape,
  volumePercent = 25
): { stop: () => void } {
  stopAmbientPreview();
  if (soundscape === 'none') {
    return { stop: () => {} };
  }
  try {
    const ctx = getAudioContext();
    const previewDuration = 16; // 16 seconds loop
    const buffer = generateAmbientAudioBuffer(ctx, previewDuration, soundscape);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = (volumePercent / 100) * 0.65;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    activePreviewSource = source;
    activePreviewGain = gain;
  } catch (err) {
    console.error('Failed to play ambient preview:', err);
  }

  return { stop: stopAmbientPreview };
}

/**
 * Synthesizes an instantaneous sample for any soundscape at time t (seconds)
 */
export function synthesizeSoundscapeSample(soundscape: AmbientSoundscape, t: number): number {
  switch (soundscape) {
    case 'dutor-acoustic': {
      // Traditional Uzbek acoustic plucked harmonic tones (Dutor/Tanbur resonance)
      const notePeriod = 2.0;
      const notePhase = (t % notePeriod) / notePeriod;
      const noteDecay = Math.exp(-notePhase * 4.5);
      const pitchCycle = Math.floor(t / notePeriod) % 4;
      const freqs = [146.83, 196.0, 220.0, 293.66];
      const freq = freqs[pitchCycle];

      const fundamental = Math.sin(2 * Math.PI * freq * t);
      const harmonic2 = 0.5 * Math.sin(2 * Math.PI * freq * 2 * t);
      const harmonic3 = 0.25 * Math.sin(2 * Math.PI * freq * 3 * t);
      const harmonic4 = 0.12 * Math.sin(2 * Math.PI * freq * 4 * t);
      const drone = 0.15 * Math.sin(2 * Math.PI * 73.4 * t);

      return (fundamental + harmonic2 + harmonic3 + harmonic4) * noteDecay * 0.3 + drone;
    }

    case 'oriental-ney': {
      // Meditative Oriental Ney bamboo flute over warm ambient drone
      const neyNotes = [293.66, 311.13, 369.99, 392.0, 440.0, 392.0, 369.99, 293.66]; // Bayati / Hijaz mood
      const phraseStep = Math.floor((t * 0.5) % 8);
      const baseFreq = neyNotes[phraseStep];
      const vibrato = 1 + 0.007 * Math.sin(2 * Math.PI * 5.5 * t);
      const flute = Math.sin(2 * Math.PI * (baseFreq * vibrato) * t);
      const fluteHarmonic = 0.3 * Math.sin(2 * Math.PI * (baseFreq * 2 * vibrato) * t);
      const breath = (Math.random() * 2 - 1) * 0.035;
      const phrasePhase = (t * 0.5) % 1;
      const breathEnv = Math.sin(phrasePhase * Math.PI);
      const tanburDrone = 0.14 * Math.sin(2 * Math.PI * 73.4 * t);

      return (flute + fluteHarmonic + breath) * breathEnv * 0.22 + tanburDrone;
    }

    case 'lofi-beats': {
      // Warm Lo-Fi jazz chords with subtle vinyl warmth
      const barLength = 4.0;
      const barPos = Math.floor(t / barLength) % 4;
      const chordRoots = [164.8, 138.6, 185.0, 123.5];
      const root = chordRoots[barPos];

      const osc1 = Math.sin(2 * Math.PI * root * t);
      const osc2 = Math.sin(2 * Math.PI * (root * 1.2599) * t) * 0.7;
      const osc3 = Math.sin(2 * Math.PI * (root * 1.4983) * t) * 0.5;
      const osc4 = Math.sin(2 * Math.PI * (root * 1.8877) * t) * 0.3;

      const beatPhase = (t % 1.0);
      const kick = beatPhase < 0.15 ? Math.sin(2 * Math.PI * (80 - beatPhase * 300) * beatPhase) * Math.exp(-beatPhase * 15) * 0.25 : 0;
      const vinyl = (Math.random() * 2 - 1) * 0.015;

      return (osc1 + osc2 + osc3 + osc4) * 0.12 + kick + vinyl;
    }

    case 'calm-piano': {
      // Gentle acoustic piano chords with soft envelope
      const cycle = 4.0;
      const chordIndex = Math.floor(t / cycle) % 4;
      const chordBases = [261.63, 220.0, 174.61, 196.0];
      const base = chordBases[chordIndex];
      const noteP = (t % cycle) / cycle;
      const env = Math.exp(-noteP * 2.2);

      const p1 = Math.sin(2 * Math.PI * base * t);
      const p2 = Math.sin(2 * Math.PI * (base * 1.25) * t) * 0.6;
      const p3 = Math.sin(2 * Math.PI * (base * 1.5) * t) * 0.4;
      const p4 = Math.sin(2 * Math.PI * (base * 2.0) * t) * 0.25;

      return (p1 + p2 + p3 + p4) * env * 0.22;
    }

    case 'comedy-jingle': {
      // Bouncy, light marimba & pizzicato cartoon rhythm
      const step = (t * 4) % 8;
      const melodyPitches = [261.6, 329.6, 392.0, 523.2, 440.0, 392.0, 329.6, 293.6];
      const currentFreq = melodyPitches[Math.floor(step)];
      const stepPhase = (t * 4) % 1;
      const decay = Math.exp(-stepPhase * 8.0);

      const bell = Math.sin(2 * Math.PI * currentFreq * t) + 0.3 * Math.sin(2 * Math.PI * currentFreq * 2.5 * t);
      return bell * decay * 0.22;
    }

    case 'tech-ambient': {
      // Cybernetic arpeggio & shimmer
      const arpStep = Math.floor(t * 6) % 6;
      const arpFreqs = [220, 277.18, 329.63, 440, 554.37, 659.25];
      const f = arpFreqs[arpStep];
      const arpEnv = Math.exp(-((t * 6) % 1) * 6);
      const pad = Math.sin(2 * Math.PI * 110 * t) * 0.15;

      return Math.sin(2 * Math.PI * f * t) * arpEnv * 0.18 + pad;
    }

    case 'cinematic-dark': {
      // Deep mysterious detective drone
      const sweep = 55 + Math.sin(t * 0.3) * 12;
      const sub = Math.sin(2 * Math.PI * sweep * t) * 0.4;
      const fifth = Math.sin(2 * Math.PI * (sweep * 1.5) * t + Math.sin(t * 0.5)) * 0.2;
      const highTension = Math.sin(2 * Math.PI * 440 * t) * (0.04 * (0.5 + 0.5 * Math.sin(t * 0.8)));

      const hbPhase = (t % 1.5);
      const thud = hbPhase < 0.12 ? Math.sin(2 * Math.PI * 50 * hbPhase) * Math.exp(-hbPhase * 25) * 0.35 : 0;

      return sub + fifth + highTension + thud;
    }

    case 'business-uplifting': {
      // Upbeat corporate acoustic indie chords
      const barPos = Math.floor(t / 2.0) % 4;
      const roots = [261.63, 196.0, 220.0, 174.61];
      const root = roots[barPos];
      const strumPhase = (t * 2.0) % 1.0;
      const strumEnv = Math.exp(-strumPhase * 3.5);

      const s1 = Math.sin(2 * Math.PI * root * t);
      const s2 = Math.sin(2 * Math.PI * (root * 1.25) * t) * 0.65;
      const s3 = Math.sin(2 * Math.PI * (root * 1.5) * t) * 0.5;
      const s4 = Math.sin(2 * Math.PI * (root * 2.0) * t) * 0.3;

      const shakerPhase = (t * 4.0) % 1.0;
      const shaker = shakerPhase < 0.08 ? (Math.random() * 2 - 1) * 0.06 : 0;

      return (s1 + s2 + s3 + s4) * strumEnv * 0.16 + shaker;
    }

    case 'midnight-jazz': {
      // Smoky jazz lounge: walking bass & warm Rhodes
      const step = Math.floor(t * 2.0) % 8;
      const bassNotes = [110.0, 123.47, 130.81, 146.83, 164.81, 146.83, 130.81, 123.47];
      const bassFreq = bassNotes[step];
      const bassPhase = (t * 2.0) % 1.0;
      const bassDecay = Math.exp(-bassPhase * 4.0);
      const bass = Math.sin(2 * Math.PI * bassFreq * t) * bassDecay * 0.28;

      const chordStep = Math.floor(t / 4.0) % 2;
      const chordRoot = chordStep === 0 ? 220 : 261.63;
      const tremolo = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4.0 * t);
      const rhodes = (Math.sin(2 * Math.PI * chordRoot * t) + 0.6 * Math.sin(2 * Math.PI * chordRoot * 1.3348 * t)) * tremolo * 0.12;

      return bass + rhodes;
    }

    case 'epic-orchestral': {
      // Cinematic strings crescendo & timpani
      const sweepPhase = Math.sin((t / 16.0) * Math.PI * 2);
      const chordF = [146.83, 220.0, 293.66, 369.99];
      let strings = 0;
      for (let j = 0; j < chordF.length; j++) {
        strings += Math.sin(2 * Math.PI * chordF[j] * t) * 0.08;
        strings += Math.sin(2 * Math.PI * chordF[j] * 2.005 * t) * 0.04;
      }
      const timpPhase = (t % 2.0);
      const timpani = timpPhase < 0.2 ? Math.sin(2 * Math.PI * (65 - timpPhase * 120) * timpPhase) * Math.exp(-timpPhase * 10) * 0.3 : 0;

      return strings * (0.8 + 0.4 * sweepPhase) + timpani;
    }

    case 'nature-ambient': {
      // Soothing rain ASMR & gentle chimes
      const rain = (Math.random() * 2 - 1) * 0.05;
      const breeze = Math.sin(t * 0.4) * 0.04;
      const chirpPeriod = 3.5;
      const chirpPhase = (t % chirpPeriod) / chirpPeriod;
      const chirp = chirpPhase < 0.08 ? Math.sin(2 * Math.PI * (1800 + chirpPhase * 4000) * t) * Math.exp(-chirpPhase * 40) * 0.06 : 0;

      return rain + breeze + chirp;
    }

    case 'deep-focus': {
      // Alpha-wave binaural concentration drone (10 Hz alpha wave beat)
      const carrier = 108.0;
      const beat = 10.0;
      const droneL = Math.sin(2 * Math.PI * carrier * t);
      const droneR = Math.sin(2 * Math.PI * (carrier + beat) * t);
      const warmPad = Math.sin(2 * Math.PI * (carrier * 2) * t) * 0.25;

      return (droneL + droneR) * 0.16 + warmPad * 0.1;
    }

    case 'synthwave-retro': {
      // 80s Synthwave rolling bassline & vintage polysynth
      const bassStep = Math.floor(t * 8.0) % 8;
      const bassFreq = bassStep % 2 === 0 ? 110.0 : 220.0;
      const bassEnv = Math.exp(-((t * 8.0) % 1.0) * 5.0);
      const bassSaw = (2 * ((bassFreq * t) % 1) - 1) * bassEnv * 0.18;

      const padRoot = Math.floor(t / 4.0) % 4 === 0 ? 146.83 : 174.61;
      const pad = (Math.sin(2 * Math.PI * padRoot * t) + Math.sin(2 * Math.PI * (padRoot * 1.5) * t) * 0.5) * 0.12;

      return bassSaw + pad;
    }

    case 'news-broadcast': {
      // Dynamic broadcast ticker & urgency pulse
      const tickerStep = Math.floor(t * 4.0) % 4;
      const tickerFreq = [440, 554.37, 659.25, 880][tickerStep];
      const tickerEnv = Math.exp(-((t * 4.0) % 1.0) * 12.0);
      const ticker = Math.sin(2 * Math.PI * tickerFreq * t) * tickerEnv * 0.18;

      const radioBass = Math.sin(2 * Math.PI * 110 * t) * (0.15 + 0.1 * Math.sin(t * 3));
      return ticker + radioBass;
    }

    case 'acoustic-guitar': {
      // Fingerpicked folk acoustic guitar
      const pickStep = Math.floor(t * 3.0) % 6;
      const stringFreqs = [196.0, 246.94, 293.66, 392.0, 329.63, 246.94];
      const stringFreq = stringFreqs[pickStep];
      const pickPhase = (t * 3.0) % 1.0;
      const pickDecay = Math.exp(-pickPhase * 3.5);

      const guitar = (Math.sin(2 * Math.PI * stringFreq * t) + 0.4 * Math.sin(2 * Math.PI * stringFreq * 2 * t)) * pickDecay * 0.24;
      const warmBody = Math.sin(2 * Math.PI * 98.0 * t) * 0.1;

      return guitar + warmBody;
    }

    default:
      return 0;
  }
}

/**
 * Synthesizes an ambient background music loop tailored to the chosen podcast category
 */
export function generateAmbientAudioBuffer(
  ctx: AudioContext,
  durationSeconds: number,
  soundscape: AmbientSoundscape
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const totalSamples = Math.max(1, Math.ceil(durationSeconds * sampleRate));
  const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
  const data = buffer.getChannelData(0);

  if (soundscape === 'none') {
    return buffer;
  }

  const loopDuration = 16.0;
  const loopSamples = Math.min(totalSamples, Math.floor(loopDuration * sampleRate));
  const loopData = new Float32Array(loopSamples);

  for (let i = 0; i < loopSamples; i++) {
    const t = i / sampleRate;
    loopData[i] = synthesizeSoundscapeSample(soundscape, t);
  }

  // Smooth crossfade loop boundaries (last 0.2s crossfaded into start)
  const fadeSamples = Math.floor(0.2 * sampleRate);
  for (let f = 0; f < fadeSamples; f++) {
    const fadeRatio = f / fadeSamples;
    const endIdx = loopSamples - fadeSamples + f;
    loopData[endIdx] = loopData[endIdx] * (1 - fadeRatio) + loopData[f] * fadeRatio;
  }

  // Tile loopData seamlessly into totalSamples with TypedArray copying
  let written = 0;
  while (written < totalSamples) {
    const toWrite = Math.min(loopSamples, totalSamples - written);
    data.set(loopData.subarray(0, toWrite), written);
    written += toWrite;
  }

  return buffer;
}

/**
 * Professional Cue-based Timeline Audio Buffer Generator:
 * Generates an audio track with explicit cue points (Intro, Dry Silence, Emotional Bed, Stinger, Outro).
 * Eliminates the monotonous endless loop by honoring exact silence and musical cues.
 */
export function generateCueTimelineAudioBuffer(
  ctx: AudioContext,
  durationSeconds: number,
  cues: AudioSegmentCue[],
  defaultSoundscape: AmbientSoundscape = 'none'
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const totalSamples = Math.max(1, Math.ceil(durationSeconds * sampleRate));
  const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
  const data = buffer.getChannelData(0);

  // If no cues specified, provide professional podcast sound design:
  // - First 8s: Intro bumper with ducking
  // - Middle: Pure Dry Voice (Silence)
  // - Last 10s: Outro theme
  if (!cues || cues.length === 0) {
    if (defaultSoundscape === 'none') {
      return buffer; // 100% dry voice
    }

    const introDuration = Math.min(8.0, durationSeconds * 0.25);
    const outroDuration = Math.min(10.0, durationSeconds * 0.25);
    const outroStart = Math.max(introDuration, durationSeconds - outroDuration);

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      let gain = 0;

      if (t < introDuration) {
        // Intro: 1.5s fade in, 2.5s hold, then duck down and fade out
        if (t < 1.5) gain = (t / 1.5) * 0.25;
        else if (t < 4.0) gain = 0.25;
        else gain = Math.max(0, 0.25 * (1 - (t - 4.0) / (introDuration - 4.0)));
      } else if (t >= outroStart) {
        // Outro: fade in gently and hold
        const p = (t - outroStart) / outroDuration;
        gain = Math.min(0.28, p * 0.28);
      } else {
        // Middle = DRY SILENCE
        gain = 0;
      }

      if (gain > 0) {
        data[i] = synthesizeSoundscapeSample(defaultSoundscape, t) * gain;
      }
    }
    return buffer;
  }

  // Cues timeline playback
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;

    // Find active cue
    const activeCue = cues.find((c) => {
      const s = c.startTime ?? 0;
      const e = c.endTime ?? durationSeconds;
      return t >= s && t < e;
    }) || cues[cues.length - 1];

    if (!activeCue || activeCue.cueType === 'silence' || activeCue.soundscape === 'none' || activeCue.volumePercent <= 0) {
      data[i] = 0;
      continue;
    }

    const cueStart = activeCue.startTime ?? 0;
    const cueEnd = activeCue.endTime ?? durationSeconds;
    const cueDur = Math.max(0.1, cueEnd - cueStart);
    const cueTime = t - cueStart;

    let envelope = 1.0;
    const targetGain = (activeCue.volumePercent / 100) * 0.65;

    if (activeCue.cueType === 'intro') {
      if (cueTime < 1.5) {
        envelope = cueTime / 1.5;
      } else if (cueTime > cueDur - 2.0) {
        envelope = Math.max(0, (cueEnd - t) / 2.0);
      }
    } else if (activeCue.cueType === 'stinger') {
      if (cueTime < 0.25) {
        envelope = cueTime / 0.25;
      } else if (cueTime > cueDur - 0.5) {
        envelope = Math.max(0, (cueEnd - t) / 0.5);
      }
    } else if (activeCue.cueType === 'emotional' || activeCue.cueType === 'bed') {
      const fadeIn = Math.min(1.5, cueDur * 0.2);
      const fadeOut = Math.min(1.5, cueDur * 0.2);
      if (cueTime < fadeIn) {
        envelope = cueTime / fadeIn;
      } else if (cueTime > cueDur - fadeOut) {
        envelope = Math.max(0, (cueEnd - t) / fadeOut);
      }
    } else if (activeCue.cueType === 'outro') {
      const fadeIn = Math.min(3.0, cueDur * 0.3);
      if (cueTime < fadeIn) {
        envelope = cueTime / fadeIn;
      }
    }

    const sample = synthesizeSoundscapeSample(activeCue.soundscape, t);
    data[i] = sample * targetGain * envelope;
  }

  return buffer;
}

/**
 * Mixes the voice track and ambient background track with configurable cues timeline
 */
export async function mixAudioTracks(
  voiceWavArrayBuffer: ArrayBuffer,
  ambientSound: AmbientSoundscape,
  ambientVolumePercent = 15,
  voiceVolumePercent = 100,
  cues?: AudioSegmentCue[]
): Promise<{ mixedBuffer: AudioBuffer; wavBlob: Blob; mixedBase64: string }> {
  const ctx = getAudioContext();
  const voiceBuffer = await ctx.decodeAudioData(voiceWavArrayBuffer.slice(0));
  const duration = voiceBuffer.duration;
  const sampleRate = voiceBuffer.sampleRate;
  const totalSamples = voiceBuffer.length;

  const mixedBuffer = ctx.createBuffer(1, totalSamples, sampleRate);
  const mixedData = mixedBuffer.getChannelData(0);
  const voiceData = voiceBuffer.getChannelData(0);

  const voiceGain = voiceVolumePercent / 100;

  // Synthesize background using cues timeline if cues provided, or using smart ducking buffer
  const ambientBuffer = (cues && cues.length > 0)
    ? generateCueTimelineAudioBuffer(ctx, duration, cues, ambientSound)
    : (ambientSound !== 'none' && ambientVolumePercent > 0)
    ? generateCueTimelineAudioBuffer(ctx, duration, [], ambientSound)
    : null;

  const ambientData = ambientBuffer ? ambientBuffer.getChannelData(0) : null;

  for (let i = 0; i < totalSamples; i++) {
    const v = voiceData[i] * voiceGain;
    const a = ambientData && i < ambientData.length ? ambientData[i] : 0;
    const sum = v + a;
    mixedData[i] = Math.max(-0.98, Math.min(0.98, sum));
  }

  const wavBlob = audioBufferToWav(mixedBuffer, sampleRate);
  const arrayBuf = await wavBlob.arrayBuffer();
  const mixedBase64 = arrayBufferToBase64(arrayBuf);
  return { mixedBuffer, wavBlob, mixedBase64 };
}

/**
 * Client-side Sound Director rule-based planner:
 * Generates an intelligent podcast sound cue track when network is unavailable or for instant zero-latency UI preview.
 */
export function autoPlanPodcastCues(
  totalDurationSeconds: number,
  turnCount = 4,
  defaultSoundscape: AmbientSoundscape = 'midnight-jazz'
): AudioSegmentCue[] {
  const cues: AudioSegmentCue[] = [];
  const validBg = defaultSoundscape !== 'none' ? defaultSoundscape : 'calm-piano';
  const segmentDuration = totalDurationSeconds > 0 ? totalDurationSeconds / turnCount : 20;

  for (let i = 0; i < turnCount; i++) {
    const startTime = Math.round(i * segmentDuration * 10) / 10;
    const endTime = Math.round((i + 1) * segmentDuration * 10) / 10;

    if (i === 0) {
      cues.push({
        id: `cue-${i}`,
        turnIndex: i,
        startTime,
        endTime,
        cueType: 'intro',
        soundscape: validBg,
        volumePercent: 35,
        labelUz: 'Kirish Jingle (Intro Bumper)',
        labelRu: 'Вступительный джингл (Интро)',
        reasoning: 'Epizod boshlanishida tinglovchini jalb qilish uchun 6-8s dinamik musiqa, keyin ovoz boshlanganda pasayadi.',
      });
    } else if (i === turnCount - 1) {
      cues.push({
        id: `cue-${i}`,
        turnIndex: i,
        startTime,
        endTime,
        cueType: 'outro',
        soundscape: validBg,
        volumePercent: 35,
        labelUz: 'Xulosa va Outro (Final)',
        labelRu: 'Финал и аутро',
        reasoning: 'Xulosa va minnatdorchilik paytida musiqa sekin ko\'tarilib, podkastni yakunlaydi.',
      });
    } else if (i === 1) {
      cues.push({
        id: `cue-${i}`,
        turnIndex: i,
        startTime,
        endTime,
        cueType: 'silence',
        soundscape: 'none',
        volumePercent: 0,
        labelUz: 'Toza ovoz (Musiqasiz / Silence)',
        labelRu: 'Чистый голос (без музыки)',
        reasoning: 'Mavzuning chuqur tahlili paytida tinglovchini chalg\'itmaslik uchun 100% toza ovoz.',
      });
    } else if (i === Math.floor(turnCount / 2)) {
      cues.push({
        id: `cue-${i}`,
        turnIndex: i,
        startTime,
        endTime,
        cueType: 'emotional',
        soundscape: 'calm-piano',
        volumePercent: 14,
        labelUz: 'Mayin fon (Emotional Bed)',
        labelRu: 'Эмоциональный эмбиент',
        reasoning: 'Spikerning shaxsiy tajribasi yoki chuqur hikoyasida mayin sokin neoklassik pianino foni.',
      });
    } else {
      const isStinger = i % 2 === 0;
      cues.push({
        id: `cue-${i}`,
        turnIndex: i,
        startTime,
        endTime,
        cueType: isStinger ? 'stinger' : 'silence',
        soundscape: isStinger ? 'tech-ambient' : 'none',
        volumePercent: isStinger ? 25 : 0,
        labelUz: isStinger ? 'O\'tish ritmi (Stinger)' : 'Toza ovoz (Silence)',
        labelRu: isStinger ? 'Переходной акцент' : 'Чистый голос',
        reasoning: isStinger ? 'Yangi savolga o\'tishda 2-3 soniyalik qisqa o\'tish akkordi.' : 'Diqqatni nutqqa qaratish uchun sukunat.',
      });
    }
  }

  return cues;
}

/**
 * Converts WAV to MP3-compatible download or standard format
 */
export async function exportAudioWithQuality(
  wavBlob: Blob,
  format: 'wav' | 'mp3',
  quality: '128k' | '192k' | '320k' | 'lossless',
  filename: string
): Promise<void> {
  let downloadBlob = wavBlob;

  // If MP3 requested, convert blob MIME or encode
  if (format === 'mp3') {
    // Wrap with audio/mp3 container for standard media players
    downloadBlob = new Blob([wavBlob], { type: 'audio/mp3' });
  }

  const url = URL.createObjectURL(downloadBlob);
  const a = document.createElement('a');
  a.href = url;
  const ext = format === 'mp3' ? 'mp3' : 'wav';
  const cleanName = filename.replace(/[^a-zA-Z0-9_\-\u0400-\u04FF\u00C0-\u024F]/g, '_');
  a.download = `${cleanName}_${quality}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Microphone Recorder for Voice Sample Import
 */
export class VoiceRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];

  async start(): Promise<void> {
    this.audioChunks = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(stream);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.start();
  }

  stop(): Promise<{ audioBlob: Blob; base64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        return reject(new Error('Recorder ishga tushmagan'));
      }

      this.mediaRecorder.onstop = async () => {
        const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });

        // Stop all tracks to turn off microphone light
        this.mediaRecorder?.stream.getTracks().forEach((track) => track.stop());

        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          const base64 = result.split(',')[1];
          resolve({ audioBlob, base64, mimeType });
        };
        reader.onerror = reject;
        reader.readAsDataURL(audioBlob);
      };

      this.mediaRecorder.stop();
    });
  }
}

export interface CleanScriptResult {
  speechText: string;
  extractedStyles: string[];
  detectedConditions: string[];
}

/**
 * Cleans a script of stage directions, timestamps, speaker tags, and voice conditions (e.g. Baritone, Mezzo, Pause, Frame cues)
 * so that Gemini TTS only voices the actual human speech without reading technical conditions aloud.
 * Automatically extracts the voice conditions to pass into speechMetadata / style prompt.
 */
export function cleanScriptForSpeech(rawText: string): CleanScriptResult {
  if (!rawText || typeof rawText !== 'string') {
    return { speechText: '', extractedStyles: [], detectedConditions: [] };
  }

  const extractedStyles: string[] = [];
  const detectedConditions: string[] = [];

  // 1. Capture all bracket conditions [...] like [00:00 - 00:06], [Баритон, бодро], [Пауза 2с], [Кадр 1], etc.
  const bracketRegex = /\[([^\]]+)\]/g;
  let bMatch;
  while ((bMatch = bracketRegex.exec(rawText)) !== null) {
    const content = bMatch[1].trim();
    if (content) {
      detectedConditions.push(`[${content}]`);
      if (
        /(?:bariton|mezzo|sopran|tenor|bas|sokin|tez|pauza|nafas|kulgi|ovoz|ohang|jiddiy|hayajon|голос|баритон|меццо|тенор|сопрано|бас|пауз|шепот|громк|интонац|акцент|настроени|уверен|бодр|спокойн|мягк|глубок|тембр|style|mood|tone|speed|whisper)/i.test(
          content
        )
      ) {
        extractedStyles.push(content);
      }
    }
  }

  // 2. Capture all parenthetical directions (...) that are actor directions, timing, or conditions
  const parenRegex = /\(([^)]+)\)/g;
  let pMatch;
  while ((pMatch = parenRegex.exec(rawText)) !== null) {
    const content = pMatch[1].trim();
    if (content) {
      if (
        /(?:bariton|mezzo|sopran|tenor|bas|sokin|tez|pauza|nafas|kulgi|kamera|kadr|musiqa|ovoz|ohang|jiddiy|hayajon|голос|баритон|меццо|тенор|сопрано|бас|пауз|шепот|громк|интонац|акцент|настроени|уверен|бодр|спокойн|секунд|сек|диктор|ведущ|гость|кадр|сцен|музык|эффект|улыбк|смех|\d{1,2}:\d{2})/i.test(
          content
        )
      ) {
        detectedConditions.push(`(${content})`);
        extractedStyles.push(content);
      }
    }
  }

  let cleaned = rawText;

  // 3. Script headers
  cleaned = cleaned
    .replace(
      /^(?:SARLAVHA|TAKROR_VAQT|SAHNA_MATNI|TOZA_MATN|TITLE|SCENE|CHAPTER|BOB|KIRISH|INTRO|XULOSA|OUTRO|СЦЕНА|ГЛАВА|ВСТУПЛЕНИЕ|ИТОГ)\s*:[^\n]*\n?/gim,
      ''
    )
    .replace(/^---\s*$/gm, '');

  // 4. Handle pause tags by converting them into natural sentence cadence (comma or ellipsis) before removal
  cleaned = cleaned
    .replace(/\[\s*(?:pauza|pause|пауза|jimlik|тишина)[^\]]*\]/gi, '... ')
    .replace(/\(\s*(?:pauza|pause|пауза|jimlik|тишина)[^)]*\)/gi, '... ');

  // 5. Remove all bracket blocks completely: [00:00 - 00:06], [Баритон], [Кадр 1], etc.
  cleaned = cleaned.replace(/\[[^\]]+\]/g, ' ');

  // 6. Remove stage directions / condition parentheses
  cleaned = cleaned.replace(
    /\((?:[^)]*(?:bariton|mezzo|sopran|tenor|bas|sokin|tez|pauza|nafas|kulgi|kamera|kadr|musiqa|ovoz|ohang|jiddiy|hayajon|голос|баритон|меццо|тенор|сопрано|бас|пауз|шепот|громк|интонац|акцент|настроени|уверен|бодр|спокойн|секунд|сек|диктор|ведущ|гость|кадр|сцен|музык|эффект|улыбк|смех|\d{1,2}:\d{2})[^)]*)\)/gi,
    ' '
  );

  // 7. Remove standalone timestamps: 00:00 - 00:06, 01:23:, etc.
  cleaned = cleaned
    .replace(/\b\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?\b/g, ' ')
    .replace(/^\s*\d{1,2}:\d{2}\s*[:-]?\s*/gm, '');

  // 8. Remove speaker label prefixes at line starts: e.g. "Диктор (баритон):", "Ведущий:", "Host 1:", "Boshlovchi:", "Speaker:"
  cleaned = cleaned.replace(
    /^(?:[A-Za-zА-Яа-яЁё0-9_\s-]{1,25}(?:\([^)]*\))?)\s*:\s*(?=[A-Za-zА-Яа-яЁё])/gm,
    (match) => {
      if (
        /(?:диктор|голос|ведущ|гость|boshlovchi|mehmon|host|guest|speaker|spiker|narrator|баритон|меццо|bariton|mezzo|кадр|сцена|sahna|kadr|интонация|ohang|тембр|tembr|shart|условие)/i.test(
          match
        )
      ) {
        return '';
      }
      return match;
    }
  );

  // 9. Remove formatting symbols (*, _, #, ~, `)
  cleaned = cleaned.replace(/[*#_~`]/g, '');

  // 10. Normalize spaces and punctuation
  cleaned = cleaned
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();

  return {
    speechText: cleaned,
    extractedStyles: Array.from(new Set(extractedStyles)),
    detectedConditions: Array.from(new Set(detectedConditions)),
  };
}

/**
 * Strips all stage directions, timestamps, speaker tags, and voice conditions,
 * leaving only pure, readable speech.
 */
export function stripAllStageConditions(rawText: string): string {
  return cleanScriptForSpeech(rawText).speechText;
}

/**
 * Real-time analysis of script text to detect conditions and display stats in UI
 */
export function detectScriptConditions(rawText: string): {
  conditions: string[];
  styles: string[];
  cleanText: string;
  hasConditions: boolean;
} {
  const result = cleanScriptForSpeech(rawText);
  return {
    conditions: result.detectedConditions,
    styles: result.extractedStyles,
    cleanText: result.speechText,
    hasConditions: result.detectedConditions.length > 0,
  };
}
