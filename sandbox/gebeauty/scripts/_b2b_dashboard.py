"""
B2B Dashboard Generator — GE Beauty
Reads history.json + deals/*.json + COGS table -> outputs b2b_dashboard.html

Usage (from any directory):
  python sandbox/gebeauty/scripts/_b2b_dashboard.py
"""

import sys, json
from pathlib import Path

ROOT      = Path(__file__).resolve().parent   # scripts/
DEALS_DIR = ROOT / "deals"
OUT       = ROOT.parent / "b2b_dashboard.html"

sys.path.insert(0, str(ROOT))
from box_deal_simulator import COGS, load_history, _norm_sku


def build():
    history = load_history()
    open_deals = sorted(
        [json.loads(f.read_text(encoding="utf-8-sig")) | {"_file": f.name}
         for f in DEALS_DIR.glob("*.json") if f.name != "history.json"],
        key=lambda d: d.get("name", "")
    )

    cogs_data = {
        sku: {
            "name":    p["name"],
            "cogs_es": p.get("cogs_es"),
            "cogs_sp": p.get("cogs_sp"),
            "retail":  p.get("retail"),
            "src":     p.get("src", "?"),
        }
        for sku, p in COGS.items()
    }

    sent_proposals = [d for d in history if d.get("status") == "sent"]

    data = {
        "history":       history,
        "cogs":          cogs_data,
        "openDeals":     open_deals,
        "sentProposals": sent_proposals,
    }
    data_json = json.dumps(data, ensure_ascii=False)

    html = HTML_TEMPLATE.replace("__DATA_JSON__", data_json)
    OUT.write_text(html, encoding="utf-8")
    print(f"Dashboard: {OUT}")


HTML_TEMPLATE = r"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GE Beauty — B2B Box Dashboard</title>
<style>
:root {
  --bg:       #F4F3F0;
  --surface:  #FFFFFF;
  --ink:      #1C1917;
  --muted:    #877E77;
  --line:     #E6E3DD;
  --accent:   #1E4FBE;
  --acc-lo:   #EEF1FA;
  --ok:       #1F7A3E;
  --ok-lo:    #EBF5EE;
  --warn:     #B83010;
  --warn-lo:  #FAEDE9;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 14px; }

body {
  background: var(--bg);
  color: var(--ink);
  font-family: system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;
  line-height: 1.5;
  padding: 24px 32px 56px;
  min-width: 820px;
}

/* ── Header ─────────────────────────────────────────────────────────── */
.page-header {
  display: flex;
  align-items: baseline;
  gap: 18px;
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 2px solid var(--ink);
}
.page-header h1 {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 1.7rem;
  font-weight: normal;
  letter-spacing: -0.01em;
}
.page-subtitle {
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}

/* ── Filter bar ─────────────────────────────────────────────────────── */
.filter-bar {
  display: flex;
  gap: 16px;
  align-items: flex-end;
  flex-wrap: wrap;
  background: var(--surface);
  border: 1px solid var(--line);
  padding: 12px 16px;
  margin-bottom: 16px;
}
.filter-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.filter-lbl {
  font-size: 0.68rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
}
.filter-bar select {
  font-family: inherit;
  font-size: 0.82rem;
  color: var(--ink);
  background: var(--bg);
  border: 1px solid var(--line);
  padding: 4px 8px;
}
.filter-bar select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.btn-reset {
  font-family: inherit;
  font-size: 0.78rem;
  color: var(--muted);
  background: none;
  border: 1px solid var(--line);
  padding: 5px 12px;
  cursor: pointer;
}
.btn-reset:hover { color: var(--ink); border-color: var(--ink); }
.btn-reset:focus { outline: 2px solid var(--accent); outline-offset: 1px; }

/* ── Top grid ───────────────────────────────────────────────────────── */
.top-grid {
  display: grid;
  grid-template-columns: 310px 1fr;
  gap: 12px;
  margin-bottom: 12px;
}

/* ── KPI panel ──────────────────────────────────────────────────────── */
.kpi-panel {
  background: var(--surface);
  border: 1px solid var(--line);
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.kpi-row { display: flex; gap: 20px; }
.kpi-item { display: flex; flex-direction: column; gap: 2px; }
.kpi-lbl {
  font-size: 0.67rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}
.kpi-val {
  font-size: 1rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.kpi-val.large {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 2rem;
  font-weight: normal;
  letter-spacing: -0.025em;
  line-height: 1.05;
}

/* ── Chart panel ─────────────────────────────────────────────────────── */
.chart-panel {
  background: var(--surface);
  border: 1px solid var(--line);
  padding: 14px 18px 6px;
}
.chart-head {
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 10px;
}
#chart-svg {
  display: block;
  width: 100%;
  overflow: visible;
}

/* ── Tooltip ─────────────────────────────────────────────────────────── */
#tooltip {
  position: fixed;
  background: var(--ink);
  color: #fff;
  font-size: 0.73rem;
  line-height: 1.7;
  padding: 8px 12px;
  pointer-events: none;
  display: none;
  z-index: 1000;
  white-space: nowrap;
}

/* ── Month detail ─────────────────────────────────────────────────────── */
#month-detail { margin-bottom: 12px; }
.detail-panel {
  background: var(--acc-lo);
  border-left: 3px solid var(--accent);
  padding: 12px 16px;
}
.detail-panel h3 {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 0.92rem;
  font-weight: normal;
  color: var(--accent);
  margin-bottom: 10px;
}

/* ── Sections ────────────────────────────────────────────────────────── */
.section { margin-bottom: 24px; }
.section-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  cursor: pointer;
  user-select: none;
  padding: 6px 0;
  border-bottom: 1px solid var(--line);
}
.section-head:focus { outline: 2px solid var(--accent); outline-offset: 2px; }
.section-head h2 {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 1.05rem;
  font-weight: normal;
}
.section-arrow {
  font-size: 0.6rem;
  color: var(--muted);
  transition: transform 0.14s ease;
  display: inline-block;
}
.section-arrow.open { transform: rotate(90deg); }
.section-body { display: none; }
.section-body.open { display: block; }

