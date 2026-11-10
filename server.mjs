import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTRACT_FIELDS, MAX_CHARS, UUID_RE, normalizeExtract, redactError } from './core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
// Safety cap on real (credit-spending) calls per server process. Not a credit balance.
const LIVE_LIMIT = Math.max(0, Math.min(20, Number(process.env.LIVE_REQUEST_LIMIT ?? 3)));
let liveUsed = 0;
// Keep the test runner's stdout protocol clean (Node's runner can choke on non-ASCII child output).
const log = process.env.NODE_TEST_CONTEXT ? () => {} : console.log;
const logErr = process.env.NODE_TEST_CONTEXT ? () => {} : console.error;

let makeClient = async () => {
  const { Clocked } = await import('clocked-sdk');
  return new Clocked({ timeout: 120000, maxAttempts: 1 });
};
/** Test seam only: inject a fake client shaped like clocked-sdk@0.4.0. */
export function _setClientFactoryForTests(f) { makeClient = f; }

const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);

function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
}

async function readJson(req) {
  const chunks = []; let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > 25000 * 4) { const e = new Error('请求内容过长，请缩短文本后再试。'); e.code = 413; throw e; }
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const e = new Error('无效的JSON请求。'); e.code = 400; throw e; }
}

// Fixed synthetic sample for offline preview. Clearly labelled; never presented as an API result.
const SAMPLE_TEXT = '【合成示例，仅用于离线预览】校园数据创新赛报名截止时间为2026年11月20日18:00（北京时间）。个人或不超过3人的团队均可参赛。参赛者须年满18周岁。一等奖奖金3000元及获奖证书。须提交项目简介、演示视频和公开代码仓库链接。';
function syntheticBody() {
  const pick = (v) => { const s = SAMPLE_TEXT.indexOf(v); return { value: v, start: s, end: s + v.length }; };
  return { model: null, fields: {
    deadline: pick('2026年11月20日18:00（北京时间）'),
    team_rule: pick('个人或不超过3人的团队均可参赛'),
    age_requirement: pick('须年满18周岁'),
    rewards: pick('一等奖奖金3000元及获奖证书'),
    required_materials: pick('项目简介、演示视频和公开代码仓库链接'),
  } };
}

async function handler(req, res) {
  const url = new URL(req.url || '/', `http://${HOST}`);
  try {
    if (req.method === 'GET' && STATIC.has(url.pathname)) {
      const [file, type] = STATIC.get(url.pathname);
      send(res, 200, await readFile(join(here, 'public', file)), type); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      send(res, 200, { ok: true, liveConfigured: Boolean(process.env.CLOCKED_API_KEY?.trim()), liveUsed, liveLimit: LIVE_LIMIT }); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/demo') {
      send(res, 200, { ok: true, mode: 'synthetic-demo', model: null, text: SAMPLE_TEXT,
        fields: normalizeExtract(SAMPLE_TEXT, syntheticBody()), note: '合成示例回放：没有调用 Clocked API，也没有消耗 Credits。' }); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/extract') {
      const body = await readJson(req);
      const text = typeof body?.text === 'string' ? body.text.trim() : '';
      if (!text || text.length > MAX_CHARS) { send(res, 400, { ok: false, error: `请输入文本，长度不能超过${MAX_CHARS}个字符。` }); return; }
      if (typeof body.idempotencyKey !== 'string' || !UUID_RE.test(body.idempotencyKey)) {
        send(res, 400, { ok: false, error: '请求标识无效，请刷新页面后重试。' }); return;
      }
      if (!process.env.CLOCKED_API_KEY?.trim()) {
        send(res, 412, { ok: false, error: '没有读取到 CLOCKED_API_KEY（.env）。真实模式不会自动改用示例数据。' }); return;
      }
      if (liveUsed >= LIVE_LIMIT) {
        send(res, 429, { ok: false, error: `本次启动最多允许 ${LIVE_LIMIT} 次真实请求，已达上限。` }); return;
      }
      liveUsed++;
      const clocked = await makeClient();
      const result = await clocked.extract({ text, fields: { ...EXTRACT_FIELDS } },
        { idempotencyKey: body.idempotencyKey, timeout: 120000, maxAttempts: 1 });
      const data = result?.data ?? {};
      send(res, 200, { ok: true, mode: 'clocked-live', model: typeof data.model === 'string' ? data.model : null, text,
        fields: normalizeExtract(text, data), status: result?.status ?? null, modelMs: result?.modelMs ?? null }); return;
    }
    send(res, 404, { ok: false, error: '接口不存在。' });
  } catch (e) {
    logErr('请求失败：', e?.name || 'Error', redactError(e));
    send(res, Number.isInteger(e.code) ? e.code : 502, { ok: false, error: Number.isInteger(e.code) ? e.message : `提取请求失败：${redactError(e)}。暂时不要连续重试。` });
  }
}

export function start(port = PORT) {
  const server = createServer(handler);
  server.listen(port, HOST, () => {
    const p = server.address().port;
    log('小羽可信文档核验助手已启动');
    log(`本地网页：http://${HOST}:${p}`);
    log(process.env.CLOCKED_API_KEY?.trim() ? `真实模式已配置（本次启动最多 ${LIVE_LIMIT} 次请求）。API Key 只在服务端。` : '未配置 API Key：只能使用合成示例预览。');
  });
  server.on('error', (e) => { logErr('服务器启动失败：', e.message); process.exitCode = 1; });
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) start();
