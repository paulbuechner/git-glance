import * as d3 from 'd3'
import {
  activeRepos,
  appendChurn,
  authorKey,
  buildAuthors,
  churnHtml,
  churnParts,
  data,
  dayKey,
  eachPeriod,
  hideTip,
  history,
  historyEnd,
  historyForAuthor,
  historyStart,
  isSubjectEmail,
  lineCount,
  metric,
  metricName,
  metricOf,
  metricText,
  num,
  periodEndDate,
  periodOf,
  periodStartDate,
  periodTitle,
  press,
  rangeText,
  repoColor,
  repoLabel,
  showTip,
  styleAxis,
  utcDate,
  widthOf,
  wire,
} from './common.ts'
import type { AuthorSummary, Commit, DayRange, Grain, TipLine, TipPart } from './common.ts'

/**
 * Activity graph: long-term activity with its own range (6M / 1Y / 5Y / All, or dragged
 * on the strip below the chart) and its own grouping (week / month / year). The author
 * picked in the filter bar is always in it; the people list beside the chart adds others.
 * One person: bars stacked by repo. Several: bars stacked by person, one color each.
 */

type Preset = '6m' | '1y' | '5y' | 'all'

type Bucket = {
  period: string
  start: Date
  end: Date
  values: Map<number, number>
  total: number
  added: number
  deleted: number
  commits: number
  /** Running total from the start of the range to the end of this bucket. */
  cum: number
}

/** How the bars are split: by repo (one person) or by person (several). */
type Series = {
  keyOf: (c: Commit, person: number) => number
  color: (key: number) => string
  label: (key: number) => string
  opacity: (key: number) => number
  keys: number[]
  /** Noun for the aria label and the legend. */
  by: 'repo' | 'person'
}

const TOP_REPOS = 8
/** Stack key for every repo outside the top N. */
const OTHER = -1
const MARGIN = { top: 16, right: 56, bottom: 26, left: 48 }
const PEOPLE_SHOWN = 40
const short = d3.format('.3~s')

const graph = {
  preset: 'all' as Preset | null,
  grain: 'month' as Grain,
  range: { start: historyStart, end: historyEnd } as DayRange,
}
/** The filter bar's author; always first in the graph. */
let author: AuthorSummary | null = null
/** People added from the list, beyond `author`. */
let extras: AuthorSummary[] = []
let peopleQuery = ''
let strip: {
  x: d3.ScaleTime<number, number>
  brush: d3.BrushBehavior<unknown>
  g: d3.Selection<SVGGElement, unknown, null, undefined>
} | null = null

/** Everyone in the graph: the filter bar's author first, then the added people. */
function people(): AuthorSummary[] {
  if (!author) return []
  const key = authorKey(author)
  return [author, ...extras.filter((p) => authorKey(p) !== key)]
}

/** Person colors: the accent for the filter bar's author, then the categorical palette. */
function personColor(i: number): string {
  return i === 0 ? 'var(--accent)' : `var(--repo-${i % Math.max(1, data.repos.length)})`
}

function firstDay(list: AuthorSummary[]): string {
  const days = list.map((p) => historyForAuthor(p)[0]?.day).filter((d): d is string => d !== undefined)
  return days.length > 0 ? days.reduce((a, b) => (a < b ? a : b)) : historyStart
}

function presetRange(p: Preset): DayRange {
  const end = utcDate(historyEnd)
  const back = (d: Date) => dayKey(d3.utcDay.offset(d, 1))
  const start =
    p === 'all'
      ? firstDay(people())
      : back(p === '6m' ? d3.utcMonth.offset(end, -6) : d3.utcYear.offset(end, p === '1y' ? -1 : -5))
  return { start: start < historyStart ? historyStart : start, end: historyEnd }
}

function grainFor(p: Preset): Grain {
  return p === '6m' || p === '1y' ? 'week' : 'month'
}

function integerTicks(scale: d3.ScaleLinear<number, number>, count: number): number[] {
  return scale.ticks(count).filter((t) => Number.isInteger(t))
}

function inRange(c: Commit): boolean {
  return c.day >= graph.range.start && c.day <= graph.range.end
}

