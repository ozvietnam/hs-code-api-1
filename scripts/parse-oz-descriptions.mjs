// scripts/parse-oz-descriptions.mjs
// Parse mô tả Oz → structured fields bằng REGEX (FREE, KHÔNG LLM).
// Dedup theo taxonomy: model/size/brand = noise, material/purpose = gold.
//
// Usage:
//   node scripts/parse-oz-descriptions.mjs --sample=12   # test 12 mẫu, in chi tiết
//   node scripts/parse-oz-descriptions.mjs               # full + report + write oz-parsed.jsonl
//   node scripts/parse-oz-descriptions.mjs --dry         # full, report only, KHÔNG ghi file

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUT = path.join(ROOT, 'data/oz-declarations.jsonl');
const OUTPUT = path.join(ROOT, 'data/oz-parsed.jsonl');

const args = process.argv.slice(2);
const sampleN = (() => { const a = args.find(x => x.startsWith('--sample=')); return a ? parseInt(a.slice(9), 10) : 0; })();
const dry = args.includes('--dry');

// ─── Regex extractors ───────────────────────────────────────────────────────
// Mô tả Oz theo khuôn: "Tên hàng, chất liệu: X, hiệu Y, model Z, kích thước:..., NSX:..., mới 100%"

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '').trim();
}

function extractMaterial(d) {
  // "chất liệu: X" / "c.liệu:X" / "chất liệu X"
  let m = d.match(/ch[aâ]́?t\s*li[eệ]u\s*[:：]?\s*([^,;]+)/i)
       || d.match(/c\.?\s*li[eệ]u\s*[:：]?\s*([^,;]+)/i);
  if (m) return clean(m[1]).slice(0, 60);
  // "bằng <vật liệu>"
  m = d.match(/\bb[aằ]ng\s+(nh[uự]a[^,;]*|inox[^,;]*|th[eé]p[^,;]*|nh[oô]m[^,;]*|cao su[^,;]*|g[oỗ][^,;]*|v[aả]i[^,;]*|đồng[^,;]*|gang[^,;]*|s[aắ]t[^,;]*|h[oợ]p kim[^,;]*)/i);
  if (m) return clean(m[1]).slice(0, 60);
  return null;
}

function extractPurpose(d) {
  // "dùng để X" / "dùng cho X" / "dùng làm X"
  const m = d.match(/d[uù]ng\s+(?:để|cho|làm)\s+([^,;]+)/i);
  return m ? clean(m[1]).slice(0, 60) : null;
}

function extractBrand(d) {
  if (/kh[oô]ng\s+(?:nh[aã]n\s*)?hi[eệ]u|kh[oô]ng\s+nh[aã]n\s*hi[eệ]u/i.test(d)) return null;
  // "Nhãn hiệu: X" / "hiệu X" / "hiệu: X" / "gắn logo X"
  let m = d.match(/nh[aã]n\s*hi[eệ]u\s*[:：]?\s*([A-Za-z0-9][^\s,;]*(?:\s+[A-Z0-9][^\s,;]*)?)/i)
       || d.match(/g[aắ]n\s+logo\s+([A-Za-z0-9][^\s,;]+)/i)
       || d.match(/\bhi[eệ]u\s*[:：]?\s*([A-Za-z][A-Za-z0-9]{2,})/);
  return m ? clean(m[1]).slice(0, 40) : null;
}

function extractModel(d) {
  // "model: X" / "model X" / "mã: X" / "mã:X"
  const m = d.match(/model\s*[:：]?\s*([A-Za-z0-9][\w./\-]{2,})/i)
         || d.match(/\bm[aã]\s*[:：]\s*([A-Za-z0-9][\w./\-]{2,})/i);
  return m ? clean(m[1]).slice(0, 50) : null;
}

function extractSize(d) {
  // "kích thước: X" / "kt: X" / "KT:X" / "đ.kính: X" / "size X"
  const m = d.match(/k[ií]ch\s*th[uư][oơ]́?c\s*[:：]?\s*([^,;]+)/i)
         || d.match(/\bkt\s*[:：]\s*([^,;]+)/i)
         || d.match(/đ\.?\s*k[ií]nh\s*[:：]?\s*([^,;]+)/i)
         || d.match(/\bsize\s*[:：]?\s*([^,;]+)/i);
  return m ? clean(m[1]).slice(0, 50) : null;
}

function extractPower(d) {
  // điện áp / công suất
  const v = d.match(/đ[iị]?[eệ]?n\s*[aá]p\s*[:：]?\s*([^,;]+)/i) || d.match(/đ\.?\s*[aá]p\s*[:：]?\s*([^,;]+)/i);
  const w = d.match(/c[oô]ng\s*su[aấ]t\s*[:：]?\s*([^,;]+)/i) || d.match(/c\.?\s*su[aấ]t\s*[:：]?\s*([^,;]+)/i);
  const parts = [];
  if (v) parts.push('điện áp ' + clean(v[1]).slice(0, 25));
  if (w) parts.push('công suất ' + clean(w[1]).slice(0, 25));
  return parts.length ? parts.join(', ') : null;
}

function extractNSX(d) {
  const m = d.match(/NSX\s*[:：]?\s*([^,;]+)/i);
  return m ? clean(m[1]).slice(0, 60) : null;
}

function extractCondition(d) {
  if (/đ[aã]\s*qua\s*s[uử]\s*d[uụ]ng|h[aà]ng\s*c[uũ]/i.test(d)) return 'Đã qua sử dụng';
  if (/m[oớ]i\s*[:：]?\s*100\s*%|h[aà]ng\s*m[oớ]i/i.test(d)) return 'Mới 100%';
  return 'Mới 100%'; // default
}

