const { supabase } = require('../lib/supabase');
const { sendJSON } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJSON(res, { success: true });
    return;
  }

  const q        = ((req.query && req.query.q)        || '').trim().substring(0, 200);
  const city     = ((req.query && req.query.city)     || '').trim().substring(0, 100);
  const category = ((req.query && req.query.category) || '').trim().substring(0, 100);
  const limit    = Math.min(parseInt((req.query && req.query.limit)  || 20), 50);
  const offset   = Math.max(parseInt((req.query && req.query.offset) || 0), 0);

  try {
    // Build query for sellers joined with seller_details
    // Supabase doesn't support cross-table text search natively in the client,
    // so we fetch sellers matching category/city then filter
    let query = supabase
      .from('sellers')
      .select(`
        id, name, category, city, state, website, contact, email,
        is_featured, is_verified, featured_order,
        seller_details ( products_offered, business_desc, whatsapp, working_hours, delivery_radius, business_type, annual_turnover )
      `, { count: 'exact' })
      .order('is_featured', { ascending: false })
      .order('featured_order', { ascending: true })
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (category) query = query.eq('category', category);
    if (city)     query = query.ilike('city', `%${city}%`);
    if (q)        query = query.or(`name.ilike.%${q}%,category.ilike.%${q}%`);

    const { data: sellers, error, count } = await query;

    if (error) return sendJSON(res, { success: false, error: error.message });

    // Flatten the nested seller_details
    const result = (sellers || []).map(s => {
      const d = (s.seller_details && s.seller_details[0]) || {};
      return {
        id:              s.id,
        name:            s.name            || '',
        category:        s.category        || '',
        city:            s.city            || '',
        state:           s.state           || '',
        website:         s.website         || '',
        contact:         s.contact         || '',
        email:           s.email           || '',
        is_featured:     Boolean(s.is_featured),
        is_verified:     Boolean(s.is_verified),
        featured_order:  parseInt(s.featured_order) || 0,
        products_offered: d.products_offered || '',
        business_desc:   d.business_desc    || '',
        whatsapp:        d.whatsapp         || '',
        working_hours:   d.working_hours    || '',
        delivery_radius: d.delivery_radius  || '',
        business_type:   d.business_type    || '',
        annual_turnover: d.annual_turnover  || ''
      };
    });

    return sendJSON(res, {
      success: true,
      total:   count || 0,
      count:   result.length,
      sellers: result
    });

  } catch (e) {
    return sendJSON(res, { success: false, error: 'An internal error occurred. Please try again later.' });
  }
};
