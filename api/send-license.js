// Serverless Function on Vercel (Node.js)
// Receives POST from your form and sends an email via Resend

import { Resend } from 'resend';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // parse form data
    const data = await new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const form = new URLSearchParams(body);
          resolve({
            email: form.get('email')?.trim(),
          });
        } catch (e) { reject(e); }
      });
      req.on('error', reject);
    });

    const { email } = data || {};
    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    // TIP: make sure your sending domain is verified in Resend.
    // For early testing, you can use on@resend.dev as the from address.
    const { data: sendData, error } = await resend.emails.send({
      from: 'Straja <hello@straja.ai>',
      to: email,
      subject: 'Your Straja license key (pre-registration)',
      html: `
        <p>Hi,</p>
        <p>Thanks for registering your interest in Straja.</p>
        <p><strong>We’ll email your free license key as soon as early access opens.</strong></p>
        <p>— Straja.ai</p>
      `,
    });

    if (error) {
      console.error(error);
      return res.status(500).json({ error: 'Email send failed' });
    }

    return res.status(200).json({ ok: true, id: sendData?.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}