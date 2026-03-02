const { sendJSON } = require('../lib/helpers');

const GST_STATES = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
  '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
  '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam',
  '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha',
  '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '25': 'Daman & Diu', '26': 'Dadra & Nagar Haveli', '27': 'Maharashtra',
  '28': 'Andhra Pradesh', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman & Nicobar',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh'
};

function parseGstPortalData(d, stateName) {
  const tradeName = (d.tradeNam || '').trim();
  const legalName = (d.lgnm     || '').trim();

  let address = '';
  if (d.pradr && d.pradr.adr) {
    address = d.pradr.adr.trim();
  } else if (d.pradr && d.pradr.addr) {
    const a = d.pradr.addr;
    address = [a.bno, a.flno, a.bnm, a.st, a.loc, a.dst]
      .filter(Boolean).join(', ');
  }

  let state = '';
  if (d.pradr && d.pradr.addr && d.pradr.addr.stcd) {
    state = d.pradr.addr.stcd.trim();
  } else if (d.stj) {
    state = d.stj.split(' - ')[0].trim();
  }
  if (!state) state = stateName;

  let city = '';
  if (d.pradr && d.pradr.addr) {
    city = (d.pradr.addr.dst || d.pradr.addr.loc || '').trim();
  }

  const pincode      = (d.pradr && d.pradr.addr && d.pradr.addr.pncd) ? String(d.pradr.addr.pncd).trim() : '';
  let   nature       = d.ntr || '';
  if (Array.isArray(nature)) nature = nature.join(', ');
  const businessType = (d.ctb || '').trim();
  const status       = (d.sts || '').trim();

  if (tradeName || legalName || address) {
    return { trade_name: tradeName, legal_name: legalName, address, state, pincode, city, business_type: businessType, status, nature };
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJSON(res, { success: true });
    return;
  }
  if (req.method !== 'POST') {
    return sendJSON(res, { success: false, error: 'POST required' }, 405);
  }

  const input = req.body || {};
  const gstin = (input.gstin || '').trim();

  if (!gstin || !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin)) {
    return sendJSON(res, { success: false, error: 'Invalid GSTIN format' });
  }

  const stateCode = gstin.substring(0, 2);
  const stateName = GST_STATES[stateCode] || '';

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  let result = null;

  // Primary: Official GST portal
  try {
    const resp = await fetch(
      `https://services.gst.gov.in/services/api/search/taxpayerByGstin/${encodeURIComponent(gstin)}`,
      {
        headers: {
          'Accept':     'application/json',
          'Referer':    'https://services.gst.gov.in/services/searchtp',
          'Origin':     'https://services.gst.gov.in',
          'User-Agent': ua
        }
      }
    );
    if (resp.ok) {
      const d = await resp.json();
      if (d && typeof d === 'object' && !d.errorMsg) {
        result = parseGstPortalData(d, stateName);
      }
    }
  } catch (e) { /* fall through */ }

  // Secondary fallback: AppyFlow
  if (!result) {
    try {
      const resp = await fetch(
        `https://appyflow.in/api/verifyGST?gstNo=${encodeURIComponent(gstin)}&key_secret=free`,
        { headers: { 'Accept': 'application/json', 'User-Agent': ua } }
      );
      if (resp.ok) {
        const d = await resp.json();
        if (d && typeof d === 'object' && !d.errorMsg) {
          result = parseGstPortalData(d, stateName);
        }
      }
    } catch (e) { /* fall through */ }
  }

  if (result) {
    return sendJSON(res, {
      success:       true,
      gstin,
      trade_name:    result.trade_name    || '',
      legal_name:    result.legal_name    || '',
      address:       result.address       || '',
      city:          result.city          || '',
      state:         result.state         || stateName,
      pincode:       result.pincode       || '',
      business_type: result.business_type || '',
      status:        result.status        || '',
      nature:        result.nature        || ''
    });
  }

  return sendJSON(res, {
    success: true, gstin, trade_name: '', legal_name: '', address: '',
    city: '', state: stateName, pincode: '', business_type: '', fallback: true
  });
};
