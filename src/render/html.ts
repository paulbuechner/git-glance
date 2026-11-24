import { resolve } from 'node:path'
import { repoColorCssVars } from '../repo-palette.ts'
import type { ReportData } from '../types.ts'

const CSS_BASE = `
:root,
[data-theme="dark"] {
  color-scheme: dark;
  --bg: #05070f;
  --ink: #e8eefc;
  --muted: #93a0c0;
  --line: rgb(148 163 184 / 18%);
  --card: rgb(12 16 32 / 88%);
  --card-border: rgb(165 180 252 / 16%);
  --accent: #2dd4bf;
  --accent-dim: #0f766e;
  --workspace-fill: #e2e8f0;
  --workspace-glow: rgb(226 232 240 / 28%);
  --repo-glow: rgb(226 232 240 / 22%);
  --empty: rgb(148 163 184 / 18%);
  --empty-stroke: rgb(148 163 184 / 45%);
  --axis-stroke: rgb(148 163 184 / 35%);
  --divider: rgb(165 180 252 / 28%);
  --select-bg: rgb(8 12 28 / 70%);
  --tooltip-bg: rgb(8 12 28 / 92%);
  --code-bg: rgb(148 163 184 / 12%);
  --code-ink: #c7d2fe;
  --heading: #f1f5f9;
  --subject-row: #ecfeff;
  --clock: #818cf8;
  --gap-empty: rgb(248 113 113 / 55%);
  --gap-other: #fbbf24;
  --heatmap-low: #134e4a;
  --heatmap-high: #5eead4;
  --heatmap-ink-dark: #042f2e;
  --card-inset: rgb(255 255 255 / 4%);
  --card-shadow: rgb(0 0 0 / 28%);
  --aurora-1: rgb(45 212 191 / 22%);
  --aurora-2: rgb(129 140 248 / 28%);
  --aurora-3: rgb(56 189 248 / 18%);
  --aurora-4: rgb(167 139 250 / 16%);
  --aurora-vignette: rgb(5 7 15 / 55%);
  --heading-glow-1: rgb(45 212 191 / 35%);
  --heading-glow-2: rgb(129 140 248 / 25%);
  --type-feat: #34d399;
  --type-fix: #f87171;
  --type-refactor: #a78bfa;
  --type-perf: #fb923c;
  --type-test: #facc15;
  --type-docs: #60a5fa;
  --type-build: #22d3ee;
  --type-chore: #94a3b8;
  --type-style: #f472b6;
  --type-merge: #a8a29e;
  --type-other: #56627a;
  --added: #34d399;
  --deleted: #f87171;
  --font: "Segoe UI", "Helvetica Neue", system-ui, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
[data-theme="light"] {
  color-scheme: light;
  --bg: #f4f1ea;
  --ink: #0f172a;
  --muted: #475569;
  --line: rgb(15 23 42 / 12%);
  --card: rgb(255 255 255 / 92%);
  --card-border: rgb(15 23 42 / 10%);
  --accent: #0f766e;
  --accent-dim: #115e59;
  --workspace-fill: #334155;
  --workspace-glow: rgb(51 65 85 / 22%);
  --repo-glow: rgb(15 23 42 / 18%);
  --empty: rgb(148 163 184 / 22%);
  --empty-stroke: rgb(71 85 105 / 55%);
  --axis-stroke: rgb(100 116 139 / 45%);
  --divider: rgb(100 116 139 / 35%);
  --select-bg: rgb(255 255 255 / 90%);
  --tooltip-bg: rgb(255 255 255 / 96%);
  --code-bg: rgb(15 23 42 / 6%);
  --code-ink: #334155;
  --heading: #0f172a;
  --subject-row: #0f172a;
  --clock: #4338ca;
  --gap-empty: rgb(220 38 38 / 55%);
  --gap-other: #b45309;
  --heatmap-low: #ccfbf1;
  --heatmap-high: #0f766e;
  --heatmap-ink-dark: #f0fdfa;
  --card-inset: rgb(255 255 255 / 60%);
  --card-shadow: rgb(15 23 42 / 8%);
  --aurora-1: rgb(15 118 110 / 12%);
  --aurora-2: rgb(67 56 202 / 10%);
  --aurora-3: rgb(3 105 161 / 10%);
  --aurora-4: rgb(190 24 93 / 8%);
  --aurora-vignette: transparent;
  --heading-glow-1: transparent;
  --heading-glow-2: transparent;
  --type-feat: #059669;
  --type-fix: #dc2626;
  --type-refactor: #7c3aed;
  --type-perf: #ea580c;
  --type-test: #ca8a04;
  --type-docs: #2563eb;
  --type-build: #0891b2;
  --type-chore: #64748b;
  --type-style: #db2777;
  --type-merge: #94a3b8;
  --type-other: #cbd5e1;
  --added: #059669;
  --deleted: #dc2626;
}
* { box-sizing: border-box; }
html, body { min-height: 100%; }
body {
  margin: 0;
  font-family: var(--font);
  background: var(--bg);
  color: var(--ink);
  line-height: 1.55;
  position: relative;
  overflow-x: hidden;
}
.aurora {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 70% 50% at 15% 20%, var(--aurora-1), transparent 55%),
    radial-gradient(ellipse 60% 45% at 85% 15%, var(--aurora-2), transparent 50%),
    radial-gradient(ellipse 55% 50% at 70% 80%, var(--aurora-3), transparent 55%),
    radial-gradient(ellipse 50% 40% at 20% 85%, var(--aurora-4), transparent 50%),
    var(--bg);
  animation: aurora-drift 22s ease-in-out infinite alternate;
}
.aurora::after {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse 80% 60% at 50% 40%, transparent 30%, var(--aurora-vignette) 100%);
}
@keyframes aurora-drift {
  0% { filter: hue-rotate(0deg) saturate(1); transform: scale(1); }
  100% { filter: hue-rotate(18deg) saturate(1.15); transform: scale(1.04); }
}
.shell {
  position: relative;
  z-index: 1;
}
header {
  padding: 2.5rem 1.5rem 1.25rem;
  max-width: 1100px;
  margin: 0 auto;
  animation: rise 0.7s ease both;
}
header h1 {
  margin: 0 0 0.4rem;
  font-size: clamp(1.8rem, 3vw, 2.35rem);
  font-weight: 650;
  letter-spacing: -0.03em;
  color: var(--heading);
  text-shadow: 0 0 28px var(--heading-glow-1), 0 0 48px var(--heading-glow-2);
}
#subtitle { color: var(--muted); margin: 0; font-size: 0.95rem; }
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  margin-top: 1.15rem;
}
.controls label {
  font-size: 0.8rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.controls select,
.controls button {
  font: inherit;
  color: var(--ink);
  padding: 0.45rem 0.75rem;
  border: 1px solid var(--card-border);
  border-radius: 999px;
  background: var(--select-bg);
  backdrop-filter: blur(10px);
  outline: none;
  cursor: pointer;
}
.controls select:focus,
.controls button:focus-visible {
  border-color: rgb(45 212 191 / 55%);
  box-shadow: 0 0 0 3px rgb(45 212 191 / 18%);
}
.controls button:hover {
  border-color: rgb(45 212 191 / 40%);
}
main {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 1.5rem 3.5rem;
  display: grid;
  gap: 1.15rem;
}
.card {
  background: var(--card);
  border: 1px solid var(--card-border);
  border-radius: 18px;
  padding: 1.35rem 1.4rem;
  backdrop-filter: blur(16px);
  box-shadow:
    0 1px 0 var(--card-inset) inset,
    0 18px 50px var(--card-shadow);
  animation: rise 0.75s ease both;
}
.card:nth-child(n+2) { animation-delay: 0.05s; }
.card:nth-child(n+3) { animation-delay: 0.1s; }
.card:nth-child(n+4) { animation-delay: 0.14s; }
@keyframes rise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.card h2 {
  margin: 0 0 0.35rem;
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.card .hint {
  margin: 0 0 0.85rem;
  color: var(--muted);
  font-size: 0.82rem;
}
#summary { margin: 0 0 1rem; color: var(--ink); }
#summary strong { color: var(--accent); font-weight: 650; }
.legend, .chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  font-size: 0.78rem;
  color: var(--muted);
  margin: 0.75rem 0 0.35rem;
}
.legend + .chart-legend { margin-top: 0.35rem; }
.legend span::before, .chart-legend span::before {
  content: "";
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  margin-right: 0.35rem;
  vertical-align: -1px;
  background: var(--swatch, #64748b);
}
.legend .weekend::before {
  border-radius: 50%;
  background: var(--workspace-fill);
  box-shadow: 0 0 6px var(--workspace-glow);
}
.legend .weekend-empty::before {
  border-radius: 50%;
  background: var(--empty);
  border: 1px solid var(--empty-stroke);
  opacity: 0.7;
}
.legend .empty::before {
  background: var(--empty);
  border: 1px solid var(--empty-stroke);
}
.legend .workspace-note::before {
  background: var(--workspace-fill);
  box-shadow: 0 0 6px var(--workspace-glow);
}
.chart-legend .gap-active::before { background: var(--accent); }
.chart-legend .gap-empty::before { background: var(--gap-empty); }
.chart-legend .gap-other::before { background: var(--gap-other); }
#lanes, #calendar, #weekdays, #heatmap, #churn, #types, #sizes, #punchcard, #hotspots, #branches, #collab, #prs, #reviews, #ci, #evo-years, #authors {
  overflow-x: auto;
}
#lanes svg, #calendar svg, #evolution svg, #evo-strip svg, #heatmap svg { display: block; overflow: visible; }
.filterbar {
  position: sticky;
  top: 0;
  z-index: 25;
  max-width: 1100px;
  margin: 0 auto 1.15rem;
  padding: 0.7rem 1.5rem 0.35rem;
  background: var(--bg);
}
.filterbar::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 100vw;
  height: 1px;
  transform: translateX(-50%);
  background: var(--line);
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem 0.9rem;
  align-items: center;
}
.filters label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: var(--muted);
}
.filters select {
  font: inherit;
  font-size: 0.82rem;
  color: var(--ink);
  max-width: 260px;
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--card-border);
  border-radius: 999px;
  background: var(--select-bg);
  cursor: pointer;
}
#range-label { margin: 0; font-size: 0.8rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.evo-controls { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  color: var(--muted);
  border: 1px solid var(--card-border);
  border-radius: 999px;
  background: var(--select-bg);
  cursor: pointer;
}
.icon-btn:hover { color: var(--ink); }
.icon-btn svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.icon-btn .icon-collapse, .expanded .icon-btn .icon-expand { display: none; }
.expanded .icon-btn .icon-collapse { display: block; }
.card:not(.expanded) .expanded-only { display: none; }
/* The Activity card as a full-page graph tool. */
.card.expanded {
  position: fixed;
  inset: 0;
  z-index: 60;
  margin: 0;
  overflow: auto;
  border-radius: 0;
  animation: none;
  backdrop-filter: none;
  background: var(--bg);
}
html.graph-expanded, html.graph-expanded body { overflow: hidden; }
.card.expanded .evo-people { max-height: calc(100vh - 230px); }
.evo-body {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}
.evo-main { min-width: 0; }
.evo-people {
  display: flex;
  flex-direction: column;
  max-height: 340px;
  padding-right: 0.75rem;
  border-right: 1px solid var(--line);
}
@media (max-width: 760px) {
  .evo-body { grid-template-columns: minmax(0, 1fr); }
  .evo-people { max-height: 220px; padding-right: 0; border-right: 0; }
}
.evo-people-head { display: flex; gap: 0.4rem; align-items: center; margin-bottom: 0.4rem; }
#evo-people-search {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 0.8rem;
  color: var(--ink);
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--card-border);
  border-radius: 999px;
  background: var(--select-bg);
}
#evo-people { overflow-y: auto; }
.person {
  display: grid;
  grid-template-columns: auto 10px minmax(0, 1fr) auto;
  gap: 0.45rem;
  align-items: center;
  padding: 0.2rem 0.25rem;
  font-size: 0.8rem;
  color: var(--muted);
  border-radius: 6px;
  cursor: pointer;
}
.person:hover { background: var(--card-inset); }
.person input { margin: 0; accent-color: var(--accent); }
.person-swatch { width: 10px; height: 10px; border-radius: 2px; border: 1px solid var(--line); }
.person.on .person-swatch { border-color: transparent; }
.person-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.person.on .person-name { color: var(--ink); font-weight: 600; }
.person-value { font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.person-more { margin: 0.4rem 0 0; font-size: 0.75rem; }
button.link {
  font: inherit;
  font-size: 0.78rem;
  color: var(--accent);
  padding: 0 0.2rem;
  border: 0;
  background: none;
  cursor: pointer;
}
#evo-strip { margin-top: 0.35rem; }
#evo-strip .selection { fill: var(--accent); fill-opacity: 0.16; stroke: var(--accent); stroke-opacity: 0.7; }
#evo-strip .handle { fill: var(--accent); fill-opacity: 0.4; }
.scope {
  margin-left: 0.5rem;
  padding: 0.05rem 0.5rem;
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--muted);
  border: 1px solid var(--card-border);
  border-radius: 999px;
  vertical-align: 2px;
  white-space: nowrap;
}
#evo-summary strong, #summary strong { color: var(--ink); font-weight: 650; }
.chart-legend .evo-cum::before {
  height: 2px;
  border-radius: 1px;
  vertical-align: 3px;
  background: var(--ink);
  opacity: 0.55;
}
.chart-legend .evo-tag::before {
  width: 8px;
  height: 8px;
  border-radius: 1px;
  transform: rotate(45deg);
  background: var(--heading);
}
.card h3.sub {
  margin: 1.35rem 0 0.5rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--muted);
}
/* Grid items default to min-width: auto, so one wide chart would widen the whole page. */
main > *, .row-2 > * { min-width: 0; }
.row-2 {
  display: grid;
  gap: 1.15rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
}
.card-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: baseline;
  justify-content: space-between;
}
.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
  gap: 0.75rem;
}
.kpi {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 0.7rem 0.85rem;
  background: var(--card-inset);
}
.kpi .label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.kpi .value {
  font-size: 1.4rem;
  font-weight: 650;
  color: var(--heading);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kpi .delta { font-size: 0.75rem; color: var(--muted); min-height: 1.1em; overflow-wrap: anywhere; }
.kpi .delta.up { color: var(--accent); }
.kpi .delta.down { color: var(--gap-empty); }
.segmented {
  display: inline-flex;
  border: 1px solid var(--card-border);
  border-radius: 999px;
  overflow: hidden;
}
.segmented button {
  font: inherit;
  font-size: 0.78rem;
  color: var(--muted);
  background: transparent;
  border: 0;
  padding: 0.3rem 0.8rem;
  cursor: pointer;
}
.segmented button[aria-pressed="true"] { background: var(--code-bg); color: var(--ink); }
table.compact { font-size: 0.85rem; }
table.compact td, table.compact th { padding: 0.45rem 0.45rem; }
td.muted { color: var(--muted); }
td.nowrap { white-space: nowrap; }
.repo-chip::before {
  content: "";
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  margin-right: 0.4rem;
  background: var(--swatch);
}
.pill {
  display: inline-block;
  margin: 0 0.3rem 0.15rem 0;
  font-size: 0.7rem;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  border: 1px solid currentColor;
  white-space: nowrap;
}
.pill.ok { color: var(--accent); }
.pill.bad { color: var(--type-fix); }
.pill.wait { color: var(--gap-other); }
.pill.muted { color: var(--muted); }
.run-failures { margin: 0; padding-left: 1.1rem; font-size: 0.85rem; }
.run-failures li { margin: 0.25rem 0; }
#github-note { margin: 0.35rem 0 0; }
.stale {
  margin-left: 0.5rem;
  font-size: 0.7rem;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  color: var(--gap-other);
  border: 1px solid currentColor;
}
.meter { display: flex; align-items: center; gap: 0.5rem; min-width: 140px; }
.meter-track { flex: 1; height: 8px; border-radius: 999px; background: var(--empty); overflow: hidden; }
.meter-fill { height: 100%; border-radius: 999px; }
.meter span { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 0.8rem; min-width: 2.6em; text-align: right; }
#lanes svg rect, #lanes svg circle, #bars svg rect.bar, #stack svg rect {
  transition: opacity 0.25s ease, filter 0.25s ease;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92rem;
}
th, td {
  text-align: left;
  padding: 0.65rem 0.45rem;
  border-bottom: 1px solid var(--line);
}
th {
  color: var(--muted);
  font-weight: 600;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
tr.subject td { color: var(--subject-row); }
tr.subject td:first-child {
  color: var(--accent);
  font-weight: 650;
}
#tooltip {
  position: fixed;
  pointer-events: none;
  opacity: 0;
  background: var(--tooltip-bg);
  color: var(--ink);
  border: 1px solid var(--card-border);
  padding: 0.6rem 0.75rem;
  border-radius: 10px;
  font-size: 0.75rem;
  font-family: var(--mono);
  white-space: pre-wrap;
  max-width: 420px;
  z-index: 80;
  backdrop-filter: blur(12px);
  box-shadow: 0 12px 40px var(--card-shadow);
  transition: opacity 0.12s ease;
}
/* Lines added and deleted in tooltips, tables and labels (the Overview tiles stay neutral). */
.add { color: var(--added); }
.del { color: var(--deleted); }
.tip-row { white-space: pre-wrap; }
.tip-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 0.45rem;
  border-radius: 2px;
  vertical-align: -1px;
}
.tip-swatch.line { height: 2px; vertical-align: 3px; opacity: 0.7; }
code {
  font-family: var(--mono);
  font-size: 0.85em;
  background: var(--code-bg);
  color: var(--code-ink);
  padding: 0.12em 0.4em;
  border-radius: 5px;
}
@media (prefers-reduced-motion: reduce) {
  .aurora { animation: none; }
  header, .card { animation: none; }
  #lanes svg rect, #lanes svg circle, #bars svg rect.bar, #stack svg rect {
    transition: none;
  }
  #tooltip { transition: none; }
}
@page { margin: 12mm; }
@media print {
  .aurora, .no-export, #tooltip { display: none !important; }
  main { padding-bottom: 0; }
  .row-2 { grid-template-columns: 1fr 1fr; }
  body { background: #fff; color: #0f172a; }
  .card {
    background: #fff;
    border: 1px solid #e2e8f0;
    box-shadow: none;
    backdrop-filter: none;
    break-inside: avoid;
    animation: none;
  }
  header h1 {
    color: #0f172a;
    text-shadow: none;
  }
  .controls { display: none; }
  #summary strong, tr.subject td, tr.subject td:first-child { color: #0f766e; }
  code { background: #f1f5f9; color: #334155; }
}
`

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Cards that need `gh`; only rendered when the report carries GitHub data. */
function githubSections(): string {
  return `
      <section class="card">
        <h2>Pull requests<span class="scope"></span></h2>
        <p class="hint">Pull requests by the selected author that were opened, merged, closed or reviewed in the report window.</p>
        <div id="prs"></div>
      </section>
      <section class="card">
        <h2>Reviews given<span class="scope"></span></h2>
        <p class="hint">Reviews the selected author left on other people's pull requests in the report window.</p>
        <div id="reviews"></div>
      </section>
      <section class="card">
        <h2>CI health<span class="scope"></span></h2>
        <p class="hint">GitHub Actions runs on the selected author's commits and pull request branches. Cancelled and skipped runs do not count toward the pass rate.</p>
        <div id="ci"></div>
      </section>`
}

