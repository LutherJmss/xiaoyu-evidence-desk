const $ = (id) => document.getElementById(id);
const source = $('source');

const DEFAULT_FIELDS = [
  ['deadline', '报名或活动截止日期和时间'],
  ['team_rule', '个人或团队参赛要求'],
  ['age_requirement', '最低年龄要求'],
  ['rewards', '奖金、奖品或额度奖励'],
  ['required_materials', '必须提交的材料'],
];
const COLORS = ['#3dfc8a', '#5fd7f2', '#ffb547', '#c99bff', '#ff7eb6', '#9ef01a', '#7aa2ff', '#ffd166', '#4ee6c4', '#f78c6c', '#b8f2e6', '#e0aaff'];
const EV = {
  'exact-offset': ['EXACT', 'API 精确位置'],
  'local-text-match': ['LOCAL', '本地字面匹配（非API位置）'],
  'unverified': ['UNVERIFIED', '原文中找不到'],
  'missing': ['NULL', '原文中没有这一项'],
};

let extractResult = null;
const claimResults = [];
let extractKey = null; // reused on retry so a timed-out request is not charged twice
let verifyKey = null;

// ---------- trace log ----------
const ts = () => new Date().toTimeString().slice(0, 8);
function trace(msg, kind = '') {
  const line = document.createElement('div');
  const t = document.createElement('span'); t.className = 't'; t.textContent = `[${ts()}] `;
  const m = document.createElement('span'); m.className = kind; m.textContent = msg;
  line.append(t, m); $('trace').append(line); $('trace').scrollTop = 1e9;
}

// ---------- health ----------
async function health() {
  try {
    const h = await (await fetch('/api/health')).json();
    const el = $('health');
    el.className = 'status ' + (h.liveConfigured ? 'live' : 'off');
    el.textContent = h.liveConfigured ? `● LIVE · calls ${h.liveUsed}/${h.liveLimit}` : '○ OFFLINE · no API key';
    return h;
  } catch { $('health').textContent = '× backend unreachable'; }
}

// ---------- field editor ----------
function loadFields() {
  try { const s = JSON.parse(localStorage.getItem('xy.fields')); if (Array.isArray(s) && s.length) return s; } catch {}
  return DEFAULT_FIELDS.map((r) => [...r]);
}
let fieldRows = loadFields();
function saveFields() { localStorage.setItem('xy.fields', JSON.stringify(fieldRows)); }
function renderEditor() {
  const box = $('fieldEditor'); box.replaceChildren();
  fieldRows.forEach((row, i) => {
    const r = document.createElement('div'); r.className = 'frow';
    const idx = document.createElement('span'); idx.className = 'idx'; idx.textContent = `[${i + 1}]`; idx.style.color = COLORS[i % COLORS.length];
    const id = document.createElement('input'); id.value = row[0]; id.placeholder = 'field_name'; id.setAttribute('aria-label', '字段名');
    const desc = document.createElement('input'); desc.className = 'desc'; desc.value = row[1]; desc.placeholder = '告诉模型要找什么，例如：报名费用'; desc.setAttribute('aria-label', '字段说明');
    const del = document.createElement('button'); del.type = 'button'; del.className = 'ghost'; del.textContent = '×'; del.title = '删除';
    id.addEventListener('input', () => { row[0] = id.value.trim(); saveFields(); extractKey = null; });
    desc.addEventListener('input', () => { row[1] = desc.value; saveFields(); extractKey = null; });
    del.addEventListener('click', () => { if (fieldRows.length > 1) { fieldRows.splice(i, 1); saveFields(); renderEditor(); extractKey = null; } });
    r.append(idx, id, desc, del); box.append(r);
  });
  $('addField').disabled = fieldRows.length >= 12;
}
$('addField').addEventListener('click', () => { fieldRows.push(['', '']); saveFields(); renderEditor(); });
$('resetFields').addEventListener('click', () => { fieldRows = DEFAULT_FIELDS.map((r) => [...r]); saveFields(); renderEditor(); extractKey = null; });
function fieldSpec() {
  const spec = {};
  for (const [id, desc] of fieldRows) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(id)) throw new Error(`字段名「${id || '(空)'}」无效：用小写英文、数字、下划线，以字母开头`);
    if (!desc.trim()) throw new Error(`字段「${id}」缺少说明`);
    if (spec[id]) throw new Error(`字段名「${id}」重复`);
    spec[id] = desc.trim();
  }
  return spec;
}

