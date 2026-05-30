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
const { callLLMJson } = require('./llm-tier.js');
const { buildEcus } = require('./describe-ecus.js');

const DATA = path.join(__dirname, '..', 'data');
let _tax, _chap, _tbtchq, _cgc, _cgh;
function tax() { return (_tax ||= JSON.parse(fs.readFileSync(path.join(DATA, 'tax.json'), 'utf8'))); }
function chapNotes() { return (_chap ||= JSON.parse(fs.readFileSync(path.join(DATA, 'notes.json'), 'utf8'))); }
function tbtchq() { try { return (_tbtchq ||= JSON.parse(fs.readFileSync(path.join(DATA, 'precedents.json'), 'utf8'))); } catch { return (_tbtchq = {}); } }
// Chú giải HARVEST từ KG 9 tầng (full: 1.269 nhóm + 97 chương) — chương (toàn cảnh) + narrative
// nhóm + GỒM/KHÔNG GỒM/LOẠI TRỪ + tính chất + phân biệt + nguồn pháp lý.
function chuGiaiChuong() { try { return (_cgc ||= JSON.parse(fs.readFileSync(path.join(DATA, 'chu-giai-chuong.json'), 'utf8'))); } catch { return (_cgc = {}); } }
function chuGiaiHeading() { try { return (_cgh ||= JSON.parse(fs.readFileSync(path.join(DATA, 'chu-giai-heading.json'), 'utf8'))); } catch { return (_cgh = {}); } }

const nz = (s) => String(s || '').replace(/\D/g, '');
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// Mã 8-số dưới 1 nhóm 4-số + tên
function codesInHeading(h4, cap = 18) {
  const t = tax();
  return Object.keys(t).filter((k) => k.startsWith(h4)).slice(0, cap).map((k) => ({ hs: k, vn: t[k].vn }));
}

// Chú giải ĐẦY ĐỦ cho 1 nhóm (harvest KG 9 tầng): chương (toàn cảnh) + narrative nhóm +
// GỒM / KHÔNG GỒM / LOẠI TRỪ + tính chất điển hình + phân biệt + nguồn pháp lý.
function headingNotes(h4) {
  const H = chuGiaiHeading()[h4] || {};
  const ch2 = h4.slice(0, 2);
  const Cm = chuGiaiChuong();
  const C = Cm[ch2] || Cm[String(parseInt(ch2, 10))] || {};
  return {
    chuong: C.chuong || '',          // CHÚ GIẢI CHƯƠNG — phạm vi tổng thể của chương
    nhom: H.nhom || '',              // narrative nhóm — logic phân nhóm theo bản chất
    baoGom: H.bao_gom || '',         // GỒM
    khongBaoGom: H.khong_bao_gom || '', // KHÔNG GỒM
    loaiTru: H.loai_tru || '',       // LOẠI TRỪ
    tinhChat: H.tinh_chat || '',     // tính chất điển hình (cấu tạo/nguyên lý/mục đích)
    phanBiet: H.phan_biet || '',     // phân biệt mã dễ nhầm
    nguon: H.nguon || '',            // nguồn pháp lý — để giải trình
  };
}

const SYS_GIR = `Bạn là chuyên gia áp mã HS hải quan Việt Nam, tuân thủ 6 quy tắc GIR.
ĐỌC CHÚ GIẢI THEO TẦNG (KHÔNG nhặt điểm chạm rời rạc):
1. ĐỌC CHÚ GIẢI CHƯƠNG trước → định khung: chương phụ trách nhóm hàng nào, ranh giới với chương khác.
2. ĐỌC narrative CHÚ GIẢI NHÓM từng ứng viên → hiểu nhóm định nghĩa theo BẢN CHẤT gì.
3. Áp GIR theo BẢN CHẤT (chức năng→cấu tạo→trạng thái), chọn mã MÔ TẢ CỤ THỂ NHẤT.
4. Dùng GỒM / KHÔNG GỒM / LOẠI TRỪ làm ĐIỂM KIỂM TRA:
   - Hàng có THỎA "GỒM" (đọc nghĩa rộng, kể cả "loại khác")?
   - Hàng có rơi "KHÔNG GỒM" / "LOẠI TRỪ"? Nếu CÓ → loại nhóm, trích nguyên văn.
5. Phản đề: vì sao KHÔNG phải mã cạnh tranh — trích chú giải (chương/nhóm/gồm/không gồm), không cảm tính.
6. PHÂN LOẠI TỪNG PHẦN — KHÔNG bịa 8 số khi thiếu dữ kiện:
   - Chắc 8 số → "hs" 8 số. Chỉ chắc 6 số → "hs" 6 số, confidence ≤70, 'missing' liệt kê dữ kiện thiếu CỤ THỂ
     (vd "công suất W", "model", "vật liệu chính", "vải dệt kim/thoi", "thành phần % sợi", "dung tích", "điện áp").
'reason' BẮT BUỘC trích câu chú giải cụ thể (chương HOẶC nhóm HOẶC gồm/không gồm) làm căn cứ — đủ GIẢI TRÌNH hải quan, KHÔNG nói chung chung.
Trả DUY NHẤT JSON: {"results":[{"hs":"6/8 số","confidence":0-100,"reason":"trích chú giải cụ thể","gir":"GIR mấy"}],"missing":["dữ kiện cụ thể"]}
Tối đa 3 results, xếp tự tin giảm dần.`;

