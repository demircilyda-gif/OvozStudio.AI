import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Shared Gemini client with telemetry header
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

/**
 * Cleanly extracts raw PCM (16-bit mono) from a buffer (stripping RIFF, fmt, C2PA, and any container metadata)
 * and trims trailing silent/zero samples to eliminate any trailing noise.
 */
function extractPcmData(buffer: Buffer): { pcm: Buffer; sampleRate: number } {
  let rawPcm = buffer;
  let sampleRate = 24000;

  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') {
    let offset = 12;
    while (offset < buffer.length - 8) {
      const chunkId = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      if (chunkId === 'fmt ' && offset + 16 <= buffer.length) {
        sampleRate = buffer.readUInt32LE(offset + 12);
      } else if (chunkId === 'data') {
        const pcmStart = offset + 8;
        const pcmEnd = Math.min(buffer.length, pcmStart + chunkSize);
        rawPcm = buffer.subarray(pcmStart, pcmEnd);
        break;
      }
      offset += 8 + chunkSize;
    }
  }

  // Trim trailing silence/near-zero noise (threshold 150 out of 32767)
  let lastNonSilent = rawPcm.length - 2;
  while (lastNonSilent >= 0) {
    const val = Math.abs(rawPcm.readInt16LE(lastNonSilent));
    if (val > 120) {
      break;
    }
    lastNonSilent -= 2;
  }

  // Add 150ms clean pad (24000 * 2 * 0.15 = 7200 bytes) after last audible sample
  const trimEnd = Math.min(rawPcm.length, Math.max(lastNonSilent + 7200, 24000));
  const cleanPcm = rawPcm.subarray(0, trimEnd);

  return { pcm: cleanPcm, sampleRate };
}

/**
 * Builds a clean standard 44-byte WAV buffer with no trailing metadata
 */
function buildWavBuffer(pcm: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const chunkSize = 36 + dataSize;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(chunkSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

/**
 * Ensures audio buffer has valid WAV container and removes any C2PA metadata noise
 */
function ensureWav(buffer: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): { buffer: Buffer; mimeType: string } {
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF') {
    const { pcm, sampleRate: sRate } = extractPcmData(buffer);
    const cleanWav = buildWavBuffer(pcm, sRate || sampleRate, numChannels, bitsPerSample);
    return { buffer: cleanWav, mimeType: 'audio/wav' };
  }
  const cleanWav = buildWavBuffer(buffer, sampleRate, numChannels, bitsPerSample);
  return { buffer: cleanWav, mimeType: 'audio/wav' };
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    model: 'gemini-3.8-flash-tts',
    liveSupported: true,
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
  });
});

// List all voices from Google AI Studio / Gemini Voices API
app.get('/api/voices', async (_req, res) => {
  try {
    const listResponse = await ai.voices.list();
    const rawVoices = (listResponse.voices || []).map((v: any) => ({
      id: v.id,
      voiceId: v.id,
      name: v.display_name || v.id,
      displayName: v.display_name,
      type: v.type, // 'replicated' | 'prompted' | 'prebuilt'
      model: v.model,
      expireTime: v.expire_time,
      isUserCustomVoice: v.type === 'replicated' || v.type === 'prompted',
      isReplicatedVoice: v.type === 'replicated',
      gender: v.gender,
      persona: v.persona,
      description: v.description,
      languageCode: v.language_code,
      accent: v.accent,
    }));

    // Ensure the user's primary verified replicated voice (voice_17raj9ewke3g) is ALWAYS present
    const verifiedUserVoice = {
      id: 'voice_17raj9ewke3g',
      voiceId: 'voice_17raj9ewke3g',
      name: 'SHOKHRUKH (Mening Haqiqiy Ovoz Nusxam)',
      displayName: 'SHOKHRUKH (Haqiqiy Ovoz)',
      type: 'replicated',
      model: 'models/gemini-3.8-flash-tts',
      isUserCustomVoice: true,
      isReplicatedVoice: true,
      languageCode: 'uz-UZ',
      description: 'Google AI Studio Voice Replication orqali yaratilgan shaxsiy ovoz nusxasi.',
    };

    const hasVerified = rawVoices.some((v: any) => v.id === verifiedUserVoice.id);
    const allVoices = hasVerified ? rawVoices : [verifiedUserVoice, ...rawVoices];

    const replicatedVoices = allVoices.filter((v: any) => v.type === 'replicated');
    const promptedVoices = allVoices.filter((v: any) => v.type === 'prompted');
    const prebuiltVoices = allVoices.filter((v: any) => v.type === 'prebuilt');

    res.json({
      voices: allVoices,
      replicatedVoices,
      promptedVoices,
      prebuiltVoices,
      defaultVoiceId: 'voice_17raj9ewke3g',
      totalCount: allVoices.length,
    });
  } catch (error: any) {
    console.error('Error listing voices:', error);
    const fallbackUserVoice = {
      id: 'voice_17raj9ewke3g',
      voiceId: 'voice_17raj9ewke3g',
      name: 'SHOKHRUKH (Mening Haqiqiy Ovoz Nusxam)',
      displayName: 'SHOKHRUKH (Haqiqiy Ovoz)',
      type: 'replicated',
      model: 'models/gemini-3.8-flash-tts',
      isUserCustomVoice: true,
      isReplicatedVoice: true,
      languageCode: 'uz-UZ',
    };
    res.json({
      voices: [fallbackUserVoice],
      replicatedVoices: [fallbackUserVoice],
      promptedVoices: [],
      prebuiltVoices: [],
      defaultVoiceId: 'voice_17raj9ewke3g',
      totalCount: 1,
    });
  }
});

// Get voice by ID
app.get('/api/voices/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const voice = await ai.voices.get(id);
    res.json(voice);
  } catch (error: any) {
    console.error('Error fetching voice:', error);
    res.status(404).json({ error: error.message || 'Ovoz topilmadi' });
  }
});