// ---------- helpers ----------
function bar(p, width = 10) {
  if (p === null || p === undefined) return '[' + '.'.repeat(width) + ']   n/a';
  const n = Math.round(p * width);
  return '[' + '#'.repeat(n) + '.'.repeat(width - n) + ']' + ` ${(p * 100).toFixed(1).padStart(5)}%`;
}
function context(text, start, end, pad = 60) {
  const frag = document.createDocumentFragment();
  frag.append((start > pad ? '…' : '') + text.slice(Math.max(0, start - pad), start));
  const m = document.createElement('mark'); m.textContent = text.slice(start, end); frag.append(m);
  frag.append(text.slice(end, end + pad) + (end + pad < text.length ? '…' : ''));
  return frag;
}
async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (!r.ok || !data.ok) { const e = new Error(data.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return data;
}

// ---------- render extract ----------
function renderExtract(d) {
  extractResult = d;
  $('resultBlock').hidden = false;
  const live = d.mode === 'clocked-live';
  $('modeLine').replaceChildren();
  const pill = document.createElement('span'); pill.className = 'pill ' + (live ? 'live' : 'synthetic');
  pill.textContent = live ? 'LIVE · Clocked Extract' : 'SYNTHETIC · 非 API 结果';
  $('modeLine').append(pill, live ? `HTTP ${d.status ?? '?'} · model ${d.model ?? 'n/a'} · model ${d.modelMs != null ? d.modelMs.toFixed(1) : '?'} ms` : d.note);

  // annotated source: colour every verified span, skipping overlaps
  const text = d.text; const ann = $('annotated'); ann.replaceChildren();
  const spans = d.fields.map((f, i) => ({ f, i })).filter(({ f }) => f.evidence.start !== null)
    .sort((a, b) => a.f.evidence.start - b.f.evidence.start);
  let pos = 0; const placed = new Set();
  for (const { f, i } of spans) {
    const { start, end } = f.evidence;
    if (start < pos) continue;
    ann.append(text.slice(pos, start));
    const s = document.createElement('span'); s.className = 'hl'; s.id = `hl-${i}`;
    const col = COLORS[i % COLORS.length];
    s.style.background = col + '2b'; s.style.borderBottom = `2px ${f.evidence.source === 'exact-offset' ? 'solid' : 'dashed'} ${col}`;
    s.title = `[${i + 1}] ${f.id} · ${EV[f.evidence.source][1]}`;
    s.append(text.slice(start, end));
    const sup = document.createElement('sup'); sup.textContent = i + 1; sup.style.color = col; s.append(sup);
    s.addEventListener('click', () => document.getElementById(`fd-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    ann.append(s); pos = end; placed.add(i);
  }
  ann.append(text.slice(pos));

  const box = $('fields'); box.replaceChildren();
  d.fields.forEach((f, i) => {
    const col = COLORS[i % COLORS.length];
    const el = document.createElement('div'); el.className = 'field'; el.tabIndex = 0; el.id = `fd-${i}`;
    el.style.borderLeft = `3px solid ${col}`;
    const k = document.createElement('div'); k.className = 'k'; k.innerHTML = '';
    const tag = document.createElement('span'); tag.style.color = col; tag.textContent = `[${i + 1}] `;
    k.append(tag, f.label);
    const v = document.createElement('div'); v.className = 'v' + (f.value === null ? ' null' : ''); v.textContent = f.value ?? 'null — 原文中没有这一项';
    const m = document.createElement('div'); m.className = 'm';
    const b = document.createElement('span'); b.className = 'badge b-' + f.evidence.source; b.style.marginLeft = '0'; b.textContent = EV[f.evidence.source][0];
    const conf = document.createElement('span'); conf.className = 'bar';
    conf.textContent = `  ${f.value === null ? 'p(blank)' : 'conf'} ${bar(f.confidence)}` + (f.evidence.start !== null ? `  · chars ${f.evidence.start}–${f.evidence.end}` : '');
    m.append(b, conf);
    el.append(k, v, m);
    const go = () => { const h = document.getElementById(`hl-${i}`); if (h) { h.scrollIntoView({ behavior: 'smooth', block: 'center' }); h.classList.add('flash'); setTimeout(() => h.classList.remove('flash'), 900); } };
    el.addEventListener('click', go); el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    box.append(el);
  });
  $('json').disabled = false; $('md').disabled = false;
  const counts = d.fields.reduce((a, f) => (a[f.evidence.source] = (a[f.evidence.source] || 0) + 1, a), {});
  trace(`  fields: ${d.fields.length} · exact ${counts['exact-offset'] || 0} · local ${counts['local-text-match'] || 0} · unverified ${counts.unverified || 0} · null ${counts.missing || 0}`, 'ok');
}

// ---------- render claim ----------
const VERDICT = (v) => {
  const s = String(v || '').toLowerCase();
  if (/contradict|refut|false/.test(s)) return ['bad', '✗ CONTRADICTED · 与原文矛盾'];
  if (/support|ground|true|pass/.test(s) && !/unsupport|ungrounded/.test(s)) return ['ok', '✓ SUPPORTED · 原文支持'];
  if (/not_stated|unsupport|ungrounded|missing|unknown/.test(s)) return ['meh', '? NOT STATED · 原文没说'];
  return ['meh', `· ${v ?? 'n/a'}`];
};
function renderClaim(d) {
  claimResults.unshift(d);
  const g = d.grounding;
  const wrap = document.createElement('div');
  const head = document.createElement('div'); head.className = 'summary';
  head.append(`> "${d.claim}"  →  overall `);
  const [cls, label] = VERDICT(g.verdict);
  const hv = document.createElement('span'); hv.className = cls === 'ok' ? 'g' : cls === 'bad' ? 'a' : 'dim'; hv.textContent = `${g.verdict ?? 'n/a'}`;
  head.append(hv, `  · grounded ${bar(g.grounded)}  · model ${d.model ?? 'n/a'}`);
  wrap.append(head);
  for (const c of g.claims) {
    const [k, text] = VERDICT(c.verdict ?? (c.contradicted > Math.max(c.supported, c.not_stated) ? 'contradicted' : c.supported >= 0.5 ? 'supported' : 'not_stated'));
    const el = document.createElement('div'); el.className = 'claim ' + k;
    const v = document.createElement('div'); v.className = 'verdict ' + (k === 'ok' ? 'g' : k === 'bad' ? '' : 'a'); v.style.color = k === 'bad' ? 'var(--r)' : ''; v.textContent = text;
    const cl = document.createElement('div'); cl.textContent = c.claim;
    const p = document.createElement('pre'); p.className = 'probs'; p.style.margin = '6px 0';
    p.textContent = `supported    ${bar(c.supported)}\ncontradicted ${bar(c.contradicted)}\nnot_stated   ${bar(c.not_stated)}`;
    el.append(v, cl, p);
    const q = document.createElement('div'); q.className = 'quote';
    if (c.evidence.start !== null) { q.append(`${EV[c.evidence.source][0]} · `, context(d.text, c.evidence.start, c.evidence.end)); }
    else q.textContent = c.evidence.source === 'unverified' ? 'API 给出的依据在原文中找不到，不作为引文。' : '没有返回原文依据。';
    el.append(q); wrap.append(el);
  }
  $('claims').prepend(wrap);
  $('json').disabled = false; $('md').disabled = false;
}

// ---------- actions ----------
source.addEventListener('input', () => { extractKey = null; verifyKey = null; $('count').textContent = source.value.length; });
$('claim').addEventListener('input', () => { verifyKey = null; });
$('claim').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('verify').click(); });

async function guard(btn, fn) { btn.disabled = true; try { await fn(); } finally { btn.disabled = false; health(); } }
function fail(path, e) {
  trace(`  ✗ ${path} → ${e.status ?? 'ERR'}  ${e.message}`, 'err');
  if (e.status === 502 || !e.status) trace('  网络超时请勿连点；重试会复用同一个 Idempotency-Key，不会重复扣费。', 'warn');
}

$('run').addEventListener('click', () => guard($('run'), async () => {
  const text = source.value.trim();
  if (!text) return trace('  ✗ source.txt is empty', 'err');
  let spec; try { spec = fieldSpec(); } catch (e) { return trace('  ✗ ' + e.message, 'err'); }
  if (!extractKey) extractKey = crypto.randomUUID();
  trace(`$ POST /extract  fields=${Object.keys(spec).length}  chars=${text.length}  idem=${extractKey.slice(0, 8)}…`);
  try {
    const d = await post('/api/extract', { text, fields: spec, idempotencyKey: extractKey });
    trace(`  ← ${d.status} ${d.model ?? ''}  model ${d.modelMs != null ? d.modelMs.toFixed(1) : '?'}ms  rtt ${d.roundTripMs}ms  calls ${d.liveUsed}/${d.liveLimit}`, 'ok');
    renderExtract(d); extractKey = null;
  } catch (e) { fail('/extract', e); }
}));

$('verify').addEventListener('click', () => guard($('verify'), async () => {
  const text = source.value.trim(); const claim = $('claim').value.trim();
  if (!text) return trace('  ✗ source.txt is empty', 'err');
  if (!claim) return trace('  ✗ claim is empty', 'err');
  if (!verifyKey) verifyKey = crypto.randomUUID();
  trace(`$ POST /grounding  claim="${claim.slice(0, 40)}${claim.length > 40 ? '…' : ''}"  idem=${verifyKey.slice(0, 8)}…`);
  try {
    const d = await post('/api/verify', { text, claim, idempotencyKey: verifyKey });
    trace(`  ← ${d.status} ${d.model ?? ''}  verdict ${d.grounding.verdict ?? 'n/a'}  claims ${d.grounding.claims.length}  rtt ${d.roundTripMs}ms  calls ${d.liveUsed}/${d.liveLimit}`, 'ok');
    renderClaim(d); verifyKey = null;
  } catch (e) { fail('/grounding', e); }
}));

$('demo').addEventListener('click', () => guard($('demo'), async () => {
  trace('$ replay --synthetic   (fixed made-up notice · no API call · no credits)', 'warn');
  try {
    const d = await post('/api/demo');
    source.value = d.text; $('count').textContent = d.text.length;
    fieldRows = DEFAULT_FIELDS.map((r) => [...r]); saveFields(); renderEditor();
    renderExtract(d);
  } catch (e) { fail('/demo', e); }
}));

function download(name, text, type) {
  const a = document.createElement('a'); const url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
$('json').addEventListener('click', () => {
  download('evidence.json', JSON.stringify({ exportedAt: new Date().toISOString(),
    extract: extractResult && { mode: extractResult.mode, model: extractResult.model, status: extractResult.status, fields: extractResult.fields },
    claims: claimResults.map((c) => ({ mode: c.mode, model: c.model, status: c.status, claim: c.claim, grounding: c.grounding })) }, null, 2), 'application/json;charset=utf-8');
  trace('  ⇩ evidence.json', 'ok');
});
$('md').addEventListener('click', () => {
  let md = `# 小羽·可信文档核验记录\n\n导出时间：${new Date().toLocaleString()}\n\n> 结果须人工复核；SYNTHETIC 为合成示例，不是 API 结果。\n`;
  if (extractResult) {
    md += `\n## 字段提取（${extractResult.mode === 'clocked-live' ? `LIVE · ${extractResult.model ?? ''}` : 'SYNTHETIC'}）\n`;
    for (const f of extractResult.fields) md += `\n### ${f.label}\n\n- 值：${f.value ?? '原文中没有'}\n- 证据：${EV[f.evidence.source][1]}\n- 原文：${f.evidence.quote ?? '—'}\n- 置信度：${f.confidence === null ? 'n/a' : (f.confidence * 100).toFixed(1) + '%'}\n`;
  }
  for (const c of claimResults) {
    md += `\n## 说法核查：「${c.claim}」\n\n总体：${c.grounding.verdict ?? 'n/a'}\n`;
    for (const k of c.grounding.claims) md += `\n- ${k.claim} → ${k.verdict ?? 'n/a'}（supported ${k.supported ?? 'n/a'} / contradicted ${k.contradicted ?? 'n/a'} / not_stated ${k.not_stated ?? 'n/a'}）\n  - 依据：${k.evidence.quote ?? '—'}\n`;
  }
  download('evidence.md', md, 'text/markdown;charset=utf-8');
  trace('  ⇩ evidence.md', 'ok');
});

// ---------- boot ----------
renderEditor();
trace('xiaoyu evidence desk · booting', 'ok');
health().then((h) => { if (h) trace(h.liveConfigured ? `  key loaded server-side · live call cap ${h.liveLimit} per start` : '  no API key → only `replay --synthetic` works', h.liveConfigured ? 'ok' : 'warn'); });
