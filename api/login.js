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

  if (!email)    return sendJSON(res, { success: false, error: 'Email is required' });
  if (!password) return sendJSON(res, { success: false, error: 'Password is required' });

  // Try sellers first
  const { data: seller } = await supabase
    .from('sellers')
    .select('id, name, email, password, category, city, state, website, contact, subscription_tier')
    .eq('email', email)
    .single();

  if (seller) {
    const valid = await bcrypt.compare(password, seller.password);
    if (!valid) return sendJSON(res, { success: false, error: 'Incorrect password' });

    const { data: details } = await supabase
      .from('seller_details')
      .select('*')
      .eq('seller_id', seller.id)
      .single();

    return sendJSON(res, {
      success: true,
      type:    'seller',
      seller: {
        id:                seller.id,
        name:              seller.name              || '',
        email:             seller.email             || '',
        category:          seller.category          || '',
        city:              seller.city              || '',
        state:             seller.state             || '',
        website:           seller.website           || '',
        contact:           seller.contact           || '',
        subscription_tier: seller.subscription_tier || 'free'
      },
      details:  details || {},
      message: 'Login successful'
    });
  }

  // Try buyers
  const { data: buyer } = await supabase
    .from('buyers')
    .select('id, name, email, password, city, contact')
    .eq('email', email)
    .single();

  if (buyer) {
    const valid = await bcrypt.compare(password, buyer.password);
    if (!valid) return sendJSON(res, { success: false, error: 'Incorrect password' });

    return sendJSON(res, {
      success: true,
      type:    'buyer',
      buyer: {
        id:    buyer.id,
        name:  buyer.name    || '',
        email: buyer.email   || '',
        city:  buyer.city    || '',
        phone: buyer.contact || ''
      }
    });
  }

  return sendJSON(res, { success: false, error: 'No account found with that email' });
};