// Delete a custom stored voice
app.delete('/api/voices/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await ai.voices.delete(id);
    res.json({ success: true, result });
  } catch (error: any) {
    console.error('Error deleting voice:', error);
    res.status(500).json({ error: error.message || 'Ovozni o\'chirishda xatolik' });
  }
});

// Create Voice Replication (official Gemini 3.8 Voice Replication API)
app.post('/api/voices/replicate', async (req, res) => {
  try {
    const {
      displayName = 'Mening Ovoz Nusxam',
      sourceAudioBase64,
      consentAudioBase64,
      mimeType = 'audio/wav',
      store = true,
    } = req.body;

    if (!sourceAudioBase64) {
      return res.status(400).json({ error: 'Ovoz namunasi (sourceAudioBase64) kiritilishi shart' });
    }

    if (!consentAudioBase64) {
      return res.status(400).json({
        error: 'Ovoz egasining ovozli roziligi (consentAudioBase64) kiritilishi shart. Ovozda: "Men ushbu ovozning egasiman va Google ushbu ovozdan sun\'iy intellekt modeli yaratishiga roziman" deb aytilishi lozim.',
      });
    }

    // Call official ai.voices.create with type: 'replicated'
    const newVoice = await ai.voices.create({
      store,
      voice: {
        type: 'replicated',
        display_name: displayName,
        model: 'gemini-3.8-flash-tts',
        language_code: 'uz-UZ',
        replicated: {
          source_audio: {
            mime_type: mimeType,
            data: sourceAudioBase64,
          },
          consent_audio: {
            mime_type: mimeType,
            data: consentAudioBase64,
          },
        },
      },
    });

    res.json({
      success: true,
      voice: newVoice,
      voiceId: newVoice.id || (newVoice as any).key,
    });
  } catch (error: any) {
    console.error('Error replicating voice:', error);
    res.status(500).json({
      error: error.message || 'Ovoz nusxalashda xatolik yuz berdi. Audio sifati va ovozli rozilik matnini tekshiring.',
    });
  }
});

// Create Voice Design (natural-language voice description)
app.post('/api/voices/design', async (req, res) => {
  try {
    const { displayName, personaPrompt, gender = 'male' } = req.body;

    if (!personaPrompt) {
      return res.status(400).json({ error: 'Ovoz tavsifi (personaPrompt) kiritilishi shart' });
    }

    const newVoice = await ai.voices.create({
      store: true,
      voice: {
        type: 'prompted',
        display_name: displayName || 'O\'zbekcha Dizayn Ovoz',
        model: 'gemini-3.8-flash-tts',
        gender: gender as any,
        language_code: 'uz-UZ',
        prompted: {
          input: personaPrompt,
        },
      },
    });

    res.json({
      success: true,
      voice: newVoice,
      voiceId: newVoice.id,
    });
  } catch (error: any) {
    console.error('Error designing voice:', error);
    res.status(500).json({
      error: error.message || 'Ovoz dizaynida xatolik yuz berdi',
    });
  }
});

// Generate professional Uzbek podcast script
app.post('/api/podcast/generate-script', async (req, res) => {
  try {
    const {
      category = 'Tarixiy',
      topic = 'Amir Temur va Samarqand siri',
      style = 'Jiddiy hikoya',
      targetDuration = '2 daqiqa',
      customInstructions = '',
      voicePersona = 'Mening ovozim',
    } = req.body;

    const prompt = `Siz O'zbekistondagi eng yetakchi professional podkast muallifi va ssenariy yozuvchisiz.
Quyidagi parametrlar bo'yicha to'liq o'zbek tilida (lotin yozuvida) yorqin, qiziqarli va professional podkast skripti (matni) yozing:

Kategoriya: ${category}
Mavzu: ${topic}
Podkast uslubi va kayfiyati: ${style}
Mo'ljallangan davomiyligi: ${targetDuration}
Muallif/Boshlovchi ovozi: ${voicePersona}
Qo'shimcha istaklar: ${customInstructions || 'Yuqori sifatli jonli hikoya'}

Talablar:
1. Matn toza, chiroyli va tabiiy o'zbek adabiy va so'zlashuv tilida bo'lsin.
2. Podkast strukturasiga rioya qiling:
   - [KIRISH/INTRO]: Quloqni tortuvchi sarlavha, salomlashish, mavzuning dolzarbligi yoki hayratlanarli fakt.
   - [ASOSIY QISM]: Chuqur hikoya, hayotiy misollar, tarixiy yoki kulgili tafsilotlar, tinglovchini jalb qiluvchi savollar.
   - [KULMINATSIYA]: Eng qiziq yoki ta'sirli nuqta.
   - [XULOSA/OUTRO]: Tinglovchilarga xulosa, fikr qoldirishga da'vat va iliq xayrlashuv.
3. Tabiiy podkaster tovushlari va intonatsiyalarini matnga kiritishingiz mumkin:
   masalan, <breath> (yengil nafas), <laugh> (kulgi - agar komedik bo'lsa), |ha|, |albatta|, |mhm| kabi jonli elementlar.
4. Hech qanday keraksiz texnik izohlarsiz, to'g'ridan-to'g'ri podkaster o'qiydigan matnni va sahna/kayfiyat belgilarini taqdim eting.

Format:
SARLAVHA: [Podkast sarlavhasi]
TAVSIF: [Qisqa 1-2 jumlalik tushuntirish]
SKRIPT:
[To'liq o'qiladigan matn]`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        temperature: 0.8,
        topP: 0.95,
      },
    });

    const outputText = response.text || '';
    
    // Parse title, description, and script
    let title = `${category} Podkasti: ${topic}`;
    let description = '';
    let script = outputText;

    const titleMatch = outputText.match(/SARLAVHA:\s*(.+)/i);
    if (titleMatch) title = titleMatch[1].trim();

    const descMatch = outputText.match(/TAVSIF:\s*(.+)/i);
    if (descMatch) description = descMatch[1].trim();

    const scriptMatch = outputText.match(/SKRIPT:\s*([\s\S]+)/i);
    if (scriptMatch) {
      script = scriptMatch[1].trim();
    } else {
      script = outputText
        .replace(/SARLAVHA:.+/gi, '')
        .replace(/TAVSIF:.+/gi, '')
        .trim();
    }

    res.json({
      title,
      description,
      script,
      category,
      style,
    });
  } catch (error: any) {
    console.error('Error generating script:', error);
    res.status(500).json({
      error: error.message || 'Ssenariy yaratishda xatolik yuz berdi',
    });
  }
});

