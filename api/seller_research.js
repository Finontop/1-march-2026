const { supabase } = require('../lib/supabase');
const { sendJSON, notifyDiscord, TIER_LIMITS } = require('../lib/helpers');

// ── Usage check helper ─────────────────────────────────────────
async function checkUsage(sellerId, feature = 'analyze') {
  const { data: sellerRow } = await supabase
    .from('sellers')
    .select('subscription_tier')
    .eq('id', sellerId)
    .single();

  if (!sellerRow) return { allowed: false, error: 'Seller not found' };

  const tier  = sellerRow.subscription_tier || 'free';
  const limit = TIER_LIMITS[tier] !== undefined ? TIER_LIMITS[tier] : 2;

  if (limit === -1) {
    await supabase.from('seller_usage').insert({ seller_id: sellerId, feature });
    return { allowed: true, tier, limit: -1 };
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data: usageRows } = await supabase
    .from('seller_usage')
    .select('id')
    .eq('seller_id', sellerId)
    .eq('feature', feature)
    .gte('used_at', startOfMonth);

  const used = (usageRows || []).length;
  if (used >= limit) {
    return { allowed: false, error: `Monthly limit reached. Your ${tier} plan allows ${limit} ${feature}s per month. Upgrade to continue.`, tier, used, limit };
  }

  await supabase.from('seller_usage').insert({ seller_id: sellerId, feature });
  return { allowed: true, tier, used: used + 1, limit };
}

function detectBusinessType(type, name, desc) {
  const t = ((type || '') + ' ' + (name || '') + ' ' + (desc || '')).toLowerCase();
  const wholesale    = ['wholesale', 'wholesaler', 'distributor', 'distribution', 'supplier', 'supply', 'bulk', 'trader', 'trading', 'stockist', 'b2b', 'importer', 'exporter'];
  const manufacturer = ['manufacturer', 'manufacturing', 'factory', 'fabricator', 'fabrication', 'producer', 'industries', 'industry', 'udyog', 'oem', 'assembler'];
  const service      = ['service', 'repair', 'installation', 'maintenance', 'contractor', 'installer', 'integrator'];
  if (wholesale.some(k => t.includes(k)))    return 'wholesale';
  if (manufacturer.some(k => t.includes(k))) return 'manufacturer';
  if (service.some(k => t.includes(k)))      return 'service';
  return 'retail';
}

function isCategoryBlocked(cat) {
  if (!cat) return false;
  const c = cat.toLowerCase().trim();
  const blocked = ['bus station', 'transit station', 'train station', 'railway station', 'metro station',
    'airport', 'ferry terminal', 'taxi service', 'truck stop', 'tourist attraction', 'point of interest',
    'monument', 'memorial', 'historical landmark', 'sculpture', 'statue', 'artwork', 'scenic point',
    'hindu temple', 'mosque', 'church', 'gurudwara', 'jain temple', 'place of worship', 'shrine', 'dargah',
    'wholesale market', 'grain market', 'vegetable market', 'produce market', 'fish market', 'flower market',
    'cattle market', 'mandi', 'bazaar', 'shopping mall', 'shopping center', 'shopping complex',
    'restaurant', 'fast food', 'cafe', 'bar', 'bakery', 'sweet shop', 'ice cream',
    'hotel', 'motel', 'lodge', 'hostel', 'guest house', 'resort', 'banquet hall',
    'hospital', 'clinic', 'doctor', 'dentist', 'pharmacy', 'diagnostic center', 'nursing home',
    'school', 'college', 'university', 'library', 'tutoring center', 'driving school',
    'gym', 'fitness center', 'yoga studio', 'spa', 'nail salon', 'hair salon', 'barbershop',
    'lawyer', 'law firm', 'accounting', 'insurance agency', 'real estate agency', 'travel agency',
    'gas station', 'petrol station', 'fuel station', 'car wash', 'parking',
    'post office', 'government office', 'police station', 'bank', 'atm',
    'grocery store', 'supermarket', 'convenience store', 'hypermarket',
    'park', 'garden', 'playground', 'stadium', 'swimming pool'];
  return blocked.some(k => c.includes(k));
}

