const { supabase } = require('../lib/supabase');
const { sendJSON } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJSON(res, { success: true });
    return;
  }

  const sellerId = parseInt((req.query && req.query.seller_id) || 0);
  const category = ((req.query && req.query.category) || '').trim();
  const city     = ((req.query && req.query.city)     || '').trim();

  if (!sellerId) return sendJSON(res, { success: false, error: 'seller_id required' });

  try {
    // 1. Assigned leads — directly sent to this seller
    const { data: assignedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('assigned_seller_id', sellerId)
      .eq('status', 'active')
      .order('assigned_at', { ascending: false })
      .limit(50);

    const assignedIds = (assignedLeads || []).map(l => l.id);

    // 2. Matched leads — by category/city, excluding assigned
    let matchQuery = supabase
      .from('leads')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(20);

    if (assignedIds.length > 0) {
      matchQuery = matchQuery.not('id', 'in', assignedIds);
    }

    if (category && city) {
      matchQuery = matchQuery
        .or(`product.ilike.%${category}%`)
        .or(`city.eq.${city},city.ilike.%${city}%`);
    } else if (city) {
      matchQuery = matchQuery.or(`city.eq.${city},city.ilike.%${city}%`);
    }

    const { data: matchedLeads } = await matchQuery;

    const allLeads = [
      ...(assignedLeads || []).map(l => ({ ...l, lead_source: 'assigned' })),
      ...(matchedLeads  || []).map(l => ({ ...l, lead_source: 'matched'  }))
    ].map(l => ({
      ...l,
      id:          parseInt(l.id),
      budget_min:  parseFloat(l.budget_min) || 0,
      budget_max:  parseFloat(l.budget_max) || 0,
      is_assigned: (parseInt(l.assigned_seller_id) === sellerId)
    }));

    return sendJSON(res, {
      success:        true,
      leads:          allLeads,
      count:          allLeads.length,
      assigned_count: (assignedLeads || []).length,
      matched_count:  (matchedLeads  || []).length
    });

  } catch (e) {
    return sendJSON(res, { success: false, error: e.message });
  }
};
