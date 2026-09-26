export type BaseVoiceModel = 'Charon' | 'Puck' | 'Kore' | 'Fenrir' | 'Zephyr' | 'Aoede';

export type VoiceType = 'replicated' | 'prompted' | 'prebuilt';

export interface VoiceProfile {
  id: string;
  name: string;
  baseVoice: BaseVoiceModel;
  voiceId?: string; // Google AI Studio Voice ID (e.g. "voice_17raj9ewke3g")
  voiceKey?: string; // Client-managed voice key
  voiceType?: VoiceType;
  model?: string; // e.g. "models/gemini-3.8-flash-tts"
  expireTime?: string;
  timbre: string;
  tempo: string;
  pitchLevel: 'Past (Bas)' | 'O\'rta (Bariton)' | 'Baland (Tenor/Soprano)';
  style: string;
  customPersonaPrompt: string;
  isUserCustomVoice: boolean;
  isReplicatedVoice?: boolean;
  sampleAudioBase64?: string;
  consentAudioBase64?: string;
  sampleNotes?: string;
}

// ----------------------------------------------------
// 1. Voiceover & Dubbing Types
// ----------------------------------------------------
export type VoiceoverFormat = 'reels_shorts' | 'commercial_ad' | 'audiobook' | 'video_dubbing';

export interface VoiceoverProject {
  id: string;
  title: string;
  format: VoiceoverFormat;
  targetDuration: string; // '15s' | '30s' | '60s' | '3min'
  script: string;
  voiceId: string;
  voiceName: string;
  stylePreset: 'cinematic' | 'energetic_sales' | 'storytelling' | 'documentary' | 'whisper';
  audioBase64?: string;
  srtSubtitles?: string;
  vttSubtitles?: string;
  durationSeconds?: number;
  createdAt: string;
}

// ----------------------------------------------------
// 2. Multi-Speaker & Interview Studio Types
// ----------------------------------------------------
export interface DialogueTurn {
  id: string;
  speakerId: 'HOST_1' | 'HOST_2';
  speakerName: string;
  text: string;
  emotion?: 'excited' | 'thoughtful' | 'skeptical' | 'humorous' | 'neutral';
  audioBase64?: string;
  durationSeconds?: number;
  startTime?: number;
  endTime?: number;
}

export interface MultiSpeakerProject {
  id: string;
  title: string;
  topic: string;
  category: string;
  host1: {
    name: string;
    role: string;
    voiceProfile: VoiceProfile;
  };
  host2: {
    name: string;
    role: string;
    voiceProfile: VoiceProfile;
  };
  turns: DialogueTurn[];
  masterAudioBase64?: string;
  totalDurationSeconds?: number;
  createdAt: string;
}

// ----------------------------------------------------
// 3. Live Voice AI Agent Types
// ----------------------------------------------------
export type AgentPersonaType = 
  | 'live_cohost'          // Podkast Hamkor-boshlovchisi
  | 'caller_in_air'        // Efirga qo'ng'iroq qiluvchi muxlis
  | 'exclusive_mentor'     // Eksklyuziv ekspert / Mentor
  | 'business_consultant'; // Biznes va audio-marketing bo'yicha assistent

export interface AgentPersonaConfig {
  id: AgentPersonaType;
  titleUz: string;
  titleRu: string;
  descriptionUz: string;
  promptSystem: string;
  suggestedVoice: string; // e.g. "Charon", "Puck", or replicated voice
  suggestedAvatar: string;
  greetingUz: string;
}

export interface AgentCallMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  audioBase64?: string;
  timestamp: string;
}

export interface AgentCallSession {
  id: string;
  persona: AgentPersonaType;
  status: 'idle' | 'calling' | 'connected' | 'ended';
  topic: string;
  messages: AgentCallMessage[];
  durationSeconds: number;
}

// ----------------------------------------------------
// 4. Exclusive Hub & Cover Art Types
// ----------------------------------------------------
export interface ExclusiveEpisode {
  id: string;
  title: string;
  tier: 'free' | 'vip' | 'masterclass';
  description: string;
  coverSvg?: string;
  audioBase64?: string;
  durationSeconds?: number;
  tags: string[];
  createdAt: string;
}

export interface PodcastTopic {
  id: string;
  titleUz: string;
  titleRu: string;
  descriptionUz: string;
  sampleScriptUz: string;
}

export interface PodcastCategory {
  id: string;
  nameUz: string;
  nameRu: string;
  taglineUz: string;
  iconName: string;
  badgeUz: string;
  colorTheme: {
    bg: string;
    text: string;
    border: string;
    accent: string;
  };
  topics: PodcastTopic[];
  suggestedVoice: BaseVoiceModel;
  suggestedTimbre: string;
  suggestedTempo: string;
  suggestedStyle: string;
  ambientSound: AmbientSoundscape;
}

export type AmbientSoundscape = 
  | 'none'
  | 'dutor-acoustic'
  | 'lofi-beats'
  | 'comedy-jingle'
  | 'cinematic-dark'
  | 'calm-piano'
  | 'tech-ambient';

export interface GeneratedPodcast {
  id: string;
  title: string;
  category: string;
  script: string;
  voiceName: string;
  baseVoice: string;
  voiceId?: string;
  timbre: string;
  tempo: string;
  style: string;
  ambientSound: AmbientSoundscape;
  ambientVolume: number; // 0 to 100
  durationSeconds: number;
  rawAudioWavBase64: string;
  mixedAudioWavBase64?: string;
  createdAt: string;
}

