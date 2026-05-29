// Historical signal từ Oz GOLD precedents.
// ĐÃ SỬA 2026-05-29: bỏ APPROVED/REJECTED giả (data cũ toàn UNKNOWN, CEO chê "ẩu").
// Gold mới chỉ có signal THẬT: ozCount = Oz đã khai mã này cho sản phẩm tương tự N lần.
// → familiarity boost (Oz quen khai mã này), KHÔNG phải "hải quan đã duyệt".

// Boost theo độ quen: nhiều lần khai + keyword khớp cao → tin cậy hơn. Cap thấp (max 8).
function familiarityBoost(totalOzCount, matchCoverage) {
  const freq = Math.log10((totalOzCount || 0) + 1); // 0..~3
  const cov = Math.max(0, Math.min(1, (matchCoverage || 0) / 100));
  return Math.round(Math.min(8, freq * cov * 5));
}

function applyHistoricalSignals({ suggestions, ozPrecedents, evidenceByHs }) {
  const precedents = Array.isArray(ozPrecedents) ? ozPrecedents : [];

  const hydrated = suggestions.map((suggestion) => {
    const related = precedents.filter((item) => item.hsCode === suggestion.hsCode);
    const totalOzCount = related.reduce((s, it) => s + (it.ozCount || 0), 0);
    const bestCoverage = related.reduce((m, it) => Math.max(m, it.matchCoverage || 0), 0);
    const policyConflict = Boolean(evidenceByHs.get(suggestion.hsCode)?.hasPolicyWarning);
    const baseConfidence = Number(suggestion.confidence) || 0;

    let ozPrecedentBoost = 0;
    if (related.length && !policyConflict) {
      ozPrecedentBoost = familiarityBoost(totalOzCount, bestCoverage);
    }
    return {
      ...suggestion,
      confidence: Math.min(100, baseConfidence + ozPrecedentBoost),
      confidenceBreakdown: {
        baseConfidence,
        ozPrecedentBoost,
        ozDeclarationCount: totalOzCount || null,    // Oz đã khai mã này bao nhiêu tờ
        ozMatchCoverage: related.length ? bestCoverage : null,
        policyConflictBlockedBoost: policyConflict && related.length > 0,
      },
    };
  });

  // Cảnh báo TRUNG THỰC: đây là tiền lệ khai của chính Oz, KHÔNG phải phán quyết hải quan.
  const historicalOnlyWarnings = hydrated
    .filter((suggestion) => precedents.some((item) => item.hsCode === suggestion.hsCode))
    .map((suggestion) => ({
      hsCode: suggestion.hsCode,
      message: 'Tiền lệ khai của Oz (không phải phán quyết hải quan) — đối chiếu biểu thuế/policy hiện hành trước khi chốt mã.',
    }));
  const conflictWarnings = hydrated
    .filter((suggestion) => evidenceByHs.get(suggestion.hsCode)?.hasPolicyWarning)
    .map((suggestion) => ({
      hsCode: suggestion.hsCode,
      message: 'Policy hiện hành có cảnh báo, hệ thống không cộng confidence boost từ tiền lệ Oz.',
    }));

  return {
    suggestions: hydrated,
    warnings: [...historicalOnlyWarnings, ...conflictWarnings],
  };
}

module.exports = {
  familiarityBoost,
  applyHistoricalSignals,
};
