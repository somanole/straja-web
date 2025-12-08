import {
  BUNDLE_MODEL_KEY,
  getLatestBundleVersion,
} from '../../_lib/bundle-config.js';
import { requireBundleAuthorization } from '../../_lib/bundle-auth.js';
import { fetchR2Object } from '../../_lib/r2.js';

const extractQueryValue = (value) => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const isValidVersion = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9._-]+$/.test(value);

const sanitizePath = (value) => value.replace(/^\/+/, '');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tokenPayload = requireBundleAuthorization(req, res);
  if (!tokenPayload) return;

  const rawVersion = extractQueryValue(req.query?.version);
  const rawPath = extractQueryValue(req.query?.path);

  const version = rawVersion || tokenPayload.version || getLatestBundleVersion();
  if (!isValidVersion(version)) {
    return res.status(400).json({ error: 'Missing or invalid version' });
  }

  if (tokenPayload.version && tokenPayload.version !== version) {
    return res.status(403).json({ error: 'Token not valid for requested version' });
  }

  if (!rawPath || typeof rawPath !== 'string') {
    return res.status(400).json({ error: 'Missing file path' });
  }

  if (rawPath.includes('..')) {
    return res.status(400).json({ error: 'Invalid file path' });
  }

  const normalizedPath = sanitizePath(rawPath);
  const key = `${BUNDLE_MODEL_KEY}/${version}/${normalizedPath}`;

  try {
    const result = await fetchR2Object(key);
    if (result.status === 404) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', String(result.contentLength));
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(result.buffer);
  } catch (error) {
    const status = error.status || 500;
    console.error('Failed to fetch bundle file:', error);
    return res.status(status).json({ error: 'Failed to fetch bundle file' });
  }
}
