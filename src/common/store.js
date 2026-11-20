// 词库、学习进度与间隔复习调度（SM-2 变体）
// 所有数据只保存在手环本地：设置、进度分片、元信息
const storage = require("@system.storage")
const WORDMETA = require("./wordmeta.js")

const DAY_MS = 86400000
const KEY_SETTINGS = "bw_set"
const KEY_SESSION = "bw_sess"
const KEY_META = "bw_meta"
const CHUNK_PREFIX = "bw_p"
const CHUNK_SIZE = 3000

const EF_DEFAULT = 250
const EF_MIN = 130
const EF_MAX = 300
const MASTER_DAYS = 21

const DEFAULT_SETTINGS = {
  dailyNew: 20,
  reviewCap: 150,
  order: "seq"
}

const state = {
  ready: false,
  // 进入学习页时想干什么：plan=日常计划，today=今日复习（一次性的意图，读完即清）
  session: "plan",
  settings: {
    dailyNew: DEFAULT_SETTINGS.dailyNew,
    reviewCap: DEFAULT_SETTINGS.reviewCap,
    order: DEFAULT_SETTINGS.order
  },
  progress: {},
  meta: {
    chunks: 0,
    streak: 0,
    lastDay: 0,
    days: [],
    plan: null,
    daily: null
  }
}

let loading = false
let waiters = []
let saveTimer = 0
let saving = false
let dirty = false
let lastChunks = []
let lastMetaStr = ""

// 用本地日历日计算天序号，跨时区/夏令时只影响 1 小时，四舍五入即可
function dayNumber(ts) {
  const date = new Date(ts === undefined ? Date.now() : ts)
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.round(midnight.getTime() / DAY_MS)
}

function clamp(value, min, max) {
  if (value < min) return min
  if (value > max) return max
  return value
}

function getKey(key, cb) {
  try {
    storage.get({
      key: key,
      success: function (value) {
        cb(value === undefined || value === null ? "" : String(value))
      },
      fail: function () {
        cb("")
      }
    })
  } catch (err) {
    cb("")
  }
}

function setKey(key, value, cb) {
  try {
    storage.set({
      key: key,
      value: value,
      success: function () {
        if (cb) cb(true)
      },
      fail: function () {
        if (cb) cb(false)
      }
    })
  } catch (err) {
    if (cb) cb(false)
  }
}

function applySettings(raw) {
  let parsed = {}
  try {
    parsed = JSON.parse(raw || "{}")
  } catch (err) {
    parsed = {}
  }
  const dailyNew = parseInt(parsed.dailyNew, 10)
  const reviewCap = parseInt(parsed.reviewCap, 10)
  if (dailyNew >= 5 && dailyNew <= 200) state.settings.dailyNew = dailyNew
  if (reviewCap >= 20 && reviewCap <= 1000) state.settings.reviewCap = reviewCap
  state.settings.order = parsed.order === "random" ? "random" : "seq"
}

function mergeMeta(raw) {
  const meta = {
    chunks: 0,
    streak: 0,
    lastDay: 0,
    days: [],
    plan: null,
    daily: null
  }
  if (!raw) return meta
  meta.chunks = Math.max(0, parseInt(raw.chunks, 10) || 0)
  meta.streak = Math.max(0, parseInt(raw.streak, 10) || 0)
  meta.lastDay = parseInt(raw.lastDay, 10) || 0
  meta.days = raw.days && raw.days.length ? raw.days.slice(-120) : []
  meta.plan = raw.plan || null
  meta.daily = raw.daily || null
  return meta
}

// 分片并发读（最多 4 路）：分片之间互不依赖，比串行快很多，
// 又不至于一次朝 storage 抛几十个请求
const READ_PARALLEL = 4