/* ── Tables ──────────────────────────────────────────────────────────── */
.tbl-wrap { overflow-x: auto; margin-bottom: 14px; }
.tbl-caption {
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 6px;
}
table {
  border-collapse: collapse;
  font-size: 0.79rem;
  width: auto;
  min-width: 100%;
  font-variant-numeric: tabular-nums;
  background: var(--surface);
}
thead th {
  background: var(--bg);
  color: var(--muted);
  font-size: 0.67rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: normal;
  padding: 6px 10px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
  text-align: left;
}
tbody td {
  padding: 5px 10px;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
  white-space: nowrap;
}
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover td { background: var(--bg); }

td.r, th.r { text-align: right; }
td.c, th.c { text-align: center; }
td.ok   { color: var(--ok); }
td.warn { color: var(--warn); }
td.muted { color: var(--muted); font-style: italic; }

/* flag chips */
.chip {
  display: inline-block;
  font-size: 0.63rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 1px 6px;
  border: 1px solid currentColor;
}
.chip.ok   { color: var(--ok);   background: var(--ok-lo); }
.chip.warn { color: var(--warn); background: var(--warn-lo); }
.chip.neu  { color: var(--muted); }

/* deal blocks */
.deal-block { margin-bottom: 22px; }
.deal-block h3 {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 0.95rem;
  font-weight: normal;
  margin-bottom: 4px;
}
.deal-meta {
  font-size: 0.7rem;
  color: var(--muted);
  letter-spacing: 0.04em;
  margin-bottom: 8px;
}

.empty-msg {
  font-size: 0.82rem;
  color: var(--muted);
  padding: 8px 0;
}

@media (prefers-reduced-motion: reduce) {
  .section-arrow { transition: none; }
}
</style>
</head>
<body>

<header class="page-header">
  <h1>GE Beauty — B2B Box</h1>
  <span class="page-subtitle">Ledger &amp; Negociação</span>
</header>

