const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(process.cwd(), 'data', 'access-log.jsonl');

function appendAccess(entry) {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...entry,
    });
    fs.appendFileSync(LOG_PATH, `${line}\n`, { flag: 'a' });
  } catch {
    // best-effort on read-only FS (Vercel)
  }
}

function readAccessRecords() {
  if (!fs.existsSync(LOG_PATH)) return [];
  const lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip
    }
  }
  return out;
}

function summarizeTodayAccess() {
  const records = readAccessRecords();
  const today = new Date().toISOString().slice(0, 10);
  const todayRows = records.filter((r) => String(r.ts || '').startsWith(today));

  const latencies = todayRows.map((r) => r.ms).filter((n) => typeof n === 'number' && n >= 0);
  latencies.sort((a, b) => a - b);
  const p90 = latencies.length
    ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.9))]
    : null;

  const hsCounts = {};
  for (const row of todayRows) {
    const key = row.hsCode || row.querySnippet;
    if (!key) continue;
    hsCounts[key] = (hsCounts[key] || 0) + 1;
  }
  const topQueriedHs = Object.entries(hsCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([hsCode, count]) => ({ hsCode, count }));

  return {
    requestsToday: todayRows.length,
    latencyP90Ms: p90,
    topQueriedHs,
    note: todayRows.length ? 'From data/access-log.jsonl (local/Vercel ephemeral).' : 'No requests logged today.',
  };
}

module.exports = { appendAccess, summarizeTodayAccess, readAccessRecords };
