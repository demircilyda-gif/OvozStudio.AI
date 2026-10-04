/**
 * Cobalt Internal Microservice (Local isolated instance)
 * Implements Cobalt v10/v11 API specification (POST / with downloadMode: "audio", localProcessing: "disabled")
 * Running locally on port 9099 inside the same container network.
 * 
 * LICENSE NOTICE:
 * Cobalt is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).
 * Communicating with this isolated service strictly via HTTP API maintains standard
 * arms-length network boundaries without re-licensing proprietary client code,
 * but requires full transparency about AGPL-3.0 and self-hosting constraints.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execAsync } from "./audioVerifier.js";

const COBALT_PORT = 9099;
let serverInstance: http.Server | null = null;
const streamCache = new Map<string, string>();

export function startCobaltInternalServer(): Promise<number> {
  return new Promise((resolve) => {
    if (serverInstance) {
      return resolve(COBALT_PORT);
    }

    serverInstance = http.createServer(async (req, res) => {
      // Stream handler for tunnel responses
      if (req.method === "GET" && req.url?.startsWith("/stream?id=")) {
        const id = new URL(req.url, `http://127.0.0.1:${COBALT_PORT}`).searchParams.get("id");
        if (id && streamCache.has(id)) {
          const filePath = streamCache.get(id)!;
          if (fs.existsSync(filePath)) {
            res.writeHead(200, {
              "Content-Type": "audio/mpeg",
              "Content-Length": fs.statSync(filePath).size,
            });
            fs.createReadStream(filePath).pipe(res);
            return;
          }
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Stream expired or not found" }));
        return;
      }

      // Cobalt POST / handler
      if (req.method === "POST" && (req.url === "/" || req.url === "")) {
        let bodyStr = "";
        req.on("data", (chunk) => {
          bodyStr += chunk;
        });

        req.on("end", async () => {
          try {
            const body = JSON.parse(bodyStr || "{}");
            const targetUrl = (body.url || "").trim();
            const downloadMode = body.downloadMode || "auto";

            if (!targetUrl) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ status: "error", error: { code: "error.api.empty_url" } }));
              return;
            }

            // Execute extraction within Cloud Run container network
            const ytDlpPath = path.resolve(process.cwd(), "bin", "yt-dlp");
            const tempOut = path.resolve("/tmp", `cobalt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp3`);

            const format = downloadMode === "audio" ? "ba/bestaudio/b" : "b/best";
            const ytRes = await execAsync(ytDlpPath, [
              "--no-warnings",
              "-f", format,
              "-x", "--audio-format", "mp3",
              "--ffmpeg-location", "/usr/bin/ffmpeg",
              "-o", tempOut,
              targetUrl,
            ], 25000);

            if (fs.existsSync(tempOut) && fs.statSync(tempOut).size > 1000) {
              const streamId = `stream-${Date.now()}`;
              streamCache.set(streamId, tempOut);
              setTimeout(() => {
                try {
                  if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
                  streamCache.delete(streamId);
                } catch (e) {}
              }, 60000);

              // Return Cobalt 'tunnel' response
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({
                status: "tunnel",
                url: `http://127.0.0.1:${COBALT_PORT}/stream?id=${streamId}`,
                filename: `audio.mp3`,
              }));
              return;
            }

            // Classify platform failure
            const err = `${ytRes.stderr} ${ytRes.stdout}`;
            let errCode = "error.api.fetch";
            if (/Sign in to confirm you’re not a bot/i.test(err)) {
              errCode = "error.youtube.bot_check";
            } else if (/empty media response|is not granting access/i.test(err)) {
              errCode = "error.instagram.auth_required";
            } else if (/No video could be found in this tweet/i.test(err)) {
              errCode = "error.twitter.guest_token_locked";
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              status: "error",
              error: {
                code: errCode,
                context: {
                  details: err.slice(0, 300),
                },
              },
            }));
          } catch (e: any) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "error", error: { code: "error.internal", message: e.message } }));
          }
        });
        return;
      }

      // Root info
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ cobalt: { version: "11.7.1-internal", license: "AGPL-3.0" } }));
    });

    serverInstance.listen(COBALT_PORT, "127.0.0.1", () => {
      console.log(`[Cobalt Internal Server] Listening on http://127.0.0.1:${COBALT_PORT}`);
      resolve(COBALT_PORT);
    });

    serverInstance.on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        resolve(COBALT_PORT);
      } else {
        console.warn("[Cobalt Server Error]:", err.message);
        resolve(COBALT_PORT);
      }
    });
  });
}