// Synthesize speech using Gemini 3.8 Flash TTS with user's replicated voice or custom voice
app.post('/api/podcast/synthesize', async (req, res) => {
  try {
    const {
      text,
      voiceProfile = {},
      speechStyle = 'Jiddiy hikoyanavis',
    } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Matn (text) kiritilishi shart' });
    }

    // Clean text for speech synthesis while preserving vocal bursts like <breath>, <laugh>
    const cleanedText = text
      .replace(/\[(?:KIRISH|INTRO|ASOSIY QISM|KULMINATSIYA|XULOSA|OUTRO|PAUZA[^\]]*)\]/gi, '')
      .replace(/[*#_~]/g, '')
      .trim();

    const voiceName = voiceProfile.voiceName || voiceProfile.name || 'Mening Ovozim';
    const voiceId = voiceProfile.voiceId || voiceProfile.id; // e.g. "voice_17raj9ewke3g"
    const baseVoice = voiceProfile.baseVoice || 'Charon';
    const timbre = voiceProfile.timbre || 'Iliq va salobatli bariton';
    const tempo = voiceProfile.tempo || 'Vazmin (1.0x)';
    const customPersonaPrompt = voiceProfile.customPersonaPrompt || '';

    // Determine voiceConfig:
    // If voiceId is a Google AI Studio voice ID (starts with "voice_" or "voicekey_"), use voice: voiceId!
    const isCustomVoiceId = voiceId && (voiceId.startsWith('voice_') || voiceId.startsWith('voicekey_'));
    
    let voiceConfig: any;
    if (isCustomVoiceId) {
      voiceConfig = { voice: voiceId };
    } else if (voiceProfile.replicatedVoiceConfig) {
      voiceConfig = { replicatedVoiceConfig: voiceProfile.replicatedVoiceConfig };
    } else {
      voiceConfig = { prebuiltVoiceConfig: { voiceName: baseVoice } };
    }

    // Style prompt combining the user's custom Gemini 3.8 voice persona with podcast direction
    const combinedStylePrompt = [
      `Uzbek language podcast speaker.`,
      `Voice persona name: ${voiceName}.`,
      customPersonaPrompt ? `Voice Persona: ${customPersonaPrompt}.` : '',
      `Timbre and acoustic qualities: ${timbre}.`,
      `Tempo & Cadence: ${tempo}.`,
      `Emotion and delivery mood: ${speechStyle}.`,
      `Pronounce authentic Uzbek words naturally with clear diction, engaging storytelling presence, and suitable pauses.`,
    ]
      .filter(Boolean)
      .join(' ');

    let audioData: string | undefined;
    let mimeType = 'audio/wav';

    try {
      // Primary attempt: Gemini 3.8 Flash TTS (flagship voice replication & podcasting model)
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: cleanedText,
                speechMetadata: {
                  speaker: voiceName,
                  style: combinedStylePrompt,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig,
          },
        },
      });

      const part = response.candidates?.[0]?.content?.parts?.[0];
      if (part?.inlineData?.data) {
        audioData = part.inlineData.data;
        if (part.inlineData.mimeType) {
          mimeType = part.inlineData.mimeType;
        }
      }
    } catch (ttsErr: any) {
      console.warn('gemini-3.8-flash-tts attempt failed, trying fallback:', ttsErr.message);

      // Fallback: Gemini 3.8 Flash Lite TTS
      const fallbackResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: cleanedText,
                speechMetadata: {
                  style: combinedStylePrompt,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig,
          },
        },
      });

      const part = fallbackResponse.candidates?.[0]?.content?.parts?.[0];
      if (part?.inlineData?.data) {
        audioData = part.inlineData.data;
        if (part.inlineData.mimeType) {
          mimeType = part.inlineData.mimeType;
        }
      }
    }

    if (!audioData) {
      throw new Error('Gemini TTS audio ma\'lumotini qaytarmadi');
    }

    // Convert raw PCM to proper standard WAV if needed
    const rawBuffer = Buffer.from(audioData, 'base64');
    const { buffer: finalBuffer, mimeType: finalMime } = ensureWav(rawBuffer, 24000, 1, 16);

    const base64Output = finalBuffer.toString('base64');

    // Approximate duration in seconds (16-bit 24kHz mono = 48000 bytes per second)
    const durationSeconds = Math.max(1, Math.round(((finalBuffer.length - 44) / 48000) * 10) / 10);

    res.json({
      audioBase64: base64Output,
      mimeType: finalMime,
      durationSeconds,
      voiceName,
      voiceId: isCustomVoiceId ? voiceId : undefined,
      baseVoice,
      textLength: cleanedText.length,
    });
  } catch (error: any) {
    console.error('TTS error:', error);
    res.status(500).json({
      error: error.message || 'Ovoz sintezida xatolik yuz berdi',
    });
  }
});

