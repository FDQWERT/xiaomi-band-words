/* 纯 Node 端逻辑测试：不依赖 DOM，验证 store.js 的调度数学与持久化 */
const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "..", "src", "common");
const read = (p) => fs.readFileSync(p, "utf8");

// ---- 假时钟 ----
const DAY = 86400000;
let now = new Date(2026, 0, 1, 9, 0, 0).getTime(); // 2026-01-01 09:00 本地
const realNow = Date.now;
Date.now = () => now;

// ---- 内存版 @system.storage ----
const mem = new Map();
let setCount = 0;
let setKeys = [];
const storage = {
  get(opt) {
    setImmediate(() => {
      const v = mem.has(opt.key) ? mem.get(opt.key) : null;
      if (v === null) opt.fail && opt.fail({ code: 100, message: "not found" });
      else opt.success && opt.success(v);
    });
  },
  set(opt) {
    setCount += 1;
    setKeys.push(opt.key);
    mem.set(opt.key, opt.value);
    setImmediate(() => opt.success && opt.success());
  },
  delete(opt) {
    mem.delete(opt.key);
    setImmediate(() => opt.success && opt.success());
  }
};

// ---- CommonJS 装载 ----
const mods = {};
function load(name) {
  if (mods[name]) return mods[name].exports;
  const m = { exports: {} };
  mods[name] = m;
  const fn = new Function("module", "exports", "require", read(path.join(SRC, name + ".js")));
  fn(m, m.exports, (id) => {
    if (id === "@system.storage") return storage;
    return load(id.replace(/^\.\//, "").replace(/\.js$/, ""));
  });
  return m.exports;
}

const store = load("store");
const wordlist = load("wordlist");
const words = [];
for (let i = 0; i < wordlist.total(); i++) words.push(wordlist.at(i));

let pass = 0;
let fail = 0;
function ok(cond, label, extra) {
  if (cond) {
    pass++;
    console.log("  ✓ " + label);
  } else {
    fail++;
    console.log("  ✗ " + label + (extra !== undefined ? "  → " + JSON.stringify(extra) : ""));
  }
}
const eq = (a, b, label) => ok(a === b, label + " (期望 " + JSON.stringify(b) + ", 实际 " + JSON.stringify(a) + ")");

function loadStore() {
  return new Promise((res) => store.load(() => res()));
}
const today = () => store.dayNumber(now);
const advance = (d) => {
  now += d * DAY;
};

(async () => {
  console.log("\n[1] 词库");
  eq(store.wordCount(), words.length, "wordCount 与词库条目数一致");
  ok(words.length >= 3500, "词库不少于 3500 条", words.length);
  const bad = words.filter((w) => !w[0] || !w[2]);
  ok(bad.length === 0, "每条都有单词与释义", bad.slice(0, 3));
  const dup = new Set();
  let dupCount = 0;
  words.forEach((w) => {
    if (dup.has(w[0])) dupCount++;
    dup.add(w[0]);
  });
  eq(dupCount, 0, "无重复单词");
  const odd = words.filter((w) => !/^\p{L}[\p{L}\p{N} .'\-()&/]*$/u.test(w[0]));
  eq(odd.length, 0, "单词均以字母开头", odd.slice(0, 3).map((w) => w[0]));

  // 音标只能含 ASCII：手环字体没有国际音标字形，非 ASCII 会显示成空白/方框
  const badPhon = words.filter((w) => w[1] && !/^[\x20-\x7E]*$/.test(w[1]));
  eq(badPhon.length, 0, "音标全部是 ASCII", badPhon.slice(0, 3).map((w) => w[0] + " " + w[1]));
  const ipaLeft = words.filter((w) => /[\u0250-\u02FF\u1D00-\u1DBF]/.test(w[1] || ""));
  eq(ipaLeft.length, 0, "没有残留的国际音标字符", ipaLeft.slice(0, 3).map((w) => w[0]));
  const find = (s) => words.find((w) => w[0] === s) || ["", ""];
  eq(find("apple")[1], "'ap(e)l", "apple 音标已转 ASCII");
  eq(find("thing")[1], "thing", "thing 的 th/ng 用字母表示");
  eq(find("ship")[1], "ship", "ship 的 ʃ 写成 sh");
  eq(find("teacher")[1], "'ti:che(r)", "teacher 的 tʃ 写成 ch");
  const wordmeta = require("../src/common/wordmeta.js");
  eq(wordmeta.total, words.length, "wordmeta.total 与词表条数一致（页面用它算进度，不再各带一份词表）");
  const storeSrc = require("fs").readFileSync(require("path").resolve(__dirname, "..", "src", "common", "store.js"), "utf8");
  eq(storeSrc.indexOf("worddata") === -1, true, "store.js 不依赖词表文件（省内存/包体）");
  const tooLong = words.filter((w) => store.displayPhonetic(w[1]).length > 22);
  eq(tooLong.length, 0, "显示用的音标不超过 22 字符（小屏放得下）", tooLong.slice(0, 3).map((w) => w[0] + " " + w[1]));
  eq(store.displayPhonetic("di'reksh(e)n, dai'reksh(e)n").length <= 22, true, "过长读音只留第一个");
  eq(store.displayPhonetic("ed'va:ns; (US) ed'vans"), "ed'va:ns", "去掉英/美第二个读音");

  console.log("\n[2] 首次加载与默认计划");
  await loadStore();
  eq(store.settings().dailyNew, 20, "默认每天新词 20");
  eq(store.plan().day, today(), "计划日期为今天");
  eq(store.plan().newIds.length, 20, "新词计划 20 个");
  eq(store.plan().reviewIds.length, 0, "首日没有复习");
  eq(store.buildQueue().length, 20, "队列 = 20");
  ok(store.buildQueue().every((c) => c.isNew), "首日队列全是新词");

  console.log("\n[3] 修改每日新词数");
  store.saveSettings({ dailyNew: 5 });
  eq(store.plan().newIds.length, 5, "改成 5 后计划立即变为 5");
  const s1 = store.buildQueue()[0];
  store.grade(s1.id, 2);
  eq(store.state.progress[s1.id].r, 1, "第一次「认识」r=1");
  eq(store.state.progress[s1.id].i, 1, "第一次「认识」i=1（明天复习）");
  eq(store.state.progress[s1.id].d, today() + 1, "下次复习 = 明天");

  console.log("\n[4] 跨天复习队列");
  advance(1);
  await loadStore();
  const p1 = store.plan();
  ok(p1.reviewIds.includes(s1.id), "第二天到期词进入复习");
  eq(p1.newIds.length, 5, "第二天仍有 5 个新词");
  const q = store.buildQueue();
  eq(q[0].id, s1.id, "复习排在队列最前");

  console.log("\n[5] SM-2 间隔增长");
  store.grade(s1.id, 2);
  const p = store.state.progress[s1.id];
  eq(p.r, 2, "第二次「认识」r=2");
  eq(p.i, 3, "第二次「认识」间隔 = 3 天");
  eq(p.e, 260, "EF 每次「认识」+5");
  advance(3);
  await loadStore();
  ok(store.plan().reviewIds.includes(s1.id), "3 天后再次到期");
  store.grade(s1.id, 2);
  const p2 = store.state.progress[s1.id];
  eq(p2.i, Math.max(1, Math.round((3 * 265) / 100)), "第三次间隔 = round(i*e/100) = 8");

  console.log("\n[6] 忘记 / 模糊");
  advance(8);
  await loadStore();
  store.grade(s1.id, 0);
  const p3 = store.state.progress[s1.id];
  eq(p3.r, 1, "忘记后 r 重置为 1");
  eq(p3.i, 1, "忘记后间隔回到 1 天");
  eq(p3.e, 240, "忘记后 EF -25");
  eq(p3.d, today() + 1, "明天再来");
  advance(1);
  await loadStore();
  store.grade(s1.id, 1);
  const p4 = store.state.progress[s1.id];
  eq(p4.i, Math.max(1, Math.round(1 * 1.2)), "模糊：间隔 ×1.2");
  eq(p4.e, 232, "模糊：EF -8");

  console.log("\n[7] 每日统计与连续天数");
  const sum = store.summary();
  ok(sum.learned >= 1, "已学数量统计正确", sum);
  ok(sum.streak >= 2, "连续天数累计", sum.streak);
  ok(store.state.meta.daily, "今日计数存在", store.state.meta.daily);

  console.log("\n[8] 复习上限");
  store.saveSettings({ reviewCap: 10, dailyNew: 0 });
  advance(30);
  await loadStore();
  ok(store.plan().reviewIds.length <= 10, "复习量不超过上限", store.plan().reviewIds.length);
  store.saveSettings({ dailyNew: 5 });

  console.log("\n[9] 持久化往返（含分片）");
  store.flush();
  await new Promise((r) => setTimeout(r, 800));
  const before = JSON.stringify(store.state.progress);
  const snapshot = new Map(mem);
  mods.store = null;
  delete mods.store;
  const store2 = load("store");
  mem.clear();
  snapshot.forEach((v, k) => mem.set(k, v));
  await new Promise((res) => store2.load(() => res()));
  eq(JSON.stringify(store2.state.progress), before, "重新加载后进度完全一致");
  ok(mem.has("bw_p0"), "分片已写入", [...mem.keys()].filter((k) => k.startsWith("bw_p")));

  console.log("\n[10] 大进度分片写入");
  for (let i = 0; i < 3500; i++) store2.grade(i, 2);
  store2.flush();
  await new Promise((r) => setTimeout(r, 50));
  const chunks = [...mem.keys()].filter((k) => k.startsWith("bw_p"));
  ok(chunks.length >= 2, "超过 3000 条会分成多片", chunks);

  console.log("\n[11] 清空进度");
  store2.resetAll();
  await new Promise((r) => setTimeout(r, 50));
  eq(Object.keys(store2.state.progress).length, 0, "清空后无进度");
  eq(store2.plan().newIds.length, 5, "清空后回到新词计划");

  console.log("\n[12] 今日复习 / 继续学习 / reload");
  mem.clear();
  delete mods.store;
  const store3 = load("store");
  await new Promise((res) => store3.load(() => res()));
  const planIds = store3.plan().newIds.slice();
  ok(planIds.length > 0, "有今日新词计划", planIds.length);
  planIds.forEach((id) => store3.grade(id, 2));
  eq(store3.todayReviewCount(), planIds.length, "今日复习数 = 今天新学的词数");
  const reviewQueue = store3.buildTodayReviewQueue();
  eq(reviewQueue.length, planIds.length, "今日复习队列数量一致");
  ok(reviewQueue.every((c) => c.isToday === true), "今日复习卡片带 isToday 标记");
  const revIds = reviewQueue.map((c) => c.id).sort((a, b) => a - b);
  eq(
    JSON.stringify(revIds),
    JSON.stringify(planIds.slice().sort((a, b) => a - b)),
    "今日复习只含今天学过的词"
  );

  const target = planIds[0];
  const beforeInterval = store3.state.progress[target].i;
  const beforeDue = store3.state.progress[target].d;
  store3.gradeTodayReview(target, 2);
  eq(store3.state.progress[target].i, beforeInterval, "今日复习「认识」不改变间隔");
  eq(store3.state.progress[target].d, beforeDue, "今日复习「认识」不改变到期日");

  store3.gradeTodayReview(target, 0);
  const reset = store3.state.progress[target];
  eq(reset.r, 1, "今日复习「忘记」重置 r=1");
  eq(reset.d, store3.dayNumber() + 1, "今日复习「忘记」改到明天");

  const newBefore = store3.plan().newIds.length;
  const added = store3.extendNewWords(5);
  eq(added, 5, "继续学习追加 5 个新词");
  eq(store3.plan().newIds.length, newBefore + 5, "计划里的新词数量增加");
  const leftBefore = store3.remainingNewCount();
  store3.extendNewWords(3);
  eq(store3.remainingNewCount(), leftBefore - 3, "继续学习后剩余新词减少");

  // 另一个页面实例改了计划，reload 之后必须能看到（页面间状态不共享）
  store3.flush();
  await new Promise((res) => setTimeout(res, 50));
  delete mods.store;
  const store4 = load("store");
  await new Promise((res) => store4.load(() => res()));
  store4.extendNewWords(2);
  store4.flush();
  await new Promise((res) => setTimeout(res, 50));
  const planAfterOther = store4.plan().newIds.length;
  await new Promise((res) => store3.reload(() => res()));
  eq(store3.plan().newIds.length, planAfterOther, "reload 读到另一个页面写入的新计划");
  ok(store3.plan().newIds.length > newBefore, "reload 后不是旧数据");

  console.log("\n[14] 入口意图（首页 →「今日复习」）");
  store3.setSession("today");
  await new Promise((r) => setTimeout(r, 30));
  eq(store3.session(), "today", "setSession 立刻生效");
  await new Promise((res) => store3.reload(() => res()));
  eq(store3.session(), "today", "重启后仍能读到「今日复习」意图");
  store3.setSession("plan");
  await new Promise((r) => setTimeout(r, 30));
  await new Promise((res) => store3.reload(() => res()));
  eq(store3.session(), "plan", "清掉意图后回到普通模式");
  eq(store3.todayReviewCount() > 0, true, "重启后今日复习词数仍在（来自 meta.daily）");

  console.log("\n[15] 增量写盘");
  store3.flush();
  await new Promise((r) => setTimeout(r, 50));
  setCount = 0;
  setKeys = [];
  store3.grade(planIds[1], 2);
  store3.flush();
  await new Promise((r) => setTimeout(r, 50));
  ok(setCount <= 2, "评分一个词只写 1 个分片（+1 次 meta）", setKeys);
  setCount = 0;
  setKeys = [];
  store3.flush();
  await new Promise((r) => setTimeout(r, 30));
  eq(setCount, 0, "没有改动时不写盘");
  const chunkKeys = setKeys.filter((k) => k.indexOf("bw_p") === 0);
  eq(chunkKeys.length, 0, "不重复写没变的分片");

  console.log("\n[16] 退出学习页就落盘 + reload 不覆盖新进度");
  mem.clear();
  delete mods.store;
  const homePage = load("store");
  await new Promise((res) => homePage.load(() => res()));
  const planA = homePage.plan().newIds.slice();
  ok(planA.length > 0, "首页有今日计划", planA.length);

  delete mods.store;
  const studyPage = load("store");
  await new Promise((res) => studyPage.load(() => res()));
  studyPage.grade(planA[0], 2);
  studyPage.grade(planA[1], 0);
  await new Promise((r) => setTimeout(r, 80)); // 远小于原来的 600ms 防抖

  delete mods.store;
  const restart = load("store");
  await new Promise((res) => restart.load(() => res()));
  ok(!!restart.state.progress[planA[0]], "评分后不等防抖就已写进存储", Object.keys(restart.state.progress).length);
  eq(restart.state.progress[planA[0]].r, 1, "「认识」一次 r=1");
  eq(restart.state.progress[planA[1]].d, restart.dayNumber() + 1, "「忘记」的到期是明天");

  const staleBefore = JSON.stringify(homePage.state.progress);
  await new Promise((res) => homePage.reload(() => res()));
  ok(!!homePage.state.progress[planA[0]], "reload 后首页看到刚学的词", Object.keys(homePage.state.progress).length);
  eq(JSON.stringify(homePage.state.progress), JSON.stringify(restart.state.progress), "reload 后与存储完全一致");
  ok(staleBefore !== JSON.stringify(homePage.state.progress), "旧的内存副本没有被写回去");

  delete mods.store;
  const afterPage = load("store");
  await new Promise((res) => afterPage.load(() => res()));
  ok(!!afterPage.state.progress[planA[0]], "存储没有被旧进度覆盖");

  Date.now = realNow;
  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})();