/** Bars by repo: the top repos get their own color, the rest share "Other repos". */
function repoSeries(commits: Commit[]): Series {
  const repoIndex = new Map(data.repos.map((r, i) => [r, i]))
  const totals = d3.rollup(
    commits,
    (v) => d3.sum(v, metricOf),
    (c) => repoIndex.get(c.repo) ?? 0,
  )
  const top = [...totals]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_REPOS)
    .map(([repo]) => repo)
  const topSet = new Set(top)
  const hasOther = [...totals].some(([repo, v]) => v > 0 && !topSet.has(repo))
  return {
    keyOf: (c) => {
      const repo = repoIndex.get(c.repo) ?? 0
      return topSet.has(repo) ? repo : OTHER
    },
    color: (k) => (k === OTHER ? 'var(--muted)' : repoColor(data.repos[k] ?? '')),
    label: (k) => (k === OTHER ? 'Other repos' : repoLabel(data.repos[k] ?? '')),
    opacity: (k) => (k === OTHER ? 0.45 : 1),
    keys: hasOther ? [...top, OTHER] : top,
    by: 'repo',
  }
}

/** Bars by person, in the order of `people()`. */
function personSeries(list: AuthorSummary[]): Series {
  return {
    keyOf: (_c, person) => person,
    color: personColor,
    label: (k) => list[k]?.name ?? '',
    opacity: () => 1,
    keys: list.map((_, i) => i),
    by: 'person',
  }
}

function bucketTip(b: Bucket, series: Series): TipLine[] {
  const title = periodTitle(b.period, graph.grain)
  if (b.commits === 0) return [{ text: `${title}: nothing` }]
  const detail: TipPart[] =
    metric === 'commits'
      ? [...churnParts(b.added, b.deleted, ' / '), { text: ' lines' }]
      : [{ text: `${num(b.commits)} commit${b.commits === 1 ? '' : 's'} · ` }, ...churnParts(b.added, b.deleted, ' / ')]
  const parts: TipLine[] = [...b.values]
    .filter(([, v]) => v > 0)
    .sort((a, c) => c[1] - a[1])
    .map(([k, v]) => ({ text: `${series.label(k)}: ${num(v)}`, color: series.color(k) }))
  return [
    { text: `${title} — ${metricText(b.total)}` },
    { text: detail },
    ...parts,
    { text: `Running total: ${num(b.cum)}`, color: 'var(--ink)', swatch: 'line' },
  ]
}

function drawSummary(commits: Commit[], list: AuthorSummary[]) {
  const el = d3.select('#evo-summary')
  const who = list.length > 1 ? `${list.length} people` : 'this author'
  if (commits.length === 0) {
    el.text(`${rangeText(graph.range)}: no commits by ${who}.`)
    return
  }
  const activeDays = new Set(commits.map((c) => c.day)).size
  const repos = new Set(commits.map((c) => c.repo)).size
  const best = d3.greatest(
    d3.rollups(
      commits,
      (v) => d3.sum(v, metricOf),
      (c) => periodOf(c.day, graph.grain),
    ),
    (e) => e[1],
  )
  const parts = [
    rangeText(graph.range),
    ...(list.length > 1 ? [`<strong>${list.length}</strong> people`] : []),
    `<strong>${num(commits.length)}</strong> commits on <strong>${num(activeDays)}</strong> days in <strong>${num(repos)}</strong> repos`,
    `${churnHtml(
      d3.sum(commits, (c) => c.added),
      d3.sum(commits, (c) => c.deleted),
    )} lines`,
  ]
  if (best) parts.push(`busiest ${graph.grain}: ${periodTitle(best[0], graph.grain)} (${metricText(best[1])})`)
  el.html(`${parts.join(' · ')}.`)
}

