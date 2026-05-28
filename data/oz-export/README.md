# Oz Internal Declarations Export (PRIVATE)

CEO export từ ECUS / VNACCS / ERP rồi drop file vào đây.

**File format** chấp nhận:
- `.xlsx` (Excel)
- `.csv` (CSV UTF-8)
- `.jsonl` (JSON Lines)

**Naming convention**:
- `oz-decl-YYYY-MM.xlsx` (theo tháng)
- `oz-decl-2026-Q1.xlsx` (theo quý)
- `oz-decl-12months.xlsx` (12 tháng gần nhất)

**Privacy**: folder này đã trong .gitignore.

**Sau khi anh drop file**:
```bash
ls -la data/oz-export/
# Sẽ thấy file anh gửi

pnpm tsx scripts/import-oz-declarations.mjs data/oz-export/oz-decl-12months.xlsx
```

Script sẽ:
1. Validate schema
2. Show preview 3 rows
3. Dry-run đếm valid/error
4. Anh confirm → import vào `data/oz-declarations.jsonl`
5. Trigger embedding pipeline để dùng cho /api/suggest precedent boost (Issue #32)
