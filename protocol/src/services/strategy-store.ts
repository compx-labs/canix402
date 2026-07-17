import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { StrategyDocument } from "../types/strategy-schema.js";

export interface StrategyStore {
  put(document: StrategyDocument): Promise<void>;
  get(strategyId: number): Promise<StrategyDocument | undefined>;
  listIds(): Promise<number[]>;
}

function strategyKey(prefix: string, strategyId: number): string {
  const base = prefix.replace(/^\/+|\/+$/g, "");
  const path = `strategies/${strategyId}.json`;
  return base.length > 0 ? `${base}/${path}` : path;
}

export interface SpacesStrategyStoreOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;
  client?: S3Client;
}

export class SpacesStrategyStore implements StrategyStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(options: SpacesStrategyStoreOptions) {
    this.bucket = options.bucket;
    this.prefix = options.prefix ?? "";
    this.client =
      options.client ??
      new S3Client({
        endpoint: options.endpoint,
        region: options.region,
        forcePathStyle: false,
        credentials: {
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey
        }
      });
  }

  async put(document: StrategyDocument): Promise<void> {
    const key = strategyKey(this.prefix, document.strategyId);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(document),
        ContentType: "application/json",
        CacheControl: "no-store"
      })
    );
  }

  async get(strategyId: number): Promise<StrategyDocument | undefined> {
    const key = strategyKey(this.prefix, strategyId);
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key })
      );
      const text = await response.Body?.transformToString();
      if (!text) {
        return undefined;
      }
      return JSON.parse(text) as StrategyDocument;
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async listIds(): Promise<number[]> {
    const prefix = strategyKey(this.prefix, 0).replace(/0\.json$/, "");
    const ids: number[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken
        })
      );
      for (const item of response.Contents ?? []) {
        const id = parseStrategyIdFromKey(item.Key ?? "");
        if (id !== undefined) {
          ids.push(id);
        }
      }
      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return [...new Set(ids)].sort((a, b) => a - b);
  }
}

export interface LocalFilesystemStrategyStoreOptions {
  rootDir: string;
  prefix?: string;
}

export class LocalFilesystemStrategyStore implements StrategyStore {
  private readonly rootDir: string;
  private readonly prefix: string;

  constructor(options: LocalFilesystemStrategyStoreOptions) {
    this.rootDir = options.rootDir;
    this.prefix = options.prefix ?? "";
  }

  async put(document: StrategyDocument): Promise<void> {
    const key = strategyKey(this.prefix, document.strategyId);
    const path = join(this.rootDir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(document, null, 2), "utf8");
  }

  async get(strategyId: number): Promise<StrategyDocument | undefined> {
    const key = strategyKey(this.prefix, strategyId);
    const path = join(this.rootDir, key);
    try {
      const text = await readFile(path, "utf8");
      return JSON.parse(text) as StrategyDocument;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async listIds(): Promise<number[]> {
    const dir = join(this.rootDir, this.prefix, "strategies").replace(
      /\/+/g,
      "/"
    );
    try {
      const entries = await readdir(dir);
      return entries
        .map((name) => {
          const match = /^(\d+)\.json$/.exec(name);
          return match ? Number(match[1]) : undefined;
        })
        .filter((id): id is number => typeof id === "number")
        .sort((a, b) => a - b);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}

export function createStrategyStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env
): StrategyStore {
  const endpoint = env.DO_SPACES_ENDPOINT?.trim();
  const bucket = env.DO_SPACES_BUCKET?.trim();
  const accessKeyId = env.DO_SPACES_KEY?.trim();
  const secretAccessKey = env.DO_SPACES_SECRET?.trim();
  const region = env.DO_SPACES_REGION?.trim() || "nyc3";
  const prefix = env.DO_SPACES_PREFIX?.trim() || "canix402";

  if (endpoint && bucket && accessKeyId && secretAccessKey) {
    return new SpacesStrategyStore({
      endpoint,
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
      prefix
    });
  }

  const rootDir = env.STRATEGY_DATA_DIR?.trim() || "data/strategies";
  return new LocalFilesystemStrategyStore({ rootDir, prefix });
}

function parseStrategyIdFromKey(key: string): number | undefined {
  const match = /(?:^|\/)strategies\/(\d+)\.json$/.exec(key);
  if (!match) {
    return undefined;
  }
  return Number(match[1]);
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = "name" in error ? String(error.name) : "";
  const code =
    "$metadata" in error &&
    error.$metadata &&
    typeof error.$metadata === "object" &&
    "httpStatusCode" in error.$metadata
      ? Number(error.$metadata.httpStatusCode)
      : undefined;
  return name === "NoSuchKey" || name === "NotFound" || code === 404;
}