function drawChart(lists: Commit[][], all: Commit[], series: Series) {
  const container = d3.select<HTMLElement, unknown>('#evolution')
  container.selectAll('*').remove()
  const legend = d3.select('#evo-legend')
  legend.selectAll('*').remove()
  d3.select('#evo-title').text(`${metricName()} per ${graph.grain}`)
  if (all.length === 0) return

  const g0 = graph.grain
  const byPeriod = new Map<string, Bucket>()
  const buckets: Bucket[] = eachPeriod(graph.range.start, graph.range.end, g0).map((period) => {
    const b: Bucket = {
      period,
      start: periodStartDate(period, g0),
      end: periodEndDate(period, g0),
      values: new Map(),
      total: 0,
      added: 0,
      deleted: 0,
      commits: 0,
      cum: 0,
    }
    byPeriod.set(period, b)
    return b
  })
  lists.forEach((commits, person) => {
    for (const c of commits) {
      const b = byPeriod.get(periodOf(c.day, g0))
      if (!b) continue
      const key = series.keyOf(c, person)
      const v = metricOf(c)
      b.values.set(key, (b.values.get(key) ?? 0) + v)
      b.total += v
      b.added += c.added
      b.deleted += c.deleted
      b.commits++
    }
  })
  let cum = 0
  for (const b of buckets) {
    cum += b.total
    b.cum = cum
  }

  const width = widthOf(container.node())
  // Expanded, the chart takes the height the page leaves after the header, strip and legend.
  const height = expanded ? Math.max(320, window.innerHeight - 260) : 280
  const innerW = width - MARGIN.left - MARGIN.right
  const innerH = height - MARGIN.top - MARGIN.bottom
  const first = buckets[0]
  const last = buckets[buckets.length - 1]
  if (!first || !last) return
  const x = d3.scaleUtc().domain([first.start, last.end]).range([0, innerW])
  // People sit side by side, so the axis only has to reach the largest single person.
  const grouped = series.by === 'person'
  const peak = grouped
    ? d3.max(buckets, (b) => d3.max(series.keys, (k) => b.values.get(k) ?? 0))
    : d3.max(buckets, (b) => b.total)
  const y = d3
    .scaleLinear()
    .domain([0, Math.max(1, peak ?? 0)])
    .nice()
    .range([innerH, 0])
  const yCum = d3
    .scaleLinear()
    .domain([0, Math.max(1, cum)])
    .nice()
    .range([innerH, 0])

  const svg = container
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('role', 'img')
    .attr('aria-label', `${metricName()} per ${g0}, ${grouped ? 'one bar per person' : 'stacked by repo'}`)
  const g = svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)

  g.append('g')
    .selectAll('line')
    .data(integerTicks(y, 5))
    .join('line')
    .attr('x1', 0)
    .attr('x2', innerW)
    .attr('y1', (t) => y(t))
    .attr('y2', (t) => y(t))
    .attr('stroke', 'var(--line)')

  const gap = (b: Bucket) => {
    const w = x(b.end) - x(b.start)
    return w > 6 ? Math.min(3, w * 0.18) : 0
  }
  if (grouped) {
    // One bar per person inside each period, side by side in the people-list order.
    const n = series.keys.length
    const bars = buckets.flatMap((b) =>
      series.keys.map((k) => ({ b, k, v: b.values.get(k) ?? 0 })).filter((d) => d.v > 0),
    )
    const slot = (b: Bucket) => (x(b.end) - x(b.start) - gap(b)) / n
    g.append('g')
      .selectAll('rect')
      .data(bars)
      .join('rect')
      .attr('x', (d) => x(d.b.start) + gap(d.b) / 2 + d.k * slot(d.b))
      .attr('width', (d) => Math.max(1, slot(d.b) - (slot(d.b) > 4 ? 1 : 0)))
      .attr('y', (d) => y(d.v))
      .attr('height', (d) => Math.max(0.5, innerH - y(d.v)))
      .attr('fill', (d) => series.color(d.k))
  } else {
    const stacked = d3
      .stack<Bucket, number>()
      .keys(series.keys)
      .value((b, key) => b.values.get(key) ?? 0)(buckets)
    g.append('g')
      .selectAll('g')
      .data(stacked)
      .join('g')
      .attr('fill', (s) => series.color(s.key))
      .attr('fill-opacity', (s) => series.opacity(s.key))
      .selectAll('rect')
      .data((s) => s.filter((p) => p[1] > p[0]))
      .join('rect')
      .attr('x', (p) => x(p.data.start) + gap(p.data) / 2)
      .attr('width', (p) => Math.max(1, x(p.data.end) - x(p.data.start) - gap(p.data)))
      .attr('y', (p) => y(p[1]))
      .attr('height', (p) => Math.max(0.5, y(p[0]) - y(p[1])))
  }

  g.append('path')
    .datum([{ at: first.start, cum: 0 }, ...buckets.map((b) => ({ at: b.end, cum: b.cum }))])
    .attr(
      'd',
      d3
        .line<{ at: Date; cum: number }>()
        .x((p) => x(p.at))
        .y((p) => yCum(p.cum))
        .curve(d3.curveMonotoneX),
    )
    .attr('fill', 'none')
    .attr('stroke', 'var(--ink)')
    .attr('stroke-opacity', 0.55)
    .attr('stroke-width', 1.5)

  drawTags(g, x, innerH, activeRepos(all))

  const xAxis = g
    .append('g')
    .attr('transform', `translate(0,${innerH})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(Math.max(2, Math.floor(innerW / 90)))
        .tickSizeOuter(0),
    )
  styleAxis(xAxis)
  const yAxis = g
    .append('g')
    .call(d3.axisLeft(y).tickValues(integerTicks(y, 5)).tickFormat(short).tickSize(0).tickPadding(8))
  yAxis.select('.domain').remove()
  styleAxis(yAxis)
  const yAxisRight = g
    .append('g')
    .attr('transform', `translate(${innerW},0)`)
    .call(d3.axisRight(yCum).tickValues(integerTicks(yCum, 4)).tickFormat(short).tickSize(0).tickPadding(8))
  yAxisRight.select('.domain').remove()
  styleAxis(yAxisRight)

  const hover = g
    .append('rect')
    .attr('y', 0)
    .attr('height', innerH)
    .attr('fill', 'var(--ink)')
    .attr('fill-opacity', 0.07)
    .attr('pointer-events', 'none')
    .attr('visibility', 'hidden')
  g.append('rect')
    .attr('width', innerW)
    .attr('height', innerH)
    .attr('fill', 'transparent')
    .on('mousemove', (event: MouseEvent) => {
      const [mx] = d3.pointer(event)
      const b = byPeriod.get(periodOf(dayKey(d3.utcDay.floor(x.invert(mx))), g0))
      if (!b) return
      hover
        .attr('x', x(b.start))
        .attr('width', Math.max(1, x(b.end) - x(b.start)))
        .attr('visibility', 'visible')
      showTip(event, bucketTip(b, series))
    })
    .on('mouseleave', () => {
      hover.attr('visibility', 'hidden')
      hideTip()
    })

  for (const key of series.keys) legend.append('span').style('--swatch', series.color(key)).text(series.label(key))
  legend.append('span').attr('class', 'evo-cum').text('Running total (right axis)')
  legend.append('span').attr('class', 'evo-tag').text('Tag')
}

/** Diamonds above the chart for tags created in the range, in repos the people worked in. */
function drawTags(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  x: d3.ScaleTime<number, number>,
  innerH: number,
  repos: string[],
) {
  const wanted = new Set(repos)
  const tags = data.allTags.filter((t) => wanted.has(t.repo) && t.day >= graph.range.start && t.day <= graph.range.end)
  for (const [period, list] of d3.group(tags, (t) => periodOf(t.day, graph.grain))) {
    const cx = (x(periodStartDate(period, graph.grain)) + x(periodEndDate(period, graph.grain))) / 2
    const shown = list.slice(-10).reverse()
    const tipLines: TipLine[] = [
      { text: `${periodTitle(period, graph.grain)} — ${list.length} tag${list.length === 1 ? '' : 's'}` },
      ...shown.map((t) => ({ text: `${repoLabel(t.repo)}: ${t.name} (${t.day})`, color: repoColor(t.repo) })),
      ...(list.length > shown.length ? [{ text: `… and ${list.length - shown.length} more` }] : []),
    ]
    const marker = g.append('g')
    marker
      .append('line')
      .attr('x1', cx)
      .attr('x2', cx)
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', 'var(--muted)')
      .attr('stroke-dasharray', '2 3')
      .attr('opacity', 0.35)
      .attr('pointer-events', 'none')
    marker
      .append('path')
      .attr('d', d3.symbol(d3.symbolDiamond, 40)())
      .attr('transform', `translate(${cx},-8)`)
      .attr('fill', 'var(--heading)')
      .on('mousemove', (event: MouseEvent) => showTip(event, tipLines))
      .on('mouseleave', hideTip)
  }
}

function drawYears(commits: Commit[]) {
  const container = d3.select<HTMLElement, unknown>('#evo-years')
  container.selectAll('*').remove()
  if (commits.length === 0) return

  const years = d3
    .groups(commits, (c) => utcDate(c.day).getUTCFullYear())
    .map(([year, list]) => {
      const byRepo = d3.rollup(
        list,
        (v) => d3.sum(v, metricOf),
        (c) => c.repo,
      )
      return {
        year,
        commits: list.length,
        value: d3.sum(list, metricOf),
        activeDays: new Set(list.map((c) => c.day)).size,
        repos: byRepo.size,
        added: d3.sum(list, (c) => c.added),
        deleted: d3.sum(list, (c) => c.deleted),
        median: Math.round(d3.median(list, lineCount) ?? 0),
        top: [...byRepo].sort((a, b) => b[1] - a[1]).slice(0, 3),
      }
    })
    .sort((a, b) => b.year - a.year)
  const max = Math.max(1, d3.max(years, (y) => y.value) ?? 1)

  const table = container.append('table').attr('class', 'compact')
  table
    .append('thead')
    .append('tr')
    .selectAll('th')
    .data(['Year', metricName(), 'Commits', 'Active days', 'Repos', 'Lines', 'Median size', 'Top repos'])
    .join('th')
    .text((d) => d)
  const body = table.append('tbody')
  for (const y of years) {
    const tr = body.append('tr')
    tr.append('td').attr('class', 'nowrap').text(String(y.year))
    const meter = tr.append('td').append('div').attr('class', 'meter')
    meter
      .append('div')
      .attr('class', 'meter-track')
      .append('div')
      .attr('class', 'meter-fill')
      .style('width', `${(y.value / max) * 100}%`)
      .style('background', 'var(--accent)')
    meter.append('span').text(num(y.value))
    tr.append('td').text(num(y.commits))
    tr.append('td').text(num(y.activeDays))
    tr.append('td').text(num(y.repos))
    appendChurn(tr.append('td').attr('class', 'nowrap'), y.added, y.deleted)
    tr.append('td').text(num(y.median))
    const topCell = tr.append('td')
    for (const [repo, n] of y.top) {
      topCell
        .append('span')
        .attr('class', 'repo-chip nowrap')
        .style('--swatch', repoColor(repo))
        .style('margin-right', '0.9rem')
        .text(`${repoLabel(repo)} ${num(n)}`)
    }
  }
}

/** Everyone with commits in the graph range, with a checkbox to add them to the graph. */
function drawPeople() {
  const box = d3.select<HTMLElement, unknown>('#evo-people')
  box.selectAll('*').remove()
  if (!author) return
  const mainKey = authorKey(author)
  const commits = history.filter(inRange)

  // One pass for per-email totals; the subject's addresses add up to one person.
  const byEmail = new Map<string, number>()
  let subjectTotal = 0
  for (const c of commits) {
    const v = metricOf(c)
    if (isSubjectEmail(c.authorEmail)) subjectTotal += v
    else byEmail.set(c.authorEmail, (byEmail.get(c.authorEmail) ?? 0) + v)
  }
  const personTotal = (a: AuthorSummary) =>
    a.isSubject ? subjectTotal : d3.sum(a.emails, (e) => byEmail.get(e.toLowerCase()) ?? 0)

  const selected = people()
  const selectedKeys = new Map(selected.map((p, i) => [authorKey(p), i]))
  const q = peopleQuery.trim().toLowerCase()
  const candidates = buildAuthors(commits)
    .filter((a) => !selectedKeys.has(authorKey(a)))
    .filter((a) => q === '' || a.name.toLowerCase().includes(q) || a.emails.some((e) => e.includes(q)))
    .map((a) => ({ a, v: personTotal(a) }))
    .filter((r) => r.v > 0)
    .sort((x, y) => y.v - x.v)
  const rows = [...selected.map((a) => ({ a, v: personTotal(a) })), ...candidates.slice(0, PEOPLE_SHOWN)]

  for (const { a, v } of rows) {
    const key = authorKey(a)
    const index = selectedKeys.get(key)
    const isMain = key === mainKey
    const label = box
      .append('label')
      .attr('class', 'person')
      .classed('on', index !== undefined)
      .attr('title', isMain ? `${a.name}: picked in the filter bar` : a.emails.join(', '))
    label
      .append('input')
      .attr('type', 'checkbox')
      .property('checked', index !== undefined)
      .property('disabled', isMain)
      .on('change', function () {
        const on = (this as HTMLInputElement).checked
        extras = on ? [...extras, a] : extras.filter((p) => authorKey(p) !== key)
        if (graph.preset === 'all') graph.range = presetRange('all')
        drawStrip()
        drawGraph()
      })
    label
      .append('span')
      .attr('class', 'person-swatch')
      .style('background', index !== undefined ? personColor(index) : 'transparent')
    label.append('span').attr('class', 'person-name').text(a.name)
    label.append('span').attr('class', 'person-value').text(short(v))
  }
  if (candidates.length > PEOPLE_SHOWN) {
    box
      .append('p')
      .attr('class', 'hint person-more')
      .text(`${num(candidates.length - PEOPLE_SHOWN)} more; search to find them.`)
  }
  d3.select('#evo-people-clear').property('hidden', extras.length === 0)
}

/** The graph people's whole history under the chart; drag to pick the graph's range. */
function drawStrip() {
  const container = d3.select<HTMLElement, unknown>('#evo-strip')
  container.selectAll('*').remove()
  strip = null
  const list = people()
  if (list.length === 0) return
  const full: [Date, Date] = [utcDate(firstDay(list)), d3.utcDay.offset(utcDate(historyEnd), 1)]
  const span = +full[1] - +full[0]
  const day = 86_400_000
  const interval = span > 3 * 365 * day ? d3.utcMonth : span > 120 * day ? d3.utcMonday : d3.utcDay
  const totals = d3.rollup(
    list.flatMap((p) => historyForAuthor(p)),
    (v) => d3.sum(v, metricOf),
    (c) => +interval.floor(utcDate(c.day)),
  )
  const points = interval.range(interval.floor(full[0]), full[1]).map((t) => ({ t, v: totals.get(+t) ?? 0 }))

  const width = widthOf(container.node())
  const innerW = width - MARGIN.left - MARGIN.right
  const innerH = 34
  const height = innerH + 20
  const x = d3.scaleUtc().domain(full).range([0, innerW])
  const y = d3
    .scaleSqrt()
    .domain([0, Math.max(1, d3.max(points, (p) => p.v) ?? 0)])
    .range([innerH, 2])

  const svg = container
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('aria-label', 'Whole history; drag to choose the graph range')
  const g = svg.append('g').attr('transform', `translate(${MARGIN.left},0)`)
  g.append('rect').attr('width', innerW).attr('height', innerH).attr('rx', 6).attr('fill', 'var(--empty)')
  g.append('path')
    .datum(points)
    .attr(
      'd',
      d3
        .area<{ t: Date; v: number }>()
        .x((p) => x(p.t))
        .y0(innerH)
        .y1((p) => y(p.v))
        .curve(d3.curveStepAfter),
    )
    .attr('fill', 'var(--accent)')
    .attr('fill-opacity', 0.45)
  const axis = g
    .append('g')
    .attr('transform', `translate(0,${innerH})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(Math.max(2, Math.floor(innerW / 80)))
        .tickSize(3),
    )
  axis.select('.domain').remove()
  styleAxis(axis)

  const toRange = (sel: [number, number]): DayRange => ({
    start: dayKey(d3.utcDay.round(x.invert(sel[0]))),
    end: dayKey(d3.utcDay.offset(d3.utcDay.round(x.invert(sel[1])), -1)),
  })
  const brush = d3
    .brushX()
    .extent([
      [0, 0],
      [innerW, innerH],
    ])
    .on('end', (event: d3.D3BrushEvent<unknown>) => {
      if (!event.sourceEvent || !author) return // moved from code
      const sel = event.selection as [number, number] | null
      if (!sel) {
        applyPreset('all')
        return
      }
      graph.preset = null
      graph.range = toRange(sel)
      press('#g-range', null)
      drawGraph()
    })
  strip = { x, brush, g: g.append('g').attr('class', 'brush').call(brush) }
  syncBrush()
}

