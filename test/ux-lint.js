/* 静态检查 .ux 模板：表达式引用的字段是否都在 private 里、事件处理函数是否存在 */
const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "..", "src", "pages");
const PAGES = ["index", "study", "stats", "settings"];
const GLOBALS = new Set([
  "true", "false", "null", "undefined", "Math", "JSON", "Date", "Number", "String",
  "Boolean", "Array", "Object", "parseInt", "parseFloat", "isNaN", "item", "index", "it"
]);

let problems = 0;

function section(text, tag) {
  const m = text.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"));
  return m ? m[1] : "";
}

function loadDef(name) {
  const text = fs.readFileSync(path.join(SRC, name, name + ".ux"), "utf8");
  const js = section(text, "script")
    .replace(/^\s*import\s+(\w+)\s+from\s+["']([^"']+)["'];?/gm, 'const $1 = require("$2");')
    .replace(/export\s+default\s*\{/, "return {");
  const fn = new Function("require", js);
  const def = fn(() => ({ push() {}, back() {}, showToast() {}, state: { progress: {} } }));
  return { def, text };
}

function identifiers(expr) {
  const out = new Set();
  const cleaned = expr.replace(/(["'])(?:\\.|(?!\1)[^\\])*\1/g, '""');
  const re = /[A-Za-z_$][\w$]*/g;
  let m;
  while ((m = re.exec(cleaned))) {
    const id = m[0];
    // 跳过成员访问 obj.prop 里的 prop
    const before = cleaned.slice(0, m.index).replace(/\s+$/, "");
    if (before.endsWith(".")) continue;
    out.add(id);
  }
  return out;
}

for (const name of PAGES) {
  const { def, text } = loadDef(name);
  const tpl = section(text, "template");
  const priv = new Set(Object.keys(def.private || {}));
  const methods = new Set(Object.keys(def).filter((k) => typeof def[k] === "function"));
  const loops = new Set();
  (tpl.match(/for="\{\{\s*(\w+)\s+in\s+[^}]+\}\}"/g) || []).forEach((s) => {
    const m = s.match(/for="\{\{\s*(\w+)/);
    if (m) loops.add(m[1]);
  });

  const exprs = [];
  const bindings = (tpl.match(/\{\{([\s\S]*?)\}\}/g) || []).filter((s) => !/\bin\b\s+[A-Za-z_$]/.test(s) || s.includes("?"));
  bindings.forEach((s) => exprs.push({ kind: "bind", code: s.slice(2, -2) }));
  (tpl.match(/on\w+="([^"]*)"/g) || []).forEach((s) => {
    const m = s.match(/on\w+="([^"]*)"/);
    if (m) exprs.push({ kind: "event", code: m[1] });
  });

  const unknown = new Set();
  for (const e of exprs) {
    for (const id of identifiers(e.code)) {
      if (priv.has(id) || methods.has(id) || loops.has(id) || GLOBALS.has(id)) continue;
      unknown.add(id + "  ← " + e.code.trim().slice(0, 60));
    }
  }
  const handlers = [];
  (tpl.match(/on\w+="\s*([A-Za-z_$][\w$]*)/g) || []).forEach((s) => {
    const m = s.match(/on\w+="\s*([A-Za-z_$][\w$]*)/);
    if (m && !methods.has(m[1])) handlers.push(m[1]);
  });

  const tagOk = (tpl.match(/<([a-zA-Z-]+)/g) || []).map((s) => s.slice(1).toLowerCase());
  const allowed = new Set(["div", "text", "scroll", "list", "list-item", "image", "span", "stack", "progress", "input", "switch", "slider", "picker", "block"]);
  const badTags = [...new Set(tagOk.filter((t) => t !== "template" && !allowed.has(t)))];

  console.log(
    "\n[" + name + "] private " + priv.size + " 字段 / " + methods.size + " 方法"
  );
  if (unknown.size) {
    problems += unknown.size;
    console.log("  ✗ 未定义字段:\n    " + [...unknown].join("\n    "));
  } else console.log("  ✓ 模板引用的字段全部存在");

  if (handlers.length) {
    problems += handlers.length;
    console.log("  ✗ 缺失事件处理函数: " + handlers.join(", "));
  } else console.log("  ✓ 事件处理函数全部存在");

  if (badTags.length) {
    problems += badTags.length;
    console.log("  ✗ 非白名单组件: " + badTags.join(", "));
  } else console.log("  ✓ 组件均在 Vela 白名单内");

  // CSS 选择器只能是 class
  const css = section(text, "style");
  const badSel = [];
  (css.replace(/\/\*[\s\S]*?\*\//g, "").match(/(^|\})([^{}]+)\{/g) || []).forEach((s) => {
    const sel = s.replace(/^\}/, "").replace(/\{$/, "").trim();
    sel.split(",").forEach((one) => {
      const t = one.trim();
      if (!t) return;
      if (!/^\.[A-Za-z0-9_-]+$/.test(t)) badSel.push(t);
    });
  });
  if (badSel.length) {
    problems += badSel.length;
    console.log("  ✗ 非法 CSS 选择器: " + [...new Set(badSel)].join(" | "));
  } else console.log("  ✓ CSS 全部为单一 class 选择器");
}

console.log("\n问题总数: " + problems);
process.exit(problems ? 1 : 0);
