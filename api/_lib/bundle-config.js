export const BUNDLE_MODEL_KEY = 'strajaguard_v1';

const LICENSE_VALIDITY_DAYS = parseInt(
  process.env.LICENSE_VALIDITY_DAYS || '365',
  10
);
const BUNDLE_TOKEN_TTL_SECONDS = parseInt(
  process.env.BUNDLE_TOKEN_TTL_SECONDS || '900',
  10
);
const MAX_BUNDLE_BYTES = parseInt(
  process.env.BUNDLE_MAX_BYTES || `${500 * 1024 * 1024}`,
  10
);

const tierEntitlements = {
  free: [BUNDLE_MODEL_KEY],
  pro: [BUNDLE_MODEL_KEY],
  enterprise: [BUNDLE_MODEL_KEY],
};

export const getEntitlementsForTier = (tier) =>
  tierEntitlements[tier] ? [...tierEntitlements[tier]] : [];

export const hasEntitlement = (tier, modelKey) =>
  getEntitlementsForTier(tier).includes(modelKey);

export const computeLicenseValidUntil = (payload) => {
  const issuedAtSeconds =
    typeof payload?.iat === 'number'
      ? payload.iat
      : Math.floor(Date.now() / 1000);

  const expiresAtMs =
    issuedAtSeconds * 1000 + LICENSE_VALIDITY_DAYS * 24 * 60 * 60 * 1000;
  return new Date(expiresAtMs).toISOString();
};

export const getBundleTokenTtlSeconds = () =>
  Math.max(60, BUNDLE_TOKEN_TTL_SECONDS);

export const getMaxBundleBytes = () => MAX_BUNDLE_BYTES;

export const buildBaseUrl = (req) => {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;

  if (!host) return '';

  try {
    const url = new URL(`${proto}://${host}`);
    return url.origin;
  } catch {
    return `https://${host}`;
  }
};
