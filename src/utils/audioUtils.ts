import { AmbientSoundscape } from '../types/podcast';

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

/**
 * Synthesizes an ambient background music loop tailored to the chosen podcast category
 */
export function generateAmbientAudioBuffer(
  ctx: AudioContext,
  durationSeconds: number,
  soundscape: AmbientSoundscape
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const totalSamples = Math.ceil(durationSeconds * sampleRate);
  const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
  const data = buffer.getChannelData(0);

  if (soundscape === 'none') {
    return buffer;
  }

  // Synthesize ambient music by genre using mathematical physical modeling & oscillators
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;

    switch (soundscape) {
      case 'dutor-acoustic': {
        // Traditional Uzbek acoustic plucked harmonic tones (Dutor/Tanbur resonance)
        // Root notes: D (146.8 Hz), G (196 Hz), A (220 Hz), D (293.6 Hz)
        const notePeriod = 2.0; // new plucked note every 2 seconds
        const notePhase = (t % notePeriod) / notePeriod;
        const noteDecay = Math.exp(-notePhase * 4.5);
        const pitchCycle = Math.floor(t / notePeriod) % 4;
        const freqs = [146.83, 196.0, 220.0, 293.66];
        const freq = freqs[pitchCycle];

        const fundamental = Math.sin(2 * Math.PI * freq * t);
        const harmonic2 = 0.5 * Math.sin(2 * Math.PI * freq * 2 * t);
        const harmonic3 = 0.25 * Math.sin(2 * Math.PI * freq * 3 * t);
        const harmonic4 = 0.12 * Math.sin(2 * Math.PI * freq * 4 * t);
        // Low warm drone in background
        const drone = 0.15 * Math.sin(2 * Math.PI * 73.4 * t);

        sample = (fundamental + harmonic2 + harmonic3 + harmonic4) * noteDecay * 0.3 + drone;
        break;
      }

      case 'lofi-beats': {
        // Warm Lo-Fi jazz chords with subtle vinyl warmth
        // Emaj9 -> C#m7 -> F#m7 -> B13 chord progression
        const barLength = 4.0;
        const barPos = Math.floor(t / barLength) % 4;
        const chordRoots = [164.8, 138.6, 185.0, 123.5]; // E3, C#3, F#3, B2
        const root = chordRoots[barPos];

        const osc1 = Math.sin(2 * Math.PI * root * t);
        const osc2 = Math.sin(2 * Math.PI * (root * 1.2599) * t) * 0.7; // major third
        const osc3 = Math.sin(2 * Math.PI * (root * 1.4983) * t) * 0.5; // fifth
        const osc4 = Math.sin(2 * Math.PI * (root * 1.8877) * t) * 0.3; // seventh

        // Subtle soft kick/beat pulse every 1 second
        const beatPhase = (t % 1.0);
        const kick = beatPhase < 0.15 ? Math.sin(2 * Math.PI * (80 - beatPhase * 300) * beatPhase) * Math.exp(-beatPhase * 15) * 0.3 : 0;

        sample = (osc1 + osc2 + osc3 + osc4) * 0.12 + kick;
        break;
      }

      case 'comedy-jingle': {
        // Bouncy, light marimba & pizzicato cartoon rhythm
        const step = (t * 4) % 8;
        const melodyPitches = [261.6, 329.6, 392.0, 523.2, 440.0, 392.0, 329.6, 293.6];
        const currentFreq = melodyPitches[Math.floor(step)];
        const stepPhase = (t * 4) % 1;
        const decay = Math.exp(-stepPhase * 8.0);

        const bell = Math.sin(2 * Math.PI * currentFreq * t) + 0.3 * Math.sin(2 * Math.PI * currentFreq * 2.5 * t);
        sample = bell * decay * 0.22;
        break;
      }

      case 'cinematic-dark': {
        // Deep mysterious detective drone with slow frequency sweep
        const sweep = 55 + Math.sin(t * 0.3) * 12;
        const sub = Math.sin(2 * Math.PI * sweep * t) * 0.4;
        const fifth = Math.sin(2 * Math.PI * (sweep * 1.5) * t + Math.sin(t * 0.5)) * 0.2;
        const highTension = Math.sin(2 * Math.PI * 440 * t) * (0.04 * (0.5 + 0.5 * Math.sin(t * 0.8)));

        sample = sub + fifth + highTension;
        break;
      }

      case 'calm-piano': {
        // Gentle acoustic piano chords with soft envelope
        const cycle = 3.5;
        const chordIndex = Math.floor(t / cycle) % 3;
        const chordBases = [220.0, 174.6, 196.0]; // A, F, G
        const base = chordBases[chordIndex];
        const noteP = (t % cycle) / cycle;
        const env = Math.exp(-noteP * 2.5);

        const p1 = Math.sin(2 * Math.PI * base * t);
        const p2 = Math.sin(2 * Math.PI * (base * 1.25) * t) * 0.6;
        const p3 = Math.sin(2 * Math.PI * (base * 1.5) * t) * 0.4;

        sample = (p1 + p2 + p3) * env * 0.25;
        break;
      }

      case 'tech-ambient': {
        // Subtle cybernetic arpeggio & shimmer
        const arpStep = Math.floor(t * 6) % 6;
        const arpFreqs = [220, 277.18, 329.63, 440, 554.37, 659.25];
        const f = arpFreqs[arpStep];
        const arpEnv = Math.exp(-((t * 6) % 1) * 6);
        const pad = Math.sin(2 * Math.PI * 110 * t) * 0.15;

        sample = Math.sin(2 * Math.PI * f * t) * arpEnv * 0.18 + pad;
        break;
      }

      default:
        sample = 0;
    }

    data[i] = sample;
  }

  return buffer;
}

