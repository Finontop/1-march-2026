const { supabase } = require('../lib/supabase');
const { sendJSON, TIER_LIMITS } = require('../lib/helpers');

// ── Usage check (same as seller_research.js) ───────────────────
async function checkUsage(sellerId, feature = 'analyze') {
  const { data: sellerRow } = await supabase
    .from('sellers').select('subscription_tier').eq('id', sellerId).single();
  if (!sellerRow) return { allowed: false, error: 'Seller not found' };
  const tier  = sellerRow.subscription_tier || 'free';
  const limit = TIER_LIMITS[tier] !== undefined ? TIER_LIMITS[tier] : 2;
  if (limit === -1) {
    await supabase.from('seller_usage').insert({ seller_id: sellerId, feature });
    return { allowed: true, tier, limit: -1 };
  }
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { data: usageRows } = await supabase.from('seller_usage').select('id')
    .eq('seller_id', sellerId).eq('feature', feature).gte('used_at', startOfMonth);
  const used = (usageRows || []).length;
  if (used >= limit) {
    return { allowed: false, error: `Monthly limit reached. Your ${tier} plan allows ${limit} ${feature}s per month.`, tier, used, limit };
  }
  await supabase.from('seller_usage').insert({ seller_id: sellerId, feature });
  return { allowed: true, tier, used: used + 1, limit };
}

function detectTypeLabel(type, name, desc) {
  const t = ((type || '') + ' ' + (name || '') + ' ' + (desc || '')).toLowerCase();
  if (['wholesale', 'wholesaler', 'distributor', 'supplier', 'bulk', 'trader', 'stockist', 'b2b', 'importer', 'exporter'].some(k => t.includes(k)))
    return 'Wholesaler / Distributor';
  if (['manufacturer', 'manufacturing', 'factory', 'fabricator', 'industries', 'oem', 'producer', 'udyog', 'assembler'].some(k => t.includes(k)))
    return 'Manufacturer / Factory';
  if (['service', 'repair', 'installation', 'maintenance', 'contractor', 'installer', 'integrator'].some(k => t.includes(k)))
    return 'Service Provider / Installer';
  return 'Retailer / Dealer / Shop';
}

async function doSearch(q, key, num = 10) {
  if (!key) return [];
  try {
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl: 'in', hl: 'en', num })
    });
    const d = await r.json();
    return d.organic || [];
  } catch (e) { return []; }
}

async function doShopping(q, key) {
  if (!key) return [];
  try {
    const r = await fetch('https://google.serper.dev/shopping', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl: 'in', hl: 'en', num: 10 })
    });
    const d = await r.json();
    return d.shopping || [];
  } catch (e) { return []; }
}

async function doGroqLocal(prompt, key, maxTok = 3000, temp = 0.25) {
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', temperature: temp, max_tokens: maxTok,
        messages: [
          { role: 'system', content: 'Return only valid JSON. No markdown. No explanation. Be specific — always name the actual competitor, city, product. Never use placeholder text.' },
          { role: 'user',   content: prompt }
        ]
      })
    });
    const raw = await r.text();
    return { raw, err: '', http: r.status };
  } catch (e) {
    return { raw: '', err: e.message, http: 0 };
  }
}

function parseGroqJson(gr) {
  if (gr.err || gr.http !== 200) return null;
  try {
    const d       = JSON.parse(gr.raw);
    let   content = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
    if (!content) return null;
    content = content.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    const po = content.indexOf('{'), pa = content.indexOf('[');
    if (po === -1 && pa === -1) return null;
    const start = (po === -1) ? pa : ((pa === -1) ? po : Math.min(po, pa));
    return JSON.parse(content.substring(start));
  } catch (e) { return null; }
}