function readChunks(total, cb) {
  if (!(total > 0)) {
    cb("", [])
    return
  }
  const parts = new Array(total)
  let next = 0
  let active = 0
  let left = total

  function pump() {
    while (active < READ_PARALLEL && next < total) {
      const idx = next
      next += 1
      active += 1
      readOne(idx, function (i, part) {
        active -= 1
        parts[i] = part
        left -= 1
        if (left === 0) {
          cb(parts.join(""), parts)
          return
        }
        pump()
      })
    }
  }

  pump()
}

function readOne(index, cb) {
  getKey(CHUNK_PREFIX + index, function (part) {
    cb(index, part || "")
  })
}

function parseProgress(payload) {
  state.progress = {}
  if (!payload) return
  const rows = payload.split(";")
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].split(",")
    if (cells.length < 5) continue
    const id = parseInt(cells[0], 10)
    if (!(id >= 0 && id < WORDMETA.total)) continue
    state.progress[id] = {
      r: parseInt(cells[1], 10) || 0,
      i: parseInt(cells[2], 10) || 0,
      d: parseInt(cells[3], 10) || 0,
      e: parseInt(cells[4], 10) || EF_DEFAULT,
      t: parseInt(cells[5], 10) || 0
    }
  }
}

function serializeProgress() {
  const parts = []
  for (const key in state.progress) {
    const p = state.progress[key]
    parts.push(key + "," + p.r + "," + p.i + "," + p.d + "," + p.e + "," + p.t)
  }
  return parts.join(";")
}

function markDirty() {
  dirty = true
  if (saveTimer) return
  saveTimer = setTimeout(function () {
    saveTimer = 0
    flush()
  }, 600)
  return saveTimer
}

// 只写内容有变化的分片：一次评分通常只影响 1~2 个分片，省掉其余二十几次写
function writeChunks(list, index, cb) {
  if (index >= list.length) {
    cb(true)
    return
  }
  setKey(CHUNK_PREFIX + list[index].index, list[index].value, function (ok) {
    if (!ok) {
      cb(false)
      return
    }
    writeChunks(list, index + 1, cb)
  })
}

// 写盘途中再调 flush 时把回调排队，等这一轮（以及紧接着的补写）真正写完再统一回调，
// 这样「退出前保存完再返回」不会因为撞上正在进行的写盘而提前回调
let pendingDone = []

function settle(ok) {
  const list = pendingDone
  pendingDone = []
  for (let i = 0; i < list.length; i++) {
    try {
      list[i](ok)
    } catch (err) {}
  }
}

function flush(done) {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = 0
  }
  if (saving) {
    if (done) pendingDone.push(done)
    return
  }
  if (!dirty) {
    if (done) pendingDone.push(done)
    settle(true)
    return
  }
  saving = true
  dirty = false
  const payload = serializeProgress()
  const chunks = []
  if (!payload.length) {
    chunks.push("")
  }
  for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
    chunks.push(payload.slice(i, i + CHUNK_SIZE))
  }

  const writes = []
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i] !== lastChunks[i]) writes.push({ index: i, value: chunks[i] })
  }
  for (let i = chunks.length; i < lastChunks.length; i++) {
    if (lastChunks[i]) writes.push({ index: i, value: "" })  // 进度变短了，清掉多余分片
  }

  state.meta.chunks = chunks.length
  const metaStr = JSON.stringify(state.meta)
  const needMeta = metaStr !== lastMetaStr

  function finish(ok) {
    saving = false
    if (!ok) {
      dirty = true
      if (done) pendingDone.push(done)
      settle(false)
      return
    }
    lastChunks = chunks.slice()
    lastMetaStr = metaStr
    if (dirty) {
      // 这一轮写盘期间又有新的评分/设置改动，马上再写一轮，回调等第二轮
      if (done) pendingDone.push(done)
      flush()
      return
    }
    if (done) pendingDone.push(done)
    settle(true)
  }

  writeChunks(writes, 0, function (ok) {
    if (!ok) {
      finish(false)
      return
    }
    if (!needMeta) {
      finish(true)
      return
    }
    setKey(KEY_META, metaStr, function () {
      finish(true)
    })
  })
}

