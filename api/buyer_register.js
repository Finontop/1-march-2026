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
    .from('buyers')
    .insert({
      name:        data.name        || '',
      requirement: data.requirement || '',
      city:        data.city        || '',
      state:       data.state       || '',
      budget_min:  data.budget_min  || 0,
      budget_max:  data.budget_max  || 0,
      contact:     data.contact     || '',
      email:       data.email,
      password:    hash
    })
    .select('id')
    .single();

  if (error) {
    return sendJSON(res, { success: false, error: error.message });
  }

  await sendDiscord('🛒 New Buyer Registered', 0x34C759, [
    ['Name',        data.name        || '—'],
    ['Looking For', data.requirement || '—'],
    ['Location',    (data.city || '—') + ', ' + (data.state || '—')],
    ['Budget',      '₹' + (data.budget_min || 0) + ' – ₹' + (data.budget_max || 0)],
    ['Phone',       data.contact     || '—'],
    ['Email',       data.email,      false]
  ]);

  return sendJSON(res, { success: true, buyer_id: row.id });
};
