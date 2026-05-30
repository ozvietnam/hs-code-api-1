// Pha 3 — Sinh mô tả ECUS (M8) từ attrs + mã HS đã chốt. Tái dùng compose + validator sẵn có.
// buildEcus(hs, attrs) → { description, level, score, missing }
// Chủ yếu FREE (composeCustomsDescription), validator chấm compliance TT39 + cờ field thiếu.

const { composeCustomsDescription } = require('./describe-compose');
const { validateDeclaration } = require('./declaration-validator');

function attrsToDeclaration(attrs) {
  return {
    tenHang: attrs.tenHang || null,
    nhanHieu: attrs.brand || attrs.nhanHieu || null,
    model: attrs.model || attrs.modelNo || null,
    thanhPhanCauTao: attrs.chatLieu || attrs.thanhPhanCauTao || null,
    thongSoKyThuat: attrs.specs ? [String(attrs.specs)] : (attrs.thongSoKyThuat || []),
    congDung: attrs.congDung || null,
    quyCach: attrs.quyCach || null,
    xuatXu: attrs.xuatXu || { code: attrs.origin || 'CN', nameVi: attrs.origin === 'CN' || !attrs.origin ? 'Trung Quốc' : attrs.origin },
    tinhTrang: attrs.condition || attrs.tinhTrang || 'Mới 100%',
    donViTinh: attrs.unit || attrs.donViTinh || 'Cái',
  };
}

function buildEcus(hs, attrs) {
  const decl = attrsToDeclaration(attrs);
  const description = composeCustomsDescription(decl);
  let compliance = { level: 'UNKNOWN', score: null, missingRequired: [] };
  try {
    compliance = validateDeclaration(decl, hs, { brand: decl.nhanHieu, model: decl.model, customerDescription: attrs.congDung });
  } catch { /* validator có thể kén dữ kiện — giữ description FREE */ }
  return {
    description,
    level: compliance.level,
    score: compliance.score,
    missing: compliance.missingRequired || [],
  };
}

module.exports = { buildEcus, attrsToDeclaration };