<div class="filter-bar">
  <div class="filter-group">
    <span class="filter-lbl">Cliente</span>
    <select id="f-op" multiple size="3" style="min-width:120px" title="Ctrl + clique para múltiplos"></select>
  </div>
  <div class="filter-group">
    <span class="filter-lbl">Período</span>
    <select id="f-per">
      <option value="3">Últimos 3 meses</option>
      <option value="6">Últimos 6 meses</option>
      <option value="12" selected>Últimos 12 meses</option>
      <option value="24">Últimos 24 meses</option>
      <option value="0">Todo período</option>
    </select>
  </div>
  <div class="filter-group">
    <span class="filter-lbl">SKU</span>
    <select id="f-sku" multiple size="3" style="min-width:220px" title="Ctrl + clique para múltiplos"></select>
  </div>
  <div class="filter-group" style="justify-content:flex-end">
    <button class="btn-reset" id="btn-reset">Limpar filtros</button>
  </div>
</div>

<div class="top-grid">
  <div class="kpi-panel">
    <div>
      <div class="kpi-lbl">Receita total</div>
      <div class="kpi-val large" id="k-rev">—</div>
    </div>
    <div class="kpi-row">
      <div class="kpi-item">
        <span class="kpi-lbl">Pedidos</span>
        <span class="kpi-val" id="k-ord">—</span>
      </div>
      <div class="kpi-item">
        <span class="kpi-lbl">Margem gerada</span>
        <span class="kpi-val" id="k-mar">—</span>
      </div>
    </div>
    <div class="kpi-row">
      <div class="kpi-item">
        <span class="kpi-lbl">SKUs distintos</span>
        <span class="kpi-val" id="k-sku">—</span>
      </div>
      <div class="kpi-item">
        <span class="kpi-lbl">Volume</span>
        <span class="kpi-val" id="k-vol">—</span>
      </div>
      <div class="kpi-item">
        <span class="kpi-lbl">Desc. médio</span>
        <span class="kpi-val" id="k-disc">—</span>
      </div>
    </div>
  </div>

  <div class="chart-panel">
    <div class="chart-head">Receita por mês — clique na barra para ver o detalhe</div>
    <svg id="chart-svg" height="188" xmlns="http://www.w3.org/2000/svg"></svg>
  </div>
</div>

<div id="month-detail"></div>
<div id="tooltip"></div>

<div class="section">
  <div class="section-head" tabindex="0" data-target="ledger-body" role="button" aria-expanded="true">
    <h2>Ledger histórico</h2>
    <span class="section-arrow open" aria-hidden="true">&#9654;</span>
  </div>
  <div class="section-body open" id="ledger-body"></div>
</div>

<div class="section">
  <div class="section-head" tabindex="0" data-target="proposals-body" role="button" aria-expanded="true">
    <h2>Propostas em aberto</h2>
    <span class="section-arrow open" aria-hidden="true">&#9654;</span>
  </div>
  <div class="section-body open" id="proposals-body"></div>
</div>

<div class="section">
  <div class="section-head" tabindex="0" data-target="sent-body" role="button" aria-expanded="true">
    <h2>Propostas enviadas</h2>
    <span class="section-arrow open" aria-hidden="true">&#9654;</span>
  </div>
  <div class="section-body open" id="sent-body"></div>
</div>

<div class="section">
  <div class="section-head" tabindex="0" data-target="cogs-body" role="button" aria-expanded="false">
    <h2>COGS &amp; cobertura</h2>
    <span class="section-arrow" aria-hidden="true">&#9654;</span>
  </div>
  <div class="section-body" id="cogs-body"></div>
</div>

<script>
const DATA = __DATA_JSON__;

// ── Formatters ────────────────────────────────────────────────────────
const BRL_FMT = new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL', minimumFractionDigits:2});
const NUM_FMT = new Intl.NumberFormat('pt-BR');
const brl = v => v == null ? '—' : BRL_FMT.format(v);
const num = v => v == null ? '—' : NUM_FMT.format(v);
const pct = v => v == null ? '—' : v.toFixed(1) + '%';
const norm = s => s.toUpperCase().replace(/[\s\-]/g, '');

// ── State ─────────────────────────────────────────────────────────────
const S = { ops: new Set(), skus: new Set(), period: 12, month: null };

