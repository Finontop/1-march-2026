const { supabase } = require('../lib/supabase');
const { sendJSON } = require('../lib/helpers');

function extractPhone(text) {
  if (!text) return '';
  let m;
  m = text.match(/\+91[\s-]?([6-9][0-9]{9})/);
  if (m) return '+91' + m[1];
  m = text.match(/0([6-9][0-9]{9})/);
  if (m) return m[1];
  m = text.match(/\b([6-9][0-9]{9})\b/);
  if (m) return m[1];
  return '';
}

function detectPlatform(url) {
  const u = url.toLowerCase();
  const map = {
    indiamart: 'IndiaMart', justdial: 'JustDial', tradeindia: 'TradeIndia',
    sulekha: 'Sulekha', udaan: 'Udaan', exportersindia: 'ExportersIndia',
    yellowpages: 'YellowPages', alibaba: 'Alibaba'
  };
  for (const [domain, name] of Object.entries(map)) {
    if (u.includes(domain)) return name;
  }
  return 'Web';
}

function isCategoryPage(title, url) {
  const junk = ['top ', 'best ', 'list of', 'directory', 'all ', 'find ', 'search ',
    'near me', 'dealers in', 'suppliers in', 'manufacturers in', 'wholesalers in',
    'companies in', 'exporters in', '/search', '/listing', '/category', '/browse', '?q=', '?search'];
  const t = title.toLowerCase();
  const u = url.toLowerCase();
  return junk.some(j => t.includes(j) || u.includes(j));
}

async function serperMaps(q, serperKey) {
  if (!serperKey) return [];
  try {
    const r = await fetch('https://google.serper.dev/maps', {
      method: 'POST',
      headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl: 'in', hl: 'en' })
    });
    const d = await r.json();
    return d.places || [];
  } catch (e) { return []; }
}

