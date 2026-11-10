const $ = (id) => document.getElementById(id);
const source = $('source');
let current = null;
let pendingKey = null; // reused on retry so a timed-out request is not charged twice

const EVIDENCE_TEXT = {
  'exact-offset': 'API 精确位置',
  'local-text-match': '本地字面匹配（非API位置）',
  'unverified': '原文中找不到，未核实',
  'missing': '未返回',
};

source.addEventListener('input', () => { pendingKey = null; $('count').textContent = source.value.length; });

fetch('/api/health').then((r) => r.json()).then((h) => {
  $('health').textContent = h.liveConfigured ? `真实模式已配置 · 本次启动 ${h.liveUsed}/${h.liveLimit} 次` : '未配置 API Key · 仅可看合成示例';
}).catch(() => {});

function msg(text, err = false) { $('msg').textContent = text; $('msg').className = err ? 'msg err' : 'msg'; }

function render(data) {
  current = data;
  const live = data.mode === 'clocked-live';
  $('mode').innerHTML = '';
  const tag = document.createElement('span');
  tag.className = 'mode ' + (live ? 'live' : 'synthetic');
  tag.textContent = live ? '真实 Clocked Extract 响应' : '合成示例 · 非 API 结果';
  $('mode').append(tag);
  msg(live
    ? `HTTP ${data.status ?? '?'} · 模型 ${data.model ?? '未返回'} · 模型耗时 ${data.modelMs ?? '未知'} ms。点击字段查看原文位置。`
    : data.note);
  $('fields').replaceChildren();
  for (const f of data.fields) {
    const box = document.createElement('div');
    box.className = 'field'; box.tabIndex = 0;
    const label = document.createElement('strong'); label.textContent = f.label;
    const value = document.createElement('div'); value.className = 'value'; value.textContent = f.value ?? '未找到';
    const meta = document.createElement('small');
    const badge = document.createElement('span');
    badge.className = 'badge b-' + f.evidence.source; badge.textContent = EVIDENCE_TEXT[f.evidence.source];
    meta.append(badge, document.createTextNode('置信度：' + (f.confidence === null ? '未提供' : (f.confidence * 100).toFixed(1) + '%')));
    box.append(label, value, meta);
    const go = () => { document.querySelectorAll('.field.active').forEach((n) => n.classList.remove('active')); box.classList.add('active'); highlight(f); };
    box.addEventListener('click', go);
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    $('fields').append(box);
  }
  $('evidence').hidden = false;
  $('evidence').textContent = '点击任意字段，查看它在原文中的位置。';
  $('json').disabled = false; $('md').disabled = false;
}

function highlight(f) {
  const box = $('evidence'); box.replaceChildren();
  const e = f.evidence;
  if (e.start === null) { box.textContent = '没有可信的原文位置，这个字段不能当作已核实的引文。'; return; }
  const t = current.text;
  box.append(document.createTextNode((e.start > 80 ? '…' : '') + t.slice(Math.max(0, e.start - 80), e.start)));
  const m = document.createElement('mark'); m.textContent = t.slice(e.start, e.end); box.append(m);
  box.append(document.createTextNode(t.slice(e.end, e.end + 80) + (e.end + 80 < t.length ? '…' : '')));
  box.append(document.createTextNode(`\n\n[${EVIDENCE_TEXT[e.source]} · 字符 ${e.start}–${e.end}]`));
}

function download(name, text, type) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

$('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const text = source.value.trim();
  if (!text) return;
  if (!pendingKey) pendingKey = crypto.randomUUID();
  $('submit').disabled = true; source.disabled = true;
  msg('正在请求 Clocked API（会消耗 Credits），请稍候……');
  try {
    const r = await fetch('/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, idempotencyKey: pendingKey }) });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || 'HTTP ' + r.status);
    render(data); pendingKey = null;
  } catch (e) {
    msg('本次请求未成功：' + e.message + '\n如果是网络超时，请先不要重复点击；再次尝试会复用同一个请求标识。', true);
  } finally { $('submit').disabled = false; source.disabled = false; }
});

$('demo').addEventListener('click', async () => {
  try { const r = await fetch('/api/demo', { method: 'POST' }); const d = await r.json(); source.value = d.text; $('count').textContent = d.text.length; render(d); }
  catch (e) { msg(e.message, true); }
});

$('json').addEventListener('click', () => {
  if (!current) return;
  download('evidence-result.json', JSON.stringify({ mode: current.mode, model: current.model ?? null, status: current.status ?? null,
    exportedAt: new Date().toISOString(), fields: current.fields }, null, 2), 'application/json;charset=utf-8');
});

$('md').addEventListener('click', () => {
  if (!current) return;
  const rows = current.fields.map((f) => `### ${f.label}\n\n- 值：${f.value ?? '未找到'}\n- 证据：${EVIDENCE_TEXT[f.evidence.source]}\n- 原文片段：${f.evidence.quote ?? '不可核实'}\n- 置信度：${f.confidence === null ? '未提供' : (f.confidence * 100).toFixed(1) + '%'}\n`).join('\n');
  download('evidence-result.md', `# 小羽·可信文档核验记录\n\n模式：${current.mode === 'clocked-live' ? '真实 Clocked Extract' : '合成示例（非API结果）'}\n\n> 所有结果须人工复核；合成示例不能作为真实API证据。\n\n${rows}`, 'text/markdown;charset=utf-8');
});
