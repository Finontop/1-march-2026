function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
}

function sendJSON(res, data, status = 200) {
  cors(res);
  res.status(status).json(data);
}

async function notifyDiscord(message, username = 'BizBot', color = 3066993) {
  const webhook = process.env.DISCORD_WEBHOOK;
  if (!webhook || webhook.includes('REPLACE_')) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        embeds: [{ description: message, color, timestamp: new Date().toISOString() }]
      })
    });
  } catch (e) { /* ignore */ }
}

async function sendDiscord(title, color, fields) {
  const webhook = process.env.DISCORD_WEBHOOK;
  if (!webhook || webhook.includes('YOUR_WEBHOOK') || webhook.includes('REPLACE_')) return;
  const embed = {
    title,
    color,
    timestamp: new Date().toISOString(),
    fields: fields.map(f => ({
      name: String(f[0] || 'Field'),
      value: String(f[1] || '—').substring(0, 1020) || '—',
      inline: f[2] !== undefined ? Boolean(f[2]) : true
    })),
    footer: { text: 'BizBoost · ' + new Date().toLocaleString('en-IN') }
  };
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });
  } catch (e) { /* ignore */ }
}

// Tier limits: analyzes per month, -1 = unlimited
const TIER_LIMITS = { free: 2, basic: 10, pro: 30, enterprise: -1 };

module.exports = { cors, sendJSON, notifyDiscord, sendDiscord, TIER_LIMITS };
