// Pha 2 — Pipeline áp mã (M0→M1 stages→M6) theo skill hs-code-vn.
// classify(attrs) → { results:[{hs, confidence, reason, gir, tbTchq}], missing:[], candidates }
//
// Luồng: getCandidates (Pha 1, LLM headings + precedent)
//   → GIR-confirm: nạp mã 8-số + chú giải nhóm + LOẠI TRỪ của các nhóm top
//      → LLM áp GIR + kiểm loại trừ + phản đề → top-3 mã 8-số + lý do + tự tin
//   → M6: tra TB-TCHQ (precedents.json) cho mã chốt → cờ tiền lệ
//   → cờ thiếu nếu tự tin < 80.

const fs = require('fs');
const path = require('path');
const { getCandidates } = require('./retrieve-candidates.js');
const { parseJsonLoose } = require('./parse-json.js');
const { buildEcus } = require('./describe-ecus.js');

const DATA = path.join(__dirname, '..', 'data');
let _tax, _chap, _legal, _expl, _tbtchq;
function tax() { return (_tax ||= JSON.parse(fs.readFileSync(path.join(DATA, 'tax.json'), 'utf8'))); }
function chapNotes() { return (_chap ||= JSON.parse(fs.readFileSync(path.join(DATA, 'notes.json'), 'utf8'))); }
function legal() { try { return (_legal ||= JSON.parse(fs.readFileSync(path.join(DATA, 'legal-notes-enriched.json'), 'utf8'))); } catch { return (_legal = {}); } }
function expl() { try { return (_expl ||= JSON.parse(fs.readFileSync(path.join(DATA, 'explanatory-notes.json'), 'utf8'))); } catch { return (_expl = {}); } }
function tbtchq() { try { return (_tbtchq ||= JSON.parse(fs.readFileSync(path.join(DATA, 'precedents.json'), 'utf8'))); } catch { return (_tbtchq = {}); } }

const nz = (s) => String(s || '').replace(/\D/g, '');
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// Mã 8-số dưới 1 nhóm 4-số + tên
function codesInHeading(h4, cap = 18) {
  const t = tax();
  return Object.keys(t).filter((k) => k.startsWith(h4)).slice(0, cap).map((k) => ({ hs: k, vn: t[k].vn }));
}

// Chú giải dùng để áp GIR cho 1 nhóm: ưu tiên loại_trừ + chú giải nhóm (legal_layer),
// fallback bao_gom (explanatory), + chú giải chương.
function headingNotes(h4) {
  const L = legal(), E = expl();
  let loaiTru = '', chuGiaiNhom = '', baoGom = '';
  for (const k of Object.keys(L)) {
    if (!k.startsWith(h4)) continue;
    const e = L[k];
    if (e.loai_tru && !loaiTru) loaiTru = Array.isArray(e.loai_tru) ? e.loai_tru.join('; ') : String(e.loai_tru);
    if (e.chu_giai_nhom && !chuGiaiNhom) chuGiaiNhom = String(e.chu_giai_nhom);
    if (loaiTru && chuGiaiNhom) break;
  }
  if (!baoGom) { for (const k of Object.keys(E)) { if (k.startsWith(h4) && E[k].noteVi) { baoGom = E[k].noteVi; break; } } }
  const chap = chapNotes()[String(parseInt(h4.slice(0, 2), 10)).padStart(2, '0')] || chapNotes()[h4.slice(0, 2)] || '';
  return { loaiTru, chuGiaiNhom: chuGiaiNhom || baoGom, chapNote: typeof chap === 'string' ? chap : (chap?.noteVi || '') };
}

