const fs = require('fs');
const path = require('path');

function loadJson(fileName, fallback) {
  const fullPath = path.join(__dirname, '..', 'data', fileName);
  if (!fs.existsSync(fullPath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch {
    return fallback;
  }
}

const iso3166Data = loadJson('iso-3166-vn.json', { countries: [] });
const unitsTchqData = loadJson('units-tchq.json', { units: [] });
const chapterRulesData = loadJson('chapter-specific-rules.json', { chapters: {} });
const antiPatternsData = loadJson('anti-patterns.json', { patterns: [] });

function getCountryByAlpha2(alpha2) {
  const code = String(alpha2 || '').toUpperCase();
  return iso3166Data.countries.find((c) => c.alpha2 === code) || null;
}

function getUnitByCode(code) {
  const u = String(code || '').toUpperCase();
  return unitsTchqData.units.find((item) => item.code === u) || null;
}

function getChapterRules(chapter) {
  const ch = String(chapter || '').padStart(2, '0').slice(-2);
  return chapterRulesData.chapters[ch] || null;
}

function listAntiPatterns() {
  return antiPatternsData.patterns || [];
}

module.exports = {
  iso3166Data,
  unitsTchqData,
  chapterRulesData,
  antiPatternsData,
  getCountryByAlpha2,
  getUnitByCode,
  getChapterRules,
  listAntiPatterns,
};
