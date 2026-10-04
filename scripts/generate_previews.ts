import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const ai = new GoogleGenAI();

function extractPcmData(buffer: Buffer): { pcm: Buffer; sampleRate: number } {
  let sampleRate = 24000;
  let rawPcm = buffer;

  if (buffer.length >= 44 && buffer.toString("ascii", 0, 4) === "RIFF") {
    let offset = 12;
    while (offset < buffer.length - 8) {
      const chunkId = buffer.toString("ascii", offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      if (chunkId === "fmt ") {
        sampleRate = buffer.readUInt32LE(offset + 12);
      } else if (chunkId === "data") {
        const pcmStart = offset + 8;
        const pcmEnd = Math.min(buffer.length, pcmStart + chunkSize);
        rawPcm = buffer.subarray(pcmStart, pcmEnd);
        break;
      }
      offset += 8 + chunkSize;
    }
  }

  return { pcm: rawPcm, sampleRate };
}

function buildWavBuffer(
  pcm: Buffer,
  sampleRate = 24000,
  numChannels = 1,
  bitsPerSample = 16
): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const chunkSize = 36 + dataSize;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(chunkSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

interface VoiceConfigItem {
  id: string;
  name: string;
  baseVoice: string;
  text: string;
  stylePrompt: string;
}

const VOICES_TO_GENERATE: VoiceConfigItem[] = [
  {
    id: "voice_17raj9ewke3g",
    name: "SHOKHRUKH",
    baseVoice: "Charon",
    text: "Assalomu alaykum! Men Shohruh. OvozStudio'ga xush kelibsiz, o'zbekcha professional podkastlarni birga yaratamiz!",
    stylePrompt: "Confident, friendly authentic male Uzbek podcast host speaking warmly.",
  },
  {
    id: "aziza-ai",
    name: "Aziza",
    baseVoice: "Kore",
    text: "Salom! Men Aziza bo'laman. OvozStudio'da siz bilan ilmiy va qiziqarli mavzularda suhbatlashamiz.",
    stylePrompt: "Intelligent, gentle, clear feminine Uzbek AI researcher with engaging tone.",
  },
  {
    id: "madina-journalist",
    name: "Madina",
    baseVoice: "Aoede",
    text: "Assalomu alaykum! Men Madina, qiziqarli podkast va jonli intervyular olib boramiz.",
    stylePrompt: "Energetic and expressive Uzbek female journalist, melodic and warm.",
  },
  {
    id: "dilnoza-blogger",
    name: "Dilnoza",
    baseVoice: "Kore",
    text: "Salom! Men Dilnoza. OvozStudio'da ruhiy xotirjamlik va samimiy mavzularda birgamiz.",
    stylePrompt: "Calm, empathetic, soothing female voice speaking gentle Uzbek.",
  },
  {
    id: "zarina-culture",
    name: "Zarina",
    baseVoice: "Aoede",
    text: "Assalomu alaykum! Men Zarina, adabiyot va madaniyat sirlarini birga ochamiz.",
    stylePrompt: "Sophisticated, poetic and eloquent female Uzbek voice.",
  },
  {
    id: "nodira-analyst",
    name: "Nodira",
    baseVoice: "Kore",
    text: "Salom! Men Nodira. Biznes, investitsiya va moliya tahlillari bilan bo'lishaman.",
    stylePrompt: "Sharp, articulate and confident female Uzbek business analyst.",
  },
  {
    id: "malika-tech",
    name: "Malika",
    baseVoice: "Aoede",
    text: "Salom! Men Malika. Yangi startaplar va texnologiyalar dunyosiga xush kelibsiz!",
    stylePrompt: "Vibrant young female tech enthusiast in Uzbek.",
  },
  {
    id: "jasur-business",
    name: "Jasur",
    baseVoice: "Charon",
    text: "Salom! Men Jasur. Biznes va tadbirkorlikda amaliy natijadorlik haqida gaplashamiz.",
    stylePrompt: "Authoritative, deep resonant male baritone in Uzbek.",
  },
  {
    id: "otabek-comedy",
    name: "Otabek",
    baseVoice: "Puck",
    text: "Salom barchaga! Men Otabek, kayfiyatingizni ko'taradigan quvnoq podkastlar yaratamiz!",
    stylePrompt: "Humorous, witty and lively young male podcaster in Uzbek.",
  },
  {
    id: "ulugbek-history",
    name: "Ulugbek",
    baseVoice: "Fenrir",
    text: "Assalomu alaykum. Men Ulug'bek, boy tariximiz va buyuk saboqlarni tahlil qilamiz.",
    stylePrompt: "Wise, profound and resonant deep male historian voice in Uzbek.",
  },
  {
    id: "farrux-tech",
    name: "Farrux",
    baseVoice: "Zephyr",
    text: "Salom! Men Farrux, axborot texnologiyalari va dasturlash haqida so'z yuritamiz.",
    stylePrompt: "Modern, articulate tech educator in Uzbek.",
  },
  {
    id: "bobur-coach",
    name: "Bobur",
    baseVoice: "Charon",
    text: "Salom do'stlar! Men Bobur, yangi maqsadlar va shaxsiy rivojlanish sari olg'a!",
    stylePrompt: "Powerful, driving and inspiring male motivational coach in Uzbek.",
  },
];

// Mapping for aliases
const ALIASES: Record<string, string> = {
  "puck-comedy": "otabek-comedy",
  "charon-history": "jasur-business",
  "kore-warm": "aziza-ai",
  "fenrir-mystery": "ulugbek-history",
  "zephyr-tech": "farrux-tech",
  "aoede-poetic": "zarina-culture",
};

async function generateAll() {
  const outputDir = path.join(process.cwd(), "public", "audio", "previews");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const generatedMap: Record<string, string> = {};

  for (const item of VOICES_TO_GENERATE) {
    const filePath = path.join(outputDir, `${item.id}.wav`);
    console.log(`Generating preview for: ${item.name} (${item.id}) using ${item.baseVoice}...`);

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash-tts",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: item.text,
                speechMetadata: {
                  speaker: item.name,
                  style: item.stylePrompt,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: item.baseVoice },
            },
          },
        },
      });

      const part = response.candidates?.[0]?.content?.parts?.[0];
      if (part?.inlineData?.data) {
        const rawBuf = Buffer.from(part.inlineData.data, "base64");
        const { pcm, sampleRate } = extractPcmData(rawBuf);
        const wavBuffer = buildWavBuffer(pcm, sampleRate);
        fs.writeFileSync(filePath, wavBuffer);
        const relUrl = `/audio/previews/${item.id}.wav`;
        generatedMap[item.id] = relUrl;
        console.log(`✓ Saved ${filePath} (${wavBuffer.length} bytes)`);
      } else {
        console.warn(`! No audio data returned for ${item.id}`);
      }
    } catch (err: any) {
      console.error(`X Error generating ${item.id}:`, err.message);
    }
  }

  // Copy aliases to their target files
  for (const [aliasId, targetId] of Object.entries(ALIASES)) {
    const targetFile = path.join(outputDir, `${targetId}.wav`);
    const aliasFile = path.join(outputDir, `${aliasId}.wav`);
    if (fs.existsSync(targetFile)) {
      fs.copyFileSync(targetFile, aliasFile);
      generatedMap[aliasId] = `/audio/previews/${aliasId}.wav`;
      console.log(`✓ Created alias ${aliasId}.wav -> ${targetId}.wav`);
    }
  }

  // Write manifest file to src/data/voicePreviews.ts
  const manifestTs = `// Autogenerated Prebuilt Voice Audio Previews Map
// All voice samples are pre-generated and stored in /public/audio/previews/
// Users listen to built-in previews instantly with ZERO API latency and ZERO token usage.

export const PREBUILT_VOICE_PREVIEWS: Record<string, string> = ${JSON.stringify(
    generatedMap,
    null,
    2
  )};

/**
 * Returns static audio preview URL for a given voiceId, or undefined if not prebuilt
 */
export function getVoicePreviewUrl(voiceId: string): string | undefined {
  if (PREBUILT_VOICE_PREVIEWS[voiceId]) {
    return PREBUILT_VOICE_PREVIEWS[voiceId];
  }
  // Try fallback to standard pattern
  return \`/audio/previews/\${voiceId}.wav\`;
}
`;

  fs.writeFileSync(path.join(process.cwd(), "src", "data", "voicePreviews.ts"), manifestTs);
  console.log("✓ Manifest written to src/data/voicePreviews.ts");
}

generateAll();