function saveMeta() {
  markDirty()
}

// 立即落盘：评分、改设置这类不可丢的操作不等 600ms 防抖，
// 分片是增量的，一次评分通常只写 1 个分片，代价很小
function saveNow() {
  dirty = true
  flush()
}

function ensureDaily() {
  const today = dayNumber()
  let daily = state.meta.daily
  if (!daily || daily.day !== today) {
    daily = { day: today, newDone: 0, reviewDone: 0, again: 0, newIds: [] }
    state.meta.daily = daily
  }
  if (!daily.newIds) daily.newIds = []
  return daily
}

// 今日新学过的单词 id 列表（用于「今日复习」）
function todayNewIds() {
  const daily = ensureDaily()
  const list = []
  for (let i = 0; i < daily.newIds.length; i++) {
    const id = daily.newIds[i]
    if (state.progress[id]) list.push(id)
  }
  return list
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = list[i]
    list[i] = list[j]
    list[j] = tmp
  }
  return list
}

// 当天计划：到期复习 + 当天新词，结果缓存到 meta.plan，避免多次进入页面时抖动
function ensurePlan(force) {
  const today = dayNumber()
  const plan = state.meta.plan
  if (!force && plan && plan.day === today) return plan

  const known = {}
  const due = []
  for (const key in state.progress) {
    known[key] = true
    if (state.progress[key].d <= today) due.push(parseInt(key, 10))
  }
  due.sort(function (a, b) {
    return state.progress[a].d - state.progress[b].d || a - b
  })
  const reviewIds = due.slice(0, state.settings.reviewCap)

  const fresh = []
  for (let i = 0; i < WORDMETA.total; i++) {
    if (!known[i]) fresh.push(i)
  }
  if (state.settings.order === "random") shuffle(fresh)
  const newIds = fresh.slice(0, state.settings.dailyNew)

  state.meta.plan = { day: today, reviewIds: reviewIds, newIds: newIds }
  markDirty()
  return state.meta.plan
}

// 生成今天要过的卡片，复习在前、新词在后
function buildQueue() {
  const plan = ensurePlan(false)
  const today = dayNumber()
  const queue = []
  for (let i = 0; i < plan.reviewIds.length; i++) {
    const id = plan.reviewIds[i]
    const p = state.progress[id]
    if (p && p.d <= today) queue.push({ id: id, isNew: false })
  }
  for (let i = 0; i < plan.newIds.length; i++) {
    const id = plan.newIds[i]
    if (!state.progress[id]) queue.push({ id: id, isNew: true })
  }
  return queue
}

// 「今日复习」队列：今天新学过的词，随机顺序
function buildTodayReviewQueue() {
  const ids = shuffle(todayNewIds().slice())
  const queue = []
  for (let i = 0; i < ids.length; i++) {
    queue.push({ id: ids[i], isNew: false, isToday: true })
  }
  return queue
}

function todayReviewCount() {
  return todayNewIds().length
}

// 「继续学习」：往今日计划里再追加 count 个新词，返回实际追加数量
function extendNewWords(count) {
  const plan = ensurePlan(false)
  const taken = {}
  for (let i = 0; i < plan.newIds.length; i++) taken[plan.newIds[i]] = true
  const pool = []
  for (let i = 0; i < WORDMETA.total; i++) {
    if (!state.progress[i] && !taken[i]) pool.push(i)
  }
  if (state.settings.order === "random") shuffle(pool)
  const add = pool.slice(0, count)
  plan.newIds = plan.newIds.concat(add)
  markDirty()
  return add.length
}

// 词库里还没学过的单词数
function remainingNewCount() {
  const plan = ensurePlan(false)
  const taken = {}
  for (let i = 0; i < plan.newIds.length; i++) taken[plan.newIds[i]] = true
  let left = 0
  for (let i = 0; i < WORDMETA.total; i++) {
    if (!state.progress[i] && !taken[i]) left += 1
  }
  return left
}

