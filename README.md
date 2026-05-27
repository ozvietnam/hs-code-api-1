# hs-code-api-1

Lightweight HS Code + tariff API for ERP `erp-xnk`.

**Live:** https://hs-code-api-1-ywbe.vercel.app

## Auth

All endpoints except `/api/health` require:

```http
Authorization: Bearer $HS_API_TOKEN
```

Set on Vercel:

```bash
vercel env add HS_API_TOKEN production
vercel env add GEMINI_API_KEY production
vercel env add GEMINI_RERANK_MODEL production   # optional, default gemini-2.5-flash
vercel env add GEMINI_DESCRIBE_MODEL production # optional, default gemini-2.5-flash
vercel env add GEMINI_ENRICH_MODEL production   # optional, default gemini-2.5-pro (offline enrich script only)
```

Generate token:

```bash
openssl rand -hex 32
```

## Endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/health` | GET | No | Service health + config checks |
| `/api/tax?hs=` | GET | Yes | Tariff lookup (camelCase) |
| `/api/search?q=` | GET | Yes | Keyword / HS search |
| `/api/notes?chapter=` | GET | Yes | Chapter notes |
| `/api/conflicts?hs=` | GET | Yes | HS conflict/risk details |
| `/api/precedents?hs=` | GET | Yes | TB-TCHQ precedent list by HS |
| `/api/suggest` | POST | Yes | AI HS suggestions (Gemini) |
| `/api/describe` | POST | Yes | AI customs description (Gemini) |
| `/api/feedback` | POST | Yes | Capture director override feedback |
| `/api/kg_chapter?chapter=` | GET | Yes | List HS codes in chapter |
| `/api/kg_stats` | GET | Yes | Dataset overview |
| `/api/versions` | GET | Yes | Tariff snapshot index |
| `/api/version?id=` | GET | Yes | One snapshot metadata |
| `/api/version/diff?from=&to=` | GET | Yes | Diff two snapshots |
| `/api/admin/overview` | GET | Yes | Aggregated KPIs for `/admin` dashboard |

## Admin dashboard

- **URL:** `/admin` — read-only operator UI (paste Bearer token; optional one-time `?token=` then stored in `localStorage`).
- **Data:** `GET /api/admin/overview` aggregates health, tariff coverage, feedback file summary, version index, and knowledge layer counts.
- **Follow-up:** request logging for “today stats” (see `todayStats.note` in JSON).

## Examples

```bash
TOKEN=your_token

curl https://hs-code-api-1-ywbe.vercel.app/api/health

curl -H "Authorization: Bearer $TOKEN" \
  "https://hs-code-api-1-ywbe.vercel.app/api/tax?hs=85171300"

curl -H "Authorization: Bearer $TOKEN" \
  "https://hs-code-api-1-ywbe.vercel.app/api/search?q=điện+thoại&limit=5"

curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"description":"iPhone 15 Pro Max 256GB"}' \
  https://hs-code-api-1-ywbe.vercel.app/api/suggest
```

## Response shape (ERP contract)

Tax/search responses use camelCase fields expected by `erp-xnk` client:

- `hsCode`, `nameVi`, `unitVi`
- `taxNkTt`, `taxNkPreferential`, `taxAcfta`, `taxVat`
- `policyByHs`, `hasPolicyWarning`, `warnings`

## Data

- `data/tax.json` — 11,871 HS codes + tariffs + policies
- `data/search.json` — search index
- `data/notes.json` — chapter notes
- `data/tax-enriched.json` — optional Gemini-enriched policy structure (see below)
- `data/explanatory-notes.json` — Level 2 explanatory notes by HS (from legacy import)
- `data/precedents.json` — Level 4 TB-TCHQ precedents by HS (from legacy import)
- `data/conflicts.json` — Level 5 conflict/risk hints by HS (from legacy import)
- `data/feedback.jsonl` — feedback events (append-only; may not persist on serverless cold paths)
- `data/versions/index.json` — tariff version catalog (`current` + metadata)
- `data/versions/tax-v2026-01-01-base.json` — baseline snapshot (same row set as `tax.json` at import)

## Offline data pipeline (Issues #5, #7, partial #4)

```bash
# Snapshot current tariff JSON (updates data/versions/index.json)
npm run data:snapshot-tax -- --label=v2026-w27 --set-current

# Diff two snapshots on disk
npm run data:diff-tax -- --from=tax-v2026-01-01-base.json --to=tax-other.json

# Rollback live tax.json from a snapshot (local only; redeploy after)
npm run data:rollback-tax -- --to=tax-v2026-01-01-base.json --backup

# Import legacy knowledge datasets from hs-knowledge-api (writes 3 data files)
npm run data:import-legacy

# Gemini deep-parse policy strings → data/tax-enriched.json (resume-safe, commits API batches)
GEMINI_API_KEY=... npm run data:enrich-policies -- --dry-run --limit=3
GEMINI_API_KEY=... npm run data:enrich-policies -- --batch=5 --concurrency=2

# Merge legacy blobs (place data/legacy-knowledge.json export first)
npm run data:merge-legacy
```

When `tax-enriched.json` contains entries keyed by HS, `/api/tax` returns those `warnings` with `enrichmentSource: "gemini"`. Until then the API uses heuristic regex (`enrichmentSource: "heuristic"`).