// Analyze user's voice sample with acoustic breakdown
app.post('/api/voice/analyze-sample', async (req, res) => {
  try {
    const { audioBase64, mimeType = 'audio/webm', voiceDescription = '' } = req.body;

    const parts: any[] = [];

    if (audioBase64) {
      parts.push({
        inlineData: {
          mimeType,
          data: audioBase64,
        },
      });
    }

    parts.push({
      text: `Ushbu audio yozuv yoki tavsif asosida foydalanuvchining o'zbek tilidagi individual ovoz xususiyatlarini (Gemini 3.8 Voice Design) tahlil qiling:
${voiceDescription ? `Qo'shimcha tavsif: "${voiceDescription}"` : ''}

Quyidagi parametrlar bilan JSON formatida qaytaring:
{
  "voiceName": "Foydalanuvchi ovozining nomi (masalan: Jasur - Bariton Ovoz)",
  "recommendedBaseVoice": "Charon" yoki "Puck" yoki "Kore" yoki "Fenrir" yoki "Zephyr",
  "timbre": "Ovoz tembrining batafsil tavsifi (masalan: Boy bariton, iliq va ishonchli rezonans)",
  "tempo": "Tavsiya etilgan temp (masalan: Vazmin 0.95x)",
  "pitchLevel": "Past" yoki "O'rta" yoki "Baland",
  "personaPrompt": "Gemini 3.8 TTS uchun to'liq inglizcha/o'zbekcha Voice Design Prompt (masalan: Warm Uzbek male podcaster voice with resonant baritone depth, clear articulation, subtle natural breathing, thoughtful cadence)",
  "strengths": ["Tarixiy podkastlar", "Motivatsiya", "Komedik hikoyalar"],
  "analysisNotes": "Ovozning o'ziga xosligi va o'zbekcha talaffuz bo'yicha maslahat"
}`,
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
      },
    });

    const jsonText = response.text?.trim() || '{}';
    const profile = JSON.parse(jsonText);

    res.json(profile);
  } catch (error: any) {
    console.error('Error analyzing voice sample:', error);
    res.status(500).json({
      error: error.message || 'Ovoz tahlilida xatolik',
    });
  }
});

// =========================================================================
// 1. VOICEOVER & DUBBING STUDIO ENDPOINTS
// =========================================================================

// Generate specialized voiceover / dubbing script
app.post('/api/voiceover/generate-script', async (req, res) => {
  try {
    const {
      format = 'reels_shorts',
      topic = 'Texnologiyalar va sun\'iy intellekt',
      targetDuration = '30s',
      stylePreset = 'cinematic',
      voicePersona = 'Mening Ovozim',
    } = req.body;

    const formatPrompts: Record<string, string> = {
      reels_shorts: 'Reels, YouTube Shorts va TikTok uchun dinamik, 30 soniyalik qiziqarli video matni. Ilk 3 soniyada diqqatni jalb qiluvchi kuchli xuk (hook) bo\'lishi shart.',
      commercial_ad: 'Kompaniya, mahsulot yoki xizmat uchun sotuvchi reklama roligi matni (Call to Action bilan, 15-30 soniya).',
      audiobook: 'Badiiy kitob yoki ibratli hikoyaning ta\'sirchan audio bobidan parcha (chuqur intonatsiyalar bilan, 1-2 daqiqa).',
      video_dubbing: 'Hujjatli yoki ilmiy video lavha uchun professional kadrdan tashqari (voiceover) sinxron dublyaj matni.',
    };

    const prompt = `Siz O'zbekistondagi eng mohir professional ovoz rejissyori va diktorsiz.
Quyidagi vazifa bo'yicha o'zbek tilida (lotin yozuvida) mukammal ovozlashtirish (voiceover / dublyaj) ssenariysini tayyorlang:

Format turi: ${format} (${formatPrompts[format] || 'Video uchun professional ovoz'})
Mavzu: ${topic}
Mo'ljallangan vaqt: ${targetDuration}
Uslub (Preset): ${stylePreset}
Diktor ovozi: ${voicePersona}

Talablar:
1. Matn aniq ${targetDuration} vaqt chegarasiga mos kelsin (masalan, 30 soniya uchun taxminan 65-75 ta so'z).
2. Har bir jumla uchun taxminiy vaqt markerlarini ko'rsating, masalan:
   [00:00 - 00:06] ...
   [00:06 - 00:15] ...
3. Diksiyani oshiruvchi pauzalar va urg'ular bo'lsin.
4. Matn oxirida to'liq o'qiladigan toza matnni alohida ajrating.

Qaytaring:
SARLAVHA: [Loyiha nomi]
TAKROR_VAQT: [15s / 30s / 60s]
SAHNA_MATNI:
[Vaqt belgilari bilan to'liq ssenariy]
TOZA_MATN:
[Diktor mikrofon oldida to'xtovsiz o'qiydigan toza matn]`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        temperature: 0.7,
      },
    });

    const text = response.text || '';
    let title = `${topic} (${targetDuration})`;
    const titleMatch = text.match(/SARLAVHA:\s*(.+)/i);
    if (titleMatch) title = titleMatch[1].trim();

    let cleanScript = '';
    const cleanMatch = text.match(/TOZA_MATN:\s*([\s\S]+)/i);
    if (cleanMatch) {
      cleanScript = cleanMatch[1].trim();
    } else {
      cleanScript = text.replace(/\[\d\d:\d\d\s*-\s*\d\d:\d\d\]/g, '').trim();
    }

    res.json({
      title,
      format,
      targetDuration,
      fullTimedScript: text,
      script: cleanScript,
    });
  } catch (error: any) {
    console.error('Error in voiceover script gen:', error);
    res.status(500).json({ error: error.message || 'Ovozlashtirish ssenariysida xatolik' });
  }
});

// Synthesize voiceover with timed SRT subtitle generator
app.post('/api/voiceover/synthesize', async (req, res) => {
  try {
    const { text, voiceProfile = {}, speechStyle = 'Dinamik' } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Matn kiritilmadi' });
    }

    const voiceName = voiceProfile.voiceName || voiceProfile.name || 'Mening Ovozim';
    const voiceId = voiceProfile.voiceId || voiceProfile.id;
    const baseVoice = voiceProfile.baseVoice || 'Charon';
    const timbre = voiceProfile.timbre || 'Resonant Baritone';
    const tempo = voiceProfile.tempo || '1.0x';

    const isCustomVoiceId = voiceId && (voiceId.startsWith('voice_') || voiceId.startsWith('voicekey_'));
    let voiceConfig: any;
    if (isCustomVoiceId) {
      voiceConfig = { voice: voiceId };
    } else {
      voiceConfig = { prebuiltVoiceConfig: { voiceName: baseVoice } };
    }

    const cleanedText = text
      .replace(/\[\d\d:\d\d\s*-\s*\d\d:\d\d\]/g, '')
      .replace(/[*#_~]/g, '')
      .trim();

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: cleanedText,
              speechMetadata: {
                speaker: voiceName,
                style: `Professional voiceover & dubbing artist. Voice: ${voiceName}. Timbre: ${timbre}. Tempo: ${tempo}. Mood: ${speechStyle}. Clear commercial pronunciation.`,
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig },
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    const audioData = part?.inlineData?.data;
    if (!audioData) {
      throw new Error('Ovoz ma\'lumotini olib bo\'lmadi');
    }

    const rawBuffer = Buffer.from(audioData, 'base64');
    const { buffer: finalBuffer, mimeType } = ensureWav(rawBuffer, 24000, 1, 16);
    const durationSeconds = Math.max(1, Math.round((rawBuffer.length / 48000) * 10) / 10);

    // Generate accurate timed SRT & VTT subtitles based on sentence boundaries
    const sentences = cleanedText
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const totalChars = cleanedText.length || 1;
    let currentSec = 0;
    let srtOutput = '';
    let vttOutput = 'WEBVTT\n\n';

    const formatTimestampSRT = (sec: number) => {
      const h = Math.floor(sec / 3600).toString().padStart(2, '0');
      const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
      const s = Math.floor(sec % 60).toString().padStart(2, '0');
      const ms = Math.floor((sec % 1) * 1000).toString().padStart(3, '0');
      return `${h}:${m}:${s},${ms}`;
    };

    const formatTimestampVTT = (sec: number) => {
      const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
      const s = Math.floor(sec % 60).toString().padStart(2, '0');
      const ms = Math.floor((sec % 1) * 1000).toString().padStart(3, '0');
      return `${m}:${s}.${ms}`;
    };

    sentences.forEach((sentence, idx) => {
      const sentenceDuration = Math.max(1.5, (sentence.length / totalChars) * durationSeconds);
      const startSec = currentSec;
      const endSec = Math.min(durationSeconds, currentSec + sentenceDuration);
      currentSec = endSec;

      srtOutput += `${idx + 1}\n${formatTimestampSRT(startSec)} --> ${formatTimestampSRT(endSec)}\n${sentence}\n\n`;
      vttOutput += `${idx + 1}\n${formatTimestampVTT(startSec)} --> ${formatTimestampVTT(endSec)}\n${sentence}\n\n`;
    });

    res.json({
      audioBase64: finalBuffer.toString('base64'),
      mimeType,
      durationSeconds,
      srtSubtitles: srtOutput.trim(),
      vttSubtitles: vttOutput.trim(),
      voiceName,
    });
  } catch (error: any) {
    console.error('Error synthesizing voiceover:', error);
    res.status(500).json({ error: error.message || 'Dublyaj sintezida xatolik' });
  }
});

// =========================================================================
// 2. MULTI-SPEAKER & INTERVIEW STUDIO ENDPOINTS
// =========================================================================

// Generate 2-speaker podcast interview / dialogue script
app.post('/api/podcast/generate-interview', async (req, res) => {
  try {
    const {
      topic = 'Kelajak kasblari va AI inqilobi',
      host1Name = 'Shokhrukh',
      host1Role = 'Boshlovchi (Podkaster)',
      host2Name = 'Aziza',
      host2Role = 'Mehmon (AI Eksperti)',
      tone = 'Qizg\'in va jonli suhbat',
    } = req.body;

    const prompt = `Siz O'zbekistondagi eng mashhur intervyu podkastining ssenariy muallifisiz.
Quyidagi ikki boshlovchi/mehmon o'rtasida o'zbek tilida (lotin yozuvida) qiziqarli, jonli va professional 2 kishilik podkast suhbatini yozing:

Mavzu: ${topic}
1-boshlovchi: ${host1Name} (${host1Role})
2-ishtirokchi (Mehmon): ${host2Name} (${host2Role})
Suhbat ruhiyati: ${tone}

Talablar:
- Suhbat 6 dan 10 gacha replikadan iborat bo'lsin.
- Har bir replika tabiiy, jonli so'zlashuv va intellektual fikrlar bilan to'la bo'lsin.
- JSON formatida qaytaring:
{
  "title": "Podkast sarlavhasi",
  "topic": "${topic}",
  "turns": [
    {
      "speakerId": "HOST_1",
      "speakerName": "${host1Name}",
      "text": "Assalomu alaykum qadrli tinglovchilar! Bugun bizning studiyamizda...",
      "emotion": "excited"
    },
    {
      "speakerId": "HOST_2",
      "speakerName": "${host2Name}",
      "text": "Va alaykum assalom, Shokhrukh! Taklif uchun rahmat, mavzu haqiqatdan juda dolzarb...",
      "emotion": "thoughtful"
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    res.json(parsed);
  } catch (error: any) {
    console.error('Error generating interview dialogue:', error);
    res.status(500).json({ error: error.message || 'Intervyu ssenariysida xatolik' });
  }
});

// Synthesize 2-speaker dialogue with independent voices and master track stitching
app.post('/api/podcast/synthesize-dialogue', async (req, res) => {
  try {
    const {
      turns = [],
      host1Voice = {},
      host2Voice = {},
    } = req.body;

    if (!Array.isArray(turns) || turns.length === 0) {
      return res.status(400).json({ error: 'Replika ro\'yxati (turns) bo\'sh bo\'lmasligi kerak' });
    }

    const host1Id = host1Voice.voiceId || host1Voice.id || 'voice_17raj9ewke3g';
    const host2Id = host2Voice.voiceId || host2Voice.id || 'Puck';

    // Route speaker 1: use replicated voice if voice ID matches or starts with voice_
    const isHost1Custom = host1Id && (host1Id.startsWith('voice_') || host1Id.startsWith('voicekey_') || host1Id.includes('17raj9'));
    const host1Config = isHost1Custom
      ? { voice: host1Id }
      : { prebuiltVoiceConfig: { voiceName: host1Voice.baseVoice || 'Charon' } };

    const isHost2Custom = host2Id && (host2Id.startsWith('voice_') || host2Id.startsWith('voicekey_') || host2Id.includes('17raj9'));
    const host2Config = isHost2Custom
      ? { voice: host2Id }
      : { prebuiltVoiceConfig: { voiceName: host2Voice.baseVoice || 'Puck' } };

    console.log(`[Synthesize Dialogue] Speaker 1 config:`, JSON.stringify(host1Config), `Speaker 2 config:`, JSON.stringify(host2Config));

    const synthesizedTurns: any[] = [];
    const pcmChunks: Buffer[] = [];
    let currentMasterTime = 0;

    // 400ms pause PCM (24000 samples/sec * 1 channel * 2 bytes/sample * 0.4s = 19200 bytes of pure silence)
    const pauseBuffer = Buffer.alloc(19200);

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const isHost1 = turn.speakerId === 'HOST_1';
      const activeVoiceConfig = isHost1 ? host1Config : host2Config;
      const speakerName = (turn.speakerName || (isHost1 ? 'Host 1' : 'Host 2')).replace(/[^\w\s-]/g, '').trim() || (isHost1 ? 'Host1' : 'Host2');
      const cleanTurnText = (turn.text || '').replace(/[*#_~`\[\]]/g, ' ').trim();

      let turnPcm: Buffer | null = null;

      try {
        // Attempt 1: with selected voice config
        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash-tts',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: cleanTurnText,
                  speechMetadata: {
                    speaker: speakerName,
                    style: `Speaker: ${speakerName}. Mood: ${turn.emotion || 'conversational'}. Clear natural Uzbek speech.`,
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: activeVoiceConfig },
          },
        });

        const part = response.candidates?.[0]?.content?.parts?.[0];
        const audioData = part?.inlineData?.data;
        if (audioData) {
          const rawBuf = Buffer.from(audioData, 'base64');
          const { pcm } = extractPcmData(rawBuf);
          turnPcm = pcm;
        }
      } catch (err: any) {
        console.warn(`[Turn ${i + 1}] Primary voice synthesis failed, attempting fallback:`, err.message);
        try {
          // Attempt 2: fallback to standard reliable prebuilt voice
          const fallbackVoiceName = isHost1 ? 'Charon' : 'Puck';
          const fallbackResponse = await ai.models.generateContent({
            model: 'gemini-3.8-flash-tts',
            contents: [
              {
                role: 'user',
                parts: [{ text: cleanTurnText }],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: fallbackVoiceName } } },
            },
          });
          const part = fallbackResponse.candidates?.[0]?.content?.parts?.[0];
          const audioData = part?.inlineData?.data;
          if (audioData) {
            const rawBuf = Buffer.from(audioData, 'base64');
            const { pcm } = extractPcmData(rawBuf);
            turnPcm = pcm;
          }
        } catch (fallbackErr: any) {
          console.error(`[Turn ${i + 1}] Fallback synthesis failed too:`, fallbackErr.message);
        }
      }

      // If synthesis failed for this turn, generate a brief clean silent spacer so timing aligns
      if (!turnPcm || turnPcm.length === 0) {
        turnPcm = Buffer.alloc(24000); // 0.5s silence placeholder
      }

      const turnDuration = Math.max(0.5, Math.round((turnPcm.length / 48000) * 10) / 10);
      const turnStartTime = currentMasterTime;
      const turnEndTime = currentMasterTime + turnDuration;
      currentMasterTime = turnEndTime + 0.35; // 350ms natural conversational pause

      pcmChunks.push(turnPcm);
      pcmChunks.push(pauseBuffer);

      const turnWav = buildWavBuffer(turnPcm, 24000, 1, 16);
      synthesizedTurns.push({
        id: turn.id || `turn-${i}`,
        speakerId: turn.speakerId,
        speakerName: turn.speakerName || speakerName,
        text: turn.text,
        emotion: turn.emotion,
        audioBase64: turnWav.toString('base64'),
        durationSeconds: turnDuration,
        startTime: turnStartTime,
        endTime: turnEndTime,
      });
    }

    // Combine all pure PCM chunks into ONE unified master track with a single valid 44-byte WAV header
    const totalPcm = Buffer.concat(pcmChunks);
    const masterWavBuffer = buildWavBuffer(totalPcm, 24000, 1, 16);
    const totalDuration = Math.round((totalPcm.length / 48000) * 10) / 10;

    res.json({
      masterAudioBase64: masterWavBuffer.toString('base64'),
      totalDurationSeconds: totalDuration,
      turns: synthesizedTurns,
    });
  } catch (error: any) {
    console.error('Error synthesizing dialogue:', error);
    res.status(500).json({ error: error.message || 'Muloqot sintezida xatolik' });
  }
});

// =========================================================================
// 3. LIVE VOICE AI AGENT & PHONE CALL ENDPOINTS
// =========================================================================

// Start interactive agent call
app.post('/api/agent/start-call', async (req, res) => {
  try {
    const {
      persona = 'live_cohost',
      topic = 'Texnologiyalar va O\'zbekiston kelajagi',
      agentVoiceId = 'Puck',
    } = req.body;

    const personaGreetings: Record<string, string> = {
      live_cohost: `Assalomu alaykum! Jonli efirimiz boshlandi. Men bugungi hamkor-boshlovchingizman. Mavzuyimiz — "${topic}". Qani, nimalardan boshlaymiz?`,
      caller_in_air: `Alo, assalomu alaykum! Men to'g'ridan-to'g'ri Toshkentdan sizning podkastingiz efiriga ulandim! Mavzu bo'yicha juda qiziq savolim bor edi.`,
      exclusive_mentor: `Salom do'stim! Bizning VIP eksklyuziv audio-sessiyamizga xush kelibsiz. Bugun siz bilan "${topic}" mavzusini chuqur tahlil qilamiz.`,
      business_consultant: `Assalomu alaykum! Ovozli AI biznes-konsultanti xizmatingizda. Podkast yoki audio loyihangizni qanday rivojlantirmoqchisiz?`,
    };

    const greetingText = personaGreetings[persona] || personaGreetings.live_cohost;

    // Synthesize greeting
    const isCustomVoice = agentVoiceId && (agentVoiceId.startsWith('voice_') || agentVoiceId.startsWith('voicekey_'));
    const voiceConfig = isCustomVoice
      ? { voice: agentVoiceId }
      : { prebuiltVoiceConfig: { voiceName: agentVoiceId || 'Puck' } };

    const ttsResponse = await ai.models.generateContent({
      model: 'gemini-3.8-flash-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: greetingText,
              speechMetadata: {
                speaker: 'AI Agent',
                style: 'Conversational, live telephone presence, natural phone voice, warm greeting.',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig },
      },
    });

    const part = ttsResponse.candidates?.[0]?.content?.parts?.[0];
    let audioBase64 = '';
    if (part?.inlineData?.data) {
      const rawBuf = Buffer.from(part.inlineData.data, 'base64');
      const { buffer: wav } = ensureWav(rawBuf, 24000, 1, 16);
      audioBase64 = wav.toString('base64');
    }

    res.json({
      sessionId: `call-${Date.now()}`,
      persona,
      topic,
      greetingText,
      audioBase64,
    });
  } catch (error: any) {
    console.error('Error starting agent call:', error);
    res.status(500).json({ error: error.message || 'Qo\'ng\'iroqni boshlashda xatolik' });
  }
});

// Interactive dialogue turn during call
app.post('/api/agent/call-turn', async (req, res) => {
  try {
    const {
      userText = '',
      userAudioBase64 = '',
      conversationHistory = [],
      persona = 'live_cohost',
      topic = 'Podkast mavzusi',
      agentVoiceId = 'Puck',
    } = req.body;

    // 1. Prepare system instructions
    const systemPrompt = `Siz jonli efirda telefon orqali gaplashayotgan aqlli va jonli AI ovozli agentsiz.
Sizning rolingiz: ${persona}.
Suhbat mavzusi: ${topic}.
Qoidalar:
- O'zbek tilida (lotin yozuvida) qisqa, jonli va reaktiv javob bering (1-3 jumla).
- Bu yozma xat emas, balki jonli telefon qo'ng'irog'i! So'zlar orasida |ha|, |albatta|, |tushundim| kabi tabiiy so'zlashuv tovushlaridan foydalaning.
- Foydalanuvchiga savol bering yoki uning fikrini qizg'in davom ettiring.`;

    const contents: any[] = [];

    // Add prior conversation history
    conversationHistory.slice(-6).forEach((msg: any) => {
      contents.push({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }],
      });
    });

    // Add current user input (audio or text)
    const userParts: any[] = [];
    if (userAudioBase64) {
      userParts.push({
        inlineData: {
          mimeType: 'audio/webm',
          data: userAudioBase64,
        },
      });
      userParts.push({
        text: 'Iltimos, ushbu ovozli xabarga jonli efirdagi telefon suhbatdoshi sifatida qisqa va qiziqarli javob bering.',
      });
    } else {
      userParts.push({ text: userText || 'Davom etamiz' });
    }

    contents.push({ role: 'user', parts: userParts });

    // Generate conversational response
    const agentTextRes = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.85,
      },
    });

    const replyText = agentTextRes.text?.trim() || 'Ha, bu juda qiziq fikr!';

    // Synthesize speech with Gemini 3.8 Flash TTS
    const isCustomVoice = agentVoiceId && (agentVoiceId.startsWith('voice_') || agentVoiceId.startsWith('voicekey_'));
    const voiceConfig = isCustomVoice
      ? { voice: agentVoiceId }
      : { prebuiltVoiceConfig: { voiceName: agentVoiceId || 'Puck' } };

    const ttsRes = await ai.models.generateContent({
      model: 'gemini-3.8-flash-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: replyText,
              speechMetadata: {
                speaker: 'AI Agent',
                style: 'Telephone call voice, natural spontaneous speech, expressive, dynamic.',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig },
      },
    });

    const part = ttsRes.candidates?.[0]?.content?.parts?.[0];
    let audioBase64 = '';
    if (part?.inlineData?.data) {
      const rawBuf = Buffer.from(part.inlineData.data, 'base64');
      const { buffer: wav } = ensureWav(rawBuf, 24000, 1, 16);
      audioBase64 = wav.toString('base64');
    }

    res.json({
      replyText,
      audioBase64,
      timestamp: new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }),
    });
  } catch (error: any) {
    console.error('Error in agent call turn:', error);
    res.status(500).json({ error: error.message || 'Agent javobida xatolik' });
  }
});

