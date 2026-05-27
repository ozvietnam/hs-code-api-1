const { getTaxRecord, normalizeHs } = require('./data');
const { getEnrichedForHs } = require('./enriched-data');
const { enrichLegalCitations } = require('./legal-docs');
const { getTreeMeta } = require('./tree-metadata');

function heuristicWarnings(csText) {
  const t = String(csText || '');
  return {
    requiresLicense: /giấy phép|giay phep/i.test(t),
    requiresInspection: /kiểm tra|kiem tra|CR\b/i.test(t),
    requiresQuarantine: /kiểm dịch|kiem dich/i.test(t),
    dualUseControl: /mật mã|mat ma|chuyên dụng|chuyen dung/i.test(t),
    ministries: extractMinistries(t),
    summary: summarizePolicy(t),
  };
}

function mapTaxRecord(record) {
  if (!record) return null;

  const hasPolicy = Boolean(record.cs && String(record.cs).trim());
  const enrichedRow = getEnrichedForHs(record.hs);
  const enrichedWarnings = enrichedRow && enrichedRow.warnings && typeof enrichedRow.warnings === 'object'
    ? enrichedRow.warnings
    : null;

  let warnings = null;
  if (enrichedWarnings) {
    warnings = {
      ...enrichedWarnings,
      enrichmentSource: 'gemini',
      enrichedAt: enrichedRow.enrichedAt || null,
      enrichModel: enrichedRow.enrichModel || null,
    };
  } else if (hasPolicy) {
    warnings = {
      ...heuristicWarnings(record.cs),
      enrichmentSource: 'heuristic',
    };
  }

  const legalCitations = hasPolicy ? enrichLegalCitations(record.cs) : [];
  if (warnings && legalCitations.length) {
    warnings.legalCitations = legalCitations;
  }

  const tree = getTreeMeta(record.hs);

  return {
    hsCode: record.hs,
    indentationLevel: tree.indentationLevel,
    parentSubheadingCode: tree.parentSubheadingCode,
    siblingHsCodes: tree.siblingHsCodes,
    treeLevel: tree.level,
    nameVi: record.vn || null,
    unitVi: record.dvt || null,
    taxNkTt: record.tt || null,
    taxNkPreferential: record.mfn || null,
    taxAcfta: record.acfta || null,
    taxVat: record.vat || null,
    taxBvmt: record.bvmt || null,
    taxVatReduction: record.giam_vat || null,
    policyByHs: record.cs || null,
    hasPolicyWarning: hasPolicy,
    warnings,
  };
}

function mapTaxLookup(hs) {
  const code = normalizeHs(hs);
  const record = getTaxRecord(code);
  if (record) {
    return { found: true, ...mapTaxRecord(record) };
  }

  const prefix6 = code.slice(0, 6);
  const related = Object.values(require('./data').taxData)
    .filter((x) => x.hs.startsWith(prefix6))
    .slice(0, 5)
    .map((x) => ({ hsCode: x.hs, nameVi: x.vn }));

  return {
    found: false,
    message: `Không tìm thấy mã ${code}`,
    relatedHsCodes: related,
  };
}

function mapSearchResult(item, full) {
  return {
    hsCode: item.hs,
    nameVi: item.vn,
    taxNkPreferential: full.mfn || null,
    taxAcfta: full.acfta || null,
    taxVat: full.vat || null,
    hasPolicyWarning: item.cs === '1',
  };
}

function extractMinistries(text) {
  const known = ['BNNPTNT', 'BYT', 'BCT', 'BKHCN', 'BTNMT', 'BCA', 'BQP', 'BTTTT', 'BLDTBXH'];
  return known.filter((code) => text.includes(code));
}

function summarizePolicy(text) {
  const parts = [];
  if (/giấy phép|giay phep/i.test(text)) parts.push('Cần giấy phép NK');
  if (/kiểm dịch|kiem dich/i.test(text)) parts.push('Cần kiểm dịch');
  if (/kiểm tra|kiem tra/i.test(text)) parts.push('Cần kiểm tra chất lượng');
  if (/mật mã|mat ma/i.test(text)) parts.push('Thuộc diện kiểm soát mật mã');
  return parts.length > 0 ? parts.join('; ') : text.slice(0, 180);
}

module.exports = {
  mapTaxRecord,
  mapTaxLookup,
  mapSearchResult,
};
