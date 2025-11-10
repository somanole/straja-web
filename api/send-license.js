import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Vercel custom API route handler (not Next.js)
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => (data += chunk));
      req.on('end', () => resolve(JSON.parse(data)));
      req.on('error', err => reject(err));
    });

    const { email } = body;

    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }

    await resend.emails.send({
      from: 'hello@straja.ai',
      to: email,
      subject: 'Your Straja license key',
      html: '<strong>Your license key: XXXX-XXXX</strong>',
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Email sending failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}