function syncBrush() {
  if (!strip) return
  const [lo, hi] = strip.x.range() as [number, number]
  const x0 = Math.max(lo, strip.x(utcDate(graph.range.start)))
  const x1 = Math.min(hi, strip.x(d3.utcDay.offset(utcDate(graph.range.end), 1)))
  if (x0 <= lo && x1 >= hi) strip.g.call(strip.brush.move, null)
  else strip.g.call(strip.brush.move, [x0, Math.max(x1, x0 + 2)])
}

function drawGraph() {
  if (!author) return
  const list = people()
  const lists = list.map((p) => historyForAuthor(p).filter(inRange))
  const all = lists.flat()
  const series = list.length > 1 ? personSeries(list) : repoSeries(all)
  drawSummary(all, list)
  drawChart(lists, all, series)
  drawYears(all)
  drawPeople()
  press('#g-metric', metric)
}

let expanded = false

/** Toggle the Activity card between its place on the page and a full-page graph tool. */
function setExpanded(on: boolean) {
  expanded = on
  document.getElementById('activity-card')?.classList.toggle('expanded', on)
  document.documentElement.classList.toggle('graph-expanded', on)
  const btn = document.getElementById('g-expand')
  btn?.setAttribute('aria-pressed', String(on))
  btn?.setAttribute('aria-label', on ? 'Close the expanded graph' : 'Expand the graph')
  btn?.setAttribute('title', on ? 'Close (Esc)' : 'Expand the graph (Esc closes)')
  hideTip()
  drawStrip()
  drawGraph()
  if (on) document.getElementById('activity-card')?.scrollTo(0, 0)
}

