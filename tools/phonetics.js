/* 把 worddata.js 里的国际音标换成 ASCII 近似记法（手环字体没有音标字形） */
const { toAscii, isAscii } = require("./ipa-ascii.js");
const { readWords, writeWords } = require("./wordfile.js");
const words = readWords();

let changed = 0;
const samples = [];
for (const w of words) {
  const before = w[1] || "";
  const after = toAscii(before);
  if (after !== before) changed++;
  if (samples.length < 12 && before && /[ʃθðŋɪəːˈˌæʌɒɔɜʊ]/.test(before) && after !== before) {
    samples.push(w[0] + "  " + before + "  →  " + after);
  }
  w[1] = after;
}

writeWords(words);

const bad = words.filter((w) => !isAscii(w[1] || ""));
console.log("共", words.length, "条，音标改写", changed, "条，仍含非 ASCII:", bad.length);
console.log(samples.join("\n"));
