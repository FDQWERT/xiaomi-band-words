/* 修源词表里几条错行/串行的条目（音标串到相邻词、释义里混进别的词） */
const { readWords, writeWords } = require("./wordfile.js");
const words = readWords();

const PATCH = {
  sofa: ["sofa", "'oufe", "n. （长）沙发", ""],
  sort: ["sort", "so:t", "v. 把…分类，拣选 n. 种类，类别", ""],
};
const ADD = {
  soft: ["soft", "soft", "a. 软的，柔和的", ""],
};

let n = 0;
for (const w of words) {
  if (PATCH[w[0]]) {
    Object.assign(w, PATCH[w[0]]);
    n++;
  }
}
for (const key of Object.keys(ADD)) {
  if (!words.some((w) => w[0] === key)) {
    words.push(ADD[key]);
    n++;
  }
}
words.sort((a, b) => (a[0].toLowerCase() < b[0].toLowerCase() ? -1 : a[0].toLowerCase() > b[0].toLowerCase() ? 1 : 0));

writeWords(words);
console.log("修补", n, "条，现在共", words.length, "条");
