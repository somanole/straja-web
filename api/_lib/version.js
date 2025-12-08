import { BUNDLE_MODEL_KEY } from './bundle-config.js';
import { fetchR2Object } from './r2.js';

const FALLBACK_LATEST_VERSION = '20251208-2100';
const cacheTtlMs = 60 * 1000;

let cachedVersion = null;
let cachedAt = 0;

const parseLatestFromManifest = (buffer) => {
  try {
    const parsed = JSON.parse(buffer.toString('utf-8'));
    if (parsed && typeof parsed.version === 'string') {
      return parsed.version;
    }
  } catch {
    // ignore parse errors
  }
  return null;
};

export const getLatestBundleVersion = async () => {
  // Env override always wins
  if (process.env.STRAJAGUARD_V1_LATEST_VERSION) {
    return process.env.STRAJAGUARD_V1_LATEST_VERSION;
  }

  // Use a short cache to avoid hammering R2
  if (cachedVersion && Date.now() - cachedAt < cacheTtlMs) {
    return cachedVersion;
  }

  const latestKey = `${BUNDLE_MODEL_KEY}/latest/manifest.json`;

  try {
    const result = await fetchR2Object(latestKey);
    if (result.status === 404) {
      throw new Error('Latest manifest not found');
    }
    const parsedVersion = parseLatestFromManifest(result.buffer);
    if (parsedVersion) {
      cachedVersion = parsedVersion;
      cachedAt = Date.now();
      return parsedVersion;
    }
  } catch (error) {
    console.error('Failed to read latest version from R2:', error?.message || error);
  }

  // Fallback to baked-in default
  return FALLBACK_LATEST_VERSION;
};
