import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Where brand images live. Files never enter PostgreSQL, which holds only their keys. A key is
 * built here from a venue id and a content hash, so it is safe as a path.
 */
export interface BrandStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** Null when the key holds nothing. */
  get(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
}

export const BRAND_STORE = Symbol("BRAND_STORE");

/** Cloudflare R2, through Bun's own S3 client. */
export class R2BrandStore implements BrandStore {
  private readonly client: Bun.S3Client;

  constructor(options: {
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) {
    this.client = new Bun.S3Client(options);
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await this.client.write(key, bytes, { type: "image/webp" });
  }

  async get(key: string): Promise<Uint8Array | null> {
    const file = this.client.file(key);
    return (await file.exists()) ? file.bytes() : null;
  }

  async remove(key: string): Promise<void> {
    await this.client.delete(key);
  }
}

/** Development and tests: a folder under `data/`, so nobody needs a bucket to run HashiFi. */
export class DiskBrandStore implements BrandStore {
  constructor(private readonly dir: string) {}

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const path = join(this.dir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async get(key: string): Promise<Uint8Array | null> {
    return readFile(join(this.dir, key)).catch(() => null);
  }

  async remove(key: string): Promise<void> {
    await rm(join(this.dir, key), { force: true });
  }
}
