import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

interface FileMetadata {
  filepath: string;
  downloadName: string;
  createdAt: Date;
  downloaded: boolean;
}

const FILE_TTL_MS = 60 * 60 * 1000; // 1 hour

export class Storage {
  private dir: string;
  private files = new Map<string, FileMetadata>();

  constructor(dir = "./uploads") {
    this.dir = path.resolve(dir);
  }

  /** Ensure the uploads directory exists. Call once at startup. */
  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  /**
   * Write `data` to disk under a UUID-v4 filename.
   * Returns a download token and its expiry time (1 hour from now).
   */
  async storeFile(data: Buffer, slug?: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomUUID();
    const filepath = path.join(this.dir, token);

    await fs.writeFile(filepath, data);

    const shortId = token.split('-')[0];
    const downloadName = slug
      ? `${slug}-${shortId}.zip`
      : `${token}.zip`;

    this.files.set(token, {
      filepath,
      downloadName,
      createdAt: new Date(),
      downloaded: false,
    });

    const expiresAt = new Date(Date.now() + FILE_TTL_MS);
    return { token, expiresAt };
  }

  /**
   * Retrieve a stored file by its token.
   *
   * Returns `null` when the token is unknown, the file has expired,
   * or it has already been downloaded once.
   *
   * On success the file is marked as downloaded and removed from disk.
   */
  async getFile(
    token: string,
  ): Promise<{ data: Buffer; filename: string } | null> {
    const meta = this.files.get(token);
    if (!meta) return null;

    if (meta.downloaded) return null;

    const age = Date.now() - meta.createdAt.getTime();
    if (age > FILE_TTL_MS) return null;

    let data: Buffer;
    try {
      data = await fs.readFile(meta.filepath);
    } catch {
      return null;
    }

    // Mark downloaded and clean up disk
    meta.downloaded = true;
    try {
      await fs.unlink(meta.filepath);
    } catch {
      // already gone — ignore
    }

    return { data, filename: meta.downloadName };
  }

  /**
   * Delete every tracked file older than 1 hour.
   * Returns the number of files removed.
   */
  async cleanup(): Promise<number> {
    const now = Date.now();
    let deleted = 0;

    for (const [token, meta] of this.files) {
      const age = now - meta.createdAt.getTime();
      if (age > FILE_TTL_MS) {
        try {
          await fs.unlink(meta.filepath);
        } catch {
          // file may already be gone
        }
        this.files.delete(token);
        deleted++;
      }
    }

    return deleted;
  }
}
