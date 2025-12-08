import { BUNDLE_MODEL_KEY } from '../../_lib/bundle-config.js';
import { requireBundleAuthorization } from '../../_lib/bundle-auth.js';
import { fetchBundleObject } from '../../_lib/bundle-keys.js';
import { getLatestBundleVersion } from '../../_lib/version.js';

const extractVersion = (req) => {
  const versionParam = req.query?.version;
  if (Array.isArray(versionParam)) return versionParam[0];
  if (typeof versionParam === 'string') return versionParam;
  return null;
};

const isValidVersion = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9._-]+$/.test(value);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tokenPayload = requireBundleAuthorization(req, res);
  if (!tokenPayload) return;

  let latestVersion;
  try {
    latestVersion = await getLatestBundleVersion();
  } catch (error) {
    console.error('Failed to resolve latest version:', error);
    return res.status(503).json({ error: 'Latest bundle version unavailable' });
  }
  let version = extractVersion(req) || tokenPayload.version || latestVersion;
  if (!isValidVersion(version)) {
    return res.status(400).json({ error: 'Missing or invalid version' });
  }

  if (tokenPayload.version && tokenPayload.version !== version) {
    return res.status(403).json({ error: 'Token not valid for requested version' });
  }

  const key = `${BUNDLE_MODEL_KEY}/${version}/manifest.sig`;

  try {
    const result = await fetchBundleObject(version, 'manifest.sig');
    if (result.status === 404) {
      return res.status(404).json({ error: 'Signature not found' });
    }

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', String(result.contentLength));
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).send(result.buffer);
  } catch (error) {
    const status = error.status || 500;
    console.error('Failed to fetch signature:', error);
    return res.status(status).json({ error: 'Failed to fetch signature' });
  }
}
