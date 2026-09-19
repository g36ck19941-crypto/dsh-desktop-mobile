// usage-calc.cjs — 从 DSH 会话日志计算每个聊天的真实 token 消耗与金额
// 含：调价前/后价格历史、峰谷时段、缓存命中/未命中拆分、归档过滤。
// 运行环境：系统 Node (>=22，node:zlib 内置 zstd)。stdout 输出单行 JSON。
'use strict';
const { zstdDecompressSync } = require('node:zlib');
const { readFileSync, readdirSync, existsSync, statSync } = require('node:fs');
const { join } = require('node:path');
const os = require('node:os');

// 8/17 00:00 北京时间（= UTC 8/16 16:00）起生效调价（峰谷分档）；此前为统一价
const PRICE_CUTOFF_UTC = Date.UTC(2026, 7, 16, 16, 0, 0);

// 价格历史（元 / 百万 tokens）。pre=调价前统一价；peak/off=调价后高峰/空闲。
// 来源：DeepSeek 官方公告（2026-08-17 生效）。
const PRICES = {
  'deepseek-v4-pro': {
    pre:  { input: 3.0,  cacheRead: 0.025, output: 6.0 },
    peak: { input: 9.0,  cacheRead: 0.30,  output: 27.0 },
    off:  { input: 4.5,  cacheRead: 0.15,  output: 13.5 }
  },
  'deepseek-v4-flash': {
    pre:  { input: 1.0,  cacheRead: 0.02,  output: 2.0 },
    peak: { input: 3.0,  cacheRead: 0.10,  output: 9.0 },
    off:  { input: 1.5,  cacheRead: 0.05,  output: 4.5 }
  }
};

const ZSTD_MAGIC = 4247762216;

function scanZstdFrames(buffer) {
  const frames = []; let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error('bad zstd magic at ' + offset);
    offset += 4;
    if (offset === buffer.length) return { frames };
    const descriptor = buffer.readUInt8(offset); offset += 1;
    if ((descriptor & 24) !== 0) throw new Error('reserved frame bit');
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : (1 << contentSizeFlag);
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames };
      const blockHeader = buffer.readUIntLE(offset, 3); offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error('reserved block type');
      offset += blockType === 1 ? 1 : blockSize;
      if (lastBlock) break;
    }
    if (checksum) offset += 4;
    frames.push({ start, end: offset });
  }
  return { frames };
}

function decodeEvents(file) {
  const buf = readFileSync(file);
  const { frames } = scanZstdFrames(buf);
  let text = '';
  for (const f of frames) text += zstdDecompressSync(buf.subarray(f.start, f.end)).toString('utf8');
  const out = [];
  for (const l of text.split('\n')) { if (l.trim()) { try { out.push(JSON.parse(l)); } catch {} } }
  return out;
}

// 自适应：在会话目录里找版本最高的日志文件，兼容 session.jsonl.zstd(v0) / session.vN.jsonl.zstd(v1/v2/v3/未来)
function findSessionFile(dir) {
  let best = null, bestVer = -1;
  let files = [];
  try { files = readdirSync(dir); } catch (e) {}
  for (const name of files) {
    const m = name.match(/^session(?:\.v(\d+))?\.jsonl\.zstd$/);
    if (!m) continue;
    const ver = m[1] ? parseInt(m[1], 10) : 0;   // 无版本号 = v0
    if (ver > bestVer) { bestVer = ver; best = join(dir, name); }
  }
  return best;
}

// 峰谷（仅调价后生效）：北京时间(UTC+8) 周一~周五 9:00-12:00、14:00-18:00 为高峰
function isPeak(utcMs) {
  const bj = new Date(utcMs + 8 * 3600 * 1000);
  const day = bj.getUTCDay();
  const t = bj.getUTCHours() * 60 + bj.getUTCMinutes();
  if (day >= 1 && day <= 5 && ((t >= 9 * 60 && t < 12 * 60) || (t >= 14 * 60 && t < 18 * 60))) return true;
  return false;
}

const BUCKET_KEYS = ['preIn','preCache','preOut','peakIn','peakCache','peakOut','offIn','offCache','offOut'];
function zeroBuckets() {
  const b = {}; for (const k of BUCKET_KEYS) b[k] = 0; return b;
}
function addBuckets(a, b) { for (const k of BUCKET_KEYS) a[k] += b[k]; }

function slotFor(utcMs) {
  if (utcMs < PRICE_CUTOFF_UTC) return 'pre';
  return isPeak(utcMs) ? 'peak' : 'off';
}

