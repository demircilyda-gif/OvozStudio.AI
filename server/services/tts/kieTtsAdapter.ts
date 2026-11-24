import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { TTS_MODELS_CONFIG } from "../../config/ttsModels.ts";
import { resolveFfmpegPath } from "../../utils/ffmpegBinary.ts";

const execFileAsync = promisify(execFile);

export interface KieTtsParams {
  text: string;
  voiceName: string; // Charon | Fenrir | Kore | Puck | Aoede | Zephyr
  style?: string;
}

/**
 * Быстрый разбор 24kHz 16-bit mono WAV напрямую в памяти без вызова ffmpeg.
 * Возвращает raw PCM Buffer, если входной файл уже в формате 24kHz 16-bit mono PCM WAV, иначе null.
 */
function tryExtractDirectPcm24kFromWav(rawBuf: Buffer): Buffer | null {
  if (
    rawBuf.length <= 44 ||
    rawBuf.toString("ascii", 0, 4) !== "RIFF" ||
    rawBuf.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return null;
  }
  let audioFormat = 0;
  let numChannels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataSlice: Buffer | null = null;

  let offset = 12;
  while (offset + 8 <= rawBuf.length) {
    const chunkId = rawBuf.toString("ascii", offset, offset + 4);
    const chunkSize = rawBuf.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;
    if (chunkId === "fmt " && bodyStart + 16 <= rawBuf.length) {
      audioFormat = rawBuf.readUInt16LE(bodyStart);
      numChannels = rawBuf.readUInt16LE(bodyStart + 2);
      sampleRate = rawBuf.readUInt32LE(bodyStart + 4);
      bitsPerSample = rawBuf.readUInt16LE(bodyStart + 14);
    } else if (chunkId === "data") {
      dataSlice = rawBuf.subarray(bodyStart, Math.min(rawBuf.length, bodyStart + chunkSize));
      break;
    }
    offset = bodyStart + chunkSize + (chunkSize % 2);
  }

  if (
    dataSlice &&
    dataSlice.length > 0 &&
    audioFormat === 1 &&
    numChannels === 1 &&
    sampleRate === 24000 &&
    bitsPerSample === 16
  ) {
    return Buffer.from(dataSlice);
  }
  return null;
}

/**
 * Перекодирует любой аудиофайл (MP3/WAV/OGG) в 24kHz 16-bit mono PCM (s16le) через ffmpeg-static / system ffmpeg.
 */
export async function transcodeAudioFileToPcm24k(inputPath: string): Promise<Buffer> {
  // Fast-path: если файл уже 24kHz mono 16-bit WAV (стандарт Gemini TTS), читаем PCM напрямую
  try {
    const raw = fs.readFileSync(inputPath);
    const directPcm = tryExtractDirectPcm24kFromWav(raw);
    if (directPcm) return directPcm;
  } catch {}

  const ffmpegBin = resolveFfmpegPath();
  if (!ffmpegBin) {
    throw new Error("ffmpeg не найден на сервере для декодирования резервного аудио kie.ai.");
  }

  const outPath = `${inputPath}.24k.pcm`;
  try {
    await execFileAsync(ffmpegBin, [
      "-y",
      "-i",
      inputPath,
      "-ac",
      "1",
      "-ar",
      "24000",
      "-f",
      "s16le",
      outPath,
    ]);
    return fs.readFileSync(outPath);
  } finally {
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch {}
  }
}

/**
 * Позволяет инжектировать тестовый обработчик для автотестов переключения на kie.ai при 429/402.
 */
let testKieOverrideHandler: ((params: KieTtsParams) => Promise<Buffer>) | null = null;
export function setKieTestOverrideHandler(
  handler: ((params: KieTtsParams) => Promise<Buffer>) | null
) {
  testKieOverrideHandler = handler;
}

/**
 * Запасной канал озвучки: kie.ai (модель google/gemini-3-8-flash-tts).
 * Вызывается ТОЛЬКО при ответе 429 или 402 от Google и ТОЛЬКО для встроенных голосов.
 * Цикл работы: создание задачи -> опрос статуса -> скачивание файла -> перекодирование ffmpeg в 24kHz PCM.
 */
