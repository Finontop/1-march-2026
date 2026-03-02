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
  const email    = (body.email    || '').trim().toLowerCase();
  const password = (body.password || '').trim();

  if (!email)    return sendJSON(res, { success: false, error: 'Email is required.' });
  if (!password) return sendJSON(res, { success: false, error: 'Password is required.' });

  // Fetch seller
  const { data: seller, error } = await supabase
    .from('sellers')
    .select('id, name, email, password, category, city, state, website, contact, subscription_tier')
    .eq('email', email)
    .single();

  if (error || !seller) {
    return sendJSON(res, { success: false, error: 'No account found with this email. Please register first.' });
  }

  const valid = await bcrypt.compare(password, seller.password);
  if (!valid) {
    return sendJSON(res, { success: false, error: 'Incorrect password. Please try again.' });
  }

  // Load seller_details
  const { data: details } = await supabase
    .from('seller_details')
    .select('business_type, business_desc, products_offered, gst_number, employees, annual_turnover, address, pincode, certifications, delivery_radius')
    .eq('seller_id', seller.id)
    .single();

  return sendJSON(res, {
    success: true,
    seller: {
      id:                seller.id,
      seller_id:         seller.id,
      name:              seller.name              || '',
      email:             seller.email             || '',
      city:              seller.city              || '',
      state:             seller.state             || '',
      category:          seller.category          || '',
      website:           seller.website           || '',
      contact:           seller.contact           || '',
      subscription_tier: seller.subscription_tier || 'free'
    },
    details: details || {}
  });
};
