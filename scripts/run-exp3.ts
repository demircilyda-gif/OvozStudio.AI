import { GoogleGenAI } from "@google/genai";
import { runExperiment3Live } from "../server/services/dubbing/exp3Runner.ts";

async function main() {
  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (envKey) {
    const ai = new GoogleGenAI({ apiKey: envKey, apiVersion: "v1beta" });
    const summary = await runExperiment3Live(ai);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  // Fallback: invoke local loopback endpoint on dev server (which holds runtime GEMINI_API_KEY)
  console.log("[run-exp3] Calling http://127.0.0.1:3000/api/internal/run-exp3 ...");
  const res = await fetch("http://127.0.0.1:3000/api/internal/run-exp3", {
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
  console.error("[run-exp3] FAILED:", err);
  process.exit(1);
});
