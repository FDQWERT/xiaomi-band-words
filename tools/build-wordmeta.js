/* 生成 wordmeta.js：只给页面用的词库总数（避免每个页面各带一份 215KB 词表） */
const fs = require("fs");
const path = require("path");
const words = require(path.resolve(__dirname, "..", "src", "common", "worddata.js"));
const OUT = path.resolve(__dirname, "..", "src", "common", "wordmeta.js");
fs.writeFileSync(
  OUT,
  "// 由 tools/build-wordmeta.js 生成，不要手改\nmodule.exports = " + JSON.stringify({ total: words.length }) + "\n"
);
console.log("wordmeta.total =", words.length);
