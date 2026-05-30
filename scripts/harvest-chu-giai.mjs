// Harvest TOÀN BỘ chú giải (legal_layer) từ hs-knowledge-api KG 9 tầng → hs-code-api.
// 0 TOKEN — chỉ đọc/biến đổi JSON đã structured. Gộp 2 cấp: CHƯƠNG + NHÓM (dedup).
// Output:
//   data/chu-giai-chuong.json  — { "85": { chuong, phan } }  (97 chương — bức tranh toàn cảnh)
//   data/chu-giai-heading.json — { "8516": { nhom, bao_gom, khong_bao_gom, loai_tru,
//                                  phan_biet, tinh_chat, sen, dieu_kien, nguon } }  (~1.200 nhóm)
import fs from 'node:fs';
import path from 'node:path';

const SRC = '/Users/ozvietnamdesktop/Documents/Claude/Projects/hs-knowledge-api/public/kg';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');

const nz = (s) => String(s || '').replace(/\D/g, '');
const joinArr = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String).join(' ') : '');

// Chuẩn hoá value bất kỳ → string gọn cho LLM đọc.
function norm(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return joinArr(v);
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') return ''; // object xử lý riêng (tinh_chat, sen)
  return String(v);
}
// tinh_chat = { nguyen_lieu, cau_tao, nguyen_ly_hoat_dong, muc_dich_su_dung, ... } → câu mô tả
function normTinhChat(v) {
  if (!v || typeof v !== 'object') return '';
  const parts = [];
  const m = { nguyen_lieu: 'nguyên liệu', cau_tao: 'cấu tạo', nguyen_ly_hoat_dong: 'nguyên lý', muc_dich_su_dung: 'mục đích', tinh_chat_vat_ly: 'lý tính', tinh_chat_hoa_hoc: 'hoá tính' };
  for (const [k, label] of Object.entries(m)) {
    const val = Array.isArray(v[k]) ? v[k].join(', ') : v[k];
    if (val) parts.push(`${label}: ${val}`);
  }
  return parts.join('; ');
}
// sen = { co, noi_dung, vi_du_sen } → noi_dung nếu có
function normSen(v) {
  if (!v || typeof v !== 'object') return norm(v);
  if (v.co && v.noi_dung) return String(v.noi_dung).trim();
  return '';
}

const chuong = {}; // 2-số → { chuong, phan }
const heading = {}; // 4-số → { nhom, bao_gom, khong_bao_gom, loai_tru, phan_biet, tinh_chat, sen, dieu_kien, nguon }

const files = fs.readdirSync(SRC).filter((f) => /^chapter_\d+\.json$/.test(f));
let codes = 0;
for (const f of files) {
  const data = JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'));
  const items = Array.isArray(data) ? data : Object.values(data);
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const hs = nz(it.hs);
    if (hs.length < 4) continue;
    codes++;
    const L = it.legal_layer || {};
    const ch2 = hs.slice(0, 2);
    const h4 = hs.slice(0, 4);

    // CHƯƠNG — lấy bản đầu tiên không rỗng (dùng chung toàn chương)
    if (!chuong[ch2]) chuong[ch2] = { chuong: '', phan: '' };
    if (!chuong[ch2].chuong && L.chu_giai_chuong) chuong[ch2].chuong = norm(L.chu_giai_chuong);
    if (!chuong[ch2].phan && L.chu_giai_phan) chuong[ch2].phan = norm(L.chu_giai_phan);

    // NHÓM — gộp field heading-level, lấy bản đầu tiên không rỗng mỗi field
    if (!heading[h4]) heading[h4] = {};
    const H = heading[h4];
    if (!H.nhom && L.chu_giai_nhom) H.nhom = norm(L.chu_giai_nhom);
    if (!H.bao_gom && L.bao_gom) H.bao_gom = norm(L.bao_gom);
    if (!H.khong_bao_gom && L.khong_bao_gom) H.khong_bao_gom = norm(L.khong_bao_gom);
    if (!H.loai_tru && L.loai_tru) H.loai_tru = norm(L.loai_tru);
    if (!H.phan_biet && L.phan_biet) H.phan_biet = norm(L.phan_biet);
    if (!H.tinh_chat && L.tinh_chat) H.tinh_chat = normTinhChat(L.tinh_chat);
    if (!H.sen && L.sen) H.sen = normSen(L.sen);
    if (!H.dieu_kien && L.dieu_kien_bat_buoc) H.dieu_kien = norm(L.dieu_kien_bat_buoc);
    if (!H.nguon && L.nguon_phap_ly) H.nguon = norm(L.nguon_phap_ly);
  }
}

// Dọn entry rỗng
for (const k of Object.keys(heading)) {
  const H = heading[k];
  for (const f of Object.keys(H)) if (!H[f]) delete H[f];
  if (Object.keys(H).length === 0) delete heading[k];
}

fs.writeFileSync(path.join(OUT, 'chu-giai-chuong.json'), JSON.stringify(chuong));
fs.writeFileSync(path.join(OUT, 'chu-giai-heading.json'), JSON.stringify(heading));

const sz = (f) => (fs.statSync(path.join(OUT, f)).size / 1e6).toFixed(2) + ' MB';
const cnt = (obj, field) => Object.values(obj).filter((x) => x[field]).length;
console.log(`Đọc ${codes} mã từ ${files.length} chương`);
console.log(`chu-giai-chuong.json: ${Object.keys(chuong).length} chương · ${sz('chu-giai-chuong.json')}`);
console.log(`chu-giai-heading.json: ${Object.keys(heading).length} nhóm · ${sz('chu-giai-heading.json')}`);
console.log(`  nhom:${cnt(heading, 'nhom')} bao_gom:${cnt(heading, 'bao_gom')} khong_bao_gom:${cnt(heading, 'khong_bao_gom')} loai_tru:${cnt(heading, 'loai_tru')} phan_biet:${cnt(heading, 'phan_biet')} tinh_chat:${cnt(heading, 'tinh_chat')} sen:${cnt(heading, 'sen')} nguon:${cnt(heading, 'nguon')}`);