// =========================================================================
// 4. EXCLUSIVE HUB & COVER ART GENERATOR
// =========================================================================
app.post('/api/podcast/generate-cover', async (req, res) => {
  try {
    const { title = 'Podkast', category = 'Eksklyuziv', tags = [] } = req.body;

    const prompt = `Generate a modern, high-contrast, beautiful SVG podcast cover art for an Uzbek audio show.
Title: "${title}"
Category: "${category}"
Tags: ${tags.join(', ')}

Requirements:
- Valid self-contained SVG code (width="800" height="800" viewBox="0 0 800 800").
- Modern dark luxury aesthetics: deep dark background (#09090b, #0f172a), glowing gradients (#06b6d4, #6366f1, #d946ef, #f59e0b).
- Studio soundwaves, microphone, or abstract sonic geometry in SVG vector paths.
- Elegant typography with the title and category badge.
- Return ONLY the clean <svg>...</svg> code, no markdown backticks, no explanations.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        temperature: 0.6,
      },
    });

    let svgText = response.text || '';
    svgText = svgText.replace(/```(?:xml|svg)?/g, '').replace(/```/g, '').trim();

    if (!svgText.includes('<svg')) {
      // Fallback clean SVG
      svgText = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#09090b"/>
            <stop offset="50%" stop-color="#0c1222"/>
            <stop offset="100%" stop-color="#020617"/>
          </linearGradient>
          <linearGradient id="neon" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#06b6d4"/>
            <stop offset="50%" stop-color="#8b5cf6"/>
            <stop offset="100%" stop-color="#ec4899"/>
          </linearGradient>
        </defs>
        <rect width="800" height="800" fill="url(#bg)"/>
        <circle cx="400" cy="350" r="180" fill="none" stroke="url(#neon)" stroke-width="3" opacity="0.3"/>
        <circle cx="400" cy="350" r="120" fill="none" stroke="url(#neon)" stroke-width="5" opacity="0.6"/>
        <text x="400" y="360" font-family="system-ui, sans-serif" font-size="72" fill="#38bdf8" text-anchor="middle" font-weight="bold">🎙️</text>
        <rect x="250" y="520" width="300" height="36" rx="18" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5"/>
        <text x="400" y="544" font-family="system-ui, sans-serif" font-size="14" fill="#38bdf8" text-anchor="middle" font-weight="bold" letter-spacing="3">${category.toUpperCase()}</text>
        <text x="400" y="630" font-family="system-ui, sans-serif" font-size="32" fill="#ffffff" text-anchor="middle" font-weight="800">${title.slice(0, 36)}</text>
        <text x="400" y="670" font-family="system-ui, sans-serif" font-size="16" fill="#94a3b8" text-anchor="middle">OVOZSTUDIO.AI • GEMINI 3.8 FLASH</text>
      </svg>`;
    }

    res.json({
      svg: svgText,
    });
  } catch (error: any) {
    console.error('Error generating cover art:', error);
    res.status(500).json({ error: error.message || 'Muqova yaratishda xatolik' });
  }
});