function extractPricesINR(text) {
  const prices = [];
  const m1 = text.matchAll(/(?:Rs\.?\s*|₹\s*|INR\s*)(\d[\d,]*)/gi);
  for (const m of m1) {
    const v = parseInt(m[1].replace(/,/g, ''));
    if (v >= 5 && v <= 50000000) prices.push(v);
  }
  const m2 = text.matchAll(/\b(\d[\d,]+)\s*\/?\s*(?:per\s+)?(?:piece|pcs|pc|unit|kg|litre|ltr|liter|mtr|meter|sqft|set|box|pair|nos|dozen)\b/gi);
  for (const m of m2) {
    const v = parseInt(m[1].replace(/,/g, ''));
    if (v >= 5 && v <= 50000000) prices.push(v);
  }
  return prices;
}

function buildPriceSummary(prices) {
  if (!prices.length) return [];
  const sorted = [...prices].sort((a, b) => a - b);
  const c    = sorted.length;
  const trim = Math.max(1, Math.floor(c * 0.1));
  const t    = c > 2 * trim ? sorted.slice(trim, c - trim) : sorted;
  const mid  = Math.floor(t.length / 2);
  return { min: t[0], max: t[t.length - 1], median: t[mid], mean: Math.round(t.reduce((a, b) => a + b, 0) / t.length), count: c };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJSON(res, { success: true });
    return;
  }
  if (req.method !== 'POST') {
    return sendJSON(res, { success: false, error: 'POST required' }, 405);
  }

  const groqKey   = process.env.GROQ_KEY   || '';
  const serperKey = process.env.SERPER_KEY || '';
  if (!groqKey)   return sendJSON(res, { success: false, error: 'GROQ_KEY not set' });
  if (!serperKey) return sendJSON(res, { success: false, error: 'SERPER_KEY not set' });

  const body         = req.body || {};
  const sid          = parseInt(body.seller_id) || 0;
  const forceRefresh = Boolean(body.force_refresh);
  const competitors  = Array.isArray(body.competitors) ? body.competitors : [];

  if (!sid) return sendJSON(res, { success: false, error: 'seller_id required' });

  // Credit check
  const credit = await checkUsage(sid, 'competitor_intel');
  if (!credit.allowed) {
    return sendJSON(res, { success: false, error: credit.error || 'Usage limit reached',
      tier: credit.tier, used: credit.used, limit: credit.limit });
  }

  // Load seller
  const { data: sellerRow } = await supabase
    .from('sellers')
    .select(`id, name, email, category, city, state, website, contact,
             seller_details ( gst_number, business_type, employees, annual_turnover,
               products_offered, business_desc, address, pincode, certifications )`)
    .eq('id', sid).single();

  if (!sellerRow) return sendJSON(res, { success: false, error: `Seller #${sid} not found` });

  const d      = (sellerRow.seller_details && sellerRow.seller_details[0]) || {};
  const seller = { ...sellerRow, ...d };

  // 24-hour cache check
  if (!forceRefresh) {
    try {
      const { data: cacheRow } = await supabase
        .from('competitor_intel')
        .select('intel_json, generated_at')
        .eq('seller_id', sid)
        .order('generated_at', { ascending: false })
        .limit(1)
        .single();

      if (cacheRow) {
        const ageSeconds = Math.floor((Date.now() - new Date(cacheRow.generated_at).getTime()) / 1000);
        if (ageSeconds < 86400) {
          try {
            const cached = JSON.parse(cacheRow.intel_json);
            if (cached && typeof cached === 'object') {
              return sendJSON(res, { ...cached, success: true, _cached: true, _cache_age_min: Math.round(ageSeconds / 60) });
            }
          } catch (e) { /* ignore parse errors */ }
        }
      }
    } catch (e) { /* table may not exist */ }
  }

  const rawProducts = (seller.products_offered || seller.category || '').trim();
  const city        = (seller.city  || '').trim();
  const state       = (seller.state || '').trim();
  const sellerName  = (seller.name  || '').trim();

  const productArr = [...new Set(rawProducts.split(/[,;/|]+/).map(s => s.trim()).filter(s => s.length >= 2))].slice(0, 5);
  if (productArr.length === 0) productArr.push(seller.category || 'product');

  const kw1        = productArr[0];
  const kw2        = productArr[1] || kw1;
  const typeLabel  = detectTypeLabel(seller.business_type || '', sellerName, seller.business_desc || '');
  const compCount  = competitors.length;
  const topComp    = competitors[0] || null;
  const topCompName    = topComp ? (topComp.name    || '') : '';
  const topCompRating  = topComp ? (topComp.rating  || 'N/A') : 'N/A';
  const topCompReviews = topComp ? (parseInt(topComp.reviews) || 0) : 0;

  // Step A: Scrape market prices
  const allPrices       = [];
  const platformListings = [];
  const sourceCount     = { indiamart: 0, justdial: 0, tradeindia: 0, shopping: 0, generic: 0 };

  // IndiaMART
  for (const r of await doSearch(`${kw1} price site:indiamart.com`, serperKey, 10)) {
    const blob  = (r.snippet || '') + ' ' + (r.title || '');
    const found = extractPricesINR(blob);
    allPrices.push(...found);
    sourceCount.indiamart += found.length;
    if (found.length) platformListings.push({ source: 'IndiaMART', name: (r.title || '').substring(0, 80), price_min: Math.min(...found), price_max: Math.max(...found), url: r.link || '' });
  }
  for (const r of await doSearch(`${kw1} wholesale price per unit ${city} site:indiamart.com`, serperKey, 8)) {
    const found = extractPricesINR((r.snippet || '') + ' ' + (r.title || ''));
    allPrices.push(...found);
    sourceCount.indiamart += found.length;
  }

  // JustDial
  for (const r of await doSearch(`${kw1} price ${city} site:justdial.com`, serperKey, 8)) {
    const blob  = (r.snippet || '') + ' ' + (r.title || '');
    const found = extractPricesINR(blob);
    allPrices.push(...found);
    sourceCount.justdial += found.length;
    if (found.length) platformListings.push({ source: 'JustDial', name: (r.title || '').substring(0, 80), price_min: Math.min(...found), price_max: Math.max(...found), url: r.link || '' });
  }

  // TradeIndia
  for (const r of await doSearch(`${kw1} price per unit site:tradeindia.com`, serperKey, 6)) {
    const blob  = (r.snippet || '') + ' ' + (r.title || '');
    const found = extractPricesINR(blob);
    allPrices.push(...found);
    sourceCount.tradeindia += found.length;
    if (found.length) platformListings.push({ source: 'TradeIndia', name: (r.title || '').substring(0, 80), price_min: Math.min(...found), price_max: Math.max(...found), url: r.link || '' });
  }

  // Google Shopping
  for (const sr of await doShopping(`${kw1} ${city}`, serperKey)) {
    const found = extractPricesINR((sr.price || '') + ' ' + (sr.title || ''));
    allPrices.push(...found);
    sourceCount.shopping += found.length;
    if (found.length) platformListings.push({ source: 'Google Shopping', name: (sr.title || '').substring(0, 80), price_min: Math.min(...found), price_max: Math.max(...found), url: sr.link || '' });
  }

  // Generic rate-list searches
  for (const r of await doSearch(`${kw1} rate list ${city} ${state} 2025`, serperKey, 8)) {
    const found = extractPricesINR((r.snippet || '') + ' ' + (r.title || ''));
    allPrices.push(...found);
    sourceCount.generic += found.length;
  }
  for (const r of await doSearch(`${kw1} ${kw2} price per piece kg ${state}`, serperKey, 6)) {
    extractPricesINR((r.snippet || '') + ' ' + (r.title || '')).forEach(p => allPrices.push(p));
  }

  let priceSummary = buildPriceSummary(allPrices);

  // Step B: Per-competitor price scraping
  const competitorPriceMap = {};
  for (const comp of competitors.slice(0, 5)) {
    const cName = (comp.name || '').trim();
    if (!cName) continue;
    const cPrices = [];
    for (const r of await doSearch(`"${cName}" ${kw1} price`, serperKey, 5)) {
      const found = extractPricesINR((r.snippet || '') + ' ' + (r.title || ''));
      cPrices.push(...found);
      allPrices.push(...found);
    }
    if (comp.website) {
      try {
        const domain = new URL(comp.website).hostname;
        for (const r of await doSearch(`${kw1} price site:${domain}`, serperKey, 5)) {
          const found = extractPricesINR((r.snippet || '') + ' ' + (r.title || ''));
          cPrices.push(...found);
          allPrices.push(...found);
        }
      } catch (e) { /* ignore URL parse errors */ }
    }
    if (cPrices.length) {
      const sorted = [...cPrices].sort((a, b) => a - b);
      const mid    = Math.floor(sorted.length / 2);
      competitorPriceMap[cName] = { min: sorted[0], max: sorted[sorted.length - 1], median: sorted[mid], count: sorted.length };
    }
  }

  // Rebuild price summary with competitor prices included
  priceSummary = buildPriceSummary(allPrices);

  // Step C: Build Groq context
  const compListStr = competitors.length === 0
    ? `No verified direct competitors found in ${city} for ${rawProducts}.`
    : competitors.slice(0, 15).map(c => {
        const hasWeb = c.website ? 'HAS WEBSITE' : 'NO WEBSITE';
        const hasPh  = c.phone   ? 'HAS PHONE'   : 'no phone listed';
        return `- ${c.name || ''} | ${c.rating ? '★' + c.rating : 'no rating'} (${c.reviews || 0} reviews) | ${hasWeb} | ${hasPh} | ${(c.address || '').substring(0, 55)}`;
      }).join('\n');

  const noWebNames = competitors.slice(0, 8).filter(c => !c.website).map(c => c.name || '').filter(Boolean).join(', ');

  const priceCtx = priceSummary && priceSummary.count
    ? `SCRAPED MARKET PRICES for "${rawProducts}":\n  Lowest:  ₹${priceSummary.min.toLocaleString('en-IN')}\n  Highest: ₹${priceSummary.max.toLocaleString('en-IN')}\n  Median:  ₹${priceSummary.median.toLocaleString('en-IN')}\n  Samples: ${priceSummary.count} data points`
    : `PRICE DATA: None found from search. Estimate realistic prices for ${rawProducts} in ${city}.`;

  const compPriceCtx = Object.keys(competitorPriceMap).length === 0
    ? 'Per-competitor prices: none found.'
    : 'PER-COMPETITOR SCRAPED PRICES:\n' + Object.entries(competitorPriceMap)
        .map(([name, p]) => `  ${name}: ₹${p.min.toLocaleString('en-IN')} – ₹${p.max.toLocaleString('en-IN')} (median ₹${p.median.toLocaleString('en-IN')}, ${p.count} samples)`)
        .join('\n');

  let topCompPriceNote = '';
  if (topCompName && competitorPriceMap[topCompName]) {
    const tp = competitorPriceMap[topCompName];
    topCompPriceNote = ` — scraped price ₹${tp.min.toLocaleString('en-IN')}–₹${tp.max.toLocaleString('en-IN')} (median ₹${tp.median.toLocaleString('en-IN')})`;
  }

  const hasSite = seller.website        ? 'YES'  : 'NO';
  const hasGst  = seller.gst_number     ? `YES (GST: ${seller.gst_number})` : 'NO';
  const hasCert = seller.certifications ? `YES: ${seller.certifications}`   : 'NONE';

  const missingFields = [];
  if (!seller.website)        missingFields.push('website');
  if (!seller.gst_number)     missingFields.push('GST number');
  if (!seller.certifications) missingFields.push('certifications');
  if (!seller.business_desc)  missingFields.push('business description');
  const missingStr = missingFields.length ? missingFields.join(', ') : 'none';

  // Step D: Single Groq call
  const groqPrompt = `You are a senior Indian SMB growth strategist. Write a PERSONALISED report for ONE specific business.

HARD RULES — violation = useless output:
1. NEVER say "your competitors" — always name them: "${topCompName}", etc.
2. NEVER say "competitive pricing" — always say "₹X (10% below ${topCompName}'s ₹Y)"
3. NEVER use placeholder text like [product] or [city] — use the actual values
4. Every weakness must reference a REAL missing field from the seller's profile
5. Every threat must name a SPECIFIC competitor from the list below

SELLER PROFILE:
  Name:        ${sellerName}
  Type:        ${typeLabel}
  Products:    ${rawProducts}
  City:        ${city}, ${state}
  Website:     ${hasSite}
  GST:         ${hasGst}
  Certs:       ${hasCert}
  Employees:   ${seller.employees     || 'unknown'}
  Turnover:    ${seller.annual_turnover || 'unknown'}
  Missing:     ${missingStr}

VERIFIED COMPETITORS (${compCount} found in ${city} — already filtered to same product + same type):
  Top: ${topCompName} (★${topCompRating}, ${topCompReviews} reviews)${topCompPriceNote}
  No website (easy to beat online): ${noWebNames}
  Full list:
${compListStr}

${priceCtx}

${compPriceCtx}

Return ONLY valid JSON — all strings must be specific to ${sellerName} / ${city} / ${rawProducts}:
{
  "swot": {
    "strengths":     ["strength 1 specific to ${sellerName}", "strength 2", "strength 3"],
    "weaknesses":    ["weakness referencing a missing field", "weakness 2", "weakness 3"],
    "opportunities": ["opportunity in ${city} for ${rawProducts}", "opportunity 2", "opportunity 3"],
    "threats":       ["threat naming ${topCompName} specifically", "threat 2", "threat 3"]
  },
  "opportunity_score":     72,
  "opportunity_reasoning": "1-2 sentence specific to ${sellerName} in ${city} with real competitor names",
  "top_competitor_analysis": {
    "name":             "${topCompName}",
    "why_winning":      "specific reason",
    "their_weaknesses": ["weakness 1", "weakness 2", "weakness 3"],
    "how_to_beat_them": ["tactic naming ${topCompName}", "tactic 2", "tactic 3", "tactic 4"]
  },
  "action_priority": [
    {"action": "specific action for ${sellerName}", "impact": "high",   "effort": "low",    "timeline": "2 days"},
    {"action": "specific action",                   "impact": "high",   "effort": "medium", "timeline": "1 week"},
    {"action": "specific action naming ${topCompName}", "impact": "high", "effort": "medium", "timeline": "2 weeks"},
    {"action": "specific action",                   "impact": "medium", "effort": "low",    "timeline": "3 days"},
    {"action": "specific action",                   "impact": "high",   "effort": "high",   "timeline": "1 month"},
    {"action": "specific action",                   "impact": "low",    "effort": "low",    "timeline": "this week"}
  ],
  "whatsapp_strategy": [
    "WhatsApp tactic 1 specific to ${rawProducts} in ${city}",
    "tactic 2", "tactic 3", "tactic 4"
  ],
  "outreach": {
    "cold_email_subject":          "specific subject line for ${rawProducts} buyers",
    "cold_email_body":             "Hi [Name],\\n\\nI'm [your name] from ${sellerName}, a ${typeLabel} based in ${city}...[complete 150-200 word email]\\n\\nRegards,\\n[Your Name]\\n${sellerName}",
    "whatsapp_message_template":   "Hi [Name]! 👋 I'm from ${sellerName} in ${city}...[complete 60-word message]",
    "follow_up_message":           "Hi [Name], following up on my message about ${rawProducts} from ${sellerName}...[write it]",
    "google_business_description": "${sellerName} — ${typeLabel} in ${city} specialising in ${rawProducts}. [USP]. Call/WhatsApp [number]. [150 chars max]",
    "indiamart_catalog_tip":       "specific tip for listing ${rawProducts} on IndiaMART to rank above ${topCompName}"
  },
  "pricing_intel": {
    "recommended_price": {"value": 0, "unit": "per piece", "reasoning": "Price at ₹X, which is Y% below ${topCompName}'s ₹Z"},
    "undercut_strategy": {"target_competitor": "${topCompName}", "their_price": 0, "your_suggested_price": 0, "undercut_percent": 0, "positioning": "How ${sellerName} should communicate this price advantage"},
    "pricing_tiers": [
      {"tier": "Bulk",    "price": 0, "min_quantity": "100+ units", "note": "target B2B buyers in ${city}"},
      {"tier": "Standard","price": 0, "min_quantity": "10+ units",  "note": ""},
      {"tier": "Premium", "price": 0, "min_quantity": "1+ unit",    "note": "urgent / branded packaging"}
    ],
    "margin_estimate": "",
    "price_positioning_advice": "specific advice for ${sellerName} vs ${topCompName} in ${city}",
    "when_to_raise_price": "",
    "seasonal_pricing": "",
    "peak_months": ["month1", "month2", "month3"],
    "slow_months": ["month1", "month2"],
    "seasonal_demand": [
      {"month":"Jan","demand":"low",   "price_tip":""},{"month":"Feb","demand":"medium","price_tip":""},
      {"month":"Mar","demand":"high",  "price_tip":""},{"month":"Apr","demand":"high",  "price_tip":""},
      {"month":"May","demand":"medium","price_tip":""},{"month":"Jun","demand":"low",   "price_tip":""},
      {"month":"Jul","demand":"low",   "price_tip":""},{"month":"Aug","demand":"medium","price_tip":""},
      {"month":"Sep","demand":"high",  "price_tip":""},{"month":"Oct","demand":"high",  "price_tip":""},
      {"month":"Nov","demand":"high",  "price_tip":""},{"month":"Dec","demand":"medium","price_tip":""}
    ],
    "revenue_potential": "High / Medium / Low — one sentence specific to ${rawProducts} in ${city}",
    "top_buying_channels": ["channel 1", "channel 2", "channel 3"]
  }
}`;

  const gr       = await doGroqLocal(groqPrompt, groqKey, 3500, 0.25);
  let   groqData = parseGroqJson(gr);
  let   groqErr  = '';

  if (!groqData || typeof groqData !== 'object') {
    groqData = {};
    groqErr  = gr.err ? `cURL: ${gr.err}` : `Parse failed — raw: ${(gr.raw || '').substring(0, 300)}`;
  }

  // Assemble final response
  const result = {
    success:      true,
    _cached:      false,
    _generated:   new Date().toISOString(),

    swot:                    groqData.swot                    || {},
    opportunity_score:       groqData.opportunity_score       || 60,
    opportunity_reasoning:   groqData.opportunity_reasoning   || '',
    top_competitor_analysis: groqData.top_competitor_analysis || {},

    action_priority:   groqData.action_priority   || [],
    whatsapp_strategy: groqData.whatsapp_strategy  || [],
    outreach:          groqData.outreach           || {},

    pricing_intel:        groqData.pricing_intel || {},
    pricing_data:         priceSummary,
    competitor_prices:    platformListings.slice(0, 20),
    competitor_price_map: competitorPriceMap,

    competitors_summary: competitors.slice(0, 25).map(c => ({
      name:    c.name    || '',
      rating:  c.rating  || null,
      reviews: parseInt(c.reviews) || 0,
      website: c.website || '',
      phone:   c.phone   || '',
      address: c.address || '',
      source:  c.source  || ''
    })),

    debug: {
      competitors_received: compCount,
      top_competitor:       topCompName,
      prices_found:         allPrices.length,
      comp_prices_mapped:   Object.keys(competitorPriceMap).length,
      source_counts:        sourceCount,
      groq_http:            gr.http || 0,
      groq_error:           groqErr,
      price_summary:        priceSummary
    }
  };

  // Save to cache
  try {
    await supabase.from('competitor_intel').insert({ seller_id: sid, intel_json: JSON.stringify(result) });
  } catch (e) { /* cache is optional */ }

  return sendJSON(res, result);
};
