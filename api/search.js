const { requireAuth } = require('../lib/auth');
const { setCors, handleOptions } = require('../lib/cors');
const { taxData } = require('../lib/data');
const { mapSearchResult } = require('../lib/tax-mapper');
const { searchCandidates } = require('../lib/search-utils');
const { matchProducts } = require('../lib/product-match');
const { appendAccess } = require('../lib/access-log');

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === 'object' ? body : null;
}

function handleMatch(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', hint: 'Use POST /api/match' });
  }
  if (requireAuth(req, res, { publicRoute: true })) return;

  const body = parseBody(req);
  if (!body) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const started = Date.now();
  try {
    const payload = matchProducts(body);
    appendAccess({
      route: '/api/match',
      ms: Date.now() - started,
      querySnippet: String(body.titleVi || body.titleZh || '').slice(0, 80),
      hsCode: payload.matches?.[0]?.hsCode || null,
    });
    return res.status(200).json(payload);
  } catch (error) {
    if (error.code === 'VALIDATION') {
      return res.status(400).json({ ok: false, error: error.message });
    }
    return res.status(500).json({ ok: false, error: error.message });
  }
}

module.exports = function handler(req, res) {
  setCors(res, req);
  if (handleOptions(req, res)) return;

  const mode = String(req.query.mode || '').trim();
  if (mode === 'match') {
    return handleMatch(req, res);
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (requireAuth(req, res)) return;

  const { q, cs_only, limit = '20' } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({
      error: 'Query q must be at least 2 characters',
      examples: ['/api/search?q=bàn+chải', '/api/search?q=8509', '/api/search?q=nhựa&cs_only=1'],
    });
  }

  const limitNum = Math.min(parseInt(limit, 10) || 20, 50);
  const onlyCS = cs_only === '1' || cs_only === 'true';
  const started = Date.now();
  const candidates = searchCandidates(q, { topCandidates: limitNum, csOnly: onlyCS });
  appendAccess({
    route: '/api/search',
    ms: Date.now() - started,
    querySnippet: String(q).slice(0, 80),
    hsCode: candidates[0]?.hsCode || null,
  });
  const results = candidates.map((item) => {
    const full = taxData[item.hsCode] || {};
    return mapSearchResult(
      {
        hs: item.hsCode,
        vn: item.nameVi,
        cs: item.hasPolicyWarning ? '1' : '0',
      },
      full
    );
  });

  return res.status(200).json({
    keyword: q,
    total: results.length,
    results,
  });
};
