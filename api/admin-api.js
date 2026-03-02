const { supabase } = require('../lib/supabase');
const { sendJSON, TIER_LIMITS } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJSON(res, { success: true });
    return;
  }

  const raw  = req.body || {};
  const key  = (req.headers['x-admin-key'] || raw.admin_key || '').toString();
  const adminPassword = process.env.ADMIN_PASSWORD || 'changeme';

  if (key !== adminPassword) {
    return sendJSON(res, { success: false, error: 'Unauthorized' }, 401);
  }

  const action = raw.action || '';
  const sid    = parseInt(raw.seller_id) || 0;

  try {

    // ── LIST ALL SELLERS ───────────────────────────────────────
    if (action === 'list') {
      const { data: rows, error } = await supabase
        .from('sellers')
        .select(`id, name, category, city, state, email, is_featured, is_verified,
                 featured_order, created_at, subscription_tier,
                 seller_details ( products_offered )`)
        .order('is_featured', { ascending: false })
        .order('featured_order', { ascending: true })
        .order('name', { ascending: true });

      if (error) return sendJSON(res, { success: false, error: error.message });

      const sellers = (rows || []).map(r => {
        const d = (r.seller_details && r.seller_details[0]) || {};
        return {
          id:                parseInt(r.id),
          name:              r.name              || '',
          category:          r.category          || '',
          city:              r.city              || '',
          state:             r.state             || '',
          email:             r.email             || '',
          is_featured:       Boolean(r.is_featured),
          is_verified:       Boolean(r.is_verified),
          featured_order:    parseInt(r.featured_order) || 0,
          created_at:        r.created_at,
          subscription_tier: r.subscription_tier || 'free',
          products_offered:  d.products_offered  || ''
        };
      });
      return sendJSON(res, { success: true, sellers });
    }

    // ── SET TIER ───────────────────────────────────────────────
    if (action === 'set_tier' && sid) {
      const validTiers = ['free', 'basic', 'pro', 'enterprise'];
      const tier = raw.tier || '';
      if (!validTiers.includes(tier)) {
        return sendJSON(res, { success: false, error: 'Invalid tier. Allowed: ' + validTiers.join(', ') });
      }
      const { error } = await supabase
        .from('sellers')
        .update({ subscription_tier: tier })
        .eq('id', sid);
      if (error) return sendJSON(res, { success: false, error: error.message });
      return sendJSON(res, { success: true, tier });
    }

    // ── GET USAGE ──────────────────────────────────────────────
    if (action === 'get_usage' && sid) {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const { data: usageRows } = await supabase
        .from('seller_usage')
        .select('feature, used_at')
        .eq('seller_id', sid);

      const usageMap = {};
      for (const row of usageRows || []) {
        const f = row.feature;
        if (!usageMap[f]) usageMap[f] = { feature: f, this_month: 0, total: 0 };
        usageMap[f].total++;
        if (row.used_at >= startOfMonth) usageMap[f].this_month++;
      }

      const { data: tierRow } = await supabase
        .from('sellers')
        .select('subscription_tier')
        .eq('id', sid)
        .single();

      return sendJSON(res, {
        success:   true,
        seller_id: sid,
        tier:      (tierRow && tierRow.subscription_tier) || 'free',
        limits:    TIER_LIMITS,
        usage:     Object.values(usageMap)
      });
    }

    // ── TOGGLE FEATURED ────────────────────────────────────────
    if (action === 'toggle_featured' && sid) {
      const { data: cur } = await supabase
        .from('sellers').select('is_featured').eq('id', sid).single();
      const val = !(cur && cur.is_featured);
      await supabase.from('sellers').update({ is_featured: val }).eq('id', sid);
      return sendJSON(res, { success: true, value: val });
    }

    // ── TOGGLE VERIFIED ────────────────────────────────────────
    if (action === 'toggle_verified' && sid) {
      const { data: cur } = await supabase
        .from('sellers').select('is_verified').eq('id', sid).single();
      const val = !(cur && cur.is_verified);
      await supabase.from('sellers').update({ is_verified: val }).eq('id', sid);
      return sendJSON(res, { success: true, value: val });
    }

    // ── SET ORDER ──────────────────────────────────────────────
    if (action === 'set_order' && sid) {
      const order = parseInt(raw.order) || 0;
      await supabase.from('sellers').update({ featured_order: order }).eq('id', sid);
      return sendJSON(res, { success: true });
    }

    // ── LIST ALL LEADS ─────────────────────────────────────────
    if (action === 'list_leads') {
      const { data: rows, error } = await supabase
        .from('leads')
        .select('*, sellers!leads_assigned_seller_id_fkey ( name, city )')
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) {
        // Fallback without join if FK not set up
        const { data: rows2 } = await supabase
          .from('leads')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(500);
        const leads = (rows2 || []).map(r => ({
          ...r,
          id:                 parseInt(r.id),
          budget_min:         parseFloat(r.budget_min) || 0,
          budget_max:         parseFloat(r.budget_max) || 0,
          assigned_seller_id: r.assigned_seller_id ? parseInt(r.assigned_seller_id) : null
        }));
        return sendJSON(res, { success: true, leads, count: leads.length });
      }

      const leads = (rows || []).map(r => ({
        ...r,
        id:                    parseInt(r.id),
        budget_min:            parseFloat(r.budget_min) || 0,
        budget_max:            parseFloat(r.budget_max) || 0,
        assigned_seller_id:    r.assigned_seller_id ? parseInt(r.assigned_seller_id) : null,
        assigned_seller_name:  r.sellers ? r.sellers.name : null,
        assigned_seller_city:  r.sellers ? r.sellers.city : null
      }));
      return sendJSON(res, { success: true, leads, count: leads.length });
    }

    // ── ASSIGN LEAD(S) TO SELLER ───────────────────────────────
    if (action === 'assign_lead') {
      const targetSellerId = parseInt(raw.seller_id) || 0;
      const leadIds        = (raw.lead_ids || []).map(Number).filter(n => n > 0);

      if (!targetSellerId) return sendJSON(res, { success: false, error: 'seller_id required' });
      if (!leadIds.length)  return sendJSON(res, { success: false, error: 'lead_ids required (array)' });

      const { data: chk } = await supabase
        .from('sellers').select('id').eq('id', targetSellerId).single();
      if (!chk) return sendJSON(res, { success: false, error: 'Seller not found' });

      const { error, count } = await supabase
        .from('leads')
        .update({ assigned_seller_id: targetSellerId, assigned_at: new Date().toISOString() })
        .in('id', leadIds);

      if (error) return sendJSON(res, { success: false, error: error.message });
      return sendJSON(res, { success: true, updated: count || leadIds.length, seller_id: targetSellerId });
    }

    // ── DELETE LEAD ────────────────────────────────────────────
    if (action === 'delete_lead') {
      const lid = parseInt(raw.lead_id) || 0;
      if (!lid) return sendJSON(res, { success: false, error: 'lead_id required' });

      const { error, count } = await supabase
        .from('leads')
        .delete()
        .eq('id', lid);

      if (error) return sendJSON(res, { success: false, error: error.message });
      if (count === 0) return sendJSON(res, { success: false, error: 'Lead not found' });
      return sendJSON(res, { success: true, deleted_id: lid });
    }

    return sendJSON(res, { success: false, error: 'Unknown action or missing parameters' });

  } catch (e) {
    return sendJSON(res, { success: false, error: 'An internal error occurred. Please try again later.' });
  }
};
