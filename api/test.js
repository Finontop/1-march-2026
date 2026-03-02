const { sendJSON } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJSON(res, { success: true });
    return;
  }

  return sendJSON(res, {
    node:       process.version,
    status:     'working',
    supabase:   process.env.SUPABASE_URL ? 'configured' : 'NOT SET',
    serper:     process.env.SERPER_KEY   ? 'configured' : 'NOT SET',
    groq:       process.env.GROQ_KEY     ? 'configured' : 'NOT SET',
    discord:    process.env.DISCORD_WEBHOOK ? 'configured' : 'NOT SET',
    admin:      process.env.ADMIN_PASSWORD  ? 'configured' : 'NOT SET'
  });
};