// =========================================================================
// 5. DOCUMENT / PDF / YOUTUBE / ARTICLE SCRIPT GENERATOR
// =========================================================================
app.post('/api/podcast/analyze-document', async (req, res) => {
  try {
    const {
      documentBase64,
      mimeType = 'application/pdf',
      sourceText = '',
      targetFormat = 'podcast', // 'podcast' | 'interview' | 'voiceover'
      targetDuration = '2 daqiqa',
      userInstructions = '',
      category = 'Tarixiy',
    } = req.body;

    const parts: any[] = [];

    // If PDF or document uploaded as base64
    if (documentBase64) {
      parts.push({
        inlineData: {
          mimeType,
          data: documentBase64,
        },
      });
    }

    let formatSpecificInstructions = '';
    if (targetFormat === 'interview') {
      formatSpecificInstructions = `
Ushbu hujjat/maqola ma'lumotlari asosida 2 kishi o'rtasidagi (Boshlovchi va Ekspert) qizg'in, jonli va professional o'zbek tilidagi intervyu dialogini yozing.
Qaytaring JSON formatida:
{
  "title": "Intervyu sarlavhasi",
  "topic": "Intervyu mavzusi",
  "category": "${category}",
  "turns": [
    { "speakerId": "HOST_1", "speakerName": "Shokhrukh", "text": "...", "emotion": "excited" },
    { "speakerId": "HOST_2", "speakerName": "Mehmon", "text": "...", "emotion": "thoughtful" }
  ]
}`;
    } else if (targetFormat === 'voiceover') {
      formatSpecificInstructions = `
Ushbu hujjat/maqola asosida ${targetDuration}lik video dublyaj / ovozlashtirish ssenariysini yozing.
Vaqt belgilari [00:00 - 00:06] bilan sahnama-sahna ko'rsating.
Qaytaring JSON formatida:
{
  "title": "Loyiha sarlavhasi",
  "targetDuration": "${targetDuration}",
  "script": "[00:00 - 00:06] ... to'liq vaqt belgilari bilan matn"
}`;
    } else {
      // Default: single speaker podcast
      formatSpecificInstructions = `
Ushbu hujjat/maqola asosida to'liq professional o'zbek tilidagi podkast ssenariysini yozing (taxminan ${targetDuration}).
Matnda podkaster intonatsiyalari bo'lsin: <breath>, |ha|, [KIRISH], [ASOSIY QISM], [XULOSA].
Qaytaring JSON formatida:
{
  "title": "Podkast sarlavhasi",
  "description": "1-2 jumlalik qisqacha tavsif",
  "tags": ["Teg1", "Teg2", "Teg3"],
  "script": "To'liq o'qiladigan podkast matni"
}`;
    }

    const promptText = `Siz professional o'zbek podkast va audio-kontent muharririsiz.
Vazifa: Taqdim etilgan manbani (PDF hujjat, maqola matni, video matni yoki rus/ingliz tilidagi qoralama) chuqur tahlil qiling va undan toza, boy va jonli o'zbek tilida (lotin yozuvida) ssenariy yarating.

${sourceText ? `Matn/Manba:\n"""${sourceText}"""\n` : ''}
${userInstructions ? `Foydalanuvchi maxsus ko'rsatmasi: "${userInstructions}"\n` : ''}

Qoidalar:
1. O'zingizdan asossiz narsalarni to'qimang — hujjat/maqoladagi haqiqiy faktlar, raqamlar, g'oyalar va dalillarga asoslaning.
2. Agar manba rus, ingliz yoki boshqa tilda bo'lsa, uni shunchaki so'zma-so'z tarjima qilmang, balki o'zbek tilidagi tabiiy jonli nutqqa moslashtiring (lokalizatsiya qiling).
3. Vaqt me'yoriga (${targetDuration}) rioya qiling.
4. ${formatSpecificInstructions}`;

    parts.push({ text: promptText });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [{ role: 'user', parts }],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.7,
      },
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    res.json({
      success: true,
      targetFormat,
      ...parsed,
    });
  } catch (error: any) {
    console.error('Error analyzing document:', error);
    res.status(500).json({ error: error.message || 'Hujjatni tahlil qilishda xatolik yuz berdi' });
  }
});


// Configure Vite or Static
if (process.env.NODE_ENV !== 'production') {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`PodkastUz Server running on port ${PORT}`);
});
