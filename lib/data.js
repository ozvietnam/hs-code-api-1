const taxData = require('../data/tax.json');
const searchData = require('../data/search.json');
const notesData = require('../data/notes.json');
const fs = require('fs');
const path = require('path');

function loadOptionalJson(fileName, fallback = {}) {
  const fullPath = path.join(__dirname, '..', 'data', fileName);
  if (!fs.existsSync(fullPath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch {
    return fallback;
  }
}

const explanatoryNotesData = loadOptionalJson('explanatory-notes.json', {});
const precedentsData = loadOptionalJson('precedents.json', {});
const conflictsData = loadOptionalJson('conflicts.json', {});
const iso3166Data = loadOptionalJson('iso-3166-vn.json', { countries: [] });
const unitsTchqData = loadOptionalJson('units-tchq.json', { units: [] });
const chapterRulesData = loadOptionalJson('chapter-specific-rules.json', { chapters: {} });
const antiPatternsData = loadOptionalJson('anti-patterns.json', { patterns: [] });

function normalizeHs(hs) {
  return String(hs || '').replace(/\./g, '').trim().padEnd(8, '0').slice(0, 8);
}

function getTaxRecord(hs) {
  return taxData[normalizeHs(hs)] || null;
}

function getChapterFromHs(hs) {
  return String(parseInt(normalizeHs(hs).slice(0, 2), 10)).padStart(2, '0');
}

module.exports = {
  taxData,
  searchData,
  notesData,
  explanatoryNotesData,
  precedentsData,
  conflictsData,
  iso3166Data,
  unitsTchqData,
  chapterRulesData,
  antiPatternsData,
  normalizeHs,
  getTaxRecord,
  getChapterFromHs,
};
