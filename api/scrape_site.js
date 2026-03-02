const { cors, sendJSON } = require('../lib/helpers');

async function scrapeURL(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BizBoostBot/1.0)' },
      redirect: 'follow'
    });
    if (!resp.ok) return { error: `HTTP ${resp.status}` };

    const html = await resp.text();

    // Meta title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const metaTitle  = titleMatch ? titleMatch[1].trim() : '';

    // Meta description
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
                   || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
    const metaDesc  = descMatch ? descMatch[1].trim() : '';

    // Keywords
    const kwMatch = html.match(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']*)["']/i)
                 || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']keywords["']/i);
    const keywords = kwMatch ? kwMatch[1].trim() : '';

    // H1 tags
    // Safe text extraction: remove all tags using a character-level state machine
    function extractText(s) {
      let result = '';
      let inTag  = false;
      for (let i = 0; i < s.length; i++) {
        if (s[i] === '<') { inTag = true; }
        else if (s[i] === '>') { inTag = false; }
        else if (!inTag) { result += s[i]; }
      }
      return result.trim();
    }

    const h1s = [];
    const h1Re = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
    let m;
    while ((m = h1Re.exec(html)) !== null && h1s.length < 5) {
      const text = extractText(m[1]);
      if (text) h1s.push(text);
    }

    // H2 tags
    const h2s = [];
    const h2Re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
    while ((m = h2Re.exec(html)) !== null && h2s.length < 8) {
      const text = extractText(m[1]);
      if (text) h2s.push(text);
    }

    // Schema markup check
    const hasSchema = html.includes('application/ld+json');

    // Canonical
    const canMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i);
    const canonical = canMatch ? canMatch[1].trim() : '';

    return {
      meta_title: metaTitle,
      meta_desc:  metaDesc,
      keywords,
      h1_tags:    h1s.join(' | '),
      h2_tags:    h2s.join(' | '),
      has_schema: hasSchema,
      canonical
    };
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    cors(res);
    return res.status(200).end();
  }

  cors(res);
  const data = req.body || {};
  const url  = data.url || '';

  if (!url) {
    return res.status(200).json({ error: 'No URL provided' });
  }

  const result = await scrapeURL(url);
  return res.status(200).json(result);
};
