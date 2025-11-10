import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { email } = JSON.parse(req.body);
    console.log('Received email:', email);

    if (!email) {
      console.error('Missing email in request body');
      return res.status(400).json({ error: 'Missing email' });
    }

    const response = await resend.emails.send({
      from: 'Straja <hello@straja.ai>',
      to: email,
      subject: 'Your Straja.ai License Key',
      html: `<p>Thanks for signing up. Your free license key will be sent to you when we launch.</p>`,
    });

    console.log('Email sent:', response);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error in send-license function:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};