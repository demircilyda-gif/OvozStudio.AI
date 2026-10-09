export type BaseVoiceModel = 'Charon' | 'Puck' | 'Kore' | 'Fenrir' | 'Zephyr' | 'Aoede';

export type VoiceType = 'replicated' | 'prompted' | 'prebuilt';

export interface VoiceProfile {
  id: string;
  name: string;
  baseVoice: BaseVoiceModel;
  gender?: 'female' | 'male';
  voiceId?: string; // OvozStudio Voice ID (e.g. "voice_17raj9ewke3g")
  voiceKey?: string; // Client-managed voice key
  voiceType?: VoiceType;
  model?: string; // e.g. "ovozstudio-neural-hd"
  expireTime?: string;
  timbre: string;
  tempo: string;
  pitchLevel: 'Past (Bas)' | 'O\'rta (Bariton)' | 'Baland (Tenor/Soprano)';
  style: string;
  customPersonaPrompt: string;
  isUserCustomVoice: boolean;
  isReplicatedVoice?: boolean;
  sampleAudioBase64?: string;
  sampleAudioUrl?: string;
  consentAudioBase64?: string;
  sampleNotes?: string;
}

// ----------------------------------------------------
// 1. Voiceover & Dubbing Types
// ----------------------------------------------------
export type VoiceoverFormat = 'reels_shorts' | 'commercial_ad' | 'audiobook' | 'video_dubbing';

export type VideoSourceMode = 'file_upload' | 'video_url' | 'script_text';

export interface DubbingTimelineSegment {
  id?: string;
  start: string; // e.g. "00:00"
  end: string;   // e.g. "00:05"
  speaker?: string; // e.g. "Speaker 1"
  originalText: string;
  uzbekText: string;
}

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

export type SoundCueType = 'intro' | 'bed' | 'emotional' | 'stinger' | 'silence' | 'outro';

export interface TurnMusicCue {
  enabled: boolean;
  cueType: SoundCueType;
  soundscape: AmbientSoundscape;
  volumePercent: number; // 0 for silence, 10-25 for bed, 35-50 for intro/stinger/outro
  labelUz?: string;
  labelRu?: string;
  reasoning?: string;
}

export interface AudioSegmentCue {
  id: string;
  turnIndex?: number;
  startTime?: number; // seconds
  endTime?: number;   // seconds
  cueType: SoundCueType;
  soundscape: AmbientSoundscape;
  volumePercent: number;
  labelUz: string;
  labelRu: string;
  reasoning?: string;
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
  musicCue?: TurnMusicCue;
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
  cues?: AudioSegmentCue[];
  createdAt: string;
}

// ----------------------------------------------------
// 3. Live Voice AI Agent Types
// ----------------------------------------------------
export type AgentPersonaType = 
  | 'tashkent_real_estate' // Toshkent Ko'chmas Mulk Eksperti (Rieltor)
  | 'live_cohost'          // Podkast Hamkor-boshlovchisi
  | 'caller_in_air'        // Efirga qo'ng'iroq qiluvchi muxlis
  | 'exclusive_mentor'     // Eksklyuziv ekspert / Mentor
  | 'business_consultant'; // Biznes va audio-marketing bo'yicha assistent

export interface MatchedProperty {
  id: string;
  title: string;
  district: string;
  price: string;
  area: string;
  rooms: string;
  roi?: string;
  badge?: string;
  developer?: string;
}

export interface RealEstateLeadCard {
  clientIntent: 'buy' | 'rent' | 'sell' | 'invest';
  district?: string;
  budgetRange?: string;
  propertyType?: 'novostroyka' | 'vtorichka' | 'commercial' | 'cottage';
  roomsCount?: string;
  urgency?: 'immediate' | 'this_month' | 'exploring';
  paymentMethod?: 'cash' | 'mortgage' | 'installments';
  leadTemperature?: 'hot' | 'warm' | 'cold';
  keyNotes?: string;
  nextStep?: string;
  offTopicAttempts?: number;
  clarificationsCount?: number;
  callSummary?: string;
  matchedProperties?: MatchedProperty[];
}

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
  suggestedVoice: string;
  suggestedTimbre: string;
  suggestedTempo: string;
  suggestedStyle: string;
  ambientSound: AmbientSoundscape;
}

export type AmbientSoundscape = 
  | 'none'
  | 'dutor-acoustic'
  | 'oriental-ney'
  | 'lofi-beats'
  | 'calm-piano'
  | 'comedy-jingle'
  | 'tech-ambient'
  | 'cinematic-dark'
  | 'business-uplifting'
  | 'midnight-jazz'
  | 'epic-orchestral'
  | 'nature-ambient'
  | 'deep-focus'
  | 'synthwave-retro'
  | 'news-broadcast'
  | 'acoustic-guitar';

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
  cues?: AudioSegmentCue[];
  rawAudioWavBase64: string;
  mixedAudioWavBase64?: string;
  createdAt: string;
}

export interface TranscriptLine {
  id: string;
  sender?: 'user' | 'agent';
  speaker?: 'agent' | 'user';
  text: string;
  timestamp?: string;
}

