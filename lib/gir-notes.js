const { notesData, explanatoryNotesData, taxData, normalizeHs } = require('./data');

let sectionsMeta = null;
try {
  sectionsMeta = require('../data/hs-sections.json').sections || [];
} catch {
  sectionsMeta = [];
}

const chapterToSection = new Map();
for (const sec of sectionsMeta) {
  for (const ch of sec.chapters || []) {
    chapterToSection.set(String(parseInt(ch, 10)), sec);
  }
}

function chapterKey(chapterNum) {
  return String(parseInt(chapterNum, 10));
}

function entry({ level, code, parentCode, titleVi, noteVi, noteType, sourceDocument, extra }) {
  return {
    level,
    code,
    parentCode: parentCode || null,
    titleVi: titleVi || null,
    noteType: noteType || 'GENERAL',
    noteVi: noteVi || null,
    noteEn: null,
    sourceDocument: sourceDocument || null,
    sourcePage: null,
    ...extra,
  };
}

function sectionForChapter(chapterNum) {
  return chapterToSection.get(chapterKey(chapterNum)) || null;
}

function buildSectionNote(chapterNum) {
  const sec = sectionForChapter(chapterNum);
  if (!sec) return null;
  return entry({
    level: 'SECTION',
    code: sec.code,
    parentCode: null,
    titleVi: sec.titleVi,
    noteVi: `Phần ${sec.code}: ${sec.titleVi}. Chương ${chapterKey(chapterNum)} thuộc phạm vi phân loại này (GIR 1, GIR 6).`,
    noteType: 'GENERAL',
    sourceDocument: 'Phụ lục I Biểu thuế 2026 NĐ 26/2023',
  });
}

function buildChapterNote(chapterNum) {
  const key = chapterKey(chapterNum);
  const raw = notesData[key];
  if (!raw) return null;
  const preview = String(raw).replace(/\s+/g, ' ').trim().slice(0, 500);
  return entry({
    level: 'CHAPTER',
    code: key,
    parentCode: sectionForChapter(chapterNum)?.code || null,
    titleVi: `Chương ${key}`,
    noteVi: preview,
    noteType: 'GENERAL',
    sourceDocument: 'Danh mục HHDM XNK Việt Nam - TT31/2022/TT-BTC',
  });
}

function taxNameForCode(hsPrefix) {
  const rec = taxData[hsPrefix] || taxData[normalizeHs(hsPrefix)];
  return rec?.vn || null;
}

function buildHeadingNote(chapterNum, headingCode) {
  if (!headingCode) return null;
  const code = String(headingCode).padStart(4, '0');
  return entry({
    level: 'HEADING',
    code,
    parentCode: chapterKey(chapterNum),
    titleVi: `Nhóm ${code.slice(0, 2)}.${code.slice(2)}`,
    noteVi: taxNameForCode(`${code}0000`) || null,
    noteType: 'CLASSIFICATION_RULE',
    sourceDocument: 'Biểu thuế 2026 / WCO HS Explanatory Notes (heading stub)',
  });
}

function buildSubheadingNote(chapterNum, headingCode, subheadingCode) {
  if (!subheadingCode) return null;
  const code = String(subheadingCode).padStart(6, '0');
  return entry({
    level: 'SUBHEADING',
    code,
    parentCode: String(headingCode || code.slice(0, 4)).padStart(4, '0'),
    titleVi: `Phân nhóm ${code.slice(0, 4)}.${code.slice(4)}`,
    noteVi: taxNameForCode(`${code}00`) || null,
    noteType: 'CLASSIFICATION_RULE',
    sourceDocument: 'Biểu thuế 2026 / WCO HS Explanatory Notes (subheading stub)',
  });
}

function buildNationalNote(hsCode) {
  const note = explanatoryNotesData[hsCode];
  if (!note) return null;
  return entry({
    level: 'NATIONAL',
    code: hsCode,
    parentCode: note.parentCode || hsCode.slice(0, 6),
    titleVi: taxNameForCode(hsCode),
    noteVi: note.noteVi || null,
    noteType: note.noteType === 'bao_gom' ? 'INCLUDES' : (note.noteType || 'GENERAL').toUpperCase(),
    sourceDocument: note.sourceFile || 'bao_gom_index.json',
    extra: { headingCode: note.headingCode, chapterCode: note.chapterCode },
  });
}

/**
 * Build GIR note chain for an 8-digit HS code (Issue #18).
 */
function buildNoteChain(hs, { levelFilter = 'all' } = {}) {
  const hsCode = normalizeHs(hs);
  const chapterNum = parseInt(hsCode.slice(0, 2), 10);
  const national = explanatoryNotesData[hsCode];
  const headingCode = national?.headingCode || hsCode.slice(0, 4);
  const subheadingCode = national?.parentCode || hsCode.slice(0, 6);

  const chain = [
    buildSectionNote(chapterNum),
    buildChapterNote(chapterNum),
    buildHeadingNote(chapterNum, headingCode),
    buildSubheadingNote(chapterNum, headingCode, subheadingCode),
    buildNationalNote(hsCode),
  ].filter(Boolean);

  if (levelFilter && levelFilter !== 'all') {
    const want = String(levelFilter).toUpperCase();
    return chain.filter((n) => n.level === want);
  }
  return chain;
}

function countByLevel(entries, level) {
  return entries.filter((e) => e.level === level).length;
}

function getNotesCoverage() {
  const nationalCount = Object.keys(explanatoryNotesData).length;
  const chapterCount = Object.keys(notesData).length;
  const sectionCount = sectionsMeta.length;

  const headingCodes = new Set();
  const subheadingCodes = new Set();
  for (const note of Object.values(explanatoryNotesData)) {
    if (note.headingCode) headingCodes.add(String(note.headingCode).padStart(4, '0'));
    if (note.parentCode) subheadingCodes.add(String(note.parentCode).padStart(6, '0'));
  }

  return {
    totalStructured: sectionCount + chapterCount + headingCodes.size + subheadingCodes.size + nationalCount,
    bySection: sectionCount,
    byChapter: chapterCount,
    byHeading: headingCodes.size,
    bySubheading: subheadingCodes.size,
    byNational: nationalCount,
    targetTotal: 7400,
    pctOfTarget: Math.round(
      ((sectionCount + chapterCount + headingCodes.size + subheadingCodes.size + nationalCount) / 7400) * 1000,
    ) / 10,
  };
}

module.exports = {
  buildNoteChain,
  getNotesCoverage,
  sectionForChapter,
};
