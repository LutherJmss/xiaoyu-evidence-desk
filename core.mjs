// Pure helpers: field spec, evidence verification, response normalisation, error redaction.
// No network access here, so everything in this file is covered by offline tests.

export const MAX_CHARS = 20000;

// Field descriptions sent to Clocked Extract (same five fields as the 2026-10-27 prototype).
export const EXTRACT_FIELDS = Object.freeze({
  deadline: '报名或活动截止日期和时间',
  team_rule: '个人或团队参赛要求',
  age_requirement: '最低年龄要求',
  rewards: '奖金、奖品或额度奖励',
  required_materials: '必须提交的材料',
});

export const FIELD_LABELS = Object.freeze({
  deadline: '截止时间 Deadline',
  team_rule: '参赛形式 Team rule',
  age_requirement: '年龄要求 Age requirement',
  rewards: '奖励 Rewards',
  required_materials: '提交材料 Required materials',
});

/**
 * Decide how far a field's value can be trusted against the source text.
 *  exact-offset     : API start/end slice the source to exactly the value
 *  local-text-match : offsets missing or wrong, but the value appears verbatim (found by us, not the API)
 *  unverified       : value not found in the source at all
 *  missing          : no value returned
 */
export function verifyEvidence(text, field) {
  const val = field && typeof field.value === 'string' ? field.value.trim() : '';
  if (!val) return { start: null, end: null, quote: null, source: 'missing' };
  const { start, end } = field;
  if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= text.length
      && text.slice(start, end).trim() === val) {
    return { start, end, quote: text.slice(start, end), source: 'exact-offset' };
  }
  const idx = text.indexOf(val);
  return idx < 0
    ? { start: null, end: null, quote: null, source: 'unverified' }
    : { start: idx, end: idx + val.length, quote: val, source: 'local-text-match' };
}

/** Map a clocked-sdk@0.4.0 ExtractResponse body ({model, fields}) to UI rows. */
export function normalizeExtract(text, body, spec = EXTRACT_FIELDS) {
  const fields = body && typeof body.fields === 'object' && body.fields ? body.fields : {};
  return Object.keys(spec).map((id) => {
    const raw = fields[id];
    const f = typeof raw === 'string' ? { value: raw } : raw && typeof raw === 'object' ? raw : {};
    const value = typeof f.value === 'string' && f.value.trim() ? f.value.trim()
      : typeof f.value === 'number' ? String(f.value) : null;
    const c = f.confidence;
    const confidence = typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 1 ? c : null;
    return { id, label: FIELD_LABELS[id] ?? (spec === EXTRACT_FIELDS ? id : `${id} · ${spec[id]}`), value, confidence, evidence: verifyEvidence(text, { ...f, value }) };
  });
}

export function redactError(e) {
  const s = String(e?.message ?? 'Unknown upstream error');
  // An HTML challenge page means the request was stopped at the network edge, before the API.
  if (/<!DOCTYPE html|Just a moment/i.test(s)) {
    return 'HTTP 403：请求被网站安全验证（Cloudflare）拦在API之前，通常是当前网络或代理IP被风控。请换网络/代理节点后再试一次';
  }
  return s.replace(/clk_[A-Za-z0-9_-]+/g, '[REDACTED]').slice(0, 220);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FIELD_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;
export const MAX_FIELDS = 12;

/** Validate user-defined fields: {id: description}. Returns {fields} or {error}. */
export function parseCustomFields(input) {
  if (input === undefined || input === null) return { fields: { ...EXTRACT_FIELDS } };
  if (typeof input !== 'object' || Array.isArray(input)) return { error: '字段格式无效。' };
  const entries = Object.entries(input);
  if (entries.length < 1 || entries.length > MAX_FIELDS) return { error: `字段数量须为 1～${MAX_FIELDS} 个。` };
  const out = {};
  for (const [id, desc] of entries) {
    if (!FIELD_ID_RE.test(id)) return { error: `字段名「${String(id).slice(0, 40)}」无效：只能用小写字母、数字、下划线，且以字母开头。` };
    if (typeof desc !== 'string' || !desc.trim() || desc.length > 200) return { error: `字段「${id}」的说明须为 1～200 字。` };
    out[id] = desc.trim();
  }
  return { fields: out };
}

const prob = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : null);

/** Map a clocked-sdk@0.4.0 GroundingResponse to UI data; every quoted passage is re-checked against the source. */
export function normalizeGrounding(text, body) {
  const claims = Array.isArray(body?.claims) ? body.claims : [];
  return {
    verdict: typeof body?.verdict === 'string' ? body.verdict : null,
    grounded: prob(body?.grounded),
    claims: claims.map((c) => {
      const ev = c?.evidence && typeof c.evidence === 'object' ? c.evidence : null;
      const evidence = ev && typeof ev.quote === 'string' && ev.quote.trim()
        ? verifyEvidence(text, { value: ev.quote, start: ev.start, end: ev.end })
        : { start: null, end: null, quote: null, source: 'missing' };
      return {
        claim: typeof c?.claim === 'string' ? c.claim : '',
        verdict: typeof c?.verdict === 'string' ? c.verdict : null,
        supported: prob(c?.supported), contradicted: prob(c?.contradicted), not_stated: prob(c?.not_stated),
        evidence,
      };
    }),
  };
}