// ── Filtering ─────────────────────────────────────────────────────────
function filterDeals() {
  const cutoff = S.period > 0
    ? new Date(Date.now() - S.period * 30.44 * 86400e3)
    : null;
  return DATA.history
    .filter(d =>
      d.status === 'completed' &&
      (!cutoff || new Date(d.date) >= cutoff) &&
      (S.ops.size === 0 || S.ops.has(d.operator))
    )
    .map(d => ({
      ...d,
      lines: d.lines.filter(l => S.skus.size === 0 || S.skus.has(norm(l.sku)))
    }))
    .filter(d => d.lines.length > 0);
}

// ── Metrics ───────────────────────────────────────────────────────────
function computeKpis(deals) {
  let revenue = 0, margin = 0, volume = 0, wDisc = 0, wRev = 0;
  const ss = new Set();
  for (const d of deals) {
    for (const l of d.lines) {
      const sku = norm(l.sku), c = DATA.cogs[sku];
      const cogs   = c ? (c.cogs_es ?? 0) : 0;
      const retail = l.retail_at_time ?? (c ? c.retail : 0) ?? 0;
      const lr = l.price * l.volume;
      revenue += lr;
      margin  += (l.price - cogs) * l.volume;
      volume  += l.volume;
      ss.add(sku);
      if (retail > 0) { wDisc += (retail - l.price) / retail * 100 * lr; wRev += lr; }
    }
  }
  return { revenue, margin, volume, orders: deals.length, skuCount: ss.size, avgDisc: wRev > 0 ? wDisc / wRev : null };
}

function groupByMonth(deals) {
  const m = new Map();
  for (const d of deals) {
    const k = d.date.slice(0, 7);
    if (!m.has(k)) m.set(k, { key: k, revenue: 0, volume: 0, orders: 0, deals: [] });
    const mo = m.get(k);
    mo.orders++;
    mo.deals.push(d);
    for (const l of d.lines) { mo.revenue += l.price * l.volume; mo.volume += l.volume; }
  }
  return [...m.entries()].sort(([a],[b]) => a < b ? -1 : 1).map(([,v]) => v);
}

// ── KPIs ──────────────────────────────────────────────────────────────
function renderKpis(deals) {
  const k = computeKpis(deals);
  document.getElementById('k-rev').textContent  = brl(k.revenue);
  document.getElementById('k-ord').textContent  = k.orders;
  document.getElementById('k-mar').textContent  = brl(k.margin);
  document.getElementById('k-sku').textContent  = k.skuCount;
  document.getElementById('k-vol').textContent  = num(k.volume) + ' un';
  document.getElementById('k-disc').textContent = pct(k.avgDisc);
}

