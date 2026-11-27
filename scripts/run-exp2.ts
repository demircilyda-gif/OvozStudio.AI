import { GoogleGenAI } from "@google/genai";
import { runExperiment2Live } from "../server/services/dubbing/exp2Runner.ts";

async function main() {
  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (envKey) {
    const ai = new GoogleGenAI({ apiKey: envKey, apiVersion: "v1beta" });
    const summary = await runExperiment2Live(ai);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  // Fallback: invoke the local dev server loopback endpoint (which holds the runtime GEMINI_API_KEY)
  console.log("[run-exp2] Calling http://127.0.0.1:3000/api/internal/run-exp2 ...");
  const res = await fetch("http://127.0.0.1:3000/api/internal/run-exp2", {
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
  console.error("[run-exp2] FAILED:", err);
  process.exit(1);
});
