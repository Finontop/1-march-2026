const { supabase } = require('../lib/supabase');
const { sendJSON, TIER_LIMITS } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJSON(res, { success: true });
    return;
  }

  let sid = 0;
  if (req.method === 'GET') {
    sid = parseInt(req.query && req.query.seller_id) || 0;
  } else {
    const body = req.body || {};
    sid = parseInt(body.seller_id || (req.query && req.query.seller_id)) || 0;
  }

  if (!sid) return sendJSON(res, { success: false, error: 'seller_id required' });

  // Get seller tier
  const { data: tierRow } = await supabase
    .from('sellers')
    .select('subscription_tier')
    .eq('id', sid)
    .single();

  if (!tierRow) return sendJSON(res, { success: false, error: 'Seller not found' });

  // Get usage grouped by feature
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data: usageRows } = await supabase
    .from('seller_usage')
    .select('feature, used_at')
    .eq('seller_id', sid);

  // Group usage
  const usageMap = {};
  for (const row of usageRows || []) {
    const f = row.feature;
    if (!usageMap[f]) usageMap[f] = { feature: f, this_month: 0, total: 0 };
    usageMap[f].total++;
    if (row.used_at >= startOfMonth) usageMap[f].this_month++;
  }

  return sendJSON(res, {
    success:   true,
    seller_id: sid,
    tier:      tierRow.subscription_tier || 'free',
    limits:    TIER_LIMITS,
    usage:     Object.values(usageMap)
  });
};