// ── Bar chart ─────────────────────────────────────────────────────────
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function renderChart(months) {
  const svg = document.getElementById('chart-svg');
  svg.innerHTML = '';

  const VW = 600, VH = 188, PL = 8, PR = 8, PT = 8, PB = 30;
  const cW = VW - PL - PR, cH = VH - PT - PB;
  svg.setAttribute('viewBox', '0 0 ' + VW + ' ' + VH);

  // Horizontal grid lines
  for (const frac of [0.25, 0.5, 0.75, 1.0]) {
    const y = PT + cH * (1 - frac);
    svg.appendChild(svgEl('line', { x1: PL, y1: y, x2: VW - PR, y2: y, stroke: '#E6E3DD', 'stroke-width': '1' }));
  }

  if (!months.length) {
    const t = svgEl('text', { x: VW / 2, y: VH / 2, 'text-anchor': 'middle', 'font-size': '12', fill: '#877E77', 'font-family': 'system-ui, sans-serif' });
    t.textContent = 'Sem dados no período selecionado';
    svg.appendChild(t);
    return;
  }

  const maxRev = Math.max(...months.map(m => m.revenue));
  const slotW  = cW / months.length;
  const barW   = Math.max(slotW * 0.62, 14);

  months.forEach((m, i) => {
    const barH   = maxRev > 0 ? (m.revenue / maxRev) * cH : 4;
    const x      = PL + i * slotW + (slotW - barW) / 2;
    const y      = PT + cH - barH;
    const active = S.month === m.key;

    const rect = svgEl('rect', {
      x, y, width: barW, height: barH,
      fill: active ? '#1E4FBE' : '#8A9EC6',
      cursor: 'pointer',
    });
    rect.addEventListener('mouseover', e => showTip(e, m));
    rect.addEventListener('mousemove', moveTip);
    rect.addEventListener('mouseout',  hideTip);
    rect.addEventListener('click',     () => toggleDetail(m));
    svg.appendChild(rect);

    // Revenue label above bar
    if (barH > 20) {
      const lv = svgEl('text', {
        x: x + barW / 2, y: y - 4,
        'text-anchor': 'middle', 'font-size': '9',
        fill: active ? '#1E4FBE' : '#1C1917',
        'font-family': 'system-ui, sans-serif',
      });
      lv.textContent = 'R$' + (m.revenue / 1000).toFixed(0) + 'k';
      svg.appendChild(lv);
    }

    // Month label below
    const parts = m.key.split('-');
    const lbl = svgEl('text', {
      x: x + barW / 2, y: VH - PB + 18,
      'text-anchor': 'middle', 'font-size': '10',
      fill: active ? '#1E4FBE' : '#877E77',
      'font-family': 'system-ui, sans-serif',
    });
    lbl.textContent = parts[1] + '/' + parts[0].slice(2);
    svg.appendChild(lbl);
  });
}

// ── Tooltip ───────────────────────────────────────────────────────────
function showTip(e, m) {
  const t = document.getElementById('tooltip');
  t.innerHTML = '<strong>' + m.key + '</strong><br>Receita: ' + brl(m.revenue) + '<br>Volume: ' + num(m.volume) + ' un<br>Pedidos: ' + m.orders;
  t.style.display = 'block';
  moveTip(e);
}
function moveTip(e) {
  const t = document.getElementById('tooltip');
  t.style.left = (e.clientX + 14) + 'px';
  t.style.top  = (e.clientY + 12) + 'px';
}
function hideTip() { document.getElementById('tooltip').style.display = 'none'; }

// ── Month detail ───────────────────────────────────────────────────────
function toggleDetail(m) {
  const div = document.getElementById('month-detail');
  if (S.month === m.key) {
    S.month = null;
    div.innerHTML = '';
  } else {
    S.month = m.key;
    let rows = '';
    for (const d of m.deals) {
      for (const l of d.lines) {
        const sku = norm(l.sku), name = DATA.cogs[sku] ? DATA.cogs[sku].name : sku;
        rows += '<tr>' +
          '<td>' + d.operator + '</td>' +
          '<td>' + sku + '</td>' +
          '<td>' + name + '</td>' +
          '<td class="r">' + num(l.volume) + '</td>' +
          '<td class="r">' + brl(l.price) + '</td>' +
          '<td class="r">' + brl(l.price * l.volume) + '</td>' +
          '</tr>';
      }
    }
    div.innerHTML = '<div class="detail-panel">' +
      '<h3>' + m.key + ' — detalhe</h3>' +
      '<div class="tbl-wrap"><table>' +
      '<thead><tr><th>Operador</th><th>SKU</th><th>Produto</th>' +
      '<th class="r">Volume</th><th class="r">Preço unit.</th><th class="r">Total</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table></div></div>';
  }
  const f = filterDeals();
  renderChart(groupByMonth(f));
}

// ── History index for proposal flag lookup ────────────────────────────
function buildHistIdx() {
  const idx = {};
  for (const d of DATA.history) {
    for (const l of d.lines) {
      const sku = norm(l.sku), retail = l.retail_at_time ?? 0;
      const disc = retail > 0 ? (retail - l.price) / retail * 100 : null;
      (idx[sku] = idx[sku] || []).push({ op: d.operator, date: d.date.slice(0,7), disc });
    }
  }
  return idx;
}

