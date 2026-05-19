/**
 * Pluggable storage backend for file artifacts.
 *
 * Switches between local-disk (dev / single-instance) and AWS S3 (prod /
 * containerised). Selected via STORAGE_BACKEND env:
 *
 *   STORAGE_BACKEND=local   → /tmp/sessions-artifacts/{sessionId}/{filename}
 *   STORAGE_BACKEND=s3      → s3://${S3_ARTIFACTS_BUCKET}/artifacts/{sessionId}/{filename}
 *
 * Why this exists: ECS Fargate task storage is ephemeral. Container
 * restarts wipe /tmp, taking every saved workbook with them. S3 makes
 * artifacts durable across restarts and shareable across multiple
 * container instances (HA / autoscaling).
 *
 * Both backends:
 *   - return a relative URL pointing back at our /api/research/artifacts
 *     route (the route then proxies the bytes back from the backend)
 *   - enforce path-traversal protection at the lookup boundary
 *   - return a stream + content-type + size for downloads
 *
 * S3 client is dynamically imported only when STORAGE_BACKEND=s3 — the
 * @aws-sdk/client-s3 dep is large (~200 KB compressed) and adds startup
 * latency, so we avoid loading it in dev.
 */

import * as fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { Readable } from "node:stream";
import { logger } from "./logger";

const ARTIFACTS_ROOT = process.env.ARTIFACTS_ROOT || "/tmp/sessions-artifacts";

export interface StoredArtifact {
  /** URL the frontend hits to download (relative). */
  url: string;
  /** Bytes on disk / in S3. */
  sizeBytes: number;
  /** Backend-specific reference (path or s3 key) — debug only. */
  ref: string;
}

export interface ResolvedArtifact {
  /** Node stream emitting the file bytes. */
  stream: NodeJS.ReadableStream;
  contentType: string;
  sizeBytes: number;
}

export interface StorageBackend {
  readonly kind: "local" | "s3";
  /** Persist a buffer under sessionId/filename. Returns the URL the
   *  frontend should use to retrieve it. */
  putArtifact(sessionId: string, filename: string, buffer: Buffer): Promise<StoredArtifact>;
  /** Stream back a stored artifact. Returns null when not found (or when
   *  the requested path/key is rejected by path-traversal defence). */
  getArtifact(sessionId: string, filename: string): Promise<ResolvedArtifact | null>;
}

/* ─────────────────── Helpers shared across backends ─────────────────── */

const SAFE_FILENAME_RE = /^[a-zA-Z0-9._-]+$/;
function isSafeFilename(name: string): boolean {
  if (!name || typeof name !== "string") return false;
  if (name === "." || name === "..") return false;
  if (name.length > 200) return false;
  return SAFE_FILENAME_RE.test(name);
}

function inferContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === ".csv") return "text/csv; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

function buildDownloadUrl(sessionId: string, filename: string): string {
  return `/api/research/artifacts/${encodeURIComponent(sessionId)}/${encodeURIComponent(filename)}`;
}

/* ─────────────────────────── Local backend ─────────────────────────── */

const localBackend: StorageBackend = {
  kind: "local",

  async putArtifact(sessionId, filename, buffer) {
    if (!isSafeFilename(filename)) throw new Error(`Unsafe filename: ${filename}`);
    const sessionDir = path.join(ARTIFACTS_ROOT, String(sessionId));
    await fs.mkdir(sessionDir, { recursive: true });
    const absolutePath = path.join(sessionDir, filename);
    await fs.writeFile(absolutePath, buffer);
    return {
      url: buildDownloadUrl(sessionId, filename),
      sizeBytes: buffer.byteLength,
      ref: absolutePath,
    };
  },

  async getArtifact(sessionId, filename) {
    if (!isSafeFilename(filename)) return null;
    const sessionDir = path.join(ARTIFACTS_ROOT, String(sessionId));
    const candidate = path.join(sessionDir, filename);
    // Path-traversal defence
    const resolvedDir = path.resolve(sessionDir);
    const resolvedFile = path.resolve(candidate);
    if (!resolvedFile.startsWith(resolvedDir + path.sep)) return null;
    try {
      const stat = await fs.stat(resolvedFile);
      if (!stat.isFile()) return null;
      return {
        stream: createReadStream(resolvedFile),
        contentType: inferContentType(filename),
        sizeBytes: stat.size,
      };
    } catch {
      return null;
    }
  },
};

