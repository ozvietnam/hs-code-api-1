// scripts/extract-oz-llm.mjs
// LLM extract structured fields từ oz-distinct.jsonl qua MiniMax (flat-rate).
// Resume-safe: checkpoint append từng batch → crash giữa chừng chạy lại tiếp.
//
// Usage:
//   node scripts/extract-oz-llm.mjs --probe          # test 1 call nhỏ, in provider, KHÔNG ghi
//   node scripts/extract-oz-llm.mjs --limit=20       # test 1 batch 20 record
//   node scripts/extract-oz-llm.mjs                  # full 5996 (resume nếu đã chạy dở)
//
// Output: data/oz-extracted.jsonl (append, mỗi dòng 1 record structured)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chat, listConfigured } from '../lib/llm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUT = path.join(ROOT, 'data/oz-distinct.jsonl');
const OUTPUT = path.join(ROOT, 'data/oz-extracted.jsonl');
const BATCH = 10;        // nhỏ → JSON ngắn, ít cụt với reasoning model
const MAX_RETRY = 2;     // retry mỗi batch nếu parse fail

const args = process.argv.slice(2);
const probe = args.includes('--probe');
const limit = (() => { const a = args.find(x => x.startsWith('--limit=')); return a ? parseInt(a.slice(8), 10) : 0; })();

// ─── Load .env (manual, handle quotes) ───────────────────────────────────────
function loadEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

// ─── Prompt builder ───────────────────────────────────────────────────────────
const SYSTEM = `Bạn là chuyên gia phân loại hải quan Việt Nam. Nhiệm vụ: tách mỗi mô tả hàng hóa thành các trường có cấu trúc.

QUY TẮC:
- tenHang: tên hàng cốt lõi, BỎ model/kích thước/thương hiệu/NSX (vd "Máy bơm ly tâm", "Lốp máy xúc lật")
- chatLieu: vật liệu chính (cao su, inox 304, nhựa PP, nhôm...) hoặc null
- congDung: công dụng/mục đích sử dụng hoặc null
- brand: thương hiệu thật (KHÔNG nhầm với model code) hoặc null
- model: model/mã sản phẩm hoặc null
- size: kích thước hoặc null
- specs: thông số kỹ thuật khác (điện áp, công suất, %...) hoặc null
- condition: tình trạng, mặc định "Mới 100%"

Trả về DUY NHẤT một JSON object gọn (không markdown, không giải thích): {"items":[{...}]}.
- "idx" PHẢI là số nguyên (1, 2, 3...) khớp số thứ tự đầu vào.
- Giá trị string ngắn gọn, escape dấu nháy đúng chuẩn JSON.
- KHÔNG suy luận dài dòng. Xuất JSON ngay.`;

function buildUserPrompt(batch) {
  const lines = batch.map((r, i) => `${i + 1}. [HS ${r.hsCode}] ${r.rawDescription}`);
  return `Tách ${batch.length} mô tả sau thành JSON {"items":[...]} với idx 1-${batch.length}:\n\n${lines.join('\n')}`;
}

