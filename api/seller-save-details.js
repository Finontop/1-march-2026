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
  const sid  = parseInt(data.seller_id) || 0;
  if (!sid) return sendJSON(res, { success: false, error: 'seller_id required' });

  // Verify seller exists
  const { data: sellerCheck } = await supabase
    .from('sellers')
    .select('id')
    .eq('id', sid)
    .single();

  if (!sellerCheck) return sendJSON(res, { success: false, error: `Seller #${sid} not found` });

  // 1. Update sellers table
  const { error: sellerErr } = await supabase
    .from('sellers')
    .update({
      name:     (data.name     || '').trim(),
      category: (data.category || '').trim(),
      city:     (data.city     || '').trim(),
      state:    (data.state    || '').trim(),
      website:  (data.website  || '').trim(),
      contact:  (data.contact  || '').trim()
    })
    .eq('id', sid);

  if (sellerErr) return sendJSON(res, { success: false, error: 'sellers update failed: ' + sellerErr.message });

  // 2. Upsert seller_details
  const detailsPayload = {
    seller_id:        sid,
    gst_number:       (data.gst_number       || '').trim(),
    business_type:    (data.business_type    || '').trim(),
    year_established: (data.year_established || '').trim(),
    employees:        (data.employees        || '').trim(),
    annual_turnover:  (data.annual_turnover  || '').trim(),
    products_offered: (data.products_offered || '').trim(),
    business_desc:    (data.business_desc    || '').trim(),
    address:          (data.address          || '').trim(),
    pincode:          (data.pincode          || '').trim(),
    certifications:   (data.certifications   || '').trim(),
    facebook_url:     (data.facebook_url     || '').trim(),
    instagram_url:    (data.instagram_url    || '').trim(),
    whatsapp:         (data.whatsapp         || '').trim(),
    working_hours:    (data.working_hours    || '').trim(),
    delivery_radius:  (data.delivery_radius  || '').trim(),
    updated_at:       new Date().toISOString()
  };

  const { error: detailErr } = await supabase
    .from('seller_details')
    .upsert(detailsPayload, { onConflict: 'seller_id' });

  if (detailErr) return sendJSON(res, { success: false, error: 'details save failed: ' + detailErr.message });

  // 3. Fetch updated data to return
  const { data: freshSeller } = await supabase
    .from('sellers')
    .select('id, name, category, city, state, website, contact, email')
    .eq('id', sid)
    .single();

  const { data: freshDetails } = await supabase
    .from('seller_details')
    .select('*')
    .eq('seller_id', sid)
    .single();

  // 4. Discord notification
  await sendDiscord('📋 Seller Profile Updated', 0x9B59B6, [
    ['Business', (freshSeller && freshSeller.name)     || '—'],
    ['Category', (freshSeller && freshSeller.category) || '—'],
    ['Location', ((freshSeller && freshSeller.city) || '—') + ', ' + ((freshSeller && freshSeller.state) || '—')],
    ['Products', (freshDetails && freshDetails.products_offered) || '—', false],
    ['GST',      (freshDetails && freshDetails.gst_number) || '—'],
    ['Turnover', (freshDetails && freshDetails.annual_turnover) || '—']
  ]);

  return sendJSON(res, {
    success: true,
    seller:  freshSeller  || data,
    details: freshDetails || data,
    message: 'Profile saved successfully'
  });
};
