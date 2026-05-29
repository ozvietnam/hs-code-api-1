const fs = require('fs');
const path = require('path');

// Đọc GOLD sạch (5,156 distinct, đã LLM extract + dedup vòng 2) thay vì raw declarations.
// Production: nếu OZ_GOLD_BLOB_URL set → fetch từ Vercel Blob (data private không lên git).
// Local: đọc file data/oz-gold-final.jsonl.
const GOLD_PATH = path.join(__dirname, '..', 'data', 'oz-gold-final.jsonl');
const GOLD_BLOB_URL = process.env.OZ_GOLD_BLOB_URL || null;

let cachedGold = null;
let cachedHsIndex = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60_000; // 5 phút

function parseJsonl(text) {
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function loadGold() {
  // Blob (production private) ưu tiên, fallback file local (dev)
  if (GOLD_BLOB_URL) {
    const res = await fetch(GOLD_BLOB_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Blob fetch ${res.status}`);
    return parseJsonl(await res.text());
  }
  if (fs.existsSync(GOLD_PATH)) return parseJsonl(fs.readFileSync(GOLD_PATH, 'utf8'));
  return [];
}

function normalize(s) {
  return String(s || '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
    .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function ensureCache() {
  const now = Date.now();
  if (cachedGold && now - cacheLoadedAt < CACHE_TTL_MS) return;
  cachedGold = await loadGold();
  // Index theo HS code (chuẩn hoá bỏ dấu chấm)
  cachedHsIndex = new Map();
  for (const g of cachedGold) {
    const hs = String(g.hsCode).replace(/\./g, '').trim();
    if (!cachedHsIndex.has(hs)) cachedHsIndex.set(hs, []);
    cachedHsIndex.get(hs).push(g);
  }
  cacheLoadedAt = now;
}

/**
 * Tra GOLD theo HS code chính xác (FREE, no LLM).
 * → "Oz đã khai mã này N lần" + biến thể.
 */
async function searchOzByHs(hsCode, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 20, 100));
  await ensureCache();
  const hs = String(hsCode).replace(/\./g, '').trim();
  const list = (cachedHsIndex.get(hs) || []).slice().sort((a, b) => (b.ozCount || 0) - (a.ozCount || 0));
  const totalTimes = list.reduce((s, g) => s + (g.ozCount || 1), 0);
  return {
    hsCode: hs,
    distinctProducts: list.length,
    totalDeclarations: totalTimes,
    items: list.slice(0, limit).map(toPublicItem),
  };
}

/**
 * Tìm GOLD theo keyword (FREE, no LLM, no Gemini).
 * Rank: token overlap trên tenHang+chatLieu+congDung + boost ozCount.
 */
async function searchOzByKeyword(query, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 10, 50));
  await ensureCache();
  const qTokens = normalize(query).split(' ').filter((w) => w.length >= 2);
  if (!qTokens.length) return { query, total: 0, items: [] };

  const scored = [];
  for (const g of cachedGold) {
    const hay = normalize(`${g.tenHang} ${g.chatLieu || ''} ${g.congDung || ''}`);
    let hits = 0;
    for (const t of qTokens) if (hay.includes(t)) hits++;
    if (hits === 0) continue;
    // score = tỉ lệ token khớp + boost nhẹ theo ozCount (log)
    const coverage = hits / qTokens.length;
    const freqBoost = Math.log10((g.ozCount || 1) + 1) * 0.1;
    scored.push({ g, score: coverage + freqBoost, coverage });
  }
  scored.sort((a, b) => b.score - a.score);
  return {
    query,
    total: scored.length,
    items: scored.slice(0, limit).map((s) => ({ ...toPublicItem(s.g), matchCoverage: Math.round(s.coverage * 100) })),
  };
}

function toPublicItem(g) {
  return {
    hsCode: g.hsCode,
    tenHang: g.tenHang,
    chatLieu: g.chatLieu || null,
    congDung: g.congDung || null,
    condition: g.condition || 'Mới 100%',
    origin: g.origin || 'CN',
    brands: g.brands || [],
    models: (g.models || []).slice(0, 10),
    sizes: (g.sizes || []).slice(0, 10),
    ozCount: g.ozCount || 1,
  };
}

module.exports = { searchOzByHs, searchOzByKeyword };
