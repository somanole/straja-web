// File: /api/send-license.js

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse JSON body
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid email' });
    }

    // Send the email
    const data = await resend.emails.send({
      from: 'Straja.ai <hello@straja.ai>',
      to: email,
      subject: 'Welcome to Straja.ai — your license key is on the way',
      html: `
        <p>Hi there,</p>
        <p>Thanks for joining <strong>Straja.ai</strong>.</p>
        <p>You’re now confirmed for early access. We’ll send your free license key as soon as the gateway launches.</p>
        <p>– Sorin from the Straja.ai team</p>
      `
    });

    if (data.error) {
      return res.status(500).json({ error: data.error.message || 'Email send failed' });
    }

    return res.status(200).json({ message: 'Email sent successfully' });

  } catch (error) {
    console.error('Error in send-license function:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}