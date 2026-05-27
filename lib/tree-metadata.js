const { taxData, normalizeHs } = require('./data');
const { indentationLevel } = require('./gir-specificity');

const chapterMetaCache = new Map();

function levelLabel(indent, hs) {
  if (indent <= 0) return 'HEADING';
  if (indent === 1) return 'SUBHEADING';
  return 'NATIONAL';
}

function parentCodeFor(hs, indent) {
  const code = normalizeHs(hs);
  if (indent <= 0) return code.slice(0, 2);
  if (indent === 1) return code.slice(0, 4);
  return code.slice(0, 6);
}

function buildChapterMeta(chapter) {
  const ch = String(parseInt(chapter, 10)).padStart(2, '0');
  if (chapterMetaCache.has(ch)) return chapterMetaCache.get(ch);

  const rows = Object.values(taxData)
    .filter((r) => r.hs.startsWith(ch))
    .sort((a, b) => a.hs.localeCompare(b.hs));

  const byKey = new Map();
  for (const row of rows) {
    const hsCode = row.hs;
    const indent = indentationLevel(row.vn);
    const parentSubheadingCode = parentCodeFor(hsCode, indent);
    const key = `${parentSubheadingCode}:${indent}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(hsCode);
    byKey.set(hsCode, {
      hsCode,
      nameVi: row.vn,
      indentationLevel: indent,
      parentSubheadingCode,
      level: levelLabel(indent, hsCode),
    });
  }

  for (const [hsCode, meta] of [...byKey.entries()]) {
    if (typeof meta !== 'object' || !meta.hsCode) continue;
    const sibKey = `${meta.parentSubheadingCode}:${meta.indentationLevel}`;
    meta.siblingHsCodes = (byKey.get(sibKey) || []).filter((h) => h !== hsCode);
  }

  const metaIndex = {};
  for (const [, meta] of byKey.entries()) {
    if (meta?.hsCode) metaIndex[meta.hsCode] = meta;
  }

  const payload = { chapter: ch, metaIndex, rows };
  chapterMetaCache.set(ch, payload);
  return payload;
}

function getTreeMeta(hs) {
  const code = normalizeHs(hs);
  const chapter = code.slice(0, 2);
  const { metaIndex } = buildChapterMeta(chapter);
  return (
    metaIndex[code] || {
      hsCode: code,
      nameVi: taxData[code]?.vn || null,
      indentationLevel: indentationLevel(taxData[code]?.vn),
      parentSubheadingCode: code.slice(0, 6),
      siblingHsCodes: [],
      level: 'NATIONAL',
    }
  );
}

function buildIndentTree(rows) {
  const tree = [];
  const stack = [{ indent: -1, children: tree }];
  let lastHeading = '';

  for (const row of rows) {
    const indent = indentationLevel(row.vn);
    const heading = row.hs.slice(0, 4);
    if (heading !== lastHeading) {
      while (stack.length > 1) stack.pop();
      const headingNode = {
        code: heading,
        level: 'HEADING',
        indentation: 0,
        name: row.vn.replace(/^[\s-]+/, '').trim() || `Nhóm ${heading}`,
        children: [],
      };
      tree.push(headingNode);
      stack.length = 1;
      stack.push({ indent: 0, children: headingNode.children });
      lastHeading = heading;
    }

    const node = {
      code: row.hs,
      level: levelLabel(indent, row.hs),
      indentation: indent,
      name: row.vn,
      unitVi: row.dvt || null,
      hasPolicyWarning: Boolean(row.cs && String(row.cs).trim()),
      children: [],
    };

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    stack[stack.length - 1].children.push(node);
    stack.push({ indent, children: node.children });
  }

  return tree;
}

function buildChapterTree(chapter) {
  const { rows } = buildChapterMeta(chapter);
  return {
    chapter: String(parseInt(chapter, 10)).padStart(2, '0'),
    tree: buildIndentTree(rows),
    total: rows.length,
  };
}

module.exports = {
  getTreeMeta,
  buildChapterTree,
  buildChapterMeta,
};
