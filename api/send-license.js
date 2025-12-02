// File: /api/send-license.js

import { Resend } from 'resend';
import { Pool } from 'pg';
import {
  ensureLicensesTable,
  generateLicenseKey,
  LICENSE_TIER,
} from './_lib/license.js';

// Re-use a single pool between invocations
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, turnstileToken } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid email' });
    }

    if (!turnstileToken) {
      return res.status(400).json({ error: 'Missing Turnstile token' });
    }

    // ---------- 0) Validate Turnstile token ----------
    const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;

    const formData = new URLSearchParams();
    formData.append('secret', turnstileSecret);
    formData.append('response', turnstileToken);

    const turnstileRes = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        body: formData,
      }
    );

    const turnstileJson = await turnstileRes.json();

    if (!turnstileJson.success) {
      console.error('Turnstile failed:', turnstileJson);
      return res.status(400).json({ error: 'Turnstile verification failed' });
    }

    // ---------- 1) Save lead to Postgres (best-effort) ----------
    try {
      await pool.query(
        `INSERT INTO leads (email, source, user_agent, ip)
         VALUES ($1, $2, $3, $4)`,
        [
          email,
          'license_key_form',
          req.headers['user-agent'] || '',
          (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null,
        ]
      );
    } catch (dbError) {
      console.error('Error saving lead to Postgres:', dbError);
      // Continue anyway
    }

    // ---------- 2) Generate license and store it ----------
    const { licenseKey, jti } = generateLicenseKey(email);

    try {
      await ensureLicensesTable(pool);
      await pool.query(
        `INSERT INTO licenses (id, email, license_key, tier, status, jti)
         VALUES ($1, $2, $3, $4, 'active', $5)`,
        [jti, email, licenseKey, LICENSE_TIER, jti]
      );
    } catch (dbError) {
      console.error('Error saving license to Postgres:', dbError);
      return res.status(500).json({ error: 'Failed to store license' });
    }

    // ---------- 3) Send the email via Resend ----------
    const data = await resend.emails.send({
      from: 'Straja.ai <hello@straja.ai>',
      to: email,
      subject: 'Your Straja.ai free license key',
      html: `
        <p>Hi there,</p>
        <p>Thanks for joining <strong>Straja.ai</strong>.</p>
        <p>Your Straja free license key:</p>
        <p><strong>${licenseKey}</strong></p>
        <p>Keep this safe&mdash;you'll need it when the gateway launches.</p>
        <p>– Sorin from the Straja.ai team</p>
      `,
    });

    if (data.error) {
      return res
        .status(500)
        .json({ error: data.error.message || 'Email send failed' });
    }

    return res.status(200).json({ message: 'Email sent successfully' });

  } catch (error) {
    console.error('Error in send-license function:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
