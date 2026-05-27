const { requireAuth } = require('../../lib/auth');
const { setCors, handleOptions } = require('../../lib/cors');
const { buildAdminOverview } = require('../../lib/admin-overview');

module.exports = function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (requireAuth(req, res)) return;

  try {
    return res.status(200).json(buildAdminOverview());
  } catch (e) {
    return res.status(500).json({ error: 'Admin overview failed', detail: e.message });
  }
};
