import { Pool } from 'pg';
import {
  LICENSE_ISSUER,
  LICENSE_SUBJECT,
  decodeLicenseKey,
  ensureLicensesTable,
  verifyLicenseSignature,
} from '../_lib/license.js';
import {
  BUNDLE_MODEL_KEY,
  buildBaseUrl,
  computeLicenseValidUntil,
  getEntitlementsForTier,
  hasEntitlement,
} from '../_lib/bundle-config.js';
import { issueBundleToken } from '../_lib/bundle-token.js';
import { getLatestBundleVersion } from '../_lib/version.js';

// Re-use a single pool between invocations
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

const invalidResponse = (res, message = 'Invalid or unknown license key') =>
  res.status(200).json({
    status: 'invalid',
    message,
  });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const { license_key: licenseKey } = body || {};

    if (!licenseKey || typeof licenseKey !== 'string') {
      return invalidResponse(res);
    }

    let decoded;
    try {
      decoded = decodeLicenseKey(licenseKey);
    } catch (parseError) {
      console.error('Failed to parse license key:', parseError);
      return invalidResponse(res);
    }

    const { payload, payloadBytes, signatureBytes } = decoded;
    const { email, jti, tier, iss, sub } = payload || {};

    if (
      !email ||
      !jti ||
      !tier ||
      iss !== LICENSE_ISSUER ||
      sub !== LICENSE_SUBJECT
    ) {
      return invalidResponse(res);
    }

    const signatureValid = verifyLicenseSignature(payloadBytes, signatureBytes);
    if (!signatureValid) {
      return invalidResponse(res);
    }

    await ensureLicensesTable(pool);

    const lookup = await pool.query(
      `SELECT license_key, tier, status
         FROM licenses
        WHERE license_key = $1
        LIMIT 1`,
      [licenseKey]
    );

    if (lookup.rowCount === 0) {
      return invalidResponse(res);
    }

    const record = lookup.rows[0];

    if (record.status === 'revoked') {
      return res.status(200).json({
        status: 'revoked',
        tier: record.tier,
        message: 'License has been revoked',
      });
    }

    if (!hasEntitlement(record.tier, BUNDLE_MODEL_KEY)) {
      return res.status(403).json({
        status: 'forbidden',
        tier: record.tier,
        message: 'License does not include StrajaGuard entitlement',
      });
    }

    const validUntil = computeLicenseValidUntil(payload);
    if (new Date(validUntil).getTime() < Date.now()) {
      return res.status(200).json({
        status: 'expired',
        tier: record.tier,
        message: 'License has expired',
      });
    }

    let latestVersion;
    try {
      latestVersion = await getLatestBundleVersion();
    } catch (error) {
      console.error('Failed to resolve latest bundle version:', error);
      return res.status(503).json({
        status: 'unavailable',
        message: 'Latest bundle version unavailable',
      });
    }
    const clientBundleInfo = body?.bundles?.[BUNDLE_MODEL_KEY];
    const currentVersion =
      clientBundleInfo && typeof clientBundleInfo.current_version === 'string'
        ? clientBundleInfo.current_version
        : null;

    const updateAvailable =
      currentVersion && currentVersion === latestVersion ? false : true;

    const entitlements = getEntitlementsForTier(record.tier);
    const baseUrl = buildBaseUrl(req);
    const manifestUrl = `${baseUrl}/api/intel/${BUNDLE_MODEL_KEY}/manifest?version=${encodeURIComponent(
      latestVersion
    )}`;
    const signatureUrl = `${baseUrl}/api/intel/${BUNDLE_MODEL_KEY}/signature?version=${encodeURIComponent(
      latestVersion
    )}`;
    const fileBaseUrl = `${baseUrl}/api/intel/${BUNDLE_MODEL_KEY}/file?version=${encodeURIComponent(
      latestVersion
    )}&path=`;

    const bundleToken = issueBundleToken({
      licenseKey,
      tier: record.tier,
      entitlements,
      version: latestVersion,
      licenseValidUntil: validUntil,
    });

    return res.status(200).json({
      status: 'ok',
      license: {
        tier: record.tier,
        valid_until: validUntil,
        models: {
          [BUNDLE_MODEL_KEY]: {
            enabled: true,
            latest_version: latestVersion,
          },
        },
      },
      bundles: {
        [BUNDLE_MODEL_KEY]: {
          version: latestVersion,
          update_available: updateAvailable,
          manifest_url: manifestUrl,
          signature_url: signatureUrl,
          file_base_url: fileBaseUrl,
        },
      },
      bundle_token: bundleToken,
    });
  } catch (error) {
    console.error('Error in license validation function:', error);
    return res.status(500).json({ status: 'error', message: 'Internal Server Error' });
  }
}
