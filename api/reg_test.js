const bcrypt = require('bcryptjs');
const { supabase } = require('../lib/supabase');
const { sendJSON } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJSON(res, { success: true });
    return;
  }

  const testEmail = `test_${Date.now()}@test.com`;
  const hash      = await bcrypt.hash('test1234', 10);

  const { data, error } = await supabase
    .from('sellers')
    .insert({
      name:     'Test Business',
      category: 'Electronics',
      city:     'Vadodara',
      state:    'Gujarat',
      website:  '',
      contact:  '9876543210',
      email:    testEmail,
      password: hash
    })
    .select('id')
    .single();

  if (error) {
    return sendJSON(res, { success: false, error: error.message });
  }

  return sendJSON(res, { success: true, seller_id: data.id, test_email: testEmail });
};
