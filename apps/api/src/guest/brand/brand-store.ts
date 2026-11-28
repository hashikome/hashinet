import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

/**
 * Where brand images live. Files never enter PostgreSQL, which holds only their keys. A key is
 * built here from a venue id and a content hash, so it is safe as a path.
 */
export interface BrandStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** Null when the key holds nothing. */
  get(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
  /** Every file held, with when it was written, for sweeping what nothing references. */
  list(): Promise<{ key: string; at: Date }[]>;
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

  async list(): Promise<{ key: string; at: Date }[]> {
    const found: { key: string; at: Date }[] = [];
    let token: string | null = null;
    do {
      const page = await this.client.list(token === null ? {} : { continuationToken: token });
      for (const o of page.contents ?? []) {
        found.push({ key: o.key, at: new Date(o.lastModified ?? 0) });
      }
      token = page.isTruncated ? (page.nextContinuationToken ?? null) : null;
    } while (token !== null);
    return found;
  }
}

/** Development and tests: a folder under `data/`, so nobody needs a bucket to run HashiNet. */
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

  async list(): Promise<{ key: string; at: Date }[]> {
    const names = await readdir(this.dir, { recursive: true }).catch(() => []);
    const found: { key: string; at: Date }[] = [];
    for (const name of names) {
      const path = join(this.dir, name);
      const info = await stat(path);
      if (info.isFile()) found.push({ key: relative(this.dir, path), at: info.mtime });
    }
    return found;
  }
}
