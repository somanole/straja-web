import crypto from 'crypto';
import { getBundleTokenTtlSeconds } from './bundle-config.js';

const base64UrlEncode = (value) =>
  Buffer.from(value).toString('base64url');

const base64UrlDecode = (value) => Buffer.from(value, 'base64url').toString('utf-8');

const getSecret = () => {
  const secret =
    process.env.BUNDLE_TOKEN_SECRET || process.env.STRAJA_BUNDLE_TOKEN_SECRET;

  if (!secret) {
    throw new Error(
      'BUNDLE_TOKEN_SECRET (or STRAJA_BUNDLE_TOKEN_SECRET) must be set'
    );
  }

  return secret;
};

export const issueBundleToken = ({
  licenseKey,
  tier,
  entitlements,
  version,
  licenseValidUntil,
}) => {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = getBundleTokenTtlSeconds();
  const maxLifetimeSeconds = Math.max(ttlSeconds, 60);

  const absoluteExpirySeconds = licenseValidUntil
    ? Math.floor(new Date(licenseValidUntil).getTime() / 1000)
    : now + maxLifetimeSeconds;

  const exp = Math.min(now + ttlSeconds, absoluteExpirySeconds);

  const payload = {
    licenseKey,
    tier,
    entitlements,
    version,
    iat: now,
    exp,
  };

  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', getSecret())
    .update(body)
    .digest('base64url');

  return `${body}.${signature}`;
};

export const verifyBundleToken = (token) => {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [body, signature] = parts;
  const expected = crypto
    .createHmac('sha256', getSecret())
    .update(body)
    .digest();

  const provided = Buffer.from(signature, 'base64url');

  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(provided, expected)
  ) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(body));
  } catch {
    return null;
  }

  if (
    !payload?.exp ||
    typeof payload.exp !== 'number' ||
    !payload.licenseKey
  ) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return null;

  return payload;
};