/* ─────────────────────────── S3 backend ─────────────────────────── */

interface S3Client {
  send(cmd: any): Promise<any>;
}
let _s3: S3Client | null = null;
let _PutObjectCommand: any = null;
let _GetObjectCommand: any = null;

async function getS3(): Promise<{ s3: S3Client; PutObjectCommand: any; GetObjectCommand: any; bucket: string }> {
  const bucket = process.env.S3_ARTIFACTS_BUCKET;
  if (!bucket) throw new Error("S3_ARTIFACTS_BUCKET env not set");
  if (!_s3) {
    // Dynamic import — keeps the dep out of the dev hot path.
    const aws = await import("@aws-sdk/client-s3");
    _s3 = new aws.S3Client({
      region: process.env.AWS_REGION || "us-east-1",
    });
    _PutObjectCommand = aws.PutObjectCommand;
    _GetObjectCommand = aws.GetObjectCommand;
  }
  return { s3: _s3!, PutObjectCommand: _PutObjectCommand, GetObjectCommand: _GetObjectCommand, bucket };
}

function s3Key(sessionId: string, filename: string): string {
  // Bucket layout: artifacts/{sessionId}/{filename}
  return `artifacts/${sessionId}/${filename}`;
}

const s3Backend: StorageBackend = {
  kind: "s3",

  async putArtifact(sessionId, filename, buffer) {
    if (!isSafeFilename(filename)) throw new Error(`Unsafe filename: ${filename}`);
    const { s3, PutObjectCommand, bucket } = await getS3();
    const key = s3Key(sessionId, filename);
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: inferContentType(filename),
        // Don't allow public reads — the download route handles auth
        // and proxies the bytes; never expose the bucket publicly.
        ACL: "private",
        ServerSideEncryption: "AES256",
      }),
    );
    return {
      url: buildDownloadUrl(sessionId, filename),
      sizeBytes: buffer.byteLength,
      ref: `s3://${bucket}/${key}`,
    };
  },

  async getArtifact(sessionId, filename) {
    if (!isSafeFilename(filename)) return null;
    try {
      const { s3, GetObjectCommand, bucket } = await getS3();
      const key = s3Key(sessionId, filename);
      const resp: any = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = resp.Body;
      if (!body) return null;
      // AWS SDK v3 returns a Web stream — normalize to Node stream for
      // pipe() compatibility with the existing route handler.
      const stream =
        typeof (body as any).pipe === "function"
          ? (body as NodeJS.ReadableStream)
          : (Readable.fromWeb(body as any) as NodeJS.ReadableStream);
      const sizeBytes = Number(resp.ContentLength || 0);
      const contentType = String(resp.ContentType || inferContentType(filename));
      return { stream, contentType, sizeBytes };
    } catch (err: any) {
      // 404 (NoSuchKey) → return null so route returns clean 404.
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NoSuchKey") return null;
      logger.warn?.({ err: err?.message, sessionId, filename }, "s3 getArtifact failed");
      return null;
    }
  },
};

/* ─────────────────────────── Resolution ─────────────────────────── */

let _backend: StorageBackend | null = null;
export function getStorageBackend(): StorageBackend {
  if (_backend) return _backend;
  const choice = (process.env.STORAGE_BACKEND || "local").toLowerCase();
  if (choice === "s3") {
    _backend = s3Backend;
  } else {
    _backend = localBackend;
  }
  logger.info?.({ backend: _backend.kind }, "storage backend selected");
  return _backend;
}

/** Test hook — reset cached backend so a test can flip STORAGE_BACKEND
 *  mid-test. Production code MUST NOT call this. */
export function _resetStorageBackendForTests(): void {
  _backend = null;
  _s3 = null;
  _PutObjectCommand = null;
  _GetObjectCommand = null;
}
