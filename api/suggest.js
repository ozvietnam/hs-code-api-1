const { requireAuth } = require('../lib/auth');
const { setCors, handleOptions } = require('../lib/cors');
const { searchCandidates } = require('../lib/search-utils');
const { geminiGenerateJson } = require('../lib/gemini');
const { buildEvidenceTrace } = require('../lib/suggest-evidence');
const { applyGirRules } = require('../lib/gir-engine');
const { applyPrecedentBoost, detectSet } = require('../lib/precedent-search');
const { translateToVi, getBrandHint } = require('../lib/glossary');

const SYSTEM_PROMPT = `Bạn là chuyên gia phân loại hàng hóa hải quan Việt Nam.
Cho mô tả hàng hóa và danh sách mã HS candidate, hãy chọn tối đa 3 mã phù hợp nhất.
Áp dụng GIR và gợi ý chương (girRulesApplied) khi giải thích.
Chỉ trả JSON đúng schema:
{
  "suggestions": [
    {
      "hsCode": "85171300",
      "nameVi": "Tên hàng",
      "confidence": 92,
      "reasoning": "Giải thích ngắn",
      "disambiguationFeatures": ["brand", "model"],
      "girRulesApplied": ["GIR 1", "Chương 85: thiết bị điện hoàn chỉnh"]
    }
  ]
}
Không thêm text ngoài JSON.`;

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (requireAuth(req, res)) return;

  const started = Date.now();
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }

  const description = String(body?.description || '').trim();
  if (description.length < 3) {
    return res.status(400).json({ error: 'description is required (min 3 chars)' });
  }

  const topCandidates = Math.min(Math.max(parseInt(body?.options?.topCandidates, 10) || 10, 3), 20);
  const topReranked = Math.min(Math.max(parseInt(body?.options?.topReranked, 10) || 3, 1), 5);
  const glossaryVi = translateToVi(description);
  const brandHint = getBrandHint(description);
  const evidence = searchCandidates(description, { topCandidates });
  const audit = buildEvidenceTrace(description, evidence);

  if (evidence.length === 0) {
    return res.status(200).json({
      suggestions: [],
      evidence: [],
      evidenceTrace: [],
      girRulesApplied: audit.girRulesApplied,
      antiPatternWarnings: audit.antiPatternWarnings,
      llmModel: null,
      ms: Date.now() - started,
      message: 'No candidates found in tariff index',
    });
  }

  try {
    const userPrompt = JSON.stringify(
      {
        description,
        glossaryTranslation: glossaryVi !== description ? glossaryVi : undefined,
        brandHint,
        candidates: evidence.map(({ hsCode, nameVi, policyByHs, score }) => ({
          hsCode,
          nameVi,
          policyByHs,
          score,
        })),
        girRulesApplied: audit.girRulesApplied,
        antiPatternWarnings: audit.antiPatternWarnings,
        topReranked,
      },
      null,
      2
    );

    const { json, model, ms } = await geminiGenerateJson({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      modelEnv: 'GEMINI_RERANK_MODEL',
      defaultModel: 'gemini-2.5-flash',
    });

    const rawSuggestions = (json.suggestions || []).slice(0, topReranked);
    const girRanked = applyGirRules(rawSuggestions, description);
    const precedentRanked = applyPrecedentBoost(girRanked.suggestions, description);
    const suggestions = precedentRanked.suggestions.slice(0, topReranked);
    const girRankingRules = [
      ...(girRanked.girRankingRules || []),
      ...(precedentRanked.girPrecedentRule ? [precedentRanked.girPrecedentRule] : []),
      ...(detectSet(description) ? ['GIR-3b'] : []),
    ];

    return res.status(200).json({
      suggestions,
      girRankingRules,
      precedentMatches: precedentRanked.precedentMatches?.slice(0, 3) || [],
      evidence: evidence.map(({ hsCode, source, score, queryExpansion }) => ({
        hsCode,
        source,
        score,
        queryExpansion,
      })),
      evidenceTrace: audit.evidenceTrace,
      girRulesApplied: audit.girRulesApplied,
      antiPatternWarnings: audit.antiPatternWarnings,
      glossaryTranslation: glossaryVi !== description ? glossaryVi : undefined,
      brandHint,
      llmModel: model,
      ms,
    });
  } catch (error) {
    if (error.code === 'GEMINI_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Gemini is not configured', detail: error.message });
    }
    return res.status(502).json({ error: 'Suggest failed', detail: error.message });
  }
};