// SM-2 变体：q=0 忘记 / 1 模糊 / 2 认识
function grade(id, q) {
  const today = dayNumber()
  const isNew = !state.progress[id]
  let p = state.progress[id]
  if (!p) {
    p = { r: 0, i: 0, d: today, e: EF_DEFAULT, t: 0 }
    state.progress[id] = p
  }
  p.t = today
  p.r = p.r + 1

  if (q === 0) {
    p.r = 1
    p.i = 1
    p.e = clamp(p.e - 25, EF_MIN, EF_MAX)
    p.d = today + 1
  } else if (q === 1) {
    p.i = p.r <= 1 ? 1 : Math.max(1, Math.round(p.i * 1.2))
    p.e = clamp(p.e - 8, EF_MIN, EF_MAX)
    p.d = today + p.i
  } else {
    if (p.r <= 1) p.i = 1
    else if (p.r === 2) p.i = 3
    else p.i = Math.max(1, Math.round((p.i * p.e) / 100))
    p.e = clamp(p.e + 5, EF_MIN, EF_MAX)
    p.d = today + p.i
  }

  const daily = ensureDaily()
  if (isNew) {
    daily.newDone += 1
    if (daily.newIds.indexOf(id) < 0) daily.newIds.push(id)
  } else {
    daily.reviewDone += 1
  }
  if (q === 0) daily.again += 1

  const meta = state.meta
  if (meta.lastDay !== today) {
    meta.streak = meta.lastDay && today - meta.lastDay === 1 ? meta.streak + 1 : 1
    meta.lastDay = today
    if (meta.days.indexOf(today) < 0) meta.days.push(today)
    if (meta.days.length > 120) meta.days = meta.days.slice(-120)
  }
  saveNow()
  return p
}

function load(done) {
  if (state.ready) {
    if (done) done()
    return
  }
  if (done) waiters.push(done)
  if (loading) return
  loading = true

  // 设置、入口意图、进度元信息三个 key 互不依赖，并发读，省掉两次串行往返
  let pending = 3
  function step() {
    pending -= 1
    if (pending > 0) return
    ensureDaily()
    ensurePlan(false)
    state.ready = true
    loading = false
    const list = waiters
    waiters = []
    for (let i = 0; i < list.length; i++) {
      try {
        list[i]()
      } catch (err) {
        // 单个页面回调异常不影响其他页面
      }
    }
  }

  getKey(KEY_SETTINGS, function (settingsRaw) {
    applySettings(settingsRaw)
    step()
  })
  getKey(KEY_SESSION, function (sessionRaw) {
    state.session = sessionRaw === "today" ? "today" : "plan"
    step()
  })
  getKey(KEY_META, function (metaRaw) {
    let parsed = null
    try {
      parsed = JSON.parse(metaRaw || "{}")
    } catch (err) {
      parsed = null
    }
    state.meta = mergeMeta(parsed)
    readChunks(state.meta.chunks, function (payload, parts) {
      parseProgress(payload)
      lastChunks = parts ? parts.slice() : []
      step()
    })
  })
}

// 每个页面各自持有一份 store 实例（快应用按页面打包模块），
// 因此从别的页面回来后必须重新从本地存储读一遍，否则看到的还是旧数据。
function reload(done) {
  // 注意：这里绝对不能 flush —— 本页内存里是上一次读到的旧进度，
  // 写回去会把别的页面刚存的新进度覆盖掉（真机上表现为「退出学习页进度没记上」）。
  // 评分与设置本身都已经立即落盘，直接丢掉内存副本重新读即可。
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = 0
  }
  dirty = false
  state.ready = false
  loading = false
  waiters = []
  state.progress = {}
  load(done)
}

