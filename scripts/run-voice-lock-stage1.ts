import { GoogleGenAI } from "@google/genai";
import { runVoiceLockStage1Live } from "../server/services/dubbing/voiceLockStage1Runner.ts";

async function main() {
  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (envKey) {
    const ai = new GoogleGenAI({
      apiKey: envKey,
      apiVersion: "v1beta",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
    const summary = await runVoiceLockStage1Live(ai);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log("[run-voice-lock-stage1] Calling http://127.0.0.1:3000/api/internal/run-voice-lock-stage1 ...");
  const res = await fetch("http://127.0.0.1:3000/api/internal/run-voice-lock-stage1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  console.log(text);
}

main().catch((err) => {
  console.error("[run-voice-lock-stage1] FAILED:", err);
  process.exit(1);
});
