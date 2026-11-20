/*
 * 词表文件的读写（打包用）。
 *
 * 词表以前是嵌套数组字面量，Babel 编译 .ux／.js 时会把数组逐项缩进格式化，
 * 215KB 的数据在产物里膨胀到 ~900KB，手环上解析这个大对象既慢又占内存。
 * 所以磁盘上存成一个「每行一条、字段用 | 分隔」的字符串，学习页按需拆行，
 * 产物里它就是原样的 112KB 字符串，Babel 不会重排。
 */
const fs = require("fs");
const path = require("path");
const FILE = path.resolve(__dirname, "..", "src", "common", "worddata.js");
const META = path.resolve(__dirname, "..", "src", "common", "wordmeta.js");

const HEADER =
  "// 高考 3500 词表（清洗后按字母排序，音标为 ASCII 近似记法）\n" +
  "// 存成「每行一条、字段用 | 分隔」的字符串：数组字面量会被 Babel 逐项展开，产物膨胀 4 倍\n" +
  "// 只有学习页需要词条，其它页面用 wordmeta.js 里的总数\n";

function readWords() {
  if (fs.existsSync(FILE)) delete require.cache[require.resolve(FILE)];
  const mod = require(FILE);
  if (typeof mod === "string") {
    return mod.split("\n").map(function (line) {
      return line.split("|");
    });
  }
  return mod.map(function (w) {
    return [String(w[0] || ""), String(w[1] || ""), String(w[2] || ""), String(w[3] || "")];
  });
}

function writeWords(words) {
  const packed = words.map(function (w) {
    return w.join("|");
  }).join("\n");
  fs.writeFileSync(FILE, HEADER + "module.exports = " + JSON.stringify(packed) + "\n");
  fs.writeFileSync(META, "// 由 tools/wordfile.js 生成，不要手改\nmodule.exports = " + JSON.stringify({ total: words.length }) + "\n");
  return packed.length;
}

module.exports = { readWords, writeWords, FILE, META };

if (require.main === module) {
  const words = readWords();
  const size = writeWords(words);
  console.log("词表", words.length, "条，打包后字符串", size, "字符；wordmeta.total =", words.length);
}
