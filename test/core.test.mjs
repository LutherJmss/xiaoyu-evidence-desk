import test from 'node:test'; import assert from 'node:assert/strict';
import { verifyEvidence, normalizeExtract, redactError, EXTRACT_FIELDS } from '../core.mjs';
const text = '报名截止日期为2026年11月10日23:59。参赛者必须年满18岁。';
test('correct API offsets are labelled exact-offset', () => {
  const v = '2026年11月10日23:59'; const s = text.indexOf(v);
  assert.equal(verifyEvidence(text, { value: v, start: s, end: s + v.length }).source, 'exact-offset');
});
test('wrong offsets are downgraded to local-text-match, never exact', () => {
  const v = '必须年满18岁'; const e = verifyEvidence(text, { value: v, start: 0, end: 4 });
  assert.equal(e.source, 'local-text-match'); assert.equal(text.slice(e.start, e.end), v);
});
test('values not in the source are unverified', () => {
  assert.equal(verifyEvidence(text, { value: '年满16岁', start: 0, end: 5 }).source, 'unverified');
});
test('null value stays missing, confidence outside 0..1 becomes null', () => {
  const rows = normalizeExtract(text, { fields: { deadline: { value: null }, age_requirement: { value: '必须年满18岁', confidence: 7 } } });
  assert.equal(rows.length, Object.keys(EXTRACT_FIELDS).length);
  assert.equal(rows.find((r) => r.id === 'deadline').evidence.source, 'missing');
  assert.equal(rows.find((r) => r.id === 'age_requirement').confidence, null);
});
test('API keys are redacted from error messages', () => {
  assert.ok(!redactError(new Error('bad key clk_live_abcDEF123')).includes('abcDEF123'));
});
test('Cloudflare challenge HTML is turned into a readable network message', () => {
  const m = redactError(new Error('Clocked API 403: <!DOCTYPE html><html><head><title>Just a moment...</title>'));
  assert.ok(m.includes('Cloudflare')); assert.ok(!m.includes('<html'));
});
import { parseCustomFields, normalizeGrounding } from '../core.mjs';
test('custom fields: defaults when absent, bad names rejected, limit enforced', () => {
  assert.ok(parseCustomFields(undefined).fields.deadline);
  assert.deepEqual(parseCustomFields({ fee: ' 报名费用 ' }).fields, { fee: '报名费用' });
  assert.ok(parseCustomFields({ 'Bad Name': 'x' }).error);
  assert.ok(parseCustomFields({ fee: '' }).error);
  assert.ok(parseCustomFields(Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`f${i}`, 'x']))).error);
});
test('grounding: passages are re-checked against the source', () => {
  const t = '参赛者必须年满18岁。允许个人参赛。'; const q = '允许个人参赛'; const s = t.indexOf(q);
  const g = normalizeGrounding(t, { verdict: 'grounded', grounded: 0.9, claims: [
    { claim: '可以个人参赛', verdict: 'supported', supported: 0.95, contradicted: 0.02, not_stated: 0.03, evidence: { quote: q, start: s, end: s + q.length } },
    { claim: '16岁可以参赛', verdict: 'contradicted', supported: 0.1, contradicted: 2, not_stated: 0.1, evidence: { quote: '十六岁', start: 0, end: 3 } },
  ] });
  assert.equal(g.claims[0].evidence.source, 'exact-offset');
  assert.equal(g.claims[1].evidence.source, 'unverified');
  assert.equal(g.claims[1].contradicted, 1);
});
