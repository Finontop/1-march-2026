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
  if (!data.product || !data.city) {
    return sendJSON(res, { success: false, error: 'Product and city required' });
  }

  // Check for existing lead from same buyer
  const { data: existing } = await supabase
    .from('leads')
    .select('id')
    .eq('buyer_id', data.buyer_id || 0)
    .eq('product',  data.product)
    .eq('city',     data.city)
    .single();

  if (existing) {
    const { error } = await supabase
      .from('leads')
      .update({
        quantity:   data.quantity   || '',
        unit:       data.unit       || '',
        budget_min: data.budget_min || 0,
        budget_max: data.budget_max || 0,
        state:      data.state      || '',
        status:     'active',
        created_at: new Date().toISOString()
      })
      .eq('buyer_id', data.buyer_id || 0)
      .eq('product',  data.product)
      .eq('city',     data.city);

    if (error) return sendJSON(res, { success: false, error: error.message });
    return sendJSON(res, { success: true, lead_id: existing.id, action: 'updated' });
  }

  const { data: row, error } = await supabase
    .from('leads')
    .insert({
      buyer_id:    data.buyer_id    || 0,
      buyer_name:  data.buyer_name  || '',
      buyer_phone: data.buyer_phone || '',
      product:     data.product,
      city:        data.city,
      state:       data.state       || '',
      quantity:    data.quantity    || '',
      unit:        data.unit        || '',
      budget_min:  data.budget_min  || 0,
      budget_max:  data.budget_max  || 0
    })
    .select('id')
    .single();

  if (error) return sendJSON(res, { success: false, error: error.message });

  await sendDiscord('📦 New Buyer Lead', 0xF59E0B, [
    ['Buyer',    (data.buyer_name || '—') + ' · ' + (data.buyer_phone || 'No phone')],
    ['Product',  data.product],
    ['Location', (data.city || '—') + ', ' + (data.state || '—')],
    ['Quantity', (data.quantity || '—') + ' ' + (data.unit || '')],
    ['Budget',   '₹' + (data.budget_min || 0) + ' – ₹' + (data.budget_max || 0), false]
  ]);

  return sendJSON(res, { success: true, lead_id: row.id, action: 'created' });
};