function parseResponse(content, batchLen) {
  let s = String(content);
  // 1. Bỏ <think>...</think> + fences
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  s = s.replace(/```(?:json)?/gi, '').trim();

  // 2. Thử parse nguyên khối
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      const obj = JSON.parse(s.slice(first, last + 1));
      const items = Array.isArray(obj) ? obj : obj.items;
      if (Array.isArray(items) && items.length) return items;
    } catch { /* rơi xuống salvage */ }
  }

  // 3. SALVAGE: vớt từng object {...} hợp lệ trong text (kể cả array cụt giữa chừng)
  const salvaged = [];
  let depth = 0, start = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const chunk = s.slice(start, i + 1);
        try {
          const o = JSON.parse(chunk);
          // chỉ nhận object có field extract (không phải wrapper {"items":...})
          if (o && (o.tenHang !== undefined || o.chatLieu !== undefined || o.congDung !== undefined || o.model !== undefined)) {
            salvaged.push(o);
          }
        } catch { /* skip chunk hỏng */ }
        start = -1;
      }
    }
  }
  if (salvaged.length) return salvaged;
  throw new Error('No salvageable items (response malformed)');
}

// chat với retry
async function chatRetry(messages, opts, label) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      const r = await chat(messages, opts);
      const items = parseResponse(r.content, opts._batchLen);
      return { items, provider: r.provider };
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRY) await new Promise(res => setTimeout(res, 1500 * attempt));
    }
  }
  throw lastErr;
}

// ─── Probe mode: test connectivity + provider ─────────────────────────────────
if (probe) {
  console.log('=== Configured providers ===');
  for (const p of listConfigured()) console.log(`  ${p.provider.padEnd(11)} key=${p.hasKey ? '✓' : '✗'} model=${p.model}`);
  console.log('\n=== Probe call (1 mô tả test) ===');
  try {
    const r = await chat([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildUserPrompt([{ hsCode: '85171300', rawDescription: 'Điện thoại di động iPhone 15 Pro Max, model A2848, chất liệu nhôm kính, dùng để liên lạc, hiệu Apple, mới 100%' }]) },
    ], { json: true, timeoutMs: 60000 });
    console.log(`✓ Provider dùng: ${r.provider} (${r.model})`);
    const items = parseResponse(r.content, 1);
    console.log('✓ Parse OK. Kết quả:');
    console.log(JSON.stringify(items[0], null, 2));
  } catch (e) {
    console.error('✗ Probe FAIL:', e.message);
    process.exit(1);
  }
  process.exit(0);
}

// ─── Main batch extract ────────────────────────────────────────────────────────
const allRecords = fs.readFileSync(INPUT, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const records = limit > 0 ? allRecords.slice(0, limit) : allRecords;

// Resume: collect uid đã extract (uid = hash hsCode+desc, ổn định & unique)
const done = new Set();
if (fs.existsSync(OUTPUT)) {
  for (const line of fs.readFileSync(OUTPUT, 'utf8').trim().split('\n')) {
    if (!line) continue;
    try { done.add(JSON.parse(line).uid); } catch {}
  }
}
const todo = records.filter(r => !done.has(r.uid));

console.log(`Input: ${records.length} | đã xong: ${done.size} | còn lại: ${todo.length}`);
console.log(`Batches: ${Math.ceil(todo.length / BATCH)} × ${BATCH}/batch\n`);

const out = fs.createWriteStream(OUTPUT, { flags: 'a' });
let okBatches = 0, failBatches = 0, written = 0;
let providerSeen = null;

for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const batchNo = Math.floor(i / BATCH) + 1;
  try {
    const r = await chatRetry([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildUserPrompt(batch) },
    ], { json: true, timeoutMs: 120000, maxTokens: 8000, _batchLen: batch.length }, `batch ${batchNo}`);
    providerSeen = r.provider;
    const items = r.items;
    // Map theo POSITION (items trả về cùng thứ tự đầu vào) — robust hơn idx lạ "1-1"
    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      // Ưu tiên idx (parse số đầu, kể cả "1-1" → 1); fallback position j
      let idx = j;
      const idxNum = parseInt(String(item.idx ?? ''), 10);
      if (Number.isFinite(idxNum) && idxNum >= 1 && idxNum <= batch.length) idx = idxNum - 1;
      const src = batch[idx];
      if (!src) continue;
      out.write(JSON.stringify({
        uid: src.uid,
        declId: src.declId || null,
        hsCode: src.hsCode,
        tenHang: item.tenHang || null,
        chatLieu: item.chatLieu || null,
        congDung: item.congDung || null,
        brand: item.brand || null,
        model: item.model || null,
        size: item.size || null,
        specs: item.specs || null,
        condition: item.condition || 'Mới 100%',
        origin: src.origin || 'CN',
        rawDescription: src.rawDescription,
        dupCount: src._dupCount || 1,
        _provider: r.provider,
      }) + '\n');
      written++;
    }
    okBatches++;
    process.stdout.write(`\r  batch ${batchNo}/${Math.ceil(todo.length / BATCH)} ✓ [${r.provider}] written=${written}   `);
  } catch (e) {
    failBatches++;
    console.error(`\n  batch ${batchNo} FAIL: ${e.message}`);
    // Không abort — tiếp batch sau, resume sẽ vá sau
  }
}
out.end();

console.log(`\n\n=== DONE ===`);
console.log(`Provider: ${providerSeen}`);
console.log(`Batches OK: ${okBatches} | FAIL: ${failBatches}`);
console.log(`Records written: ${written}`);
console.log(`Output: data/oz-extracted.jsonl`);
if (failBatches > 0) console.log(`\n⚠️ Có ${failBatches} batch fail — chạy lại lệnh để resume vá.`);