const SYS_GIR = `Bạn là chuyên gia áp mã HS hải quan Việt Nam, tuân thủ 6 quy tắc GIR.
Cho hồ sơ sản phẩm và danh sách MÃ ỨNG VIÊN kèm chú giải/loại trừ, hãy:
1. Áp GIR theo BẢN CHẤT (chức năng→cấu tạo→trạng thái), chọn mã MÔ TẢ CỤ THỂ NHẤT.
2. KIỂM LOẠI TRỪ: nếu chú giải loại trừ sản phẩm khỏi nhóm → loại mã đó, nêu lý do.
3. Phản đề: vì sao KHÔNG phải mã cạnh tranh (dựa chú giải, không phải cảm tính).
4. Nếu THIẾU dữ kiện để chốt 8 số (vd thiếu công suất, thiếu thành phần %) → liệt kê 'missing'.
Trả DUY NHẤT JSON: {"results":[{"hs":"8 số","confidence":0-100,"reason":"ngắn, trích chú giải","gir":"GIR mấy"}],"missing":["..."]}
Tối đa 3 results, xếp tự tin giảm dần. confidence<80 nghĩa là chưa chắc.`;

function buildContext(attrs, headings) {
  const lines = [];
  lines.push('HỒ SƠ SẢN PHẨM:');
  lines.push(`- Tên: ${attrs.tenHang || ''}`);
  if (attrs.chatLieu) lines.push(`- Chất liệu: ${attrs.chatLieu}`);
  if (attrs.congDung) lines.push(`- Công dụng: ${attrs.congDung}`);
  if (attrs.chucNang) lines.push(`- Chức năng: ${attrs.chucNang}`);
  if (attrs.specs) lines.push(`- Thông số: ${attrs.specs}`);
  lines.push('\nMÃ ỨNG VIÊN (theo nhóm):');
  for (const h4 of headings) {
    const n = headingNotes(h4);
    lines.push(`\n■ Nhóm ${h4}:`);
    if (n.chuGiaiNhom) lines.push(`  Chú giải: ${clip(n.chuGiaiNhom, 280)}`);
    if (n.loaiTru) lines.push(`  ⛔ LOẠI TRỪ: ${clip(n.loaiTru, 280)}`);
    for (const c of codesInHeading(h4)) lines.push(`  - ${c.hs}: ${clip(c.vn, 70)}`);
  }
  return lines.join('\n');
}

async function girConfirm(attrs, headings, opts = {}) {
  const { chat } = await import('./llm.mjs');
  const ctx = buildContext(attrs, headings.slice(0, 4));
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { content } = await chat(
        [{ role: 'system', content: SYS_GIR }, { role: 'user', content: ctx }],
        { json: true, timeoutMs: opts.timeoutMs || 60000, maxTokens: 4000 },
      );
      const obj = parseJsonLoose(content);
      return { results: (obj.results || []).slice(0, 3), missing: obj.missing || [] };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// M6 — tra TB-TCHQ cho mã chốt
function tbTchqGate(hs) {
  const db = tbtchq(), code = nz(hs);
  const hit = db[code];
  return hit ? { hasPrecedent: true, entries: hit } : { hasPrecedent: false };
}

async function classify(attrs, opts = {}) {
  const { headings, precedentCodes } = await getCandidates(attrs, opts);
  if (!headings.length) return { results: [], missing: ['Không sinh được nhóm ứng viên'], candidates: { headings, precedentCodes } };
  const { results, missing } = await girConfirm(attrs, headings.map((h) => h.code4), opts);
  // M6 gate + cờ tự tin thấp
  for (const r of results) { const g = tbTchqGate(r.hs); if (g.hasPrecedent) r.tbTchq = g.entries; }
  const lowConf = results[0] && results[0].confidence < 80;
  const ecus = results[0] ? buildEcus(results[0].hs, attrs) : null;
  return {
    results,
    ecus, // mô tả ECUS chuẩn TT39 cho mã top + compliance + field thiếu
    missing: lowConf && !missing.length ? ['Tự tin < 80 — cần xác nhận thêm dữ kiện đặc trưng'] : missing,
    candidates: { headings: headings.map((h) => h.code4), precedentCodes },
  };
}

module.exports = { classify, girConfirm, getCandidates, headingNotes, tbTchqGate };
