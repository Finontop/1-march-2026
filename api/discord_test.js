const { sendJSON } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJSON(res, { success: true });
    return;
  }

  const webhook = process.env.DISCORD_WEBHOOK;

  if (!webhook || webhook.includes('REPLACE_')) {
    return sendJSON(res, { success: false, error: 'DISCORD_WEBHOOK not configured' });
  }

  // Validate format
  const valid = /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(webhook);
  if (!valid) {
    return sendJSON(res, { success: false, error: 'Webhook URL looks malformed' });
  }

  // Send test message
  try {
    const resp = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title:       '✅ Webhook Test',
          description: 'Your BizBoost webhook is working correctly!',
          color:       0x34C759,
          footer:      { text: 'BizBoost · ' + new Date().toLocaleString('en-IN') }
        }]
      })
    });

    if (resp.status === 204 || resp.status === 200) {
      return sendJSON(res, { success: true, message: 'Test message sent! Check your Discord channel.' });
    }
    const body = await resp.text();
    return sendJSON(res, { success: false, error: `Discord returned ${resp.status}`, raw: body.substring(0, 200) });
  } catch (e) {
    return sendJSON(res, { success: false, error: e.message });
  }
};
