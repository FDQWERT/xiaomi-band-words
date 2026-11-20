/* 迷你 Vela 运行时：仅用于在浏览器里预览 .ux 页面，不代表真机行为 */
(function () {
  // ---------- @system.storage 桩 ----------
  var __storage = {
    get: function (opt) {
      setTimeout(function () {
        var v = null;
        try { v = localStorage.getItem(opt.key); } catch (e) { v = null; }
        if (v === null) { opt.fail && opt.fail({ code: 100, message: "not found" }); }
        else { opt.success && opt.success(v); }
      }, 0);
    },
    set: function (opt) {
      try { localStorage.setItem(opt.key, opt.value); } catch (e) {}
      setTimeout(function () { opt.success && opt.success(); }, 0);
    },
    delete: function (opt) {
      try { localStorage.removeItem(opt.key); } catch (e) {}
      setTimeout(function () { opt.success && opt.success(); }, 0);
    },
    clear: function (opt) {
      try { localStorage.clear(); } catch (e) {}
      setTimeout(function () { opt.success && opt.success(); }, 0);
    }
  };

  // ---------- 路由 / toast 桩 ----------
  function pageKey(uri) {
    var s = String(uri || "").replace(/^\//, "");
    var m = s.match(/pages\/([A-Za-z0-9_]+)\//);
    if (m) return m[1];
    return s.split("?")[0].split("/").pop() || "index";
  }
  var stack = [];
  function route(uri, replace) {
    var key = pageKey(uri);
    if (!replace) stack.push(key);
    window.__go && window.__go(key);
  }
  window.__router = {
    push: function (o) { route(o.uri, false); },
    replace: function (o) { route(o.uri, true); },
    back: function () {
      stack.pop();
      var prev = stack.pop() || "index";
      window.__go && window.__go(prev);
    }
  };

  function toast(text) {
    var box = document.getElementById("toast");
    if (!box) return;
    box.textContent = text;
    box.style.opacity = "1";
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { box.style.opacity = "0"; }, 1400);
  }
  window.__prompt = {
    showToast: function (o) { toast(typeof o === "string" ? o : o.message); },
    showDialog: function (o) {
      var msg = typeof o === "string" ? o : (o.message || "");
      if (window.confirm(msg)) { o && o.success && o.success(); } else { o && o.cancel && o.cancel(); }
    }
  };

  // ---------- CommonJS 模块注册 ----------
  var __defs = {}, __cache = {};
  function normalize(id) {
    var part = String(id).split("/").pop();
    return part.replace(/\.js$/, "");
  }
  function require(id) {
    if (id === "@system.storage") return __storage;
    if (id === "@system.router") return window.__router;
    if (id === "@system.prompt") return window.__prompt;
    var key = normalize(id);
    if (__cache[key]) return __cache[key].exports;
    if (!__defs[key]) throw new Error("module not found: " + id);
    var m = { exports: {} };
    __cache[key] = m;
    __defs[key](m, m.exports);
    return m.exports;
  }
  window.__def = function (key, fn) { __defs[key] = fn; };
  window.require = function (id) {
    var mod = require(id);
    // 方便自动化测试拿到单例
    if (normalize(id) === "store") window.__store = mod;
    return mod;
  };

  // ---------- 模板渲染 ----------
  function evalExpr(expr, ctx) {
    try {
      return new Function("$c", "with ($c) { return (" + expr + "); }")(ctx);
    } catch (e) {
      console.warn("[expr]", expr, e && e.message);
      return undefined;
    }
  }

  function interp(str, ctx) {
    return str.replace(/\{\{([\s\S]*?)\}\}/g, function (m, expr) {
      var v = evalExpr(expr, ctx);
      return v === undefined || v === null ? "" : String(v);
    });
  }

  var TAGS = {
    TEXT: "span", SCROLL: "div", LIST: "div", "LIST-ITEM": "div", STACK: "div",
    SWIPER: "div", PROGRESS: "div", PICKER: "div", SWITCH: "div", SLIDER: "div",
    IMAGE: "img", MARQUEE: "div", SPAN: "span"
  };

  function buildNode(node, ctx) {
    if (node.nodeType === 3) {
      var raw = node.nodeValue;
      if (!/\S/.test(raw)) return null;
      return document.createTextNode(interp(raw, ctx));
    }
    if (node.nodeType !== 1) return null;
    if (node.tagName === "TEMPLATE") return null;

    // for 循环
    if (node.hasAttribute("for")) {
      var spec = node.getAttribute("for").replace(/[{}\s]/g, "");
      var mm = spec.match(/^([\w$]+)(?:,([\w$]+))?in(.+)$/);
      if (mm) {
        var list = evalExpr(mm[3], ctx) || [];
        var frag = document.createDocumentFragment();
        for (var i = 0; i < list.length; i++) {
          var scoped = Object.create(ctx);
          scoped[mm[1]] = list[i];
          if (mm[2]) scoped[mm[2]] = i;
          var clone = node.cloneNode(true);
          clone.removeAttribute("for");
          var built = buildElement(clone, scoped);
          if (built) frag.appendChild(built);
        }
        return frag;
      }
      node.removeAttribute("for");
    }

    return buildElement(node, ctx);
  }

  function buildElement(el, ctx) {
    if (el.hasAttribute("if")) {
      var cond = evalExpr(el.getAttribute("if").replace(/^\{\{|\}\}$/g, ""), ctx);
      if (!cond) return null;
    }
    if (el.tagName === "BLOCK") {
      // Vela 的 <block> 只是循环/条件的包裹层，本身不产生节点
      var frag = document.createDocumentFragment();
      for (var bi = 0; bi < el.childNodes.length; bi++) {
        var bc = buildNode(el.childNodes[bi], ctx);
        if (bc) frag.appendChild(bc);
      }
      return frag;
    }
    var tag = el.tagName;
    var out = document.createElement(TAGS[tag] || "div");

    for (var i = 0; i < el.attributes.length; i++) {
      var attr = el.attributes[i];
      var name = attr.name, val = attr.value;
      if (name === "if" || name === "for" || name === "else") continue;
      if (name === "class") { out.className = interp(val, ctx).replace(/\s+/g, " ").trim(); continue; }
      if (name === "style") { out.setAttribute("style", interp(val, ctx)); continue; }
      if (/^on/.test(name)) {
        (function (code, type) {
          out.addEventListener(type, function (ev) {
            try {
              // "startStudy" 这种写法在 Vela 里等于调用该方法；"apply(0)" 直接执行
              var ret = new Function("$c", "$event", "with ($c) { return (" + code + "); }")(ctx, ev);
              if (typeof ret === "function") ret(ev);
            } catch (e) {
              console.error("[handler]", code, e);
            }
          });
        })(val.trim(), name.slice(2));
        continue;
      }
      out.setAttribute(name, interp(val, ctx));
    }

    for (var k = 0; k < el.childNodes.length; k++) {
      var child = buildNode(el.childNodes[k], ctx);
      if (child) out.appendChild(child);
    }
    return out;
  }

  // ---------- 页面实例 ----------
  function makePage(def, onChange) {
    var data = {};
    var priv = def.private || def.data || {};
    for (var k in priv) data[k] = priv[k];

    var methods = {};
    var proxy = new Proxy({}, {
      get: function (t, key) {
        if (key in data) return data[key];
        if (key in methods) return methods[key];
        return undefined;
      },
      set: function (t, key, value) {
        data[key] = value;
        onChange();
        return true;
      },
      has: function (t, key) { return (key in data) || (key in methods); }
    });

    for (var name in def) {
      if (typeof def[name] === "function") methods[name] = def[name].bind(proxy);
    }
    return proxy;
  }

  var tplCache = {};
  function getTpl(name) {
    if (!tplCache[name]) tplCache[name] = document.getElementById("tpl-" + name);
    return tplCache[name];
  }

  var current = null;
  var pending = false;

  function draw() {
    pending = false;
    if (!current) return;
    var screen = document.getElementById("screen");
    screen.setAttribute("data-page", current.name);
    var tpl = getTpl(current.name);
    var holder = document.createDocumentFragment();
    var kids = tpl.content.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var built = buildNode(kids[i], current.ctx);
      if (built) holder.appendChild(built);
    }
    while (screen.firstChild) screen.removeChild(screen.firstChild);
    screen.appendChild(holder);
  }

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(draw);
  }

  window.__boot = function (name) {
    var def = window.__pages[name];
    if (!def) return;
    var ctx = makePage(def, schedule);
    current = { name: name, ctx: ctx };
    if (ctx.onInit) ctx.onInit();
    draw();
    if (ctx.onReady) ctx.onReady();
    if (ctx.onShow) ctx.onShow();
    var tabs = document.querySelectorAll("[data-tab]");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].className = "tab" + (tabs[i].getAttribute("data-tab") === name ? " tab-on" : "");
    }
  };

  window.__go = function (name) { window.__boot(name); location.hash = name; };

  window.addEventListener("hashchange", function () {
    var n = (location.hash || "#index").slice(1) || "index";
    if (!current || current.name !== n) window.__boot(n);
  });
})();
