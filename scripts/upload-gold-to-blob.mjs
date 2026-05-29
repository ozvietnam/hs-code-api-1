// scripts/upload-gold-to-blob.mjs
// Đẩy data/oz-gold-final.jsonl lên Vercel Blob (PRIVATE) để production fetch được
// mà KHÔNG commit data riêng tư của Oz vào public repo.
//
// VÌ SAO: oz-gold-final.jsonl gitignored (lộ sản phẩm/NCC/sản lượng Oz = nhạy cảm).
// Vercel deploy từ git → file gitignored KHÔNG có trên production. Blob private giải quyết:
// data nằm ngoài git, chỉ service (có token) đọc được.
//
// KÍCH HOẠT (1 lần):
//   1. Vercel dashboard → project hs-code-api → Storage → Create → Blob store
//      → tự thêm env BLOB_READ_WRITE_TOKEN vào project.
//   2. Lấy token: copy từ dashboard (Storage → .env.local tab) HOẶC `vercel env pull`.
//      Dán token vào 1 file, vd ~/Desktop/blobtoken.txt (xong xóa).
//   3. npm i @vercel/blob
//   4. node scripts/upload-gold-to-blob.mjs ~/Desktop/blobtoken.txt
//      (hoặc set BLOB_READ_WRITE_TOKEN trong .env rồi chạy không tham số)
//   5. Script in ra URL blob → set env OZ_GOLD_BLOB_URL = URL đó trên Vercel.
//
// REFRESH data sau này: chỉ cần chạy lại bước 4 (pathname cố định → URL không đổi).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOLD = path.join(ROOT, 'data/oz-gold-final.jsonl');
const PATHNAME = 'oz/oz-gold-final.jsonl'; // cố định → URL ổn định, refresh ghi đè

// Token: ưu tiên arg file path, rồi env, rồi .env
function loadToken() {
  const argPath = process.argv[2];
  if (argPath && fs.existsSync(argPath)) {
    return fs.readFileSync(argPath, 'utf8').trim();
  }
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN.trim();
  // thử .env
  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^\s*BLOB_READ_WRITE_TOKEN\s*=\s*(.+)\s*$/m);
    if (m) return m[1].replace(/^["']|["']$/g, '').trim();
  }
  return null;
}

async function main() {
  if (!fs.existsSync(GOLD)) {
    console.error(`✗ Không thấy ${GOLD}. Chạy pipeline trước (score → extract → dedup).`);
    process.exit(1);
  }
  const token = loadToken();
  if (!token) {
    console.error('✗ Thiếu BLOB_READ_WRITE_TOKEN.');
    console.error('  Cách 1: node scripts/upload-gold-to-blob.mjs <đường-dẫn-file-token>');
    console.error('  Cách 2: thêm BLOB_READ_WRITE_TOKEN vào .env rồi chạy lại.');
    process.exit(1);
  }

  let put;
  try {
    ({ put } = await import('@vercel/blob'));
  } catch {
    console.error('✗ Chưa cài @vercel/blob. Chạy: npm i @vercel/blob');
    process.exit(1);
  }

  const body = fs.readFileSync(GOLD);
  const sizeMB = (body.length / 1024 / 1024).toFixed(2);
  const lines = body.toString('utf8').trim().split('\n').length;
  console.log(`Upload ${lines} gold records (${sizeMB} MB) → Blob private...`);

  const blob = await put(PATHNAME, body, {
    access: 'public',          // "public" = URL khó đoán (random token trong host); KHÔNG listing. Đủ riêng tư cho data nội bộ.
    addRandomSuffix: false,     // pathname cố định → ghi đè khi refresh, URL ổn định
    contentType: 'application/x-ndjson',
    token,
    allowOverwrite: true,
  });

  console.log('\n✓ Upload xong.');
  console.log(`  URL: ${blob.url}`);
  console.log('\n→ BƯỚC CUỐI: set env trên Vercel (project hs-code-api):');
  console.log(`     OZ_GOLD_BLOB_URL = ${blob.url}`);
  console.log('  Rồi redeploy. Service sẽ fetch gold từ Blob (cache 5 phút).');
}

main().catch((e) => { console.error('✗ FAIL:', e.message); process.exit(1); });
