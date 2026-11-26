import fs from "fs";
import path from "path";

export const MUX_AUDIO_CHUNK_MAX_BYTES = 10 * 1024 * 1024; // 10 MB per chunk ceiling (client sends 8 MB chunks)
export const MUX_AUDIO_MAX_CHUNKS = 32; // Up to 256 MB total WAV (~90 min @ 24kHz mono)
export const MUX_AUDIO_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

const UPLOAD_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

export interface MuxAudioChunkSession {
  uploadId: string;
  ownerUid: string;
  total: number;
  receivedIndices: Set<number>;
  sessionDir: string;
  assembledPath: string | null;
  assembledSizeBytes: number;
  createdAt: number;
  updatedAt: number;
}

export interface SaveAudioChunkInput {
  uploadId: string;
  index: number;
  total: number;
  chunkBuffer: Buffer;
  ownerUid: string;
}

export interface SaveAudioChunkResult {
  status: "chunk_received" | "assembled";
  uploadId: string;
  index: number;
  received: number;
  total: number;
  assembledSizeBytes?: number;
}

export interface ConsumedAudioUpload {
  filePath: string;
  sizeBytes: number;
  cleanup: () => Promise<void>;
}

export class MuxAudioChunkStore {
  private readonly baseDir: string;
  private readonly sessions = new Map<string, MuxAudioChunkSession>();

  constructor(baseDir = "/tmp/ovozstudio_mux_chunks") {
    this.baseDir = path.resolve(baseDir);
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  private resolveConfinedPath(...segments: string[]): string {
    const resolved = path.resolve(this.baseDir, ...segments);
    if (!resolved.startsWith(this.baseDir + path.sep)) {
      throw new Error("Invalid upload path");
    }
    return resolved;
  }

  private validateUploadId(uploadId: string): string {
    const trimmed = String(uploadId || "").trim();
    if (!UPLOAD_ID_RE.test(trimmed)) {
      throw new Error("Некорректный идентификатор загрузки uploadId");
    }
    return trimmed;
  }

  async cleanupExpiredSessions(maxAgeMs = MUX_AUDIO_SESSION_TTL_MS): Promise<void> {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.updatedAt > maxAgeMs) {
        this.sessions.delete(id);
        await fs.promises.rm(session.sessionDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  async saveChunk(input: SaveAudioChunkInput): Promise<SaveAudioChunkResult> {
    await this.cleanupExpiredSessions();

    const uploadId = this.validateUploadId(input.uploadId);
    const total = Number(input.total);
    const index = Number(input.index);
    const ownerUid = String(input.ownerUid || "");

    if (!Number.isInteger(total) || total < 1 || total > MUX_AUDIO_MAX_CHUNKS) {
      throw new Error(`Некорректное количество частей total (1..${MUX_AUDIO_MAX_CHUNKS})`);
    }
    if (!Number.isInteger(index) || index < 0 || index >= total) {
      throw new Error(`Некорректный индекс части index (0..${total - 1})`);
    }
    if (!Buffer.isBuffer(input.chunkBuffer) || input.chunkBuffer.length === 0) {
      throw new Error("Пустой фрагмент аудиодорожки");
    }
    if (input.chunkBuffer.length > MUX_AUDIO_CHUNK_MAX_BYTES) {
      throw new Error("Размер одной части превышает лимит 10 МБ");
    }

    let session = this.sessions.get(uploadId);
    if (!session) {
      const sessionDir = this.resolveConfinedPath(uploadId);
      await fs.promises.mkdir(sessionDir, { recursive: true });
      session = {
        uploadId,
        ownerUid,
        total,
        receivedIndices: new Set<number>(),
        sessionDir,
        assembledPath: null,
        assembledSizeBytes: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.sessions.set(uploadId, session);
    } else {
      if (session.ownerUid && ownerUid && session.ownerUid !== ownerUid) {
        throw new Error("Нет доступа к чужой сессии загрузки аудио");
      }
      if (session.total !== total) {
        throw new Error("Несовпадение общего числа частей total для этой сессии");
      }
    }

    const partName = `chunk_${String(index).padStart(4, "0")}.part`;
    const partPath = this.resolveConfinedPath(uploadId, partName);
    await fs.promises.writeFile(partPath, input.chunkBuffer);
    session.receivedIndices.add(index);
    session.updatedAt = Date.now();

    if (session.receivedIndices.size < total) {
      return {
        status: "chunk_received",
        uploadId,
        index,
        received: session.receivedIndices.size,
        total,
      };
    }

    // All chunks received — stream-assemble sequentially into assembled.wav
    const assembledPath = this.resolveConfinedPath(uploadId, "assembled.wav");
    const outStream = fs.createWriteStream(assembledPath);
    let assembledSizeBytes = 0;

    try {
      for (let i = 0; i < total; i++) {
        const currentPartPath = this.resolveConfinedPath(
          uploadId,
          `chunk_${String(i).padStart(4, "0")}.part`
        );
        const stat = await fs.promises.stat(currentPartPath);
        assembledSizeBytes += stat.size;
        await new Promise<void>((resolve, reject) => {
          const readStream = fs.createReadStream(currentPartPath);
          readStream.on("error", reject);
          readStream.on("end", resolve);
          readStream.pipe(outStream, { end: false });
        });
      }
      await new Promise<void>((resolve, reject) => {
        outStream.on("error", reject);
        outStream.end(() => resolve());
      });
    } catch (err) {
      outStream.destroy();
      await fs.promises.unlink(assembledPath).catch(() => {});
      throw err;
    }

    // Remove individual part files to conserve /tmp space
    for (let i = 0; i < total; i++) {
      const currentPartPath = this.resolveConfinedPath(
        uploadId,
        `chunk_${String(i).padStart(4, "0")}.part`
      );
      await fs.promises.unlink(currentPartPath).catch(() => {});
    }

    session.assembledPath = assembledPath;
    session.assembledSizeBytes = assembledSizeBytes;
    session.updatedAt = Date.now();

    return {
      status: "assembled",
      uploadId,
      index,
      received: total,
      total,
      assembledSizeBytes,
    };
  }

  async consumeAssembled(uploadIdRaw: string, ownerUid: string): Promise<ConsumedAudioUpload> {
    const uploadId = this.validateUploadId(uploadIdRaw);
    const session = this.sessions.get(uploadId);
    if (!session) {
      throw new Error("Загруженная аудиодорожка не найдена или истекла. Попробуйте собрать MP4 снова.");
    }
    if (session.ownerUid && ownerUid && session.ownerUid !== ownerUid) {
      throw new Error("Нет доступа к чужой загруженной аудиодорожке");
    }
    if (!session.assembledPath || !fs.existsSync(session.assembledPath)) {
      throw new Error(
        `Аудиодорожка ещё не собрана полностью (${session.receivedIndices.size}/${session.total} частей)`
      );
    }

    const confinedFile = this.resolveConfinedPath(uploadId, "assembled.wav");
    if (confinedFile !== session.assembledPath) {
      throw new Error("Invalid assembled audio path");
    }

    const sessionDir = session.sessionDir;
    const sizeBytes = session.assembledSizeBytes;
    this.sessions.delete(uploadId);

    return {
      filePath: confinedFile,
      sizeBytes,
      cleanup: async () => {
        await fs.promises.rm(sessionDir, { recursive: true, force: true }).catch(() => {});
      },
    };
  }
}

export const muxAudioChunkStore = new MuxAudioChunkStore();
