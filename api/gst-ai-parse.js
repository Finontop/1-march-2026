const { supabase } = require('../lib/supabase');
const { sendJSON } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJSON(res, { success: true });
    return;
  }
  if (req.method !== 'POST') {
    return sendJSON(res, { success: false, error: 'POST required' }, 405);
  }

  const data     = req.body || {};
  const sellerId = parseInt(data.seller_id) || 0;
  const gstRaw   = data.gst_raw || {};

  if (!gstRaw || !gstRaw.gstin) {
    return sendJSON(res, { success: false, error: 'No GST data provided' });
  }

  const groqKey = process.env.GROQ_KEY || '';
  if (!groqKey) return sendJSON(res, { success: false, error: 'GROQ_KEY not configured' });

  const categoryOptions    = 'Electronics, Clothing & Apparel, Food & Restaurant, Furniture, Hardware & Tools, Medical & Pharmacy, Real Estate, Education, Salon & Beauty, Automobile, Grocery, IT Services, Printing & Packaging, Textile & Fabric, Agriculture, Chemical & Plastics, Construction, Other';
  const businessTypeOptions = 'Manufacturer, Wholesaler / Distributor, Retailer, Dealer, Exporter, Service Provider, Trader, Franchise';
  const turnoverOptions     = 'Below ₹10 Lakh, ₹10L – ₹50L, ₹50L – ₹1 Crore, ₹1Cr – ₹5Cr, ₹5Cr – ₹25Cr, Above ₹25 Crore';
  const employeesOptions    = '1–5 (Micro), 6–20 (Small), 21–50, 51–200 (Medium), 200+ (Large)';
  const deliveryOptions     = 'Local only (within city), Within 50 km, Within state, Pan India, International / Export';
  const gstJson = JSON.stringify(gstRaw, null, 2);

  const prompt = `You are an Indian business data expert. Given raw GST portal data for a business, extract and intelligently map the data into our onboarding form fields.

Raw GST Data:
${gstJson}

Map this data into the following JSON structure. Use ONLY the exact allowed values for dropdown fields. If you cannot determine a value, use empty string "".

Required JSON output:
{
  "business_name": "<trade name from GST, NOT the proprietor/legal name>",
  "business_type": "<one of: ${businessTypeOptions}>",
  "category": "<one of: ${categoryOptions}>",
  "products_offered": "<comma-separated list of products/services>",
  "business_desc": "<a short 1-2 line description>",
  "address": "<full business address>",
  "city": "<city/district name only>",
  "state": "<full state name>",
  "pincode": "<6-digit pincode if available>",
  "gst_number": "<the GSTIN>",
  "annual_turnover": "<one of: ${turnoverOptions}, or empty>",
  "employees": "<one of: ${employeesOptions}, or empty>",
  "delivery_radius": "<one of: ${deliveryOptions}, or empty>",
  "certifications": "<any certifications like GST registered, etc.>"
}

Rules:
- business_name must be the TRADE NAME, not the legal/proprietor name
- Return ONLY valid JSON, no markdown, no explanation`;

  let content = '';
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.1,
        max_tokens: 800,
        messages: [
          { role: 'system', content: 'Return only valid JSON. No markdown. No explanation. No code fences.' },
          { role: 'user',   content: prompt }
        ]
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return sendJSON(res, { success: false, error: `Groq HTTP ${resp.status}`, raw: errText.substring(0, 300) });
    }

    const groqResp = await resp.json();
    content = (groqResp.choices && groqResp.choices[0] && groqResp.choices[0].message && groqResp.choices[0].message.content) || '';
  } catch (e) {
    return sendJSON(res, { success: false, error: 'Groq request failed: ' + e.message });
  }

  if (!content) return sendJSON(res, { success: false, error: 'Empty Groq response' });

  // Clean markdown fences if any
  content = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return sendJSON(res, { success: false, error: 'Could not parse AI response', raw_content: content.substring(0, 500) });
  }

  // Save to DB if seller_id provided
  if (sellerId > 0) {
    try {
      const { data: chk } = await supabase.from('sellers').select('id').eq('id', sellerId).single();
      if (chk) {
        const updateData = {};
        if (parsed.business_name) updateData.name     = parsed.business_name;
        if (parsed.category)      updateData.category = parsed.category;
        if (parsed.city)          updateData.city      = parsed.city;
        if (parsed.state)         updateData.state     = parsed.state;

        if (Object.keys(updateData).length > 0) {
          await supabase.from('sellers').update(updateData).eq('id', sellerId);
        }

        const detailsPayload = {
          seller_id:        sellerId,
          gst_number:       parsed.gst_number       || '',
          business_type:    parsed.business_type    || '',
          employees:        parsed.employees        || '',
          annual_turnover:  parsed.annual_turnover  || '',
          products_offered: parsed.products_offered || '',
          business_desc:    parsed.business_desc    || '',
          address:          parsed.address          || '',
          pincode:          parsed.pincode          || '',
          certifications:   parsed.certifications   || '',
          delivery_radius:  parsed.delivery_radius  || '',
          updated_at:       new Date().toISOString()
        };
        await supabase.from('seller_details').upsert(detailsPayload, { onConflict: 'seller_id' });
      }
    } catch (e) { /* ignore DB save errors */ }
  }

  return sendJSON(res, { success: true, parsed });
};