// 学习页入口意图：首页点「今日复习」时先写进去，学习页 init 时读出来
function setSession(mode, done) {
  state.session = mode === "today" ? "today" : "plan"
  setKey(KEY_SESSION, state.session, done)
}

function session() {
  return state.session
}

function todayDoneCount() {
  const today = dayNumber()
  let count = 0
  for (const key in state.progress) {
    if (state.progress[key].t === today) count += 1
  }
  return count
}

// 「今日复习」评分：同一天重复复习不加深掌握度，
// 只有「忘记」才把词打回重学（明天再来），「模糊 / 认识」保持原有排期
function gradeTodayReview(id, q) {
  const today = dayNumber()
  const p = state.progress[id]
  if (!p) return null
  p.t = today
  const daily = ensureDaily()
  if (q === 0) {
    p.r = 1
    p.i = 1
    p.e = clamp(p.e - 25, EF_MIN, EF_MAX)
    p.d = today + 1
    daily.again += 1
  }
  saveNow()
  return p
}

function summary() {
  const plan = ensurePlan(false)
  const today = dayNumber()
  const dueLeft = buildQueue().filter(function (card) {
    return !card.isNew
  }).length
  const newLeft = buildQueue().filter(function (card) {
    return card.isNew
  }).length
  let learned = 0
  let mastered = 0
  for (const key in state.progress) {
    learned += 1
    if (state.progress[key].i >= MASTER_DAYS) mastered += 1
  }
  const done = todayDoneCount()
  const total = done + dueLeft + newLeft
  return {
    today: today,
    dueLeft: dueLeft,
    newLeft: newLeft,
    planTotal: total,
    done: done,
    learned: learned,
    mastered: mastered,
    streak: state.meta.streak,
    studyDays: state.meta.days.length,
    daily: ensureDaily()
  }
}

function upcoming(days) {
  const today = dayNumber()
  const counts = []
  for (let i = 0; i < days; i++) counts.push(0)
  for (const key in state.progress) {
    const diff = state.progress[key].d - today
    if (diff >= 0 && diff < days) counts[diff] += 1
  }
  return counts
}

function saveSettings(patch) {
  if (patch) {
    if (patch.dailyNew) state.settings.dailyNew = patch.dailyNew
    if (patch.reviewCap) state.settings.reviewCap = patch.reviewCap
    if (patch.order) state.settings.order = patch.order
  }
  setKey(KEY_SETTINGS, JSON.stringify(state.settings))
  ensurePlan(true)
  saveNow()
}

function resetAll() {
  state.progress = {}
  state.meta.streak = 0
  state.meta.lastDay = 0
  state.meta.days = []
  state.meta.daily = null
  state.meta.plan = null
  ensureDaily()
  ensurePlan(true)
  saveNow()
}

function wordCount() {
  return WORDMETA.total
}

// 卡片上显示的读音：只取第一个，太长时再砍掉后面的英美异读，保证小屏一行放得下
function displayPhonetic(raw) {
  var s = String(raw || "").split(";")[0].trim()
  if (s.length > 22) {
    s = s.split(",")[0].trim()
  }
  return s
}

module.exports = {
  state: state,
  load: load,
  reload: reload,
  setSession: setSession,
  session: session,
  ready: function () {
    return state.ready
  },
  settings: function () {
    return state.settings
  },
  plan: function (force) {
    return ensurePlan(force)
  },
  buildQueue: buildQueue,
  buildTodayReviewQueue: buildTodayReviewQueue,
  todayReviewCount: todayReviewCount,
  extendNewWords: extendNewWords,
  remainingNewCount: remainingNewCount,
  grade: grade,
  gradeTodayReview: gradeTodayReview,
  summary: summary,
  upcoming: upcoming,
  saveSettings: saveSettings,
  resetAll: resetAll,
  displayPhonetic: displayPhonetic,
  wordCount: wordCount,
  todayDoneCount: todayDoneCount,
  flush: flush,
  dayNumber: dayNumber
}