function isChainStore(name) {
  const n = name.toLowerCase().trim();
  const chains = ['croma', 'reliance digital', 'vijay sales', 'samsung smart', 'apple store',
    'sony centre', 'sony center', 'lg best shop', 'poorvika', 'sangeetha', 'mi store', 'oneplus',
    'xiaomi store', 'oppo store', 'vivo store', 'realme store', 'pantaloons', 'shoppers stop',
    'lifestyle store', 'max fashion', 'westside', 'zara', 'h&m', 'manyavar', 'fabindia',
    'biba store', 'reliance trends', 'v-mart', 'bata store', 'bata shoe', 'liberty shoes',
    'woodland store', 'metro shoes', 'decathlon', 'nike store', 'adidas store', 'puma store',
    'reebok store', 'titan world', 'tanishq', 'malabar gold', 'kalyan jewellers', 'joyalukkas',
    'd-mart', 'dmart', 'big bazaar', 'more supermarket', 'reliance fresh', 'reliance smart',
    'lulu hypermarket', 'spar hypermarket', 'metro cash', 'vishal mega mart',
    'dominos', "domino's", 'mcdonalds', "mcdonald's", 'burger king', 'kfc', 'subway', 'pizza hut',
    'starbucks', 'cafe coffee day', 'ccd', 'barista', 'airtel store', 'jio point', 'jio store',
    'apollo pharmacy', 'medplus', 'maruti suzuki', 'hyundai motor', 'tata motors showroom',
    'honda cars', 'toyota showroom', 'mahindra showroom', 'mg motors', 'kia showroom',
    'hero motocorp', 'bajaj showroom', 'tvs motor', 'royal enfield showroom', 'ikea', 'pepperfry', 'lenskart'];
  if (chains.some(k => n.includes(k))) return true;
  if (/\b(mall|hypermarket|superstore|megastore)\b/i.test(name)) return true;
  return false;
}

function isNamePOI(name) {
  const n = name.toLowerCase().trim();
  const patterns = ['bus station', 'bus stand', 'bus depot', 'bus terminal', 'railway station',
    'train station', 'metro station', 'wholesale grain', 'grain market', 'wholesale mandi',
    'anaj mandi', 'sabzi mandi', 'vegetable market', 'wholesale vegetable', 'fish market',
    'meat market', 'flower market', 'general wholesale market', ' temple', ' mandir', ' masjid',
    ' mosque', ' church', ' gurudwara', ' dargah', ' statue', ' monument', ' memorial',
    ' fort', ' palace', ' museum', ' lake ', ' garden', ' park ', ' stadium',
    ' hospital', ' clinic', ' school', ' college', ' university',
    'petrol pump', 'fuel station', 'gas station', 'cng station'];
  if (patterns.some(p => n.includes(p.trim()))) return true;
  if (/^[\w\s.]+(bazar|bazaar|market|mandi|chowk|chawk|darwaza|darwaja|crossing|circle)\s*\.?$/i.test(name.trim())) return true;
  return false;
}

function productRelevanceScore(name, address, keywords) {
  const text = (name + ' ' + address).toLowerCase();
  let score  = 0;
  for (const kw of keywords) {
    if (name.toLowerCase().includes(kw))    score += 10;
    if (address.toLowerCase().includes(kw)) score += 3;
    for (const w of kw.split(' ')) {
      if (w.length >= 4 && text.includes(w)) score += 2;
    }
  }
  return score;
}

function getCityVariants(city) {
  const c = city.toLowerCase().trim();
  const map = {
    vadodara: 'vadodara,baroda', mumbai: 'mumbai,bombay,navi mumbai',
    bengaluru: 'bengaluru,bangalore', kolkata: 'kolkata,calcutta',
    chennai: 'chennai,madras', hyderabad: 'hyderabad,secunderabad,cyberabad',
    ahmedabad: 'ahmedabad,ahmadabad,amdavad', pune: 'pune,pimpri,chinchwad',
    delhi: 'delhi,new delhi', noida: 'noida,greater noida', gurugram: 'gurugram,gurgaon',
    kochi: 'kochi,cochin,ernakulam', chandigarh: 'chandigarh,mohali,panchkula',
    mysuru: 'mysuru,mysore', varanasi: 'varanasi,banaras,kashi',
    allahabad: 'allahabad,prayagraj', mangaluru: 'mangaluru,mangalore',
    bhubaneswar: 'bhubaneswar,cuttack', visakhapatnam: 'visakhapatnam,vizag',
    coimbatore: 'coimbatore,kovai', guwahati: 'guwahati,gauhati'
  };
  return (map[c] || c).split(',');
}

