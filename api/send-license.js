export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = '';

  // Collect the raw request body
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const email = data.email;

      if (!email) {
        return res.status(400).json({ error: 'Missing email' });
      }

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'hello@straja.ai',
          to: email,
          subject: 'Your free license key',
          text: 'Thank you! You’ll receive your license key as soon as we launch.',
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(500).json({ error: 'Resend failed: ' + err });
      }

      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Invalid JSON or internal error: ' + err.message });
    }
  });
}