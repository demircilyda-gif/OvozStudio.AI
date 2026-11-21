export type TtsMode = 'standard' | 'agent';

export type TtsLanguage = 'uz' | 'ru' | 'en';

export type TtsPreset = 'auto' | 'conversational' | 'confident' | 'energetic' | 'warm';

export type TtsProcessingStage = 'idle' | 'translating' | 'analyzing_intonation' | 'synthesizing' | 'done';

export type TtsAgentWorkflow = 'create' | 'format' | 'expand';

export interface TtsAgentDecision {
  genre: string;
  workflow: TtsAgentWorkflow;
  variantsCount: number;
  targetSeconds: number;
  reasonShort: string;
}

export interface TtsAgentProposal {
  id: string;
  title: string;
  badge: string;
  text: string;
  preset: Exclude<TtsPreset, 'auto'>;
  recommendedPreset: Exclude<TtsPreset, 'auto'>;
  recommendedVoiceId: string;
  reason: string;
  estimatedSeconds: number;
  wordCount: number;
  pauseTotalSeconds?: number;
  placeholders: string[];
}

export interface TtsAgentProposeResponse {
  decision?: TtsAgentDecision;
  needsClarification: boolean;
  clarifyingQuestion?: string;
  proposals: TtsAgentProposal[];
}

export interface TtsTranslateResponse {
  translatedText: string;
  sourceLanguage: 'uz_latn' | 'uz_cyrl' | 'ru' | 'en' | 'mixed';
  wasTransliterated: boolean;
  wasTranslated: boolean;
}

export interface TtsQuotaStatus {
  limit: number;
  used: number;
  remaining: number;
  dayKey: string;
  resetLabelRu: string;
  resetLabelUz: string;
}

export interface TtsSynthesisResult {
  id: string;
  audioUrl: string;
  mp3Url: string;
  durationSeconds: number;
  finalSpokenText: string;
  styleSummary: string;
  provider: 'google-gemini-tts' | 'kie-gemini-tts' | 'cache';
  cached: boolean;
  ttsCallsUsed?: number;
  quotaRemaining?: number;
  quotaLimit?: number;
  creditsUsed: number;
  creditsRemaining?: number;
  synthesisWallTimeMs?: number;
}