function extractProductName(d) {
  // Tên hàng = cụm đầu trước marker đầu tiên (chất liệu/model/kích thước/dấu phẩy)
  // Cắt tại marker sớm nhất
  const markers = [
    /,\s*ch[aâ]́?t\s*li[eệ]u/i, /,\s*model/i, /,\s*m[aã]\s*[:：]/i,
    /,\s*k[ií]ch\s*th[uư]/i, /,\s*\bkt\s*[:：]/i, /,\s*hi[eệ]u/i,
    /,\s*NSX/i, /,\s*đ[iị]?[eệ]?n\s*[aá]p/i, /,/,
  ];
  let cut = d.length;
  for (const re of markers) {
    const m = d.match(re);
    if (m && m.index < cut) cut = m.index;
  }
  let name = clean(d.slice(0, cut));
  // Bỏ phần "model X" lẫn trong tên nếu lọt
  name = name.replace(/\s+model\s+[\w./\-]+/i, '').trim();
  return name.slice(0, 80) || clean(d).slice(0, 80);
}

function normalizeForKey(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // bỏ dấu
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parse(rec) {
  const d = rec.customsDescription || rec.productName || '';
  return {
    hsCode: rec.hsCode,
    productName: extractProductName(d),
    material: extractMaterial(d),
    purpose: extractPurpose(d),
    brand: extractBrand(d),
    model: extractModel(d),
    size: extractSize(d),
    power: extractPower(d),
    nsx: extractNSX(d),
    condition: extractCondition(d),
    origin: rec.origin || 'CN',
    rawDescription: d,
    declId: rec.declId,
    date: rec.date,
    quantity: rec.quantity,
    unitVi: rec.unitVi,
  };
}

// Dedup key: HS + tên hàng + chất liệu + công dụng (BỎ model/size/brand/nsx/condition/origin)
function dedupKey(p) {
  return [
    p.hsCode,
    normalizeForKey(p.productName),
    normalizeForKey(p.material),
    normalizeForKey(p.purpose),
  ].join('|');
}

// ─── Main ───────────────────────────────────────────────────────────────────
const lines = fs.readFileSync(INPUT, 'utf8').trim().split('\n');
const records = lines.map(l => JSON.parse(l));

if (sampleN > 0) {
  console.log(`=== SAMPLE ${sampleN} mẫu — kiểm tra chất lượng parse ===\n`);
  // Lấy mẫu đa dạng (mỗi 800 record 1 cái)
  const step = Math.floor(records.length / sampleN);
  for (let i = 0; i < sampleN; i++) {
    const p = parse(records[i * step]);
    console.log(`[${p.hsCode}] ${p.rawDescription.slice(0, 100)}`);
    console.log(`  → tên hàng : ${p.productName}`);
    console.log(`  → chất liệu: ${p.material ?? '—'}`);
    console.log(`  → công dụng: ${p.purpose ?? '—'}`);
    console.log(`  → hiệu     : ${p.brand ?? '—'}`);
    console.log(`  → model    : ${p.model ?? '—'}`);
    console.log(`  → kích thước: ${p.size ?? '—'}`);
    console.log(`  → điện/CS  : ${p.power ?? '—'}`);
    console.log(`  → NSX      : ${p.nsx ?? '—'}`);
    console.log(`  → tình trạng: ${p.condition}`);
    console.log('');
  }
  process.exit(0);
}

// Full run
const parsed = records.map(parse);
const cov = { material: 0, purpose: 0, brand: 0, model: 0, size: 0, power: 0, nsx: 0 };
for (const p of parsed) for (const k of Object.keys(cov)) if (p[k]) cov[k]++;

// Dedup
const seen = new Map();
const gold = [];
for (const p of parsed) {
  const k = dedupKey(p);
  if (seen.has(k)) {
    seen.get(k).dupCount++;
    // Gom model/size variant vào để search hiển thị
    const g = seen.get(k);
    if (p.model && !g.variants.models.includes(p.model)) g.variants.models.push(p.model);
    if (p.size && !g.variants.sizes.includes(p.size)) g.variants.sizes.push(p.size);
  } else {
    const g = { ...p, dupCount: 1, variants: { models: p.model ? [p.model] : [], sizes: p.size ? [p.size] : [] } };
    seen.set(k, g);
    gold.push(g);
  }
}

const total = parsed.length;
console.log('='.repeat(60));
console.log('PARSE + DEDUP REPORT (regex, $0 LLM)');
console.log('='.repeat(60));
console.log(`Input records       : ${total}`);
console.log(`GOLD (sau dedup)    : ${gold.length}`);
console.log(`NOISE (gộp model/size): ${total - gold.length} (${Math.round((total-gold.length)/total*100)}%)`);
console.log('');
console.log('Field coverage (regex extract):');
for (const k of Object.keys(cov)) {
  console.log(`  ${k.padEnd(10)}: ${cov[k]} / ${total} (${Math.round(cov[k]/total*100)}%)`);
}
console.log('');
// Top gold theo dupCount (nhiều variant nhất)
const topDup = [...gold].sort((a, b) => b.dupCount - a.dupCount).slice(0, 5);
console.log('Top 5 GOLD nhiều variant model/size nhất:');
for (const g of topDup) {
  console.log(`  [${g.hsCode}] ${g.productName.slice(0,50)} — ${g.dupCount} biến thể (${g.variants.models.length} model, ${g.variants.sizes.length} size)`);
}

if (!dry) {
  fs.writeFileSync(OUTPUT, gold.map(g => JSON.stringify(g)).join('\n'));
  console.log(`\n✓ Ghi ${gold.length} GOLD records → data/oz-parsed.jsonl`);
} else {
  console.log('\n(--dry: KHÔNG ghi file)');
}
