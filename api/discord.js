const { sendJSON, sendDiscord } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJSON(res, { success: true });
    return;
  }
  if (req.method !== 'POST') {
    return sendJSON(res, { success: false, error: 'POST required' }, 405);
  }

  const data  = req.body || {};
  const title  = data.title  || 'BizBoost Notification';
  const color  = parseInt(data.color) || 3066993;
  const fields = data.fields || [];

  await sendDiscord(title, color, fields);
  return sendJSON(res, { success: true });
};