function applyPreset(p: Preset) {
  if (!author) return
  graph.preset = p
  graph.range = presetRange(p)
  graph.grain = grainFor(p)
  press('#g-range', p)
  press('#g-grain', graph.grain)
  syncBrush()
  drawGraph()
}

/** Wire the graph's own range, grouping and people controls once. */
export function setupEvolution() {
  press('#g-range', graph.preset)
  press('#g-grain', graph.grain)
  wire('#g-range', (mode) => applyPreset(mode as Preset))
  wire('#g-grain', (mode) => {
    graph.grain = mode as Grain
    drawGraph()
  })
  d3.select<HTMLInputElement, unknown>('#evo-people-search').on('input', function () {
    peopleQuery = this.value
    drawPeople()
  })
  d3.select('#evo-people-clear').on('click', () => {
    extras = []
    if (graph.preset === 'all') graph.range = presetRange('all')
    drawStrip()
    drawGraph()
  })

  d3.select('#g-expand').on('click', () => setExpanded(!expanded))
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && expanded) setExpanded(false)
  })
  // The filter bar is covered while expanded; this toggle drives the same global metric.
  wire('#g-metric', (mode) => {
    document.querySelector<HTMLButtonElement>(`#f-metric [data-mode="${mode}"]`)?.click()
  })
  let frame = 0
  window.addEventListener('resize', () => {
    if (!expanded) return
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      drawStrip()
      drawGraph()
    })
  })
}

/** Redraw for the filter bar's author and metric; a preset range follows the people. */
export function drawEvolution(a: AuthorSummary) {
  author = a
  if (graph.preset) graph.range = presetRange(graph.preset)
  drawStrip()
  drawGraph()
}
