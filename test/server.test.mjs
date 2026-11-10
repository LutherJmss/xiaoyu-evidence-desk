import test from 'node:test'; import assert from 'node:assert/strict';
import { start, _setClientFactoryForTests } from '../server.mjs';
const UUID = '00000000-0000-4000-8000-0000000000aa';
async function withServer(fn) {
  const server = start(0); await new Promise((r) => server.once('listening', r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}
const post = (u, body) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('synthetic demo is clearly labelled and makes no API call', async () => {
  _setClientFactoryForTests(async () => { throw new Error('must not be called'); });
  await withServer(async (b) => {
    const d = await (await fetch(b + '/api/demo', { method: 'POST' })).json();
    assert.equal(d.mode, 'synthetic-demo'); assert.ok(d.note.includes('没有调用')); assert.ok(d.text.includes('合成示例'));
    assert.ok(d.fields.every((f) => f.evidence.source === 'exact-offset'));
  });
});

test('without a key, real mode fails closed with 412 (no silent fallback)', async () => {
  const old = process.env.CLOCKED_API_KEY; delete process.env.CLOCKED_API_KEY;
  try { await withServer(async (b) => assert.equal((await post(b + '/api/extract', { text: '截止11月10日', idempotencyKey: UUID })).status, 412)); }
  finally { if (old) process.env.CLOCKED_API_KEY = old; }
});

test('invalid idempotency key is rejected', async () => {
  await withServer(async (b) => assert.equal((await post(b + '/api/extract', { text: 'x', idempotencyKey: 'nope' })).status, 400));
});

// The fake response is hand-written to match clocked-sdk@0.4.0 types. It is NOT a real API response.
test('adapter maps an SDK-shaped response and forwards the idempotency key', async () => {
  const text = '报名截止日期为2026年11月10日23:59。参赛者必须年满18岁。';
  const v = '2026年11月10日23:59'; const s = text.indexOf(v);
  let seen;
  _setClientFactoryForTests(async () => ({ extract: async (req, opts) => { seen = { req, opts };
    return { status: 200, attempts: 1, modelMs: 40, data: { model: 'fake-model-for-test', fields: {
      deadline: { value: v, start: s, end: s + v.length, confidence: 0.98 }, age_requirement: { value: '必须年满18岁', start: 1, end: 2 } } } }; } }));
  const old = process.env.CLOCKED_API_KEY; process.env.CLOCKED_API_KEY = 'placeholder-not-a-key';
  try {
    await withServer(async (b) => {
      const r = await post(b + '/api/extract', { text, idempotencyKey: UUID }); const d = await r.json();
      assert.equal(r.status, 200); assert.equal(d.mode, 'clocked-live'); assert.equal(d.model, 'fake-model-for-test');
      assert.equal(seen.opts.idempotencyKey, UUID); assert.equal(seen.opts.maxAttempts, 1); assert.ok(seen.req.fields.team_rule);
      const by = Object.fromEntries(d.fields.map((f) => [f.id, f]));
      assert.equal(by.deadline.evidence.source, 'exact-offset');
      assert.equal(by.age_requirement.evidence.source, 'local-text-match');
      assert.equal(by.rewards.evidence.source, 'missing');
    });
  } finally { if (old) process.env.CLOCKED_API_KEY = old; else delete process.env.CLOCKED_API_KEY; }
});

test('upstream errors return 502 with the key redacted', async () => {
  _setClientFactoryForTests(async () => ({ extract: async () => { throw new Error('401 for clk_live_SECRET123'); } }));
  const old = process.env.CLOCKED_API_KEY; process.env.CLOCKED_API_KEY = 'placeholder-not-a-key';
  try {
    await withServer(async (b) => {
      const r = await post(b + '/api/extract', { text: '测试文本', idempotencyKey: UUID }); const d = await r.json();
      assert.equal(r.status, 502); assert.ok(!JSON.stringify(d).includes('SECRET123'));
    });
  } finally { if (old) process.env.CLOCKED_API_KEY = old; else delete process.env.CLOCKED_API_KEY; }
});
