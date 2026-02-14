/**
 * Storage Client using FlyDrive
 *
 * Provides a unified abstraction layer for file storage across
 * multiple backends (local filesystem, S3, R2).
 */

import { Disk, DriveManager } from "flydrive";
import { FSDriver } from "flydrive/drivers/fs";
import { S3Driver } from "flydrive/drivers/s3";
import type { StorageBackendConfig } from "./types.js";

type StorageServices = {
  local: () => Disk;
  s3?: () => Disk;
  r2?: () => Disk;
};

let driveManager: DriveManager<StorageServices> | null = null;
let currentConfig: StorageBackendConfig | null = null;

/**
 * Get storage configuration from environment and config
 */
function getStorageConfig(): StorageBackendConfig {
  const backend = (process.env.STORAGE_BACKEND || "local") as "local" | "s3" | "r2";

  return {
    backend,
    local: {
      basePath: process.env.MEDIA_DIR || "./data/media",
    },
    s3: {
      bucket: process.env.S3_BUCKET || "nexthello-media",
      region: process.env.S3_REGION || process.env.AWS_REGION || "us-east-1",
      endpoint: process.env.S3_ENDPOINT,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    },
    retention: {
      defaultDays: parseInt(process.env.MEDIA_RETENTION_DAYS || "90", 10),
      autoCleanup: process.env.MEDIA_AUTO_CLEANUP !== "false",
      cleanupIntervalMinutes: parseInt(process.env.MEDIA_CLEANUP_INTERVAL || "60", 10),
    },
  };
}

/**
 * Initialize the DriveManager with configured drivers
 */
function initializeDriveManager(config: StorageBackendConfig): DriveManager<StorageServices> {
  const drivers: StorageServices = {
    local: () => new Disk(
      new FSDriver({
        location: config.local?.basePath || "./data/media",
        visibility: "private",
      })
    ),
  };

  // Configure S3 driver if credentials available
  if (config.s3?.accessKeyId && config.s3?.secretAccessKey) {
    const s3Config = {
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
      region: config.s3.region || "us-east-1",
      bucket: config.s3.bucket,
      visibility: "private" as const,
      ...(config.s3.endpoint && { endpoint: config.s3.endpoint }),
      ...(config.s3.forcePathStyle && { forcePathStyle: true }),
    };

    drivers.s3 = () => new Disk(new S3Driver(s3Config));

    // R2 is S3-compatible with Cloudflare endpoint
    if (process.env.R2_ACCOUNT_ID) {
      drivers.r2 = () => new Disk(
        new S3Driver({
          ...s3Config,
          endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          region: "auto",
        })
      );
    }
  }

  const defaultDisk = (config.backend === "s3" && drivers.s3) ? "s3" :
                      (config.backend === "r2" && drivers.r2) ? "r2" : "local";

  return new DriveManager({
    default: defaultDisk,
    fakes: {
      location: "./data/test-media",
      urlBuilder: {
        async generateURL(key: string) {
          return `file://./data/test-media/${key}`;
        },
        async generateSignedURL(key: string) {
          return `file://./data/test-media/${key}`;
        },
      },
    },
    services: drivers,
  });
}

/**
 * Get or create the storage manager singleton
 */
export function getStorageManager(config?: StorageBackendConfig): DriveManager<StorageServices> {
  if (driveManager && (!config || config === currentConfig)) {
    return driveManager;
  }

  const effectiveConfig = config || getStorageConfig();
  driveManager = initializeDriveManager(effectiveConfig);
  currentConfig = effectiveConfig;

  console.log(`[storage] Initialized with backend: ${effectiveConfig.backend}`);

  return driveManager;
}

/**
 * Get the default disk based on configuration
 */
export function getDefaultDisk(): Disk {
  const manager = getStorageManager();
  return manager.use();
}

/**
 * Get a specific disk by name
 */
export function getDisk(name: "local" | "s3" | "r2"): Disk {
  const manager = getStorageManager();
  return manager.use(name);
}

/**
 * Get the current storage configuration
 */
export function getStorageConfiguration(): StorageBackendConfig {
  return currentConfig || getStorageConfig();
}

/**
 * Check if storage is configured and accessible
 */
export async function checkStorageHealth(): Promise<{
  healthy: boolean;
  backend: string;
  error?: string;
}> {
  try {
    const disk = getDefaultDisk();
    const config = getStorageConfiguration();

    // Try to check if a test path exists (won't throw if path doesn't exist)
    await disk.exists(".health-check");

    return {
      healthy: true,
      backend: config.backend,
    };
  } catch (error) {
    return {
      healthy: false,
      backend: currentConfig?.backend || "unknown",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Reset storage manager (for testing)
 */
export function resetStorageManager(): void {
  driveManager = null;
  currentConfig = null;
}

/**
 * Enable fake storage for testing
 */
export function useFakeStorage(): void {
  const manager = getStorageManager();
  manager.fake();
}

/**
 * Restore real storage after testing
 */
export function restoreStorage(): void {
  const manager = getStorageManager();
  manager.restore();
}