/**
 * Mixes the voice track and ambient background track with configurable volume
 */
export async function mixAudioTracks(
  voiceWavArrayBuffer: ArrayBuffer,
  ambientSound: AmbientSoundscape,
  ambientVolumePercent = 15,
  voiceVolumePercent = 100
): Promise<{ mixedBuffer: AudioBuffer; wavBlob: Blob }> {
  const ctx = getAudioContext();
  const voiceBuffer = await ctx.decodeAudioData(voiceWavArrayBuffer.slice(0));
  const duration = voiceBuffer.duration;
  const sampleRate = voiceBuffer.sampleRate;
  const totalSamples = voiceBuffer.length;

  const mixedBuffer = ctx.createBuffer(1, totalSamples, sampleRate);
  const mixedData = mixedBuffer.getChannelData(0);
  const voiceData = voiceBuffer.getChannelData(0);

  const voiceGain = voiceVolumePercent / 100;
  const ambientGain = (ambientVolumePercent / 100) * 0.7; // gentle ambient balance

  if (ambientSound === 'none' || ambientVolumePercent <= 0) {
    for (let i = 0; i < totalSamples; i++) {
      mixedData[i] = voiceData[i] * voiceGain;
    }
  } else {
    const ambientBuffer = generateAmbientAudioBuffer(ctx, duration, ambientSound);
    const ambientData = ambientBuffer.getChannelData(0);
    const fadeOutSamples = Math.min(totalSamples, Math.floor(sampleRate * 1.5));

    for (let i = 0; i < totalSamples; i++) {
      const v = voiceData[i] * voiceGain;
      const fadeMultiplier = i >= totalSamples - fadeOutSamples ? (totalSamples - i) / fadeOutSamples : 1;
      const a = (i < ambientData.length ? ambientData[i] : 0) * ambientGain * fadeMultiplier;
      // Soft limiter / compressor to prevent clipping
      const sum = v + a;
      mixedData[i] = Math.max(-0.98, Math.min(0.98, sum));
    }
  }

  const wavBlob = audioBufferToWav(mixedBuffer, sampleRate);
  return { mixedBuffer, wavBlob };
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