/** Tab icon: an eye whose pupil is a commit node on a git line, white on the accent blue. */
const FAVICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#346bf1"/>' +
  '<path d="M16 3.5v5.2M16 23.3v5.2" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>' +
  '<path d="M4.5 16c3.1-4.9 6.9-7.3 11.5-7.3s8.4 2.4 11.5 7.3c-3.1 4.9-6.9 7.3-11.5 7.3S7.6 20.9 4.5 16z" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>' +
  '<circle cx="16" cy="16" r="3.8" fill="#fff"/></svg>'

function escapeScriptJson(json: string): string {
  return json.replace(/</g, '\\u003c')
}

function buildCss(repoCount: number): string {
  const darkVars = repoColorCssVars(repoCount, 'dark')
  const lightVars = repoColorCssVars(repoCount, 'light')
  const repoTheme = `
:root,
[data-theme="dark"] {
${darkVars}
}
[data-theme="light"] {
${lightVars}
}
`
  return `${CSS_BASE}\n${repoTheme}`
}

function segmented(id: string, label: string, options: [string, string][]): string {
  const buttons = options
    .map(([mode, text]) => `<button type="button" data-mode="${mode}" aria-pressed="false">${text}</button>`)
    .join('')
  return `<div class="segmented" id="${id}" role="group" aria-label="${label}">${buttons}</div>`
}