async function serperSearch(q, serperKey) {
  if (!serperKey) return [];
  try {
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl: 'in', hl: 'en', num: 10 })
    });
    const d = await r.json();
    return d.organic || [];
  } catch (e) { return []; }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJSON(res, { success: true });
    return;
  }
  if (req.method !== 'POST') {
    return sendJSON(res, { success: false, error: 'POST required' }, 405);
  }

  const body     = req.body || {};
  const product  = (body.product  || '').trim();
  const city     = (body.city     || '').trim();
  const state    = (body.state    || '').trim();

  if (!product) return sendJSON(res, { success: false, error: 'Product is required' });
  if (!city)    return sendJSON(res, { success: false, error: 'City is required' });

  const serperKey = process.env.SERPER_KEY || '';

  // 1. Search our own database
  let dbSellers = [];
  try {
    const { data } = await supabase
      .from('sellers')
      .select(`id, name, category, city, state, website, contact, is_featured, is_verified, featured_order,
               seller_details ( products_offered, business_type, address, whatsapp, working_hours )`)
      .ilike('city', city)
      .order('is_featured', { ascending: false })
      .order('featured_order', { ascending: true })
      .order('name', { ascending: true });

    // Filter by product match
    dbSellers = (data || []).filter(s => {
      const d = (s.seller_details && s.seller_details[0]) || {};
      const text = [s.category, s.name, d.products_offered || ''].join(' ').toLowerCase();
      return text.includes(product.toLowerCase());
    });

    // Expand to state if fewer than 3 results
    if (dbSellers.length < 3 && state) {
      const { data: data2 } = await supabase
        .from('sellers')
        .select(`id, name, category, city, state, website, contact, is_featured, is_verified, featured_order,
                 seller_details ( products_offered, business_type, address, whatsapp, working_hours )`)
        .ilike('state', state)
        .not('city', 'ilike', city)
        .order('is_featured', { ascending: false })
        .order('featured_order', { ascending: true });

      const extra = (data2 || []).filter(s => {
        const d = (s.seller_details && s.seller_details[0]) || {};
        const text = [s.category, s.name, d.products_offered || ''].join(' ').toLowerCase();
        return text.includes(product.toLowerCase());
      });
      dbSellers = [...dbSellers, ...extra];
    }

    // Flatten seller_details
    dbSellers = dbSellers.map(s => {
      const d = (s.seller_details && s.seller_details[0]) || {};
      return {
        id: s.id, name: s.name, category: s.category, city: s.city, state: s.state,
        website: s.website, contact: s.contact,
        is_featured: Boolean(s.is_featured), is_verified: Boolean(s.is_verified),
        featured_order: parseInt(s.featured_order) || 0,
        products_offered: d.products_offered || '', business_type: d.business_type || '',
        address: d.address || '', whatsapp: d.whatsapp || '', working_hours: d.working_hours || ''
      };
    });
  } catch (e) { dbSellers = []; }

  // 2. Google Maps via Serper
  const mapsResults = [];
  const seenNames   = {};
  const mapQueries  = [
    `${product} in ${city}`,
    `${product} dealer ${city}`,
    `${product} supplier ${city}`,
    `${product} wholesaler ${city}`
  ];

  for (const q of mapQueries) {
    const places = await serperMaps(q, serperKey);
    for (const p of places) {
      const name = (p.title || '').trim();
      if (!name) continue;
      const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (seenNames[key]) continue;
      seenNames[key] = true;
      const phone = p.phoneNumber || extractPhone(p.address || '');
      mapsResults.push({
        name, contact: phone, address: p.address || city,
        website: p.website || '', url: p.website || '',
        rating: p.rating || null, reviews: parseInt(p.ratingCount) || 0,
        source: 'Google Maps', verified: Boolean(phone), platforms: ['Google Maps']
      });
    }
  }

  // 3. Platform searches
  const platformSearches = [
    `${product} seller in ${city} site:indiamart.com`,
    `${product} ${city} site:tradeindia.com`,
    `${product} ${city} site:sulekha.com`,
    `${product} supplier ${city} site:exportersindia.com`,
    `${product} ${city} site:justdial.com`,
    `${product} supplier ${city} ${state}`
  ];

  const platformResults = [];
  const seenUrls = {};

  for (const q of platformSearches) {
    const organic = await serperSearch(q, serperKey);
    for (const item of organic) {
      const title = (item.title || '').trim();
      const url   = (item.link  || '').trim();
      const snip  = (item.snippet || '').trim();
      if (!url || !title || seenUrls[url] || isCategoryPage(title, url)) continue;
      seenUrls[url] = true;
      const platform = detectPlatform(url);
      const phone = extractPhone(snip);
      platformResults.push({
        name: title, contact: phone, address: snip, url, source: platform,
        verified: Boolean(phone), platforms: [platform], rating: null, reviews: 0
      });
    }
  }

  // 4. Merge Maps + Platform results
  const merged    = [];
  const usedPlat  = new Set();

  for (const mr of mapsResults) {
    const entry    = { ...mr };
    const mrClean  = mr.name.toLowerCase().replace(/[^a-z0-9]/g, '');

    platformResults.forEach((pr, pi) => {
      if (usedPlat.has(pi)) return;
      const prClean = pr.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      // Simple similarity: check if 65%+ chars overlap
      const shorter = Math.min(mrClean.length, prClean.length);
      let common = 0;
      for (const c of mrClean) if (prClean.includes(c)) common++;
      if (shorter > 0 && (common / shorter) > 0.65) {
        entry.platforms.push(pr.source);
        if (!entry.contact && pr.contact) { entry.contact = pr.contact; entry.verified = true; }
        usedPlat.add(pi);
      }
    });

    entry.trust_score = (new Set(entry.platforms)).size;
    if (entry.contact)       entry.trust_score += 4;
    if (entry.rating)        entry.trust_score += 2;
    if (entry.reviews > 10)  entry.trust_score += 2;
    if (entry.website)       entry.trust_score += 1;
    merged.push(entry);
  }

  platformResults.forEach((pr, pi) => {
    if (usedPlat.has(pi)) return;
    merged.push({ ...pr, trust_score: pr.contact ? 5 : 1 });
  });

  merged.sort((a, b) => (b.trust_score || 0) - (a.trust_score || 0));
  const top = merged.slice(0, 25);

  // Cache to DB
  for (const item of top) {
    try {
      await supabase.from('external_listings').insert({
        platform:      (item.platforms || [item.source || 'Web']).join(','),
        category:      product,
        city,
        business_name: item.name,
        contact:       item.contact || '',
        url:           item.url     || ''
      });
    } catch (e) { /* ignore cache failures */ }
  }

  // Platform grouping for pills
  const grouped = {};
  for (const item of top) {
    const primary = (item.platforms && item.platforms[0]) || item.source || 'Web';
    if (!grouped[primary]) grouped[primary] = [];
    grouped[primary].push(item);
  }

  return sendJSON(res, {
    success:    true,
    db_sellers: dbSellers,
    external:   top,
    grouped,
    counts: {
      local:       dbSellers.length,
      external:    top.length,
      with_phone:  top.filter(e => e.contact).length,
      google_maps: mapsResults.length,
      platforms:   Object.keys(grouped)
    }
  });
};
