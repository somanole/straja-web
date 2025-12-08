import { BUNDLE_MODEL_KEY } from './bundle-config.js';
import { verifyBundleToken } from './bundle-token.js';

export const parseBearerToken = (req) => {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string') return null;

  const [scheme, value] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;
  return value || null;
};

export const requireBundleAuthorization = (req, res) => {
  const rawToken = parseBearerToken(req);
  if (!rawToken) {
    res.status(401).json({ error: 'Missing bundle token' });
    return null;
  }

  const payload = verifyBundleToken(rawToken);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired bundle token' });
    return null;
  }

  if (
    !Array.isArray(payload.entitlements) ||
    !payload.entitlements.includes(BUNDLE_MODEL_KEY)
  ) {
    res.status(403).json({ error: 'Token not entitled to requested bundle' });
    return null;
  }

  return payload;
};
