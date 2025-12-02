import { Pool } from 'pg';
import {
  LICENSE_ISSUER,
  LICENSE_SUBJECT,
  decodeLicenseKey,
  ensureLicensesTable,
  verifyLicenseSignature,
} from '../_lib/license.js';

// Re-use a single pool between invocations
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

const invalidResponse = (res) =>
  res.status(200).json({
    status: 'invalid',
    message: 'Invalid or unknown license key',
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

    return res.status(200).json({
      status: 'ok',
      tier: record.tier,
      message: 'Valid license',
    });
  } catch (error) {
    console.error('Error in license validation function:', error);
    return res.status(500).json({ status: 'error', message: 'Internal Server Error' });
  }
}
