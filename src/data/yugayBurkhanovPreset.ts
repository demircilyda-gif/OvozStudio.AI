import yugayData from './yugayBurkhanovInterview.json';
import { DialogueTurn } from '../types/podcast';

export interface YugayPresetMetadata {
  title: string;
  topic: string;
  host1Name: string;
  host1Role: string;
  host1VoiceId: string;
  host2Name: string;
  host2Role: string;
  host2VoiceId: string;
  totalTurns: number;
  estimatedMinutes: number;
  videoId: string;
  embedUrl: string;
}

export const YUGAY_BURKHANOV_TURNS: DialogueTurn[] = (yugayData as any[]).map((t) => ({
  id: t.id,
  speakerId: t.speakerId,
  speakerName: t.speakerName,
  text: t.text,
  originalText: t.originalText,
  timecode: t.timecode,
  startSec: t.startSec,
  endSec: t.endSec,
  durationSec: t.durationSec,
  chapter: t.chapter,
  emotion: t.emotion,
}));

export const YUGAY_BURKHANOV_METADATA: YugayPresetMetadata = {
  title: "Artur Yugay & Ayubxon Burxanov — Nega O'zbekistonda yashash qimmat?",
  topic: "Toshkentda narxlar, ko'chmas mulk va iqtisodiy o'sish sabablari",
  host1Name: "Artur Yugay",
  host1Role: "Boshlovchi & Intervyuer",
  host1VoiceId: "jasur-business", // Male Baritone (Charon)
  host2Name: "Ayubxon Burxonov",
  host2Role: "Moliya & Biznes Eksperti",
  host2VoiceId: "farrux-tech", // Male Bass-Baritone (Fenrir)
  totalTurns: YUGAY_BURKHANOV_TURNS.length,
  estimatedMinutes: 12,
  videoId: "dQw4w9WgXcQ",
  embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=0",
};
