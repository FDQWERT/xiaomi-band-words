const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const OUT = path.join(ROOT, "preview", "preview.html");
const PAGES = ["index", "study", "stats", "settings"];

const read = (p) => fs.readFileSync(p, "utf8");

function section(text, tag) {
  const m = text.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"));
  return m ? m[1] : "";
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// Vela 的 class 选择器前面加作用域前缀，四个页面互不干扰
function scopeCss(css, prefix) {
  return stripComments(css).replace(/([^{}]+)\{([^{}]*)\}/g, (m, sels, body) => {
    const list = sels
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => prefix + " " + s)
      .join(", ");
    return list + " {" + body + "}";
  });
}

function transformScript(body) {
  return body
    .replace(/^\s*import\s+(\w+)\s+from\s+["']([^"']+)["'];?/gm, 'const $1 = require("$2");')
    .replace(/export\s+default\s*\{/, "return {");
}

const templates = [];
const styles = [];
const scripts = [];

for (const name of PAGES) {
  const file = path.join(SRC, "pages", name, name + ".ux");
  const text = read(file);
  const tpl = section(text, "template").trim();
  const css = section(text, "style");
  const js = transformScript(section(text, "script"));

  if (/<template/i.test(tpl === "" ? text : "") && tpl === "") {
    console.log("WARN no template in " + file);
  }

  templates.push(`<template id="tpl-${name}">${tpl}</template>`);
  styles.push(`<style>${scopeCss(css, '#screen[data-page="' + name + '"]')}</style>`);
  scripts.push(`window.__pages.${name} = (function () {${js}\n})();`);
}

const words = read(path.join(SRC, "common", "worddata.js"));
const store = read(path.join(SRC, "common", "store.js"));
const wordmeta = read(path.join(SRC, "common", "wordmeta.js"));
const wordlist = read(path.join(SRC, "common", "wordlist.js"));
const runtime = read(path.join(ROOT, "preview", "runtime.js"));

const base = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #08090a; color: #e6edf3;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", sans-serif; }
body { display: flex; flex-direction: column; align-items: center; min-height: 100vh; padding: 26px 14px 40px; }
.hint { font-size: 12px; color: #6e7681; margin-bottom: 16px; letter-spacing: .3px; }
#screen { position: relative; width: 336px; height: 480px; overflow: hidden; background: #000;
  border-radius: 30px; box-shadow: 0 0 0 8px #171b1f, 0 24px 50px rgba(0, 0, 0, .65); color: #fff; }
#screen div, #screen scroll, #screen list, #screen stack, #screen list-item {
  display: flex; flex-direction: column; position: relative; }
#screen span { display: block; }
#screen img { display: block; }
.tabs { display: flex; gap: 8px; margin-top: 22px; }
.tab { padding: 7px 14px; border-radius: 999px; background: #171b1f; color: #8b949e;
  font-size: 13px; cursor: pointer; user-select: none; }
.tab-on { background: #34d399; color: #06251b; font-weight: 600; }
.reset { margin-top: 12px; font-size: 12px; color: #4b5359; text-decoration: underline; cursor: pointer; user-select: none; }
#toast { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
  background: rgba(22, 25, 28, .97); border: 1px solid #262b30; color: #fff; padding: 9px 18px;
  border-radius: 999px; font-size: 13px; opacity: 0; transition: opacity .2s; pointer-events: none; }
`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>背单词 · 小米手环 8 Pro 预览</title>
<style>${base}</style>
${styles.join("\n")}
</head>
<body>
<div class="hint">336 × 480 · 小米手环 8 Pro 界面预览</div>
<div id="screen"></div>
<div class="tabs">
  <div class="tab" data-tab="index" onclick="__go('index')">首页</div>
  <div class="tab" data-tab="study" onclick="__go('study')">学习</div>
  <div class="tab" data-tab="stats" onclick="__go('stats')">统计</div>
  <div class="tab" data-tab="settings" onclick="__go('settings')">设置</div>
</div>
<div class="reset" onclick="if(confirm('清空全部学习进度？')){localStorage.clear();location.reload();}">清空预览数据</div>
<div id="toast"></div>
${templates.join("\n")}
<script>${runtime}</script>
<script>
window.__pages = {};
window.__def("worddata", function (module, exports) {${words}
});
window.__def("wordmeta", function (module, exports) {${wordmeta}
});
window.__def("wordlist", function (module, exports) {${wordlist}
});
window.__def("store", function (module, exports) {${store}
});
${scripts.join("\n")}
window.__boot((location.hash || "#index").slice(1) || "index");
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html);
console.log("wrote", OUT, (html.length / 1024).toFixed(0) + "KB");
