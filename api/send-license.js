import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    let body = '';

    // Collect incoming data
    req.on('data', chunk => {
      body += chunk.toString();
    });

    // After all data is received
    req.on('end', async () => {
      try {
        const { email } = JSON.parse(body);
        if (!email) {
          return res.status(400).json({ error: 'Missing email' });
        }

        const response = await resend.emails.send({
          from: 'Straja <hello@straja.ai>',
          to: email,
          subject: 'Your Straja.ai License Key',
          html: `<p>Thanks for signing up. Your free license key will be sent to you when we launch.</p>`,
        });

        return res.status(200).json({ success: true });
      } catch (err) {
        console.error('Failed to parse or send email:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
      }
    });
  } catch (error) {
    console.error('Outer error in send-license:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};