export async function synthesizeViaKieAi(params: KieTtsParams): Promise<{ pcm: Buffer }> {
  if (testKieOverrideHandler) {
    const pcm = await testKieOverrideHandler(params);
    return { pcm };
  }

  const apiKey = TTS_MODELS_CONFIG.getKieApiKey();
  if (!apiKey) {
    throw new Error(
      "Лимит Google Gemini TTS исчерпан (429), а резервный ключ KIE_API_KEY (kie.ai) не задан в настройках сервера."
    );
  }

  const baseUrl = TTS_MODELS_CONFIG.kieApiBaseUrl.replace(/\/+$/, "");

  // 1. Создание задачи в kie.ai (официальная схема google/gemini-3-8-flash-tts: speakers + dialogue_turns)
  const speakerId = "Speaker 1";
  const createResp = await fetch(`${baseUrl}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TTS_MODELS_CONFIG.kieModel,
      input: {
        speakers: [
          {
            speaker_id: speakerId,
            voice_name: params.voiceName,
            ...(params.style ? { style: params.style } : {}),
          },
        ],
        dialogue_turns: [
          {
            speaker_id: speakerId,
            text: params.text,
          },
        ],
        temperature: 1.0,
      },
    }),
  });

  if (!createResp.ok) {
    const errBody = await createResp.text().catch(() => "");
    throw new Error(`kie.ai createTask error (${createResp.status}): ${errBody.slice(0, 300)}`);
  }

  const createJson: any = await createResp.json();
  if (typeof createJson?.code === "number" && createJson.code !== 200) {
    throw new Error(
      `kie.ai createTask rejected (code ${createJson.code}): ${createJson?.msg || createJson?.message || JSON.stringify(createJson).slice(0, 250)}`
    );
  }
  const taskId =
    createJson?.data?.taskId ||
    createJson?.data?.task_id ||
    createJson?.taskId ||
    createJson?.id;

  if (!taskId) {
    throw new Error(`kie.ai did not return taskId: ${JSON.stringify(createJson).slice(0, 250)}`);
  }

  // 2. Опрос статуса задачи
  const maxPolls = 45;
  let audioDownloadUrl = "";

  for (let poll = 0; poll < maxPolls; poll++) {
    await new Promise((r) => setTimeout(r, 1200));

    const pollResp = await fetch(
      `${baseUrl}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (!pollResp.ok) continue;
    const pollJson: any = await pollResp.json();
    const data = pollJson?.data || pollJson;
    const state = String(data?.state || data?.status || "").toLowerCase();

    if (state === "success" || state === "completed" || state === "succeeded") {
      let resultObj: any = data?.resultJson || data?.result || data?.output;
      if (typeof resultObj === "string") {
        try {
          resultObj = JSON.parse(resultObj);
        } catch {}
      }
      audioDownloadUrl =
        resultObj?.resultUrls?.[0] ||
        resultObj?.audioUrl ||
        resultObj?.audio_url ||
        resultObj?.url ||
        data?.audioUrl ||
        "";
      if (audioDownloadUrl) break;
    }

    if (state === "fail" || state === "failed" || state === "error") {
      throw new Error(
        `kie.ai TTS task failed: ${data?.failMsg || data?.error || "Unknown error"}`
      );
    }
  }

  if (!audioDownloadUrl) {
    throw new Error("kie.ai TTS task timed out waiting for audio URL");
  }

  // 3. Скачивание аудиофайла
  const audioResp = await fetch(audioDownloadUrl);
  if (!audioResp.ok) {
    throw new Error(`Failed to download audio from kie.ai (${audioResp.status})`);
  }

  const arrayBuf = await audioResp.arrayBuffer();
  const rawBuffer = Buffer.from(arrayBuf);

  // 4. Перекодирование в 24kHz 16-bit mono PCM через ffmpeg
  const tmpFile = path.join(
    os.tmpdir(),
    `kie_tts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.audio`
  );
  try {
    fs.writeFileSync(tmpFile, rawBuffer);
    const pcm = await transcodeAudioFileToPcm24k(tmpFile);
    if (!pcm || pcm.length === 0) {
      throw new Error("kie.ai audio transcoding produced empty PCM");
    }
    return { pcm };
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {}
  }
}

export interface KieDialogueTurnInput {
  speaker: string;
  voice: string;
  text: string;
  style?: string;
}

let testKieDialogueOverrideHandler:
  | ((turns: KieDialogueTurnInput[]) => Promise<Buffer>)
  | null = null;

export function setKieDialogueTestOverrideHandler(
  handler: ((turns: KieDialogueTurnInput[]) => Promise<Buffer>) | null
) {
  testKieDialogueOverrideHandler = handler;
}

/**
 * Раздел 2.8: Запасной канал для пакетного дубляжа (встроенные голоса при 429 от Google).
 * Отправляет тот же блок той же моделью google/gemini-3-8-flash-tts через kie.ai с dialogue_turns и style на реплику.
 */
