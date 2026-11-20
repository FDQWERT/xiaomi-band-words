/* 用 jsdom 跑 preview.html：真实执行 .ux 模板 + store + 词库，模拟点击流程 */
const fs = require("fs");
const path = require("path");
let JSDOM;
try { JSDOM = require("jsdom").JSDOM; } catch (e) { JSDOM = require("/tmp/domtest/node_modules/jsdom").JSDOM; }

const html = fs.readFileSync(path.resolve(__dirname, "..", "preview", "preview.html"), "utf8");
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "http://localhost/preview.html"
});
const { window } = dom;
const doc = window.document;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log("  ✓ " + label); }
  else { fail++; console.log("  ✗ " + label + (extra !== undefined ? "  → " + JSON.stringify(extra).slice(0, 200) : "")); }
}

(async () => {
  window.addEventListener("error", (e) => console.log("  ! window error:", e.message));
  await sleep(800);

  const screen = doc.getElementById("screen");
  const txt = () => screen.textContent.replace(/\s+/g, " ").trim();

  console.log("\n[1] 首页渲染");
  ok(screen.children.length > 0, "首页有内容");
  ok(screen.getAttribute("data-page") === "index", "当前页 = index");
  const home = txt();
  ok(/今日待复习/.test(home), "显示「今日待复习」", home.slice(0, 80));
  ok(/新词/.test(home) && /掌握率/.test(home), "显示新词/掌握率");
  ok(/学习统计/.test(home) && /设置/.test(home), "底部入口存在");
  const btn = screen.querySelector(".btn-primary");
  ok(!!btn, "主按钮存在", home);
  ok(/新词|复习|开始/.test(btn.textContent), "主按钮有可执行文案", btn && btn.textContent);

  const quickHome = screen.querySelectorAll(".quick-btn");
  ok(quickHome.length === 2, "首页有两个快捷按钮");
  ok(/还剩|\+/.test(quickHome[0].textContent), "未学完时继续学习显示剩余量", quickHome[0].textContent.trim());

  console.log("\n[2] 进入学习页");
  click(btn);
  await sleep(300);
  ok(screen.getAttribute("data-page") === "study", "切到学习页", screen.getAttribute("data-page"));
  const counter = screen.querySelector(".counter");
  ok(counter && /^1 \/ \d+$/.test(counter.textContent.trim()), "计数器 1 / N", counter && counter.textContent);
  const wordEl = screen.querySelector(".word-lg") || screen.querySelector(".word-sm") || screen.querySelector(".word-md");
  ok(wordEl && /[A-Za-z]/.test(wordEl.textContent), "显示单词", wordEl && wordEl.textContent);
  ok(!screen.querySelector(".def-text"), "未点击时释义隐藏");
  ok(/轻点卡片|显示释义/.test(txt()), "有提示文案");

  console.log("\n[3] 翻面并评分");
  click(screen.querySelector(".study-card"));
  await sleep(150);
  ok(!!screen.querySelector(".def-text"), "点击后显示释义", txt().slice(0, 100));
  const grades = screen.querySelectorAll(".grade-btn");
  ok(grades.length === 3, "三个评分按钮", grades.length);
  ok(/忘记/.test(grades[0].textContent) && /模糊/.test(grades[1].textContent) && /认识/.test(grades[2].textContent), "按钮文案正确");

  const before = counter.textContent;
  click(grades[2]);
  await sleep(200);
  const after = screen.querySelector(".counter");
  ok(after && after.textContent !== before, "评分后进入下一张", before + " → " + (after && after.textContent));

  console.log("\n[4] 连续学习直到完成");
  let guard = 0;
  while (screen.getAttribute("data-page") === "study" && guard++ < 40) {
    const card = screen.querySelector(".study-card");
    if (card && !screen.querySelector(".def-text")) { click(card); await sleep(60); }
    const g = screen.querySelectorAll(".grade-btn");
    if (g.length === 3) { click(g[2]); await sleep(80); }
    else break;
  }
  ok(/今日完成/.test(txt()), "出现完成页", txt().slice(0, 80));
  ok(guard < 40, "没有死循环", guard);

  console.log("\n[4b] 完成页只保留「返回首页」");
  ok(/今日完成/.test(txt()), "出现完成页", txt().slice(0, 40));
  ok(screen.querySelectorAll(".btn-secondary").length === 0, "没有「今日复习」按钮");
  const finishBtns = Array.from(screen.querySelectorAll(".btn-primary"));
  ok(finishBtns.length === 1, "完成页只有一颗按钮", finishBtns.map((b) => b.textContent.trim()));
  ok(/返回首页/.test(finishBtns[0].textContent), "这颗按钮是「返回首页」", finishBtns[0].textContent.trim());
  ok(!/继续学习|今日复习/.test(txt()), "完成页不再有继续学习/今日复习", txt().slice(0, 60));

  click(finishBtns[0]);
  await sleep(300);
  ok(screen.getAttribute("data-page") === "index", "点按钮回到首页", screen.getAttribute("data-page"));
  const afterQuitLine = screen.querySelector(".progress-text");
  const quitDone = Number(((afterQuitLine ? afterQuitLine.textContent : "").match(/今日\s*(\d+)/) || [])[1] || 0);
  ok(quitDone > 0, "返回首页后立刻显示今天已学的数量", afterQuitLine && afterQuitLine.textContent);

  console.log("\n[4c] 从首页「继续学习」再学一批");
  const quickContinue = screen.querySelectorAll(".quick-btn")[0];
  click(quickContinue);
  await sleep(300);
  ok(screen.getAttribute("data-page") === "study", "进入学习页", screen.getAttribute("data-page"));
  ok(!!screen.querySelector(".study-card"), "有卡片可学");
  let guard2 = 0;
  while (screen.getAttribute("data-page") === "study" && guard2++ < 60) {
    const card = screen.querySelector(".study-card");
    if (card && !screen.querySelector(".def-text")) { click(card); await sleep(40); }
    const g = screen.querySelectorAll(".grade-btn");
    if (g.length === 3) { click(g[2]); await sleep(50); }
    else break;
  }
  ok(/今日完成/.test(txt()), "追加的这一批也学完了", txt().slice(0, 40));
  click(screen.querySelector(".btn-primary"));
  await sleep(300);
  ok(screen.getAttribute("data-page") === "index", "再次回到首页");

  console.log("\n[4d] 从首页「今日复习」只过今天学的词");
  const quickToday = screen.querySelectorAll(".quick-btn")[1];
  const todayWords = Number((quickToday.textContent.match(/(\d+)/) || [])[1] || 0);
  ok(todayWords > 0, "首页今日复习有词数", quickToday.textContent.trim());
  click(quickToday);
  await sleep(300);
  const counterAfterToday = screen.querySelector(".counter");
  ok(/今日复习/.test(counterAfterToday ? counterAfterToday.textContent : ""), "进入今日复习模式", counterAfterToday && counterAfterToday.textContent);
  const totalToday = Number((counterAfterToday.textContent.match(/\/\s*(\d+)/) || [])[1] || 0);
  ok(totalToday === todayWords, "今日复习队列 = 今日新学词数", totalToday + " vs " + todayWords);

  const progressBefore = JSON.parse(JSON.stringify(window.__store.state.progress));
  let guard3 = 0;
  while (screen.getAttribute("data-page") === "study" && guard3++ < 80) {
    const card = screen.querySelector(".study-card");
    if (card && !screen.querySelector(".def-text")) { click(card); await sleep(40); }
    const g = screen.querySelectorAll(".grade-btn");
    if (g.length === 3) { click(g[2]); await sleep(50); }
    else break;
  }
  ok(/今日复习完成/.test(txt()), "今日复习完成页", txt().slice(0, 40));
  const progressAfter = window.__store.state.progress;
  const changed = Object.keys(progressAfter).filter(
    (k) => JSON.stringify(progressAfter[k]) !== JSON.stringify(progressBefore[k])
  );
  ok(changed.length === 0, "今日复习不影响原有排期", changed.length);
  click(screen.querySelector(".btn-primary"));
  await sleep(300);
  ok(screen.getAttribute("data-page") === "index", "今日复习后回到首页");

  console.log("\n[5] 设置页");
  window.__go("settings");
  await sleep(250);
  const st = txt();
  ok(/每天新词/.test(st), "有「每天新词」分区");
  ok(/每日复习上限/.test(st), "有「每日复习上限」分区");
  ok(/新词顺序/.test(st), "有「新词顺序」分区");
  const chips = screen.querySelectorAll(".chip");
  ok(chips.length >= 11, "选项 chip 渲染完整", chips.length);
  ok(/10/.test(st) && /50/.test(st), "新词选项 10~50");
  const onChip = screen.querySelector(".chip-on");
  ok(!!onChip, "当前选项有高亮");

  console.log("\n[6] 统计页");
  window.__go("stats");
  await sleep(250);
  const stt = txt();
  ok(/已学|掌握|连续/.test(stt), "统计页有数据", stt.slice(0, 80));
  ok(screen.querySelectorAll(".chart-col").length >= 7, "7 天柱状图", screen.querySelectorAll(".chart-col").length);

  console.log("\n[7] 回到首页后数据已更新（对应 onShow → store.reload）");
  window.__go("index");
  await sleep(300);
  ok(screen.getAttribute("data-page") === "index", "回到首页");
  const homeTxt = txt();
  const heroNum = screen.querySelector(".hero-num");
  const progressLine = screen.querySelector(".progress-text");
  ok(heroNum && heroNum.textContent.trim() === "0", "今日待复习已清零", heroNum && heroNum.textContent);
  ok(/今日\s*\d+\s*\/\s*\d+/.test(progressLine ? progressLine.textContent : ""), "进度行仍在", progressLine && progressLine.textContent);
  const done = Number(((progressLine.textContent.match(/今日\s*(\d+)/) || [])[1]) || 0);
  ok(done > 0, "今日完成数已回显到首页", done);
  ok(/已完成|无需复习/.test(homeTxt) || /继续/.test(homeTxt), "主按钮反映当前状态", (screen.querySelector(".btn-text") || {}).textContent);

  console.log("\n[8] 首页的继续学习 / 今日复习（模拟第二次打开应用）");
  const quick = screen.querySelectorAll(".quick-btn");
  ok(quick.length === 2, "首页有两个快捷按钮", quick.length);
  ok(/继续学习/.test(quick[0].textContent), "第一个是继续学习", quick[0].textContent.trim());
  ok(/今日复习/.test(quick[1].textContent), "第二个是今日复习", quick[1].textContent.trim());
  const quickTodayCount = Number((quick[1].textContent.match(/(\d+)\s*词/) || [])[1] || 0);
  ok(quickTodayCount > 0, "今日复习按钮显示今日词数", quick[1].textContent.trim());

  click(quick[1]);
  await sleep(300);
  ok(screen.getAttribute("data-page") === "study", "首页进今日复习", screen.getAttribute("data-page"));
  const homeTodayCounter = screen.querySelector(".counter");
  ok(/今日复习/.test(homeTodayCounter ? homeTodayCounter.textContent : ""), "直接进入今日复习模式", homeTodayCounter && homeTodayCounter.textContent);
  const homeTodayTotal = Number((homeTodayCounter.textContent.match(/\/\s*(\d+)/) || [])[1] || 0);
  ok(homeTodayTotal === quickTodayCount, "队列数量与按钮一致", homeTodayTotal + " vs " + quickTodayCount);

  // 退回首页，点继续学习
  window.__go("index");
  await sleep(250);
  const quick2 = screen.querySelectorAll(".quick-btn");
  const beforeExtend = window.__store.plan().newIds.length;
  click(quick2[0]);
  await sleep(300);
  ok(screen.getAttribute("data-page") === "study", "首页进继续学习", screen.getAttribute("data-page"));
  ok(window.__store.plan().newIds.length > beforeExtend, "继续学习追加了新词", [beforeExtend, window.__store.plan().newIds.length]);
  const extendCounter = screen.querySelector(".counter");
  ok(!/今日复习/.test(extendCounter ? extendCounter.textContent : ""), "继续学习是普通模式", extendCounter && extendCounter.textContent);

  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  window.close();
  process.exit(fail ? 1 : 0);
})();
