// scripts/score-oz-gold.mjs
// Chấm điểm + lọc TẬP VÀNG từ oz-declarations.jsonl — FREE, KHÔNG LLM.
// Mục tiêu: tìm ~20% record giá trị nhất để LLM extract, BỎ rác lặp/mỏng.
//
// "Vàng" = (1) distinct sản phẩm trong cùng HS, (2) mô tả giàu signal,
//          (3) góp coverage HS đa dạng. Rác = near-dup model/size, mô tả mỏng.
//
// Usage:
//   node scripts/score-oz-gold.mjs                # report + ghi oz-gold.jsonl (top 20%)
//   node scripts/score-oz-gold.mjs --pct=20 --dry # chỉ report
//   node scripts/score-oz-gold.mjs --sample-gold=8 --sample-rejected=8

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

// uid ổn định = hash(hsCode + mô tả) — declId KHÔNG unique (file 2 rỗng, file 1 chung Số TK)
function makeUid(hsCode, desc) {
  return crypto.createHash('sha1').update(`${hsCode}|${desc}`).digest('hex').slice(0, 16);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUT = path.join(ROOT, 'data/oz-declarations.jsonl');
const OUTPUT = path.join(ROOT, 'data/oz-gold.jsonl');

const args = process.argv.slice(2);
const pct = (() => { const a = args.find(x => x.startsWith('--pct=')); return a ? parseInt(a.slice(6), 10) : 20; })();
const dry = args.includes('--dry');
const allDistinct = args.includes('--all');   // xuất TOÀN BỘ distinct (input cho LLM extract), không cắt 20%
const distinctOut = path.join(ROOT, 'data/oz-distinct.jsonl');
const sampleGold = (() => { const a = args.find(x => x.startsWith('--sample-gold=')); return a ? parseInt(a.slice(14), 10) : 0; })();
const sampleRej = (() => { const a = args.find(x => x.startsWith('--sample-rejected=')); return a ? parseInt(a.slice(18), 10) : 0; })();

// ─── Helpers ────────────────────────────────────────────────────────────────
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Stopwords mô tả (noise tokens không phân biệt sản phẩm)
const STOP = new Set(['moi', '100', 'hang', 'cac', 'loai', 'dung', 'cho', 'de', 'va', 'co',
  'khong', 'bang', 'mau', 'nsx', 'kt', 'kich', 'thuoc', 'model', 'ma', 'hieu', 'size']);

// "Product core" = vài từ đầu mô tả (định danh sản phẩm), bỏ phần spec phía sau.
// Cắt tại marker spec đầu tiên.
function productCore(desc) {
  const d = String(desc || '');
  const markers = [/,/, /\bch[aâ]́?t\s*li[eệ]u/i, /\bmodel/i, /\bm[aã]\s*[:：]/i,
    /\bk[ií]ch\s*th/i, /\bkt\s*[:：]/i, /\bhi[eệ]u\b/i, /\bNSX/i, /\bđ[iị]?[eệ]?n\s*[aá]p/i];
  let cut = d.length;
  for (const re of markers) { const m = d.match(re); if (m && m.index < cut && m.index > 8) cut = m.index; }
  return norm(d.slice(0, cut)).split(' ').filter(w => w.length > 1 && !STOP.has(w)).slice(0, 6).join(' ');
}

// Richness: đếm signal markers + độ dài hợp lý
function richness(desc) {
  const d = String(desc || '');
  let score = 0;
  const markers = [
    /ch[aâ]́?t\s*li[eệ]u|c\.?\s*li[eệ]u|\bb[aằ]ng\s+(nh[uự]a|inox|th[eé]p|nh[oô]m|cao su|g[oỗ]|v[aả]i|đồng)/i, // material
    /d[uù]ng\s+(?:để|cho|làm)/i,                       // purpose
    /k[ií]ch\s*th|[\bkt\b]|đ\.?\s*k[ií]nh|\d+\s*[x×*]\s*\d+/i, // size/dimension
    /đ[iị]?[eệ]?n\s*[aá]p|c[oô]ng\s*su[aấ]t|\d+\s*[vw]\b|\d+\s*kw/i, // power
    /model|m[aã]\s*[:：]/i,                              // model
    /nh[aã]n\s*hi[eệ]u|\bhi[eệ]u\b|logo/i,             // brand
    /\d+\s*%/,                                          // percentage spec (alloy/fiber)
    /ti[eê]u\s*chu[aẩ]n|chu[aẩ]n\b|TCVN|ISO|JIS/i,     // standard
  ];
  for (const re of markers) if (re.test(d)) score += 1;
  // length factor
  const len = d.length;
  if (len >= 80) score += 2; else if (len >= 50) score += 1;
  if (len < 30) score -= 2; // too thin
  return score;
}

// ─── Load ───────────────────────────────────────────────────────────────────
const records = fs.readFileSync(INPUT, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const total = records.length;

// HS frequency (cho coverage weighting: HS hiếm = quý hơn 1 chút)
const hsFreq = {};
for (const r of records) hsFreq[r.hsCode] = (hsFreq[r.hsCode] || 0) + 1;

// ─── Step 1: cluster theo (HS + product core) → giữ richest mỗi cluster ──────
const clusters = new Map(); // key → { best, members, bestScore }
for (const r of records) {
  const desc = r.customsDescription || r.productName || '';
  const key = r.hsCode + '|' + productCore(desc);
  const rich = richness(desc);
  const c = clusters.get(key);
  if (!c) {
    clusters.set(key, { best: r, bestDesc: desc, bestScore: rich, members: 1 });
  } else {
    c.members++;
    if (rich > c.bestScore) { c.best = r; c.bestDesc = desc; c.bestScore = rich; }
  }
}
const distinct = [...clusters.values()];

// ─── Step 2: score = richness + coverage bonus (HS hiếm) + distinct size penalty ──
for (const c of distinct) {
  const freq = hsFreq[c.best.hsCode] || 1;
  const coverageBonus = freq <= 2 ? 2 : freq <= 5 ? 1 : 0; // HS hiếm → quý
  c.score = c.bestScore + coverageBonus;
}
distinct.sort((a, b) => b.score - a.score);

// ─── Step 3: chọn top pct% (tính trên TOTAL input, không phải distinct) ──────
const goldTarget = Math.round(total * pct / 100);
const gold = distinct.slice(0, Math.min(goldTarget, distinct.length));

// ─── Report ───────────────────────────────────────────────────────────────────
const goldHs = new Set(gold.map(g => g.best.hsCode));
const allHs = new Set(records.map(r => r.hsCode));

console.log('='.repeat(64));
console.log('GOLD SCORING REPORT (FREE, $0 LLM)');
console.log('='.repeat(64));
console.log(`Input records      : ${total}`);
console.log(`Distinct products  : ${distinct.length} (sau gộp near-dup theo HS+core)`);
console.log(`Near-dup collapsed : ${total - distinct.length} (${Math.round((total-distinct.length)/total*100)}%)`);
console.log(`GOLD target (${pct}%)   : ${goldTarget} → chọn ${gold.length}`);
console.log('');
console.log(`HS coverage:`);
console.log(`  Tổng HS distinct trong data : ${allHs.size}`);
console.log(`  HS có trong GOLD            : ${goldHs.size} (${Math.round(goldHs.size/allHs.size*100)}% coverage)`);
console.log('');
console.log(`LLM cost nếu extract GOLD:`);
console.log(`  ${gold.length} records / 20 per batch = ${Math.ceil(gold.length/20)} MiniMax requests`);
console.log(`  (giới hạn 1500 req/5h → ${Math.ceil(gold.length/20) < 1500 ? 'DƯ SỨC 1 cửa sổ, $0 thêm' : 'cần nhiều cửa sổ'})`);

if (sampleGold > 0) {
  console.log('\n=== ' + sampleGold + ' GOLD samples (điểm cao) ===');
  for (const g of gold.slice(0, sampleGold)) {
    console.log(`  [${g.best.hsCode}] score=${g.score} freq=${hsFreq[g.best.hsCode]} dup=${g.members}`);
    console.log(`    ${g.bestDesc.slice(0, 110)}`);
  }
}
if (sampleRej > 0) {
  console.log('\n=== ' + sampleRej + ' REJECTED samples (điểm thấp/rác) ===');
  for (const r of distinct.slice(-sampleRej)) {
    console.log(`  [${r.best.hsCode}] score=${r.score} freq=${hsFreq[r.best.hsCode]} dup=${r.members}`);
    console.log(`    ${r.bestDesc.slice(0, 110)}`);
  }
}

if (allDistinct) {
  // Xuất TẤT CẢ distinct (best exemplar mỗi cluster) — input cho LLM extract vòng 1
  fs.writeFileSync(distinctOut, distinct.map(c => JSON.stringify({
    uid: makeUid(c.best.hsCode, c.bestDesc),
    declId: c.best.declId || null, hsCode: c.best.hsCode, date: c.best.date,
    quantity: c.best.quantity, unitVi: c.best.unitVi, origin: c.best.origin,
    rawDescription: c.bestDesc, _dupCount: c.members,
  })).join('\n'));
  console.log(`\n✓ Ghi ${distinct.length} DISTINCT → data/oz-distinct.jsonl (input LLM extract)`);
} else if (!dry) {
  fs.writeFileSync(OUTPUT, gold.map(g => JSON.stringify({ ...g.best, _dupCount: g.members, _score: g.score })).join('\n'));
  console.log(`\n✓ Ghi ${gold.length} GOLD → data/oz-gold.jsonl (sẵn sàng LLM extract)`);
} else {
  console.log('\n(--dry: KHÔNG ghi file)');
}
