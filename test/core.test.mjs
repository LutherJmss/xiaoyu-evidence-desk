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
