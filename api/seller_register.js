const bcrypt = require('bcryptjs');
const { supabase } = require('../lib/supabase');
const { sendJSON, sendDiscord } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJSON(res, { success: true });
    return;
  }
  if (req.method !== 'POST') {
    return sendJSON(res, { success: false, error: 'POST required' }, 405);
  }

  const data = req.body || {};
  if (!data.email || !data.password) {
    return sendJSON(res, { success: false, error: 'Email and password are required' });
  }

  const hash = await bcrypt.hash(data.password, 10);

  const { data: row, error } = await supabase
    .from('sellers')
    .insert({
      name:     data.name     || '',
      category: data.category || '',
      city:     data.city     || '',
      state:    data.state    || '',
      website:  data.website  || '',
      contact:  data.contact  || '',
      email:    data.email,
      password: hash
    })
    .select('id')
    .single();

  if (error) {
    return sendJSON(res, { success: false, error: error.message });
  }

  await sendDiscord('🏪 New Seller Registered', 0x0071E3, [
    ['Business', data.name     || '—'],
    ['Category', data.category || '—'],
    ['Location', (data.city || '—') + ', ' + (data.state || '—')],
    ['Email',    data.email],
    ['Phone',    data.contact  || '—'],
    ['Website',  data.website  || 'None', false]
  ]);

  return sendJSON(res, { success: true, seller_id: row.id });
};
