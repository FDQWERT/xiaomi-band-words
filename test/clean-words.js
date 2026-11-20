/* 词库清洗：统一连字符、拆合写变体、去掉专有名词标记 */
const { readWords, writeWords } = require("../tools/wordfile.js");
const words = readWords();
const { toAscii } = require("../tools/ipa-ascii.js");

const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g;

function cleanHead(raw) {
  let s = String(raw);
  s = s.replace(DASHES, "-");
  s = s.replace(/[\uE000-\uF8FF]/g, "-");   // 私用区字符（源数据里的变体连字符）            // 各种破折号 → 连字符
  s = s.replace(/\u02c8/g, "'");         // 误用的重音符 → 撇号
  s = s.replace(/\*+$/, "");             // 专有名词标记 *
  s = s.replace(/\s*-\s*/g, "-");        // "best--seller" / "department -store"
  s = s.replace(/-{2,}/g, "-");
  s = s.trim();
  if (s.includes("/")) {                 // "grey / gray" → "grey"
    const first = s.split("/")[0].trim();
    if (/[A-Za-z]/.test(first)) s = first;
  }
  s = s.replace(/\s{2,}/g, " ").trim();
  if (/\s/.test(s)) {                    // "does doesn't" 这类并列写法只留第一个词
    const parts = s.split(" ");
    if (parts.length > 1 && parts.slice(1).some((p) => /'/.test(p))) s = parts[0];
  }
  return s;
}

const seen = new Map();
const out = [];
const changed = [];

for (const w of words) {
  const head = cleanHead(w[0]);
  if (!head || !/[A-Za-z]/.test(head)) continue;
  if (!/^[A-Za-z]/.test(head)) continue;
  const rec = [head, toAscii(w[1] || ""), w[2] || "", w[3] || ""];
  if (head !== w[0]) changed.push(w[0] + " → " + head);
  const key = head.toLowerCase();
  const old = seen.get(key);
  if (!old) {
    seen.set(key, rec);
    out.push(rec);
  } else if ((rec[2] || "").length > (old[2] || "").length) {
    const i = out.indexOf(old);
    out[i] = rec;
    seen.set(key, rec);
  }
}

out.sort((a, b) => (a[0].toLowerCase() < b[0].toLowerCase() ? -1 : a[0].toLowerCase() > b[0].toLowerCase() ? 1 : 0));

const body = "// 高考 3500 词表（清洗后按字母排序）\n// [单词, 音标, 词性与释义, 其他形式]\nmodule.exports = " + JSON.stringify(out) + "\n";
fs.writeFileSync(SRC, body);
console.log("原文", words.length, "→ 清洗后", out.length, "，改写", changed.length);
console.log(changed.slice(0, 15).join("\n"));