// ── Ledger ────────────────────────────────────────────────────────────
function renderLedger(deals) {
  const el = document.getElementById('ledger-body');
  if (!deals.length) {
    el.innerHTML = '<p class="empty-msg">Sem deals no período selecionado.</p>';
    return;
  }

  const bySku = {}, rows = [];
  for (const d of deals) {
    for (const l of d.lines) {
      const sku = norm(l.sku), c = DATA.cogs[sku];
      const retail = l.retail_at_time ?? 0;
      const disc   = retail > 0 ? (retail - l.price) / retail * 100 : null;
      const gm     = (c && c.cogs_es != null) ? (l.price - c.cogs_es) / l.price * 100 : null;
      rows.push([sku, c ? c.name : '?', d.operator, d.date.slice(0,7),
                 num(l.volume), brl(l.price), brl(retail || null), disc, gm]);
      if (disc != null) (bySku[sku] = bySku[sku] || []).push(disc);
    }
  }
  rows.sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[3] < b[3] ? -1 : 1);

  let sumRows = '';
  for (const sku of Object.keys(bySku).sort()) {
    const ds = bySku[sku];
    sumRows += '<tr>' +
      '<td>' + sku + '</td>' +
      '<td>' + (DATA.cogs[sku] ? DATA.cogs[sku].name : '?') + '</td>' +
      '<td class="r">' + ds.length + '</td>' +
      '<td class="r">' + Math.min(...ds).toFixed(1) + '%</td>' +
      '<td class="r">' + Math.max(...ds).toFixed(1) + '%</td>' +
      '</tr>';
  }

  let detRows = '';
  for (const [sku, name, op, dt, vol, preco, retail, disc, gm] of rows) {
    const discCls = (disc != null && disc > 85) ? 'warn' : '';
    const gmCls   = gm != null ? (gm < 10 ? 'warn' : gm > 25 ? 'ok' : '') : '';
    detRows += '<tr>' +
      '<td>' + sku + '</td><td>' + name + '</td><td>' + op + '</td><td>' + dt + '</td>' +
      '<td class="r">' + vol + '</td>' +
      '<td class="r">' + preco + '</td>' +
      '<td class="r">' + retail + '</td>' +
      '<td class="r ' + discCls + '">' + pct(disc) + '</td>' +
      '<td class="r ' + gmCls + '">' + pct(gm) + '</td>' +
      '</tr>';
  }

  el.innerHTML =
    '<div class="tbl-caption">Range por SKU</div>' +
    '<div class="tbl-wrap"><table>' +
    '<thead><tr><th>SKU</th><th>Produto</th><th class="r">Deals</th><th class="r">Desc% min</th><th class="r">Desc% max</th></tr></thead>' +
    '<tbody>' + sumRows + '</tbody></table></div>' +
    '<div class="tbl-caption">Detalhe — deals fechados</div>' +
    '<div class="tbl-wrap"><table>' +
    '<thead><tr><th>SKU</th><th>Produto</th><th>Operador</th><th>Data</th>' +
    '<th class="r">Volume</th><th class="r">Preço</th><th class="r">Retail</th>' +
    '<th class="r">Desc%</th><th class="r">GM%</th></tr></thead>' +
    '<tbody>' + detRows + '</tbody></table></div>';
}