function isInCity(address, city) {
  if (!address || !city) return true;
  const addr = address.toLowerCase();
  return getCityVariants(city).some(v => addr.includes(v.toLowerCase().trim()));
}

async function doSerperMaps(q, key, city, state, num = 20) {
  if (!key) return [];
  try {
    const r = await fetch('https://google.serper.dev/maps', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, location: `${city}, ${state}, India`, gl: 'in', hl: 'en', num })
    });
    const d = await r.json();
    return d.places || [];
  } catch (e) { return []; }
}

async function doSerperSearch(q, key) {
  if (!key) return [];
  try {
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl: 'in', hl: 'en', num: 10 })
    });
    const d = await r.json();
    return d.organic || [];
  } catch (e) { return []; }
}

async function doGroq(prompt, key, maxTok, temp) {
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', temperature: temp, max_tokens: maxTok,
        messages: [
          { role: 'system', content: 'Return only valid JSON. No markdown. No explanation.' },
          { role: 'user',   content: prompt }
        ]
      })
    });
    const raw  = await r.text();
    return { raw, err: '', http: r.status };
  } catch (e) {
    return { raw: '', err: e.message, http: 0 };
  }
}

function extractJson(text) {
  text = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const po = text.indexOf('{'), pa = text.indexOf('[');
  let start;
  if (po === -1 && pa === -1) return null;
  else if (po === -1) start = pa;
  else if (pa === -1) start = po;
  else start = Math.min(po, pa);
  try { return JSON.parse(text.substring(start)); }
  catch (e) { return null; }
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

  const body = req.body || {};
  const sid  = parseInt(body.seller_id) || 0;
  if (!sid) return sendJSON(res, { success: false, error: 'seller_id required' });

  // Credit check
  const credit = await checkUsage(sid, 'analyze');
  if (!credit.allowed) {
    return sendJSON(res, { success: false, error: credit.error || 'Usage limit reached',
      tier: credit.tier, used: credit.used, limit: credit.limit });
  }

  // Load seller
  const { data: sellerRow } = await supabase
    .from('sellers')
    .select(`id, name, email, category, city, state, website, contact,
             seller_details ( gst_number, business_type, employees, annual_turnover,
               products_offered, business_desc, address, pincode, certifications, delivery_radius )`)
    .eq('id', sid)
    .single();

  if (!sellerRow) return sendJSON(res, { success: false, error: `Seller #${sid} not found` });

  const d      = (sellerRow.seller_details && sellerRow.seller_details[0]) || {};
  const seller = { ...sellerRow, ...d };

  // Step 1: Detect business type
  const detectedType = detectBusinessType(seller.business_type || '', seller.name || '', seller.business_desc || '');
  const typeLabels   = { wholesale: 'Wholesaler / Distributor', manufacturer: 'Manufacturer / Factory',
    service: 'Service Provider / Installer', retail: 'Retailer / Dealer / Shop' };
  const typeLabel = typeLabels[detectedType];

  const typeQWords = {
    wholesale:    ['wholesaler', 'distributor', 'supplier', 'bulk supplier', 'stockist', 'trader'],
    manufacturer: ['manufacturer', 'factory', 'producer', 'fabricator', 'industries', 'oem'],
    service:      ['service center', 'installer', 'repair center', 'contractor', 'service provider'],
    retail:       ['shop', 'dealer', 'store', 'outlet', 'showroom', 'retailer']
  };
  const qWords = typeQWords[detectedType];

  const rawProducts = (seller.products_offered || seller.category || '').trim();
  const city        = (seller.city  || '').trim();
  const state       = (seller.state || '').trim();
  const cat         = (seller.category || '').trim();
  const ownKey      = (seller.name || '').toLowerCase().replace(/[^a-z0-9]/gi, '');

  const productArr = [...new Set(rawProducts.split(/[,;/|]+/).map(s => s.trim()).filter(s => s.length >= 2))].slice(0, 5);
  if (productArr.length === 0) productArr.push(cat || 'business');
  const productKeywords = productArr.map(s => s.toLowerCase());

  const kw1 = productArr[0] || '';
  const kw2 = productArr[1] || kw1;

  // Step 3: Build queries
  const queries = [];
  for (const prod of productArr.slice(0, 4)) {
    for (const qw of qWords.slice(0, 4)) {
      queries.push(`${prod} ${qw} ${city}`);
    }
  }
  if (kw2 !== kw1) queries.push(`${kw1} ${kw2} ${qWords[0]} ${city}`);
  if (cat && cat.toLowerCase() !== kw1.toLowerCase()) {
    queries.push(`${cat} ${qWords[0]} ${city}`);
    if (qWords[1]) queries.push(`${cat} ${qWords[1]} ${city}`);
  }
  if (detectedType === 'wholesale' || detectedType === 'manufacturer') {
    queries.push(`${kw1} distributor ${city}`, `${kw1} bulk supplier ${city}`, `${kw1} wholesale price ${city}`, `${kw1} stockist ${city}`);
  }
  if (detectedType === 'service') {
    queries.push(`${kw1} service ${city}`, `${kw1} installation ${city}`, `${kw1} repair ${city}`);
  }
  if (detectedType === 'retail') {
    queries.push(`${kw1} shop near ${city}`, `buy ${kw1} ${city}`, `${kw1} showroom ${city}`);
  }
  const uniqueQueries  = [...new Set(queries)].slice(0, 16);
  const debugQueries   = uniqueQueries;

  // Fetch maps
  const allPlaces     = [];
  let outOfCitySkip   = 0, categorySkip = 0;

  for (const q of uniqueQueries) {
    const places = await doSerperMaps(q, serperKey, city, state, 20);
    for (const place of places) {
      const addr     = place.address  || '';
      const placeCat = place.category || '';
      if (city && !isInCity(addr, city)) { outOfCitySkip++; continue; }
      if (isCategoryBlocked(placeCat))  { categorySkip++;  continue; }
      allPlaces.push(place);
    }
  }

  // Organic search
  const skipDomains = ['justdial', 'indiamart', 'tradeindia', 'sulekha', 'wikipedia', 'quora',
    'facebook', 'instagram', 'youtube', 'amazon', 'flipkart', 'twitter', 'linkedin',
    'zomato', 'swiggy', 'practo', '99acres', 'magicbricks', 'olx', 'snapdeal',
    'naukri', 'indeed', 'glassdoor', 'paytm', 'phonepe', 'maps.google'];

  const [o1, o2] = await Promise.all([
    doSerperSearch(`"${kw1}" ${qWords[0]} ${city} ${state}`, serperKey),
    doSerperSearch(`${kw1} ${kw2} ${qWords[0]} ${city}`, serperKey)
  ]);
  const allOrganic = [...o1, ...o2];

  // Step 4: Build candidates
  const seenKeys = {};
  const candidates = [];
  let chainsSkipped = 0, nameSkipped = 0;

  for (const p of allPlaces) {
    const name = (p.title || '').trim();
    if (!name) continue;
    if (isChainStore(name))  { chainsSkipped++; continue; }
    if (isNamePOI(name))     { nameSkipped++;   continue; }
    const reviews = parseInt(p.ratingCount) || 0;
    if (reviews > 5000) { chainsSkipped++; continue; }
    const key = name.toLowerCase().replace(/[^a-z0-9]/gi, '');
    if (seenKeys[key]) continue;
    // Simple similarity check vs own name
    const shorter = Math.min(key.length, ownKey.length);
    let common = 0;
    for (const c of key) if (ownKey.includes(c)) common++;
    if (shorter > 0 && (common / shorter) > 0.75) continue;
    seenKeys[key] = true;
    const address  = p.address     || city;
    const mapCat   = p.category    || '';
    const relScore = productRelevanceScore(name, address + ' ' + mapCat, productKeywords);
    candidates.push({ name, address, phone: p.phoneNumber || '', website: p.website || '',
      rating: p.rating || null, reviews, source: 'Google Maps', map_category: mapCat, relScore });
  }

  for (const r of allOrganic) {
    const name = (r.title   || '').trim();
    const url  = (r.link    || '').trim();
    const snip = (r.snippet || '').trim();
    if (!name || !url) continue;
    if (isChainStore(name))  { chainsSkipped++; continue; }
    if (isNamePOI(name))     { nameSkipped++;   continue; }
    if (skipDomains.some(sk => url.toLowerCase().includes(sk))) continue;
    if (city && !isInCity(snip + ' ' + name, city)) { outOfCitySkip++; continue; }
    const key = name.toLowerCase().replace(/[^a-z0-9]/gi, '');
    if (seenKeys[key]) continue;
    seenKeys[key] = true;
    const relScore = productRelevanceScore(name, snip, productKeywords);
    candidates.push({ name, address: snip, phone: '', website: url,
      rating: null, reviews: 0, source: 'Google Search', map_category: '', relScore });
  }

  // Step 5: Groq filter
  let groqFilteredNames = [], groqFilterError = '', groqApprovedCount = 0;

  if (candidates.length > 0) {
    const productList = productArr.join(', ');
    const nameLines   = candidates.map((c, i) => {
      const catNote = c.map_category ? ` [Category: ${c.map_category}]` : '';
      return `${i + 1}. ${c.name}${catNote} | ${c.address.substring(0, 70)}`;
    }).join('\n');

    const filterPrompt = `You are a strict business competitor classifier for an Indian B2B analytics tool.

SELLER PROFILE:
- Business type: ${typeLabel}
- Primary products: "${productList}"
- City: ${city}, ${state}, India

A COMPETITOR must pass BOTH tests:

TEST 1 — PRIMARY PRODUCT MATCH:
The business must PRIMARILY deal in "${productList}".
FAIL if the business is a general shop or in a different industry.

TEST 2 — BUSINESS TYPE MATCH:
The business must be the SAME business type as "${typeLabel}".
FAIL if it's a different business type (e.g., retail shop for a wholesaler).

Business list:
${nameLines}

Return ONLY: {"include": [2, 5, 8]}
Return empty if none qualify: {"include": []}
No explanation. JSON only.`;

    const fr = await doGroq(filterPrompt, groqKey, 500, 0.0);

    if (fr.err) {
      groqFilterError = 'Curl: ' + fr.err;
    } else if (fr.http !== 200) {
      groqFilterError = `HTTP ${fr.http}: ${fr.raw.substring(0, 200)}`;
    } else {
      try {
        const gd      = JSON.parse(fr.raw);
        const content = gd.choices && gd.choices[0] && gd.choices[0].message && gd.choices[0].message.content || '';
        if (content) {
          const parsed = extractJson(content);
          const nums   = (parsed && parsed.include && Array.isArray(parsed.include)) ? parsed.include : [];
          for (const num of nums) {
            const idx = parseInt(num) - 1;
            if (candidates[idx]) {
              groqFilteredNames.push(candidates[idx].name.toLowerCase().replace(/[^a-z0-9]/gi, ''));
            }
          }
          groqApprovedCount = groqFilteredNames.length;
        } else {
          groqFilterError = 'Empty Groq response';
        }
      } catch (e) {
        groqFilterError = 'Parse fail: ' + e.message;
      }
    }
  }

  // Step 6: Apply filter + fallback
  const competitors = [];
  let groqFiltered  = 0;
  const groqRanOk   = !groqFilterError && candidates.length > 0;

  for (const c of candidates) {
    const key      = c.name.toLowerCase().replace(/[^a-z0-9]/gi, '');
    const relScore = parseInt(c.relScore) || 0;
    if (groqRanOk) {
      if (groqFilteredNames.includes(key)) {
        const { relScore: _r, map_category: _m, ...clean } = c;
        competitors.push(clean);
      } else {
        groqFiltered++;
      }
    } else {
      if (relScore >= 8) {
        const { relScore: _r, map_category: _m, ...clean } = c;
        competitors.push(clean);
      } else {
        groqFiltered++;
      }
    }
  }

  // Score + rank
  competitors.forEach(c => {
    c.score = (c.reviews || 0) * 2 + (parseFloat(c.rating) || 0) * 10
            + (c.website ? 5 : 0) + (c.phone ? 3 : 0);
  });
  competitors.sort((a, b) => b.score - a.score);

  const topCompetitor = competitors[0] || null;
  const topComp       = competitors.slice(0, 25);
  const compCount     = topComp.length;

  // Step 7: Groq strategy
  const compListStr = topComp.length === 0
    ? `No verified direct competitors found in ${city} for ${rawProducts} (${typeLabel}).`
    : topComp.map(c => `- ${c.name} | ${c.rating ? '⭐' + c.rating : 'No rating'} (${c.reviews} reviews) | ${c.address.substring(0, 55)}`).join('\n');

  const topStr = topCompetitor
    ? `${topCompetitor.name} (⭐${topCompetitor.rating || 'N/A'}, ${topCompetitor.reviews} reviews)`
    : 'None found';

  const stratPrompt = `You are a senior Indian SMB growth strategist.

SELLER:
- Name: ${seller.name}
- Type: ${typeLabel}
- Products: ${rawProducts}
- City: ${city}, ${state}
- Employees: ${seller.employees || 'Unknown'}
- Turnover: ${seller.annual_turnover || 'Unknown'}
- Website: ${seller.website || 'None'}
- GST: ${seller.gst_number ? 'Yes' : 'No'}

VERIFIED DIRECT COMPETITORS (${compCount} in ${city} — same products, same business type):
Top: ${topStr}
All:
${compListStr}

Write practical growth strategy for a "${typeLabel}" selling "${rawProducts}" in ${city}.
Be specific to business type — wholesalers: B2B focus, bulk pricing, distributor network.

Return ONLY valid JSON:
{
  "top_competitor": {"name": "","why_winning": "","their_strengths": ["","",""],"how_to_beat_them": ["","","",""]},
  "bottlenecks": ["","","",""],
  "keyword_targets": ["","","","","","","",""],
  "seo_fixes": ["","","","",""],
  "content_gaps": ["","",""],
  "local_listings": ["","","","",""],
  "weekly_actions": ["","","","",""],
  "ad_strategy": ["","",""],
  "offline_strategy": ["","",""],
  "gst_advantage": "",
  "revenue_score": ""
}`;

  let strategy = {}, groqError = '';
  const gr = await doGroq(stratPrompt, groqKey, 2000, 0.3);

  if (gr.err) {
    groqError = 'Curl: ' + gr.err;
  } else if (gr.http !== 200) {
    groqError = `HTTP ${gr.http}: ${gr.raw.substring(0, 300)}`;
  } else {
    try {
      const gd      = JSON.parse(gr.raw);
      const content = gd.choices && gd.choices[0] && gd.choices[0].message && gd.choices[0].message.content || '';
      if (content) {
        const parsed = extractJson(content);
        if (parsed && typeof parsed === 'object') strategy = parsed;
        else groqError = 'Parse fail: ' + content.substring(0, 200);
      } else {
        groqError = 'Empty strategy response';
      }
    } catch (e) {
      groqError = 'Parse fail: ' + e.message;
    }
  }

  // Save to seo_reports
  if (Object.keys(strategy).length > 0) {
    try {
      await supabase.from('seo_reports').insert({ seller_id: sid, report_json: JSON.stringify(strategy) });
    } catch (e) { /* ignore */ }
  }

  // Discord notification
  try {
    const wh = process.env.DISCORD_WEBHOOK;
    if (wh && !wh.includes('YOUR_WEBHOOK')) {
      await fetch(wh, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [{ title: `BizBoost: ${seller.name}`,
          description: `${typeLabel} · ${city} · ${compCount} direct competitors`,
          color: 3447003,
          fields: [
            { name: 'Products',       value: rawProducts,              inline: true },
            { name: 'Type',           value: typeLabel,                inline: true },
            { name: 'Final Results',  value: String(compCount),        inline: true },
            { name: 'Candidates',     value: String(candidates.length),inline: true },
            { name: 'AI Filtered',    value: String(groqFiltered),     inline: true }
          ]
        }] })
      });
    }
  } catch (e) { /* ignore */ }

  return sendJSON(res, {
    success:        true,
    strategy,
    competitors:    topComp,
    top_competitor: topCompetitor,
    competitor_count: compCount,
    counts: {
      competitors:      compCount,
      keywords:         (strategy.keyword_targets || []).length,
      seo_fixes:        (strategy.seo_fixes || []).length,
      chains_skipped:   chainsSkipped,
      category_blocked: categorySkip,
      name_blocked:     nameSkipped,
      ai_filtered:      groqFiltered,
      out_of_city:      outOfCitySkip
    },
    debug: {
      detected_type:         detectedType,
      type_label:            typeLabel,
      queries_fired:         uniqueQueries.length,
      queries_list:          debugQueries,
      products_parsed:       productArr,
      candidates_total:      candidates.length,
      category_blocked:      categorySkip,
      name_blocked:          nameSkipped,
      chains_skipped:        chainsSkipped,
      out_of_city_skipped:   outOfCitySkip,
      groq_approved:         groqApprovedCount,
      ai_filtered_out:       groqFiltered,
      final_competitors:     compCount,
      groq_filter_error:     groqFilterError,
      groq_strat_error:      groqError,
      strategy_model_used:   'llama-3.3-70b-versatile',
      strategy_groq_error:   groqError || null
    }
  });
};