function costSession(events) {
  let title = null, model = null;
  const byStep = new Map(); // turn:step -> {usage, time}（对话请求，last wins）
  const auxUsages = [];     // 辅助 LLM 调用（compaction 等），独立计费
  for (const e of events) {
    if (e.type === 'session/title' && e.data && typeof e.data.title === 'string' && !title) title = e.data.title;
    if (e.type === 'request/header' && e.data && e.data.header && e.data.header.config && e.data.header.config.model && !model) {
      model = e.data.header.config.model;
    }
    let turn, step, usage, time;
    if (e.type === 'assistant/chunk' && e.data && e.data.chunk && e.data.chunk.type === 'usage') {
      turn = e.data.turn; step = e.data.step; usage = e.data.chunk.usage; time = e.time;
    } else if (e.type === 'assistant/message' && e.data && e.data.usage !== undefined) {
      turn = e.data.turn; step = e.data.step; usage = e.data.usage; time = e.time;
    } else if (e.type === 'compaction/summary' && e.data && e.data.usage) {
      auxUsages.push({ usage: e.data.usage, time: e.time });
      continue;
    } else continue;
    byStep.set(turn + ':' + step, { usage, time });
  }
  const buckets = zeroBuckets();
  const addUsage = (usage, time) => {
    const slot = slotFor(time);
    buckets[slot + 'In'] += usage.inputTokens || 0;
    buckets[slot + 'Cache'] += usage.cacheReadTokens || 0;
    buckets[slot + 'Out'] += usage.outputTokens || 0;
  };
  for (const { usage, time } of byStep.values()) addUsage(usage, time);
  for (const { usage, time } of auxUsages) addUsage(usage, time);
  const m = PRICES[model] || PRICES['deepseek-v4-pro'];
  const slotCost = (slot) => buckets[slot + 'In'] * m[slot].input / 1e6
    + buckets[slot + 'Cache'] * m[slot].cacheRead / 1e6
    + buckets[slot + 'Out'] * m[slot].output / 1e6;
  const costPre = slotCost('pre'), costPeak = slotCost('peak'), costOff = slotCost('off');
  const totalCost = costPre + costPeak + costOff;
  const totalTokens = BUCKET_KEYS.reduce((s, k) => s + buckets[k], 0);
  return { id: null, title, model: model || null, steps: byStep.size, buckets, costPre, costPeak, costOff, totalCost, totalTokens };
}

// 读 usage-prices.json（由「刷新价格」写入），用其中的当前价(peak/off)覆盖内置值；调价前价格保持内置
function applyPriceOverrides() {
  const p = join(os.homedir(), '.dsh', 'usage-prices.json');
  try {
    const o = JSON.parse(readFileSync(p, 'utf8'));
    if (o && o.models) {
      for (const [model, slots] of Object.entries(o.models)) {
        if (!PRICES[model]) continue;
        if (slots && slots.peak && typeof slots.peak.input === 'number') PRICES[model].peak = slots.peak;
        if (slots && slots.off && typeof slots.off.input === 'number') PRICES[model].off = slots.off;
      }
    }
  } catch (e) {}
}

function loadWorkspaceSets() {
  const p = join(os.homedir(), '.dsh', 'storages', 'workspace.json');
  const archived = new Set(); const active = new Set();
  try {
    const w = JSON.parse(readFileSync(p, 'utf8'));
    for (const id of (w.global && w.global.archivedSessionIds) || []) archived.add(id);
    const tables = w.tables && w.tables.workspaces;
    if (tables) for (const ws of Object.values(tables)) for (const id of (ws && ws.sessionIds) || []) active.add(id);
  } catch (e) {}
  return { archived, active };
}

function main() {
  applyPriceOverrides();
  const root = process.env.DSH_SESSIONS_ROOT || join(os.homedir(), '.dsh', 'sessions');
  const { archived, active } = loadWorkspaceSets();
  const results = [];
  let projList = []; try { projList = readdirSync(root); } catch (e) {}
  for (const proj of projList) {
    const pd = join(root, proj);
    let isDir = false; try { isDir = statSync(pd).isDirectory(); } catch (e) {}
    if (!isDir) continue;
    let sds = []; try { sds = readdirSync(pd); } catch (e) {}
    for (const sd of sds) {
      if (archived.has(sd)) continue;
      if (active.size > 0 && !active.has(sd)) continue;
      const f = findSessionFile(join(pd, sd));
      if (!f) continue;
      try { const r = costSession(decodeEvents(f)); r.id = sd; results.push(r); }
      catch (e) { results.push({ id: sd, error: String(e.message || e) }); }
    }
  }
  results.sort((a, b) => (b.totalCost || 0) - (a.totalCost || 0));
  const grand = Object.assign(zeroBuckets(), { totalCost: 0, totalTokens: 0 });
  for (const r of results) {
    if (r.error) continue;
    addBuckets(grand, r.buckets);
    grand.totalCost += r.totalCost;
    grand.totalTokens += r.totalTokens;
  }
  grand.totalCost = Math.round(grand.totalCost * 10000) / 10000;
  const out = {
    computedAt: Date.now(),
    priceCutoffUtc: PRICE_CUTOFF_UTC,
    prices: PRICES,
    sessions: results.map(r => r.error ? r : ({ ...r, totalCost: Math.round(r.totalCost * 10000) / 10000 })),
    grand
  };
  process.stdout.write(JSON.stringify(out));
}
main();
