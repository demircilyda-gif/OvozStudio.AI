import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { TTS_MODELS_CONFIG } from "../../config/ttsModels.ts";

const execFileAsync = promisify(execFile);

export interface KieTtsParams {
  text: string;
  voiceName: string; // Charon | Fenrir | Kore | Puck | Aoede | Zephyr
  style?: string;
}

/**
 * Перекодирует любой аудиофайл (MP3/WAV/OGG) в 24kHz 16-bit mono PCM (s16le) через ffmpeg.
 */
export async function transcodeAudioFileToPcm24k(inputPath: string): Promise<Buffer> {
  const outPath = `${inputPath}.24k.pcm`;
  try {
    await execFileAsync("/usr/bin/ffmpeg", [
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

  // 1. Создание задачи в kie.ai
  const createResp = await fetch(`${baseUrl}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TTS_MODELS_CONFIG.kieModel,
      input: {
        text: params.text,
        voice: params.voiceName,
        voice_name: params.voiceName,
        ...(params.style ? { style: params.style, prompt: params.style } : {}),
      },
    }),
  });

  if (!createResp.ok) {
    const errBody = await createResp.text().catch(() => "");
    throw new Error(`kie.ai createTask error (${createResp.status}): ${errBody.slice(0, 200)}`);
  }

  const createJson: any = await createResp.json();
  const taskId =
    createJson?.data?.taskId ||
    createJson?.data?.task_id ||
    createJson?.taskId ||
    createJson?.id;

  if (!taskId) {
    throw new Error(`kie.ai did not return taskId: ${JSON.stringify(createJson).slice(0, 200)}`);
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

  const uniqueSpeakers = Array.from(
    new Map(turns.map((t) => [t.speaker, { speaker: t.speaker, voice: t.voice }])).values()
  );

  const createResp = await fetch(`${baseUrl}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TTS_MODELS_CONFIG.kieModel,
      input: {
        dialogue_turns: turns.map((t) => ({
          speaker: t.speaker,
          voice: t.voice,
          text: t.text,
          ...(t.style ? { style: t.style } : {}),
        })),
        speakers: uniqueSpeakers,
      },
    }),
  });

  if (!createResp.ok) {
    const errBody = await createResp.text().catch(() => "");
    throw new Error(`kie.ai dialogue createTask error (${createResp.status}): ${errBody.slice(0, 200)}`);
  }

  const createJson: any = await createResp.json();
  const taskId =
    createJson?.data?.taskId ||
    createJson?.data?.task_id ||
    createJson?.taskId ||
    createJson?.id;

  if (!taskId) {
    throw new Error(`kie.ai dialogue did not return taskId: ${JSON.stringify(createJson).slice(0, 200)}`);
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
