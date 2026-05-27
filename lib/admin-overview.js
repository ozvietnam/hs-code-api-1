const fs = require('fs');
const path = require('path');
const { taxData, explanatoryNotesData, precedentsData, conflictsData } = require('./data');
const { loadIndex } = require('./tariff-versions');
const { enrichedEntryCount } = require('./enriched-data');
const { isApiTokenConfigured } = require('./auth');

const FEEDBACK_PATH = path.join(process.cwd(), 'data', 'feedback.jsonl');

function pct(count, total) {
  if (!total) return 0;
  return Math.round((count / total) * 1000) / 10;
}

function readFeedbackRecords() {
  if (!fs.existsSync(FEEDBACK_PATH)) return [];
  const lines = fs.readFileSync(FEEDBACK_PATH, 'utf8').split('\n').filter(Boolean);
  const records = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  return records;
}

function summarizeFeedback(records) {
  const byType = {};
  for (const row of records) {
    const t = row.feedbackType || 'UNKNOWN';
    byType[t] = (byType[t] || 0) + 1;
  }
  return {
    total: records.length,
    pendingReview: records.length,
    byType,
    recent: records.slice(-5).reverse(),
  };
}

function buildAdminOverview() {
  const rows = Object.values(taxData);
  const total = rows.length;
  const chapters = new Set(rows.map((r) => r.hs.slice(0, 2)));
  const withWarnings = rows.filter((r) => r.cs && String(r.cs).trim()).length;
  const withMfn = rows.filter((r) => r.mfn !== null && r.mfn !== '').length;
  const withAcfta = rows.filter((r) => r.acfta !== null && r.acfta !== '').length;
  const withVat = rows.filter((r) => r.vat !== null && r.vat !== '').length;
  const withBvmt = rows.filter((r) => r.bvmt !== null && r.bvmt !== '').length;
  const enrichedPolicies = enrichedEntryCount();
  const versionIndex = loadIndex();
  const feedback = summarizeFeedback(readFeedbackRecords());

  const enrichedPath = path.join(process.cwd(), 'data', 'tax-enriched.json');
  let lastEnrichedAt = null;
  if (fs.existsSync(enrichedPath)) {
    lastEnrichedAt = fs.statSync(enrichedPath).mtime.toISOString();
  }

  const recentVersions = [...(versionIndex.versions || [])]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 3)
    .map((v) => ({
      id: v.id,
      file: v.file,
      type: v.type,
      effectiveDate: v.effectiveDate,
      rowCount: v.rowCount,
      createdAt: v.createdAt,
      source: v.source,
    }));

  return {
    generatedAt: new Date().toISOString(),
    systemHealth: {
      status: 'healthy',
      service: 'hs-code-api-1',
      version: '2.0.0',
      checks: {
        taxData: { ok: true, rows: total },
        geminiKey: { ok: Boolean(process.env.GEMINI_API_KEY) },
        apiToken: { ok: isApiTokenConfigured() },
      },
      totalHsCodes: total,
      chapters: chapters.size,
      withPolicyWarnings: withWarnings,
      lastEnrichedAt,
    },
    todayStats: {
      requestsToday: null,
      topQueriedHs: [],
      latencyP90Ms: null,
      note: 'Request access logging not enabled yet (serverless).',
    },
    feedbackQueue: feedback,
    tariffCoverage: {
      total,
      withMfn,
      withAcfta,
      withVat,
      withBvmt,
      withNameEn: 0,
      enrichedWarnings: enrichedPolicies,
      pctMfn: pct(withMfn, total),
      pctAcfta: pct(withAcfta, total),
      pctVat: pct(withVat, total),
      pctBvmt: pct(withBvmt, total),
      pctNameEn: 0,
      pctEnrichedWarnings: pct(enrichedPolicies, total),
    },
    knowledgeLayers: {
      explanatoryNotes: Object.keys(explanatoryNotesData).length,
      precedentHsCodes: Object.keys(precedentsData).length,
      conflictHsCodes: Object.keys(conflictsData).length,
    },
    recentUpdates: {
      currentTariffVersion: versionIndex.current || null,
      tariffVersions: (versionIndex.versions || []).length,
      versions: recentVersions,
      lastEnrichedAt,
    },
  };
}

module.exports = { buildAdminOverview, readFeedbackRecords };
