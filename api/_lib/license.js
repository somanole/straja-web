import crypto from 'crypto';
import nacl from 'tweetnacl';

const LICENSE_PREFIX = 'STRAJA-FREE-';
const LICENSE_ISSUER = 'straja.ai';
const LICENSE_SUBJECT = 'license';
const LICENSE_TIER = 'free';

let cachedSecretKey;
let cachedPublicKey;
let ensureTablePromise;

const base64UrlEncode = (buffer) =>
  Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const normalizeBase64 = (value) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  return normalized + '='.repeat(padLength);
};

const base64UrlDecode = (value) =>
  Buffer.from(normalizeBase64(value), 'base64');

const getSecretKey = () => {
  if (cachedSecretKey) return cachedSecretKey;

  const keyFromEnv = process.env.STRAJA_LICENSE_PRIVATE_KEY;
  if (!keyFromEnv) {
    throw new Error('STRAJA_LICENSE_PRIVATE_KEY is not set');
  }

  const decoded = base64UrlDecode(keyFromEnv);
  if (decoded.length !== nacl.sign.secretKeyLength) {
    throw new Error(
      `Invalid STRAJA_LICENSE_PRIVATE_KEY length: expected ${nacl.sign.secretKeyLength} bytes`
    );
  }

  cachedSecretKey = new Uint8Array(decoded);
  return cachedSecretKey;
};

const getPublicKey = () => {
  if (cachedPublicKey) return cachedPublicKey;

  const publicFromEnv = process.env.STRAJA_LICENSE_PUBLIC_KEY;
  if (publicFromEnv) {
    const decoded = base64UrlDecode(publicFromEnv);
    if (decoded.length !== nacl.sign.publicKeyLength) {
      throw new Error(
        `Invalid STRAJA_LICENSE_PUBLIC_KEY length: expected ${nacl.sign.publicKeyLength} bytes`
      );
    }
    cachedPublicKey = new Uint8Array(decoded);
    return cachedPublicKey;
  }

  const secretKey = getSecretKey();
  cachedPublicKey = nacl.sign.keyPair.fromSecretKey(secretKey).publicKey;
  return cachedPublicKey;
};

export const buildLicensePayload = (email) => {
  if (!email) {
    throw new Error('Email is required to build license payload');
  }

  const jti = crypto.randomUUID();
  const payload = {
    iss: LICENSE_ISSUER,
    sub: LICENSE_SUBJECT,
    tier: LICENSE_TIER,
    email,
    iat: Math.floor(Date.now() / 1000),
    jti,
  };

  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf-8');
  return { payload, payloadBytes, jti };
};

export const generateLicenseKey = (email) => {
  const { payload, payloadBytes, jti } = buildLicensePayload(email);

  const secretKey = getSecretKey();
  const signature = nacl.sign.detached(
    new Uint8Array(payloadBytes),
    secretKey
  );

  const combined = Buffer.concat([
    payloadBytes,
    Buffer.from(signature),
  ]);

  const encoded = base64UrlEncode(combined);
  const licenseKey = `${LICENSE_PREFIX}${encoded}`;

  return {
    licenseKey,
    payload,
    payloadBytes,
    jti,
    tier: LICENSE_TIER,
  };
};

export const decodeLicenseKey = (licenseKey) => {
  if (!licenseKey || typeof licenseKey !== 'string') {
    throw new Error('License key is missing');
  }

  if (!licenseKey.startsWith(LICENSE_PREFIX)) {
    throw new Error('Invalid license key prefix');
  }

  const encoded = licenseKey.slice(LICENSE_PREFIX.length);
  const combined = base64UrlDecode(encoded);

  if (combined.length <= nacl.sign.signatureLength) {
    throw new Error('License key payload is too short');
  }

  const payloadBytes = combined.slice(0, combined.length - nacl.sign.signatureLength);
  const signatureBytes = combined.slice(-nacl.sign.signatureLength);

  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString('utf-8'));
  } catch {
    throw new Error('License payload is not valid JSON');
  }

  return {
    payload,
    payloadBytes,
    signatureBytes,
  };
};

export const verifyLicenseSignature = (payloadBytes, signatureBytes) => {
  if (!payloadBytes || !signatureBytes) return false;
  if (signatureBytes.length !== nacl.sign.signatureLength) return false;

  try {
    const publicKey = getPublicKey();
    return nacl.sign.detached.verify(
      new Uint8Array(payloadBytes),
      new Uint8Array(signatureBytes),
      publicKey
    );
  } catch (error) {
    console.error('Failed to verify license signature:', error);
    return false;
  }
};

export const ensureLicensesTable = async (pool) => {
  if (!ensureTablePromise) {
    ensureTablePromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS licenses (
          id uuid PRIMARY KEY,
          email text NOT NULL,
          license_key text UNIQUE NOT NULL,
          tier text NOT NULL,
          status text NOT NULL DEFAULT 'active',
          jti text NOT NULL UNIQUE,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_licenses_email ON licenses (email)'
      );
    })();
  }

  return ensureTablePromise;
};

export {
  LICENSE_PREFIX,
  LICENSE_TIER,
  LICENSE_ISSUER,
  LICENSE_SUBJECT,
};