// ── Proposals ─────────────────────────────────────────────────────────
function renderProposals() {
  const histIdx = buildHistIdx();
  let html = '';

  for (const deal of DATA.openDeals) {
    const name = deal.name || deal._file;
    const pay  = deal.payment_days ? deal.payment_days + ' dias' : 'pagamento a definir';
    let rows = '';

    for (const l of (deal.lines || [])) {
      const sku = norm(l.sku), c = DATA.cogs[sku];
      const retail = c ? c.retail : null;
      const disc   = retail ? (retail - l.price) / retail * 100 : null;
      const gm     = (c && c.cogs_es != null) ? (l.price - c.cogs_es) / l.price * 100 : null;
      const hist   = histIdx[sku] || [];
      const histStr = hist.map(h => h.op + ' ' + h.date + ': ' + pct(h.disc)).join(' · ') || '—';

      let flagHtml = '';
      if (disc != null && hist.length) {
        const ds = hist.filter(h => h.disc != null).map(h => h.disc);
        if (ds.length) {
          const lo = Math.min(...ds), hi = Math.max(...ds);
          if (disc < lo)      flagHtml = '<span class="chip ok">+ melhor (hist. min ' + lo.toFixed(1) + '%)</span>';
          else if (disc > hi) flagHtml = '<span class="chip warn">! pior (hist. max ' + hi.toFixed(1) + '%)</span>';
          else                flagHtml = '<span class="chip neu">~ no range ' + lo.toFixed(1) + '–' + hi.toFixed(1) + '%</span>';
        }
      }

      const gmCls = gm != null ? (gm < 10 ? 'warn' : gm > 25 ? 'ok' : '') : '';
      rows += '<tr>' +
        '<td>' + sku + '</td>' +
        '<td>' + (c ? c.name : '?') + '</td>' +
        '<td class="r">' + num(l.volume) + '</td>' +
        '<td class="r">' + brl(l.price) + '</td>' +
        '<td class="r">' + brl(retail) + '</td>' +
        '<td class="r">' + pct(disc) + '</td>' +
        '<td class="r ' + gmCls + '">' + pct(gm) + '</td>' +
        '<td>' + histStr + '</td>' +
        '<td>' + flagHtml + '</td>' +
        '</tr>';
    }

    for (const l of (deal._lines_blocked_no_cogs || [])) {
      const sku = norm(l.sku), c = DATA.cogs[sku];
      rows += '<tr>' +
        '<td>' + sku + '</td>' +
        '<td class="muted">' + (c ? c.name : '?') + '</td>' +
        '<td class="r">' + num(l.volume) + '</td>' +
        '<td class="r">' + brl(l.price) + '</td>' +
        '<td colspan="5" class="muted">COGS ausente — bloqueado</td>' +
        '</tr>';
    }

    html += '<div class="deal-block">' +
      '<h3>' + name + '</h3>' +
      '<div class="deal-meta">' + pay + '</div>' +
      '<div class="tbl-wrap"><table>' +
      '<thead><tr><th>SKU</th><th>Produto</th><th class="r">Volume</th><th class="r">Preço</th>' +
      '<th class="r">Retail</th><th class="r">Desc%</th><th class="r">GM%</th>' +
      '<th>Histórico</th><th>Flag</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table></div></div>';
  }

  document.getElementById('proposals-body').innerHTML =
    html || '<p class="empty-msg">Sem propostas em aberto.</p>';
}

// ── Sent proposals ───────────────────────────────────────────────────
function renderSentProposals() {
  const el = document.getElementById('sent-body');
  if (!DATA.sentProposals || !DATA.sentProposals.length) {
    el.innerHTML = '<p class="empty-msg">Nenhuma proposta enviada registrada.</p>';
    return;
  }

  let html = '';
  for (const deal of DATA.sentProposals) {
    const dateStr = deal.date || '—';
    let rows = '';
    for (const l of (deal.lines || [])) {
      const sku = norm(l.sku), c = DATA.cogs[sku];
      const retail = l.retail_at_time ?? (c ? c.retail : null);
      const disc   = (retail && retail > 0) ? (retail - l.price) / retail * 100 : null;
      const gm     = (c && c.cogs_es != null) ? (l.price - c.cogs_es) / l.price * 100 : null;
      const gmCls  = gm != null ? (gm < 10 ? 'warn' : gm > 25 ? 'ok' : '') : '';
      const discCls = (disc != null && disc > 85) ? 'warn' : '';
      rows += '<tr>' +
        '<td>' + sku + '</td>' +
        '<td>' + (c ? c.name : '?') + '</td>' +
        '<td class="r">' + num(l.volume) + '</td>' +
        '<td class="r">' + brl(l.price) + '</td>' +
        '<td class="r">' + brl(retail) + '</td>' +
        '<td class="r ' + discCls + '">' + pct(disc) + '</td>' +
        '<td class="r ' + gmCls + '">' + pct(gm) + '</td>' +
        '</tr>';
    }
    html += '<div class="deal-block">' +
      '<h3>' + (deal.operator || '?') + ' <span class="chip neu" style="vertical-align:middle;font-size:0.6rem">enviado</span></h3>' +
      '<div class="deal-meta">' + dateStr + (deal._note ? ' &middot; ' + deal._note : '') + '</div>' +
      '<div class="tbl-wrap"><table>' +
      '<thead><tr><th>SKU</th><th>Produto</th><th class="r">Volume</th><th class="r">Preço proposto</th>' +
      '<th class="r">Retail</th><th class="r">Desc%</th><th class="r">GM%</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table></div></div>';
  }
  el.innerHTML = html;
}

