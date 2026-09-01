const fs = require('node:fs');
const path = require('node:path');

const target = path.join(process.cwd(), 'node_modules', 'yt-search', 'dist', 'yt-search.js');
if (!fs.existsSync(target)) {
  console.warn('[patch-yt-search] dependency file not found; skipping');
  process.exit(0);
}

let source = fs.readFileSync(target, 'utf8');
const original = source;
const marker = 'var _normalizeTextValue = function (value) {';

if (!source.includes(marker)) {
  const anchor = "  return r;\n};\n\n// google bot user-agent";
  const helper = `  return r;
};
var _normalizeTextValue = function (value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map(_normalizeTextValue).join('').trim();
  if (value && typeof value === 'object') {
    if (value.simpleText != null) return _normalizeTextValue(value.simpleText);
    if (value.text != null) return _normalizeTextValue(value.text);
    if (value.content != null) return _normalizeTextValue(value.content);
    if (value.runs != null) return _normalizeTextValue(value.runs);
  }
  return '';
};

// google bot user-agent`;
  if (!source.includes(anchor)) throw new Error('[patch-yt-search] parser anchor changed');
  source = source.replace(anchor, helper);
}

const replacements = [
  [
    "var title = _jp.value(item, '$..title..text') || _jp.value(item, '$..title..simpleText');",
    "var title = _normalizeTextValue(_jp.value(item, '$..title..text') || _jp.value(item, '$..title..simpleText'));",
  ],
  [
    "var author_name = _jp.value(item, '$..shortBylineText..text') || _jp.value(item, '$..longBylineText..text');",
    "var author_name = _normalizeTextValue(_jp.value(item, '$..shortBylineText..text') || _jp.value(item, '$..longBylineText..text'));",
  ],
  [
    "var agoText = _jp.value(item, '$..publishedTimeText..text') || _jp.value(item, '$..publishedTimeText..simpleText');",
    "var agoText = _normalizeTextValue(_jp.value(item, '$..publishedTimeText..text') || _jp.value(item, '$..publishedTimeText..simpleText'));",
  ],
  [
    "var viewCountText = _jp.value(item, '$..viewCountText..text') || _jp.value(item, '$..viewCountText..simpleText') || \"0\";",
    "var viewCountText = _normalizeTextValue(_jp.value(item, '$..viewCountText..text') || _jp.value(item, '$..viewCountText..simpleText')) || \"0\";",
  ],
  [
    "var lengthText = _jp.value(item, '$..lengthText..text') || _jp.value(item, '$..lengthText..simpleText');",
    "var lengthText = _normalizeTextValue(_jp.value(item, '$..lengthText..text') || _jp.value(item, '$..lengthText..simpleText'));",
  ],
  ['title: title.trim(),', 'title: _normalizeTextValue(title),'],
  ['title: _title.trim(),', 'title: _normalizeTextValue(_title),'],
];

for (const [before, after] of replacements) {
  if (source.includes(before)) source = source.replace(before, after);
  if (!source.includes(after)) throw new Error(`[patch-yt-search] expected expression missing: ${after}`);
}

if (source !== original) {
  fs.writeFileSync(target, source);
  console.log('[patch-yt-search] current YouTube text format supported');
} else {
  console.log('[patch-yt-search] already applied');
}