export async function synthesizeDialogueBlockViaKieAi(
  turns: KieDialogueTurnInput[]
): Promise<{ pcm: Buffer }> {
  if (testKieDialogueOverrideHandler) {
    const pcm = await testKieDialogueOverrideHandler(turns);
    return { pcm };
  }

  const apiKey = TTS_MODELS_CONFIG.getKieApiKey();
  if (!apiKey) {
    throw new Error(
      "Лимит Google Gemini TTS исчерпан (429), а резервный ключ KIE_API_KEY (kie.ai) не задан в настройках сервера."
    );
  }

  const baseUrl = TTS_MODELS_CONFIG.kieApiBaseUrl.replace(/\/+$/, "");

  // Собираем список уникальных спикеров по официальной схеме google/gemini-3-8-flash-tts
  // kie.ai строго требует формат speaker_id: "Speaker 1", "Speaker 2", ... ("Speaker N")
  const speakerNameToId = new Map<string, string>();
  const speakerDefMap = new Map<
    string,
    { speaker_id: string; voice_name: string; style?: string }
  >();
  for (const t of turns) {
    let speakerId = speakerNameToId.get(t.speaker);
    if (!speakerId) {
      speakerId = `Speaker ${speakerNameToId.size + 1}`;
      speakerNameToId.set(t.speaker, speakerId);
      speakerDefMap.set(speakerId, {
        speaker_id: speakerId,
        voice_name: t.voice,
        ...(t.style ? { style: t.style } : {}),
      });
    }
  }
  const uniqueSpeakers = Array.from(speakerDefMap.values());

  const createResp = await fetch(`${baseUrl}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TTS_MODELS_CONFIG.kieModel,
      input: {
        speakers: uniqueSpeakers,
        dialogue_turns: turns.map((t) => ({
          speaker_id: speakerNameToId.get(t.speaker) || "Speaker 1",
          text: t.text,
        })),
        temperature: 1.0,
      },
    }),
  });

  if (!createResp.ok) {
    const errBody = await createResp.text().catch(() => "");
    throw new Error(`kie.ai dialogue createTask error (${createResp.status}): ${errBody.slice(0, 300)}`);
  }

  const createJson: any = await createResp.json();
  if (typeof createJson?.code === "number" && createJson.code !== 200) {
    throw new Error(
      `kie.ai dialogue rejected (code ${createJson.code}): ${createJson?.msg || createJson?.message || JSON.stringify(createJson).slice(0, 250)}`
    );
  }
  const taskId =
    createJson?.data?.taskId ||
    createJson?.data?.task_id ||
    createJson?.taskId ||
    createJson?.id;

  if (!taskId) {
    throw new Error(`kie.ai dialogue did not return taskId: ${JSON.stringify(createJson).slice(0, 250)}`);
  }

  const maxPolls = 60;
  let audioDownloadUrl = "";
  for (let poll = 0; poll < maxPolls; poll++) {
    await new Promise((r) => setTimeout(r, 1500));
    const pollResp = await fetch(
      `${baseUrl}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!pollResp.ok) continue;
    const pollJson: any = await pollResp.json();
    const data = pollJson?.data || pollJson;
    const state = String(data?.state || data?.status || "").toLowerCase();

    if (state === "success" || state === "completed" || state === "succeeded") {
      let resultObj: any = data?.resultJson || data?.result || data?.output;
      if (typeof resultObj === "string") {
        try {
          resultObj = JSON.parse(resultObj);
        } catch {}
      }
      audioDownloadUrl =
        resultObj?.resultUrls?.[0] ||
        resultObj?.audioUrl ||
        resultObj?.audio_url ||
        resultObj?.url ||
        data?.audioUrl ||
        "";
      if (audioDownloadUrl) break;
    }
    if (state === "fail" || state === "failed" || state === "error") {
      throw new Error(`kie.ai dialogue task failed: ${data?.failMsg || data?.error || "Unknown"}`);
    }
  }

  if (!audioDownloadUrl) {
    throw new Error("kie.ai dialogue TTS task timed out waiting for audio URL");
  }

  const audioResp = await fetch(audioDownloadUrl);
  if (!audioResp.ok) {
    throw new Error(`Failed to download kie.ai dialogue audio (${audioResp.status})`);
  }
  const rawBuffer = Buffer.from(await audioResp.arrayBuffer());
  const tmpFile = path.join(
    os.tmpdir(),
    `kie_dlg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.audio`
  );
  try {
    fs.writeFileSync(tmpFile, rawBuffer);
    const pcm = await transcodeAudioFileToPcm24k(tmpFile);
    if (!pcm || pcm.length === 0) {
      throw new Error("kie.ai dialogue transcoding produced empty PCM");
    }
    return { pcm };
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {}
  }
}
