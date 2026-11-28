/**
 * Triggers the ONE live Stage 2 full Tiggo 8 Voice Lock control dubbing
 * via the temporary loopback-only internal endpoint on the running dev server
 * (where GEMINI_API_KEY is available in process.env).
 */
async function main() {
  const url = "http://127.0.0.1:3000/api/internal/run-voice-lock-stage2";
  console.log(`🚀 Launching Stage 2 live control dubbing via ${url} ...`);
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const text = await res.text();
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`HTTP ${res.status} in ${elapsedSec}s`);
  if (!res.ok) {
    console.error("Error response:", text);
    process.exit(1);
  }
  const data = JSON.parse(text);
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error("Failed to invoke Stage 2 live runner:", err);
  process.exit(1);
});
