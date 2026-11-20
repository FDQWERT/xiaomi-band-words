/*
 * 词表读取（运行时分）。
 *
 * worddata.js 里是一整条字符串，一行一个词，字段用 | 分隔。这里只做两件事：
 * 第一次用到时按行切开（一次 split，之后复用），按 id 取一条时再切字段。
 * 这样只有真正翻开卡片时才产生数组，平时只占一个字符串的内存。
 */
const RAW = require("./worddata.js");

let lines = null;

function all() {
  if (!lines) {
    lines = RAW.length ? RAW.split("\n") : [];
  }
  return lines;
}

function total() {
  return all().length;
}

function at(id) {
  const list = all();
  const line = list[id];
  if (!line) return ["", "", "", ""];
  const cells = line.split("|");
  return [cells[0] || "", cells[1] || "", cells[2] || "", cells[3] || ""];
}

module.exports = { at: at, total: total };