/**
 * @param themeCss Optional CSS (the config's `theme` file) applied after the built-in
 *   styles, so it can override any token or rule.
 */
export async function renderHtml(data: ReportData, projectRoot: string, themeCss = ''): Promise<string> {
  const entry = resolve(projectRoot, 'src/html/report.ts')
  const result = await Bun.build({
    entrypoints: [entry],
    minify: true,
    target: 'browser',
  })

  if (!result.success) {
    const msg = result.logs.map((l) => String(l)).join('\n')
    throw new Error(`Failed to bundle HTML report script:\n${msg}`)
  }

  const artifact = result.outputs[0]
  if (!artifact) throw new Error('Bun.build produced no output')
  const script = await artifact.text()

  // The dashboard derives everything from `history` (whole range) and `allCommits`
  // (report window, with file lists); the server-side window aggregates stay in the markdown.
  const payload = {
    repos: data.repos,
    repoLabels: data.repoLabels,
    subjectEmails: data.subjectEmails,
    allCommits: data.allCommits,
    window: data.window,
    branches: data.branches,
    allTags: data.allTags,
    github: data.github,
    history: data.history,
  }

  const json = escapeScriptJson(JSON.stringify(payload))
  const css = buildCss(data.repos.length)
  const theme = themeCss ? `\n  <style id="theme">${themeCss.replace(/<\/style/gi, '<\\/style')}</style>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Git Glance — ${data.window.start} to ${data.window.end}</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(FAVICON)}" />
  <script>
    (function () {
      try {
        var stored = localStorage.getItem("commit-visibility-theme");
        var theme = stored === "light" || stored === "dark"
          ? stored
          : (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
        document.documentElement.setAttribute("data-theme", theme);
      } catch (e) {
        document.documentElement.setAttribute("data-theme", "dark");
      }
    })();
  </script>
  <style>${css}</style>${theme}
</head>
<body>
  <div class="aurora" aria-hidden="true"></div>
  <div class="shell">
    <header>
      <h1>Git Glance</h1>
      <p id="subtitle"></p>${
        data.githubNote
          ? `
      <p class="hint" id="github-note">${escapeHtml(data.githubNote)}</p>`
          : ''
      }
      <div class="controls no-export">
        <button type="button" id="theme-toggle" aria-pressed="false">Theme</button>
        <button type="button" id="export-png">Export PNG</button>
        <button type="button" id="export-pdf" title="Opens the print dialog; choose Save as PDF">Print / PDF</button>
      </div>
    </header>
    <div class="filterbar no-export">
      <div class="filters">
        <label>Author <select id="author"></select></label>
        ${segmented('f-range', 'Range', [
          ['day', 'Day'],
          ['week', 'Week'],
          ['month', 'Month'],
          ['90d', '90D'],
        ])}
        ${segmented('f-metric', 'Metric', [
          ['commits', 'Commits'],
          ['lines', 'Lines'],
        ])}
        <p id="range-label"></p>
      </div>
    </div>
    <main>
      <section class="card">
        <h2>Overview</h2>
        <p class="hint" id="kpi-hint"></p>
        <div id="kpis" class="kpis"></div>
      </section>
      <section class="card" id="activity-card">
        <div class="card-head">
          <h2 id="evo-title">Activity</h2>
          <div class="evo-controls no-export">
            <span class="expanded-only">${segmented('g-metric', 'Metric', [
              ['commits', 'Commits'],
              ['lines', 'Lines'],
            ])}</span>
            ${segmented('g-range', 'Graph range', [
              ['6m', '6M'],
              ['1y', '1Y'],
              ['5y', '5Y'],
              ['all', 'All'],
            ])}
            ${segmented('g-grain', 'Graph grouping', [
              ['week', 'Week'],
              ['month', 'Month'],
              ['year', 'Year'],
            ])}
            <button type="button" id="g-expand" class="icon-btn" aria-pressed="false" aria-label="Expand the graph" title="Expand the graph (Esc closes)">
              <svg class="icon-expand" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
              <svg class="icon-collapse" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>
            </button>
          </div>
        </div>
        <p class="hint" id="evo-summary"></p>
        <div class="evo-body">
          <aside class="evo-people" aria-label="People in the graph">
            <div class="evo-people-head no-export">
              <input type="search" id="evo-people-search" placeholder="Add people…" aria-label="Search people to add to the graph" />
              <button type="button" id="evo-people-clear" class="link" hidden>Clear</button>
            </div>
            <div id="evo-people"></div>
          </aside>
          <div class="evo-main">
            <div id="evolution"></div>
            <div id="evo-strip" class="no-export" title="Drag to choose the graph range; click outside the selection to reset"></div>
          </div>
        </div>
        <div class="chart-legend" id="evo-legend"></div>
        <h3 class="sub">By year</h3>
        <div id="evo-years"></div>
      </section>
      <section class="card">
        <h2>Activity calendar</h2>
        <p class="hint" id="calendar-hint"></p>
        <div id="calendar"></div>
      </section>
      <section class="card">
        <h2>Repo lanes</h2>
        <p class="hint" id="summary"></p>
        <div id="lanes"></div>
      </section>
      <section class="card">
        <div class="card-head">
          <h2 id="churn-title">Lines added and deleted</h2>
          <div class="segmented no-export" id="churn-scale" role="group" aria-label="Y axis scale">
            <button type="button" data-mode="log" aria-pressed="true">Log</button>
            <button type="button" data-mode="linear" aria-pressed="false">Linear</button>
          </div>
        </div>
        <p class="hint">Added above the line, deleted below, stacked by repo. Log scale keeps one huge period from flattening the rest; switch to linear for true proportions.</p>
        <div id="churn"></div>
      </section>
      <div class="row-2">
        <section class="card">
          <h2>Volume by weekday</h2>
          <p class="hint">Totals per weekday across the range; weekends in grey.</p>
          <div id="weekdays"></div>
        </section>
        <section class="card">
          <h2>Commit size</h2>
          <p class="hint" id="sizes-hint">Lines added + deleted per commit, merges excluded.</p>
          <div id="sizes"></div>
        </section>
      </div>
      <section class="card">
        <h2>Commit types</h2>
        <p class="hint">From Conventional Commit prefixes (feat:, fix(scope):, …). Anything else is “other”. Bar share follows the metric.</p>
        <div id="types"></div>
      </section>
      <section class="card">
        <h2>Weekday × hour</h2>
        <p class="hint">Author-date weekday and hour (local offset in the commit). Dot area follows the metric; totals on the right.</p>
        <div id="punchcard"></div>
      </section>
      <section class="card">
        <div class="card-head">
          <h2>Hotspots<span class="scope"></span></h2>
          <div class="segmented no-export" id="hotspots-mode" role="group" aria-label="Group hotspots by">
            <button type="button" data-mode="files" aria-pressed="true">Files</button>
            <button type="button" data-mode="folders" aria-pressed="false">Folders</button>
          </div>
        </div>
        <p class="hint">Most-changed paths for the selected author, ranked by the metric. File lists are only loaded for the report window.</p>
        <div id="hotspots"></div>
      </section>
      <section class="card">
        <h2>Work in flight<span class="scope"></span></h2>
        <p class="hint">Branches that moved in the report window and still hold commits not on the default branch.</p>
        <div id="branches"></div>
      </section>${data.github ? githubSections() : ''}
      <section class="card">
        <h2>Collaboration<span class="scope"></span></h2>
        <p class="hint">Share of lines changed by the selected author, per repo and on the files they touched, and who else changed those files.</p>
        <div id="collab"></div>
      </section>
      <section class="card">
        <h2>Authors × repos</h2>
        <p class="hint">Top authors and repos in the range, by the metric.</p>
        <div id="heatmap"></div>
      </section>
      <section class="card">
        <h2>Authors</h2>
        <p class="hint">Everyone with commits in the range, ranked by the metric.</p>
        <div id="authors"></div>
      </section>
    </main>
  </div>
  <div id="tooltip"></div>
  <script>window.__REPORT__ = ${json};</script>
  <script>${script}</script>
</body>
</html>
`
}
