const { requireAuth } = require('../lib/auth');
const { setCors, handleOptions } = require('../lib/cors');
const { taxData, explanatoryNotesData, precedentsData, conflictsData, normalizeHs } = require('../lib/data');
const { loadIndex } = require('../lib/tariff-versions');
const { enrichedEntryCount } = require('../lib/enriched-data');
const { buildAdminOverview } = require('../lib/admin-overview');
const { getDocByCode, listDocs } = require('../lib/legal-docs');
const { getNotesCoverage } = require('../lib/gir-notes');
const { searchPrecedents } = require('../lib/precedent-search');
const { listMinistries, getMinistriesByChapter } = require('../lib/ministries');
const { detectMaterials, listTaxonomySummary } = require('../lib/material-taxonomy');
const { buildChaptersIndex } = require('../lib/chapters-index');
const fs = require('fs');
const path = require('path');

/** Multi-route handler to stay under Vercel Hobby ~12 Serverless Functions cap.
 * Entry: `GET /api/dataset` with `resource` query (set via rewrites from legacy URLs).
 */
function kgStatsPayload() {
  const rows = Object.values(taxData);
  const chapters = new Set(rows.map((r) => r.hs.slice(0, 2)));
  const withWarnings = rows.filter((r) => r.cs && String(r.cs).trim()).length;
  const enrichedPolicies = enrichedEntryCount();
  const versionIndex = loadIndex();

  const enrichedPath = path.join(process.cwd(), 'data', 'tax-enriched.json');
  let lastEnrichedAt = null;
  if (fs.existsSync(enrichedPath)) {
    lastEnrichedAt = fs.statSync(enrichedPath).mtime.toISOString();
  }

  return {
    totalHsCodes: rows.length,
    chapters: chapters.size,
    tariffCoverage: {
      withMfn: rows.filter((r) => r.mfn !== null && r.mfn !== '').length,
      withAcfta: rows.filter((r) => r.acfta !== null && r.acfta !== '').length,
      withVat: rows.filter((r) => r.vat !== null && r.vat !== '').length,
    },
    withWarnings,
    enrichedPolicies,
    explanatoryNotes: Object.keys(explanatoryNotesData).length,
    precedentHsCodes: Object.keys(precedentsData).length,
    conflictHsCodes: Object.keys(conflictsData).length,
    tariffVersions: versionIndex.versions.length,
    currentTariffVersion: versionIndex.current || null,
    lastEnrichedAt,
    notesCoverage: getNotesCoverage(),
  };
}

module.exports = function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (requireAuth(req, res)) return;

  const resource = String(req.query.resource || '').trim();
  if (!resource) {
    return res.status(400).json({
      error: 'Missing resource',
      hint: 'Use legacy URLs such as /api/kg_stats — they rewrite here.',
    });
  }

  try {
    if (resource === 'kg_stats') {
      return res.status(200).json(kgStatsPayload());
    }

    if (resource === 'chapters') {
      const chapters = buildChaptersIndex();
      return res.status(200).json({ total: chapters.length, chapters });
    }

    if (resource === 'conflicts') {
      const { hs } = req.query;
      if (!hs) {
        return res.status(400).json({
          error: 'hs parameter required',
          example: '/api/conflicts?hs=19011020',
        });
      }
      const hsCode = normalizeHs(hs);
      const payload = conflictsData[hsCode];
      if (!payload) {
        return res.status(404).json({
          found: false,
          hsCode,
          message: `No conflict data for ${hsCode}`,
        });
      }
      return res.status(200).json({
        found: true,
        hsCode,
        ...payload,
      });
    }

    if (resource === 'precedents') {
      const { hs, q, description } = req.query;
      const searchText = String(q || description || '').trim();
      if (searchText.length >= 3) {
        const matches = searchPrecedents(searchText, { topK: 5 });
        return res.status(200).json({
          found: matches.length > 0,
          query: searchText,
          total: matches.length,
          matches,
        });
      }
      if (!hs) {
        return res.status(400).json({
          error: 'hs or q (description) parameter required',
          examples: ['/api/precedents?hs=03046200', '/api/precedents?q=máy bơm Pentax'],
        });
      }
      const hsCode = normalizeHs(hs);
      const items = precedentsData[hsCode] || [];
      if (items.length === 0) {
        return res.status(404).json({
          found: false,
          hsCode,
          message: `No precedents for ${hsCode}`,
        });
      }
      return res.status(200).json({
        found: true,
        hsCode,
        total: items.length,
        items,
      });
    }

    if (resource === 'admin_overview') {
      return res.status(200).json(buildAdminOverview());
    }

    if (resource === 'materials' || resource === 'material_taxonomy') {
      const { q } = req.query;
      if (q && String(q).trim().length >= 2) {
        const materials = detectMaterials(String(q));
        return res.status(200).json({ query: q, total: materials.length, materials });
      }
      const families = listTaxonomySummary();
      return res.status(200).json({
        families,
        totalEntries: families.reduce((n, f) => n + f.count, 0),
      });
    }

    if (resource === 'ministries') {
      const { chapter } = req.query;
      if (chapter) {
        const ch = String(parseInt(chapter, 10)).padStart(2, '0');
        const items = getMinistriesByChapter(ch);
        return res.status(200).json({ chapter: ch, total: items.length, items });
      }
      const items = listMinistries();
      return res.status(200).json({ total: items.length, items });
    }

    if (resource === 'legal_docs') {
      const { chapter, status, issuer } = req.query;
      const items = listDocs({ chapter, status, issuer });
      return res.status(200).json({
        total: items.length,
        chapter: chapter || 'all',
        items,
      });
    }

    if (resource === 'legal_doc') {
      const code = String(req.query.code || '').trim();
      if (!code) {
        return res.status(400).json({ error: 'code query required', example: '/api/legal-docs/08-2023-TT-BCT' });
      }
      const doc = getDocByCode(code);
      if (!doc) {
        return res.status(404).json({ found: false, code, message: 'Legal document not in catalog' });
      }
      return res.status(200).json({ found: true, ...doc });
    }

    return res.status(404).json({ error: 'Unknown resource', resource });
  } catch (e) {
    return res.status(500).json({ error: 'dataset handler failed', detail: e.message });
  }
};
