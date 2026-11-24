import dotenv from "dotenv";
dotenv.config();

import { GoogleGenAI } from "@google/genai";
import { localStore } from "../server/localStore.ts";
import { runCartoonVoiceVerification } from "../server/services/tts/cartoonVoiceVerifier.ts";

async function main() {
  const candidates = [
    process.env.CUSTOM_GEMINI_API_KEY,
    localStore.getGeminiApiKey(),
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.API_KEY,
  ]
    .map((k) => (k || "").trim())
    .filter(Boolean);
  const apiKey = candidates.find((k) => k.startsWith("AIza")) || candidates[0] || "";
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in environment or localStore.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const report = await runCartoonVoiceVerification(ai);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
