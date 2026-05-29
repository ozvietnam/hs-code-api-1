// scripts/dedup-oz-gold.mjs
// Dedup VÒNG 2 trên data đã LLM extract sạch — FREE.
// Key = HS + tenHang + chatLieu + congDung (BỎ model/size/brand/condition).
// → Gold thật: cùng HS khác model/size = GỘP; khác chất liệu/công dụng = GIỮ RIÊNG.
//
// Usage: node scripts/dedup-oz-gold.mjs [--dry]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUT = path.join(ROOT, 'data/oz-extracted.jsonl');
const OUTPUT = path.join(ROOT, 'data/oz-gold-final.jsonl');
const dry = process.argv.includes('--dry');

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

const records = fs.readFileSync(INPUT, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

const clusters = new Map();
for (const r of records) {
  // Key gold: 4 chỉ tiêu phân loại (HS + tên + chất liệu + công dụng)
  const key = [r.hsCode, norm(r.tenHang), norm(r.chatLieu), norm(r.congDung)].join('|');
  let c = clusters.get(key);
  if (!c) {
    c = {
      hsCode: r.hsCode,
      tenHang: r.tenHang,
      chatLieu: r.chatLieu || null,
      congDung: r.congDung || null,
      condition: r.condition || 'Mới 100%',
      origin: r.origin || 'CN',
      // Aggregate variants (model/size/brand khác nhau gộp về đây để search hiển thị)
      brands: new Set(),
      models: new Set(),
      sizes: new Set(),
      specs: new Set(),
      ozCount: 0,          // Oz đã khai bao nhiêu tờ (gồm cả near-dup vòng 1)
      sampleDesc: r.rawDescription,
    };
    clusters.set(key, c);
  }
  if (r.brand) c.brands.add(r.brand);
  if (r.model) c.models.add(r.model);
  if (r.size) c.sizes.add(r.size);
  if (r.specs) c.specs.add(r.specs);
  c.ozCount += (r.dupCount || 1); // dupCount từ vòng 1 (model/size noise đã gộp)
}

const gold = [...clusters.values()].map(c => ({
  hsCode: c.hsCode,
  tenHang: c.tenHang,
  chatLieu: c.chatLieu,
  congDung: c.congDung,
  condition: c.condition,
  origin: c.origin,
  brands: [...c.brands].slice(0, 20),
  models: [...c.models].slice(0, 50),
  sizes: [...c.sizes].slice(0, 50),
  specs: [...c.specs].slice(0, 20),
  ozCount: c.ozCount,
  sampleDesc: c.sampleDesc,
}));

// Sort theo ozCount desc (sản phẩm Oz khai nhiều = quan trọng)
gold.sort((a, b) => b.ozCount - a.ozCount);

// Report
const total = records.length;
const hsSet = new Set(gold.map(g => g.hsCode));
console.log('='.repeat(60));
console.log('DEDUP VÒNG 2 — GOLD THẬT (FREE, trên data LLM sạch)');
console.log('='.repeat(60));
console.log(`Input (extracted)  : ${total}`);
console.log(`GOLD distinct      : ${gold.length}`);
console.log(`Gộp thêm vòng 2    : ${total - gold.length} (${Math.round((total-gold.length)/total*100)}%)`);
console.log(`HS codes phủ       : ${hsSet.size}`);
console.log('');
console.log('Top 8 GOLD (Oz khai nhiều nhất):');
for (const g of gold.slice(0, 8)) {
  console.log(`  [${g.hsCode}] ${g.tenHang} — Oz ${g.ozCount} lần | ${g.models.length} model, ${g.brands.length} brand`);
  console.log(`     chất liệu: ${g.chatLieu ?? '—'} | công dụng: ${g.congDung ?? '—'}`);
}

if (!dry) {
  fs.writeFileSync(OUTPUT, gold.map(g => JSON.stringify(g)).join('\n'));
  console.log(`\n✓ Ghi ${gold.length} GOLD → data/oz-gold-final.jsonl`);
} else {
  console.log('\n(--dry: không ghi)');
}