// ── COGS coverage ─────────────────────────────────────────────────────
function renderCogs() {
  let rows = '';
  for (const [sku, p] of Object.entries(DATA.cogs).sort(([a],[b]) => a < b ? -1 : 1)) {
    const okEs = p.cogs_es != null;
    const okSp = p.cogs_sp != null;
    rows += '<tr>' +
      '<td>' + sku + '</td>' +
      '<td>' + p.name + '</td>' +
      '<td class="r ' + (okEs ? '' : 'muted') + '">' + (okEs ? brl(p.cogs_es) : 'N/D') + '</td>' +
      '<td class="r ' + (okSp ? '' : 'muted') + '">' + (okSp ? brl(p.cogs_sp) : 'N/D') + '</td>' +
      '<td class="r">' + brl(p.retail) + '</td>' +
      '<td>' + (p.src || '?') + '</td>' +
      '</tr>';
  }
  document.getElementById('cogs-body').innerHTML =
    '<div class="tbl-wrap"><table>' +
    '<thead><tr><th>SKU</th><th>Produto</th><th class="r">COGS ES</th><th class="r">COGS SP</th><th class="r">Retail</th><th>Fonte</th></tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table></div>';
}

// ── Full render ───────────────────────────────────────────────────────
function render() {
  const f = filterDeals();
  renderKpis(f);
  renderChart(groupByMonth(f));
  renderLedger(f);
  renderProposals();
  renderSentProposals();
  renderCogs();
}

// ── Filter init ───────────────────────────────────────────────────────
function initFilters() {
  const ops  = [...new Set(DATA.history.map(d => d.operator))].sort();
  const skus = [...new Set(DATA.history.flatMap(d => d.lines.map(l => norm(l.sku))))].sort();

  const opSel  = document.getElementById('f-op');
  const skuSel = document.getElementById('f-sku');

  ops.forEach(op => {
    const o = document.createElement('option');
    o.value = op; o.textContent = op;
    opSel.appendChild(o);
  });
  skus.forEach(s => {
    const o = document.createElement('option');
    o.value = s;
    o.textContent = s + ' — ' + (DATA.cogs[s] ? DATA.cogs[s].name : '?');
    skuSel.appendChild(o);
  });

  function resetDetail() {
    S.month = null;
    document.getElementById('month-detail').innerHTML = '';
  }

  opSel.addEventListener('change', () => {
    S.ops = new Set([...opSel.selectedOptions].map(o => o.value));
    resetDetail(); render();
  });
  skuSel.addEventListener('change', () => {
    S.skus = new Set([...skuSel.selectedOptions].map(o => o.value));
    resetDetail(); render();
  });
  document.getElementById('f-per').addEventListener('change', e => {
    S.period = parseInt(e.target.value, 10);
    resetDetail(); render();
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    S.ops = new Set(); S.skus = new Set(); S.period = 12;
    opSel.selectedIndex = -1; skuSel.selectedIndex = -1;
    document.getElementById('f-per').value = '12';
    resetDetail(); render();
  });
}

// ── Section collapse ──────────────────────────────────────────────────
document.querySelectorAll('.section-head').forEach(head => {
  function toggle() {
    const body   = document.getElementById(head.dataset.target);
    const arrow  = head.querySelector('.section-arrow');
    const isOpen = body.classList.toggle('open');
    arrow.classList.toggle('open', isOpen);
    head.setAttribute('aria-expanded', isOpen);
  }
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
});

// ── Boot ──────────────────────────────────────────────────────────────
initFilters();
render();
</script>
</body>
</html>"""


if __name__ == "__main__":
    build()
