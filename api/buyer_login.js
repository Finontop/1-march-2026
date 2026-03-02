const bcrypt = require('bcryptjs');
const { supabase } = require('../lib/supabase');
const { sendJSON } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJSON(res, { success: true });
    return;
  }
  if (req.method !== 'POST') {
    return sendJSON(res, { success: false, error: 'POST required' }, 405);
  }

  const body = req.body || {};
  const email    = (body.email    || '').trim();
  const password = (body.password || '').trim();

  if (!email)    return sendJSON(res, { success: false, error: 'Email is required.' });
  if (!password) return sendJSON(res, { success: false, error: 'Password is required.' });

  const { data: buyer, error } = await supabase
    .from('buyers')
    .select('id, name, email, password, city, contact')
    .eq('email', email)
    .single();

  if (error || !buyer) {
    return sendJSON(res, { success: false, error: 'No buyer account found with this email. Please register first.' });
  }

  const valid = await bcrypt.compare(password, buyer.password);
  if (!valid) {
    return sendJSON(res, { success: false, error: 'Incorrect password. Please try again.' });
  }

  return sendJSON(res, {
    success: true,
    buyer: {
      id:    buyer.id,
      name:  buyer.name    || '',
      email: buyer.email   || '',
      city:  buyer.city    || '',
      phone: buyer.contact || ''
    }
  });
};
