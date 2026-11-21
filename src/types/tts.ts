export type TtsMode = 'standard' | 'agent';

export type TtsLanguage = 'uz' | 'ru' | 'en';

export type TtsPreset = 'auto' | 'conversational' | 'confident' | 'energetic' | 'warm';

export type TtsProcessingStage = 'idle' | 'translating' | 'analyzing_intonation' | 'synthesizing' | 'done';

export type TtsAgentOutputMode = 'single_monologue' | 'three_variants';

export type TtsAgentWorkflowMode = 'create' | 'format_procedure' | 'expand_monologue';

export type TtsPauseCadence = 'auto' | '1s' | '1_2_3s' | 'none';

export interface TtsAgentProposal {
  id: string;
  title: string;
  badge: string;
  text: string;
  recommendedPreset: Exclude<TtsPreset, 'auto'>;
  recommendedVoiceId: string;
  reason: string;
  estimatedSeconds: number;
  wordCount: number;
  pauseTotalSeconds?: number;
  placeholders: string[];
}

export interface TtsAgentProposeResponse {
  needsClarification: boolean;
  clarifyingQuestion?: string;
  proposals: TtsAgentProposal[];
  appliedPromptArchitecture?: string;
}

export interface TtsTranslateResponse {
  translatedText: string;
  sourceLanguage: 'uz_latn' | 'uz_cyrl' | 'ru' | 'en' | 'mixed';
  wasTransliterated: boolean;
  wasTranslated: boolean;
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
  creditsUsed: number;
  creditsRemaining?: number;
  synthesisWallTimeMs?: number;
}
