const { supabase } = require('../lib/supabase');
const { sendJSON } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJSON(res, { success: true });
    return;
  }

  // Accept seller_id from GET param or POST JSON body
  let sid = 0;
  if (req.method === 'GET') {
    sid = parseInt(req.query && req.query.seller_id) || 0;
  } else {
    const body = req.body || {};
    sid = parseInt(body.seller_id || (req.query && req.query.seller_id)) || 0;
  }

  if (!sid) return sendJSON(res, { success: false, error: 'seller_id required' });

  const { data: seller, error } = await supabase
    .from('sellers')
    .select('id, name, category, city, state, website, contact, email')
    .eq('id', sid)
    .single();

  if (error || !seller) {
    return sendJSON(res, { success: false, error: `Seller #${sid} not found` });
  }

  const { data: details } = await supabase
    .from('seller_details')
    .select('seller_id, gst_number, business_type, year_established, employees, annual_turnover, products_offered, business_desc, address, pincode, certifications, facebook_url, instagram_url, whatsapp, working_hours, delivery_radius')
    .eq('seller_id', sid)
    .single();

  return sendJSON(res, {
    success: true,
    seller: {
      id:       seller.id,
      name:     seller.name     || '',
      category: seller.category || '',
      city:     seller.city     || '',
      state:    seller.state    || '',
      website:  seller.website  || '',
      contact:  seller.contact  || '',
      email:    seller.email    || ''
    },
    details: details || { seller_id: sid }
  });
};
