import { BUNDLE_MODEL_KEY } from './bundle-config.js';
import { fetchR2Object, listR2Prefixes } from './r2.js';

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
  // Use a short cache to avoid hammering R2
  if (cachedVersion && Date.now() - cachedAt < cacheTtlMs) {
    return cachedVersion;
  }

  const latestKey = `${BUNDLE_MODEL_KEY}/latest/manifest.json`;

  try {
    const result = await fetchR2Object(latestKey);
    if (result.status !== 404) {
      const parsedVersion = parseLatestFromManifest(result.buffer);
      if (parsedVersion) {
        cachedVersion = parsedVersion;
        cachedAt = Date.now();
        return parsedVersion;
      }
    }
  } catch (error) {
    console.error('Failed to read latest version from R2:', error?.message || error);
  }

  // If no latest pointer, try to infer by listing versions
  try {
    const prefixes = await listR2Prefixes(`${BUNDLE_MODEL_KEY}/`);
    const versions = prefixes
      .map((p) => p.replace(`${BUNDLE_MODEL_KEY}/`, '').replace(/\/$/, ''))
      .filter((p) => /^[0-9A-Za-z._-]+$/.test(p) && p !== 'latest');

    if (versions.length > 0) {
      versions.sort().reverse();
      cachedVersion = versions[0];
      cachedAt = Date.now();
      return cachedVersion;
    }
  } catch (error) {
    console.error('Failed to list versions from R2:', error?.message || error);
  }

  throw new Error('Unable to resolve latest bundle version from R2');
};