function buildContext(attrs, headings) {
  const lines = [];
  lines.push('HỒ SƠ SẢN PHẨM:');
  lines.push(`- Tên: ${attrs.tenHang || ''}`);
  if (attrs.chatLieu) lines.push(`- Chất liệu: ${attrs.chatLieu}`);
  if (attrs.congDung) lines.push(`- Công dụng: ${attrs.congDung}`);
  if (attrs.chucNang) lines.push(`- Chức năng: ${attrs.chucNang}`);
  if (attrs.specs) lines.push(`- Thông số: ${attrs.specs}`);
  // TẦNG 1 — Chú giải CHƯƠNG (toàn cảnh), dedup theo chương, đọc TRƯỚC để định khung
  const seenChap = new Set();
  const chapLines = [];
  for (const h4 of headings) {
    const ch2 = h4.slice(0, 2);
    if (seenChap.has(ch2)) continue;
    seenChap.add(ch2);
    const n = headingNotes(h4);
    if (n.chuong) chapLines.push(`■ Chương ${ch2}: ${clip(n.chuong, 420)}`);
  }
  if (chapLines.length) {
    lines.push('\n━━ CHÚ GIẢI CHƯƠNG (đọc TRƯỚC để định khung phạm vi + ranh giới) ━━');
    lines.push(...chapLines);
  }
  // TẦNG 2 — Narrative nhóm + điểm kiểm tra GỒM/KHÔNG GỒM/LOẠI TRỪ + tính chất/phân biệt
  lines.push('\n━━ MÃ ỨNG VIÊN (đọc narrative nhóm → dùng GỒM/KHÔNG GỒM/LOẠI TRỪ làm điểm kiểm tra) ━━');
  for (const h4 of headings) {
    const n = headingNotes(h4);
    lines.push(`\n■ Nhóm ${h4}:`);
    if (n.nhom) lines.push(`  Chú giải nhóm: ${clip(n.nhom, 430)}`);
    if (n.baoGom) lines.push(`  ✅ GỒM: ${clip(n.baoGom, 240)}`);
    if (n.khongBaoGom) lines.push(`  ⛔ KHÔNG GỒM: ${clip(n.khongBaoGom, 190)}`);
    if (n.loaiTru) lines.push(`  ⛔ LOẠI TRỪ: ${clip(n.loaiTru, 140)}`);
    for (const c of codesInHeading(h4, 8)) lines.push(`  - ${c.hs}: ${clip(c.vn, 60)}`);
  }
  return lines.join('\n');
}

async function girConfirm(attrs, headings, opts = {}) {
  // 3 nhóm (thay 4) — nhường chỗ cho chú giải dày (chương + narrative nhóm + gồm/không gồm...).
  const ctx = buildContext(attrs, headings.slice(0, 3));
  // 1 lần gọi: timeout 36s (prompt dày hơn) + maxTokens 2000. classify() có graceful catch
  //   nên dù quá giờ vẫn trả mềm, KHÔNG để function serverless (limit 60s) chết.
  const { json, provider } = await callLLMJson(SYS_GIR, ctx, { tier: opts.tier, maxTokens: 2000, timeoutMs: opts.timeoutMs || 36000 });
  return { results: (json.results || []).slice(0, 3), missing: json.missing || [], provider };
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
  let results, missing, provider;
  try {
    ({ results, missing, provider } = await girConfirm(attrs, headings.map((h) => h.code4), opts));
  } catch {
    // girConfirm timeout/lỗi → trả MỀM (ứng viên nhóm + cờ), KHÔNG để function chết/500/treo.
    return {
      results: [],
      missing: ['Engine bận hoặc quá thời gian — bấm "Áp mã" lại'],
      candidates: { headings: headings.map((h) => h.code4), precedentCodes },
      engine: { tier: opts.tier === 'premium' ? 'premium' : 'standard', provider: 'timeout' },
    };
  }
  // M6 gate + chuẩn hoá mã (6 hoặc 8 số) + cờ tự tin thấp
  for (const r of results) {
    r.hs = nz(r.hs).slice(0, 8);
    r.hsLevel = r.hs.length; // 8 = đủ; 6 = mới tới phân nhóm, cần thêm dữ kiện
    const g = tbTchqGate(r.hs);
    if (g.hasPrecedent) r.tbTchq = g.entries;
  }
  const top = results[0];
  const lowConf = top && (top.confidence < 80 || top.hs.length < 8);
  const ecus = top && top.hs.length === 8 ? buildEcus(top.hs, attrs) : null;
  return {
    results,
    ecus, // mô tả ECUS chuẩn TT39 cho mã top + compliance + field thiếu
    missing: lowConf && !missing.length ? ['Chưa đủ dữ kiện chốt 8 số — bổ sung đặc tính (công suất/vật liệu/model/kích thước...) rồi áp lại'] : missing,
    candidates: { headings: headings.map((h) => h.code4), precedentCodes },
    engine: { tier: opts.tier === 'premium' ? 'premium' : 'standard', provider },
  };
}

module.exports = { classify, girConfirm, getCandidates, headingNotes, tbTchqGate };
