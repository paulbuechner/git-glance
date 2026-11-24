import * as d3 from 'd3'
import {
  activeRepos,
  addDays,
  appendChurn,
  authorKey,
  commitsForAuthor,
  cssVar,
  data,
  dayKey,
  formatTooltip,
  grain,
  hideTip,
  historyEnd,
  inkOn,
  isWeekend,
  metric,
  metricName,
  metricOf,
  metricText,
  num,
  periodAxisLabel,
  periodOf,
  periodStartDate,
  periodTitle,
  press,
  range,
  rangeText,
  repoColor,
  repoLabel,
  setFilters,
  showTip,
  slotNoun,
  styleAxis,
  subjectAuthor,
  utcDate,
  view,
  widthOf,
  wire,
} from './common.ts'
import type { AuthorSummary, Commit, DayRange, Grain, Metric, TipLine } from './common.ts'
import { drawEvolution, setupEvolution } from './evolution.ts'
import { exportPng, setupPrintTheme } from './export.ts'
import { drawCi, drawPullRequests, drawReviews } from './github.ts'
import {
  type ChurnScale,
  type HotspotMode,
  drawBranches,
  drawChurn,
  drawCollab,
  drawHotspots,
  drawKpis,
  drawPunchcard,
  drawSizes,
  drawTypes,
} from './insights.ts'

type Container = d3.Selection<HTMLElement, unknown, null, undefined>
/** Global range for every card except the Activity graph: the last day, week, month or 90 days. */
type Preset = 'day' | 'week' | 'month' | '90d'

let selected: AuthorSummary = subjectAuthor
const windowDays =
  Math.round((utcDate(data.window.end).getTime() - utcDate(data.window.start).getTime()) / 86_400_000) + 1
// A report window of up to 90 days (last-30d, --month) opens as is; longer ones open on 90D.
let preset: Preset | null = data.window.label === 'last-30d' ? 'month' : windowDays > 90 ? '90d' : null
let hotspotMode: HotspotMode = 'files'
let churnScale: ChurnScale = 'log'

function emptyNote(container: Container, text: string) {
  container.append('p').attr('class', 'hint').text(text)
}

// ---------------------------------------------------------------------------
// Authors

function selectedAuthor(): AuthorSummary {
  const key = authorKey(selected)
  return view.authors.find((a) => authorKey(a) === key) ?? selected
}

/** Authors in the range, plus the current selection even when it has no commits there. */
function syncAuthorOptions() {
  const select = d3.select<HTMLSelectElement, unknown>('#author')
  const key = authorKey(selected)
  const list = view.authors.filter((a) => a.commits > 0 || a.isSubject)
  if (!list.some((a) => authorKey(a) === key)) list.push({ ...selected, commits: 0 })
  select
    .selectAll('option')
    .data(list, (d) => authorKey(d as AuthorSummary))
    .join('option')
    .attr('value', (d) => authorKey(d))
    .text((d) => `${d.name} (${num(d.commits)})`)
  select.property('value', key)
}

// ---------------------------------------------------------------------------
// Range presets

function presetRange(p: Preset): DayRange {
  const end = historyEnd
  const days = p === 'day' ? 1 : p === 'week' ? 7 : p === 'month' ? 30 : 90
  return { start: addDays(end, 1 - days), end }
}

/** Day columns up to a month; 90 days reads better by week. */
function grainFor(p: Preset | null): Grain {
  return p === '90d' ? 'week' : 'day'
}

function applyPreset(p: Preset) {
  preset = p
  press('#f-range', p)
  setFilters({ range: presetRange(p), grain: grainFor(p) })
  syncAuthorOptions()
  renderCards()
}

/** Lane tooltip for one repo row: the repo (with its swatch) leads the first line. */
function withRepoPrefix(repo: string, lines: TipLine[]): TipLine[] {
  const [first, ...rest] = lines
  const head = first?.text ?? ''
  return [
    {
      text: [{ text: `${repoLabel(repo)} · ` }, ...(typeof head === 'string' ? [{ text: head }] : head)],
      color: repoColor(repo),
    },
    ...rest,
  ]
}

// ---------------------------------------------------------------------------
// Repo lanes: one row per repo, one cell per period, shaded by the metric

function drawLanes(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const commits = commitsForAuthor(author)
  const periods = view.periods
  const repos = activeRepos(commits)
  const activeSlots = new Set(commits.map((c) => periodOf(c.day)))
  const active = view.slots.filter((s) => activeSlots.has(s)).length
  d3.select('#summary').html(
    `<strong>${num(active)}</strong> of <strong>${num(view.slots.length)}</strong> ${slotNoun(true)} active · <strong>${num(
      view.slots.length - active,
    )}</strong> empty · <strong>${num(commits.length)}</strong> commits in <strong>${num(repos.length)}</strong> repos`,
  )
  if (repos.length === 0) return emptyNote(container, 'No commits in the selected range.')
  if (periods.length > 420) {
    return emptyNote(container, `Too many ${grain}s to give each a cell. Pick a coarser grain or a shorter range.`)
  }

  const labelW = 170
  const width = widthOf(container.node())
  const pitch = Math.max(5, Math.min(24, Math.floor((width - labelW - 8) / periods.length)))
  const cellW = Math.max(3, pitch - (pitch > 12 ? 4 : 1))
  const rowH = 20
  const cellH = Math.min(14, rowH - 6)
  const headerH = 22
  const rows = [{ key: '', label: 'All repos' }, ...repos.map((r) => ({ key: r, label: repoLabel(r) }))]
  const svgW = labelW + periods.length * pitch + 8
  const svgH = headerH + rows.length * rowH + 4

  const byRepo = d3.group(
    commits,
    (c) => c.repo,
    (c) => periodOf(c.day),
  )
  const byPeriod = d3.group(commits, (c) => periodOf(c.day))

  const svg = container
    .append('svg')
    .attr('width', svgW)
    .attr('height', svgH)
    .attr('viewBox', `0 0 ${svgW} ${svgH}`)
    .attr('role', 'img')
    .attr('aria-label', `Repo activity per ${grain} for ${author.name}`)

  const labelEvery = Math.max(1, Math.ceil(44 / pitch))
  periods.forEach((p, i) => {
    if (i % labelEvery !== 0) return
    svg
      .append('text')
      .attr('x', labelW + i * pitch + cellW / 2)
      .attr('y', 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', 10)
      .attr('fill', 'var(--muted)')
      .text(periodAxisLabel(p))
  })

  rows.forEach((row, ri) => {
    const y = headerH + ri * rowH
    const color = row.key ? repoColor(row.key) : 'var(--workspace-fill)'
    const label = row.label.length > 24 ? `${row.label.slice(0, 23)}…` : row.label
    svg
      .append('rect')
      .attr('x', 0)
      .attr('y', y + (rowH - 10) / 2 - 1)
      .attr('width', 10)
      .attr('height', 10)
      .attr('rx', 2)
      .attr('fill', color)
    svg
      .append('text')
      .attr('x', 16)
      .attr('y', y + rowH / 2 + 3)
      .attr('font-size', 11)
      .attr('font-weight', row.key ? 400 : 600)
      .attr('fill', 'var(--ink)')
      .text(label)
      .append('title')
      .text(row.label)

    const cells = row.key ? byRepo.get(row.key) : byPeriod
    const values = periods.map((p) => d3.sum(cells?.get(p) ?? [], metricOf))
    const max = Math.max(1, d3.max(values) ?? 1)
    periods.forEach((p, i) => {
      const list = cells?.get(p) ?? []
      const v = values[i]!
      const x = labelW + i * pitch
      const weekend = grain === 'day' && isWeekend(p)
      const fill = v > 0 ? color : 'var(--empty)'
      const opacity = v > 0 ? 0.35 + 0.65 * Math.sqrt(v / max) : weekend ? 0.5 : 1
      const shape =
        weekend && cellW >= 8
          ? svg
              .append('circle')
              .attr('cx', x + cellW / 2)
              .attr('cy', y + rowH / 2)
              .attr('r', Math.min(cellW, cellH) / 2)
          : svg
              .append('rect')
              .attr('x', x)
              .attr('y', y + (rowH - cellH) / 2)
              .attr('width', cellW)
              .attr('height', cellH)
              .attr('rx', Math.min(3, cellW / 3))
      shape
        .attr('fill', fill)
        .attr('fill-opacity', opacity)
        .on('mousemove', (event: MouseEvent) =>
          showTip(event, row.key ? withRepoPrefix(row.key, formatTooltip(p, list)) : formatTooltip(p, list)),
        )
        .on('mouseleave', hideTip)
    })
  })
}

// ---------------------------------------------------------------------------
// Activity calendar: every period in the range, shaded by the metric, empty slots marked

function drawCalendar(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const commits = commitsForAuthor(author)
  const byPeriod = d3.group(commits, (c) => periodOf(c.day))
  const values = new Map([...byPeriod].map(([p, list]) => [p, d3.sum(list, metricOf)]))
  const max = Math.max(1, d3.max(values.values()) ?? 1)
  const low = cssVar('--heatmap-low') || '#134e4a'
  const high = cssVar('--heatmap-high') || '#5eead4'
  const color = d3.scaleSequentialSqrt(d3.interpolateRgb(low, high)).domain([0, max])
  const slotSet = new Set(view.slots)
  const active = view.slots.filter((s) => values.has(s)).length
  d3.select('#calendar-hint').text(
    `${num(active)} of ${num(view.slots.length)} ${slotNoun(true)} active, ${num(view.slots.length - active)} empty (outlined). Darker = more ${
      metric === 'commits' ? 'commits' : 'lines changed'
    }.`,
  )

  type Cell = { period: string; row: number; col: number }
  let cells: Cell[]
  let rowLabels: string[]
  let colLabels: { col: number; text: string }[]
  const width = widthOf(container.node())
  const labelW = 40

  if (grain === 'day') {
    const first = d3.utcMonday.floor(utcDate(range.start))
    const days = d3.utcDay.range(utcDate(range.start), d3.utcDay.offset(utcDate(range.end), 1))
    cells = days.map((d) => ({
      period: dayKey(d),
      row: (d.getUTCDay() + 6) % 7,
      col: d3.utcMonday.count(first, d),
    }))
    rowLabels = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']
    colLabels = []
    let lastMonth = -1
    for (const c of cells) {
      const d = utcDate(c.period)
      if (d.getUTCMonth() !== lastMonth && c.row === 0) {
        lastMonth = d.getUTCMonth()
        colLabels.push({ col: c.col, text: d3.utcFormat(d.getUTCMonth() === 0 ? '%Y' : '%b')(d) })
      }
    }
  } else if (grain === 'year') {
    cells = view.periods.map((p, i) => ({ period: p, row: 0, col: i }))
    rowLabels = ['']
    colLabels = view.periods.map((p, i) => ({ col: i, text: p }))
  } else {
    const years = [
      ...new Set(view.periods.map((p) => (grain === 'week' ? d3.utcFormat('%G')(periodStartDate(p)) : p.slice(0, 4)))),
    ]
    cells = view.periods.map((p) => {
      const d = periodStartDate(p)
      const year = grain === 'week' ? d3.utcFormat('%G')(d) : p.slice(0, 4)
      const col = grain === 'week' ? Number(d3.utcFormat('%V')(d)) - 1 : d.getUTCMonth()
      return { period: p, row: years.indexOf(year), col }
    })
    rowLabels = years
    colLabels =
      grain === 'month'
        ? d3.range(12).map((m) => ({ col: m, text: d3.utcFormat('%b')(new Date(Date.UTC(2000, m, 1))) }))
        : [0, 9, 18, 27, 36, 45].map((w) => ({ col: w, text: `W${w + 1}` }))
  }

  const cols = (d3.max(cells, (c) => c.col) ?? 0) + 1
  const maxPitch = grain === 'day' ? 16 : grain === 'week' ? 18 : 40
  const pitch = Math.max(6, Math.min(maxPitch, Math.floor((width - labelW - 8) / cols)))
  const cellW = pitch - 2
  const cellH = grain === 'day' || grain === 'week' ? cellW : Math.min(22, cellW)
  const rowPitch = cellH + 2
  const headerH = 16
  const svgW = labelW + cols * pitch + 4
  const svgH = headerH + rowLabels.length * rowPitch + 4

  const svg = container
    .append('svg')
    .attr('width', svgW)
    .attr('height', svgH)
    .attr('viewBox', `0 0 ${svgW} ${svgH}`)
    .attr('role', 'img')
    .attr('aria-label', `Activity calendar per ${grain} for ${author.name}`)

  let lastX = Number.NEGATIVE_INFINITY
  for (const l of colLabels) {
    const x = labelW + l.col * pitch
    if (x - lastX < 30) continue
    lastX = x
    svg.append('text').attr('x', x).attr('y', 11).attr('font-size', 10).attr('fill', 'var(--muted)').text(l.text)
  }
  rowLabels.forEach((text, i) => {
    if (!text) return
    svg
      .append('text')
      .attr('x', 0)
      .attr('y', headerH + i * rowPitch + cellH - 2)
      .attr('font-size', 10)
      .attr('fill', 'var(--muted)')
      .text(text)
  })

  for (const c of cells) {
    const v = values.get(c.period) ?? 0
    const isGap = v === 0 && slotSet.has(c.period)
    const tipText =
      v > 0 ? formatTooltip(c.period, byPeriod.get(c.period) ?? []) : `${periodTitle(c.period)}: no commits`
    svg
      .append('rect')
      .attr('x', labelW + c.col * pitch)
      .attr('y', headerH + c.row * rowPitch)
      .attr('width', cellW)
      .attr('height', cellH)
      .attr('rx', Math.min(3, cellW / 4))
      .attr('fill', v > 0 ? color(v) : 'var(--empty)')
      .attr('fill-opacity', v === 0 && !isGap ? 0.5 : 1)
      .attr('stroke', isGap ? 'var(--gap-empty)' : 'none')
      .attr('stroke-width', isGap ? 1 : 0)
      .on('mousemove', (event: MouseEvent) => showTip(event, tipText))
      .on('mouseleave', hideTip)
  }
}

// ---------------------------------------------------------------------------
// Volume by weekday

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function drawWeekdays(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const commits = commitsForAuthor(author)
  if (commits.length === 0) return emptyNote(container, 'No commits in the selected range.')
  const groups = d3.range(7).map(() => [] as Commit[])
  for (const c of commits) groups[(utcDate(c.day).getUTCDay() + 6) % 7]!.push(c)
  const values = groups.map((g) => d3.sum(g, metricOf))

  const margin = { top: 16, right: 8, bottom: 26, left: 40 }
  const width = 520
  const height = 220
  const innerW = width - margin.left - margin.right
  const innerH = height - margin.top - margin.bottom
  const svg = container
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('role', 'img')
    .attr('aria-label', `${metricName()} by weekday for ${author.name}`)
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
  const x = d3.scaleBand().domain(WEEKDAYS).range([0, innerW]).padding(0.3)
  const y = d3
    .scaleLinear()
    .domain([0, Math.max(1, d3.max(values) ?? 1)])
    .nice()
    .range([innerH, 0])
  g.append('g').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x)).call(styleAxis)
  g.append('g')
    .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format('.3~s')))
    .call(styleAxis)
  WEEKDAYS.forEach((wd, i) => {
    const v = values[i]!
    const top = d3
      .rollups(
        groups[i]!,
        (list) => d3.sum(list, metricOf),
        (c) => c.repo,
      )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([repo, n]): TipLine => ({ text: `${repoLabel(repo)}: ${num(n)}`, color: repoColor(repo) }))
    g.append('rect')
      .attr('x', x(wd)!)
      .attr('y', y(v))
      .attr('width', x.bandwidth())
      .attr('height', innerH - y(v))
      .attr('rx', 3)
      .attr('fill', i >= 5 ? 'var(--muted)' : 'var(--accent)')
      .on('mousemove', (event: MouseEvent) => showTip(event, [{ text: `${wd} — ${metricText(v)}` }, ...top]))
      .on('mouseleave', hideTip)
    g.append('text')
      .attr('x', x(wd)! + x.bandwidth() / 2)
      .attr('y', y(v) - 4)
      .attr('text-anchor', 'middle')
      .attr('font-size', 11)
      .attr('fill', 'var(--muted)')
      .text(d3.format('.3~s')(v))
  })
}

// ---------------------------------------------------------------------------
// Authors × repos and the author table

function drawHeatmap(container: Container) {
  container.selectAll('*').remove()
  const value = (list: Commit[]) => d3.sum(list, metricOf)
  const authors = view.authors
    .filter((a) => a.commits > 0)
    .map((a) => ({ a, commits: commitsForAuthor(a) }))
    .sort((p, q) => value(q.commits) - value(p.commits))
    .slice(0, 15)
  if (authors.length === 0) return emptyNote(container, 'No commits in the selected range.')
  const repoTotals = d3.rollup(view.commits, value, (c) => c.repo)
  const repos = [...repoTotals]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([r]) => r)
  const matrix = authors.map(({ commits }) => {
    const byRepo = d3.rollup(commits, value, (c) => c.repo)
    return repos.map((r) => byRepo.get(r) ?? 0)
  })
  const max = Math.max(1, d3.max(matrix.flat()) ?? 1)

  const labelW = 170
  const width = widthOf(container.node())
  const cellW = Math.max(40, Math.min(84, Math.floor((width - labelW) / repos.length)))
  const cellH = 26
  const headerH = 70
  const svgW = labelW + repos.length * cellW + 8
  const svgH = headerH + authors.length * cellH + 6

  const low = cssVar('--heatmap-low') || '#134e4a'
  const high = cssVar('--heatmap-high') || '#5eead4'
  const color = d3.scaleSequentialSqrt(d3.interpolateRgb(low, high)).domain([0, max])
  const svg = container
    .append('svg')
    .attr('width', svgW)
    .attr('height', svgH)
    .attr('viewBox', `0 0 ${svgW} ${svgH}`)
    .attr('role', 'img')
    .attr('aria-label', `${metricName()} by author and repository`)

  repos.forEach((repo, i) => {
    const label = repoLabel(repo)
    svg
      .append('text')
      .attr('transform', `translate(${labelW + i * cellW + cellW / 2},${headerH - 6}) rotate(-35)`)
      .attr('font-size', 11)
      .attr('fill', 'var(--muted)')
      .text(label.length > 20 ? `${label.slice(0, 19)}…` : label)
      .append('title')
      .text(label)
  })
  authors.forEach(({ a }, ri) => {
    const y = headerH + ri * cellH
    svg
      .append('text')
      .attr('x', 0)
      .attr('y', y + cellH / 2 + 4)
      .attr('font-size', 11)
      .attr('fill', a.isSubject ? 'var(--accent)' : 'var(--ink)')
      .attr('font-weight', a.isSubject ? 650 : 400)
      .text(a.name.length > 24 ? `${a.name.slice(0, 23)}…` : a.name)
    repos.forEach((repo, ci) => {
      const n = matrix[ri]![ci]!
      const fill = n === 0 ? 'var(--empty)' : color(n)
      svg
        .append('rect')
        .attr('x', labelW + ci * cellW + 2)
        .attr('y', y + 2)
        .attr('width', cellW - 4)
        .attr('height', cellH - 4)
        .attr('rx', 4)
        .attr('fill', fill)
        .on('mousemove', (event: MouseEvent) => showTip(event, `${a.name} · ${repoLabel(repo)}: ${metricText(n)}`))
        .on('mouseleave', hideTip)
      if (n > 0) {
        svg
          .append('text')
          .attr('x', labelW + ci * cellW + cellW / 2)
          .attr('y', y + cellH / 2 + 4)
          .attr('text-anchor', 'middle')
          .attr('font-size', 10)
          .attr('font-weight', 600)
          .attr('fill', inkOn(fill))
          .attr('pointer-events', 'none')
          .text(d3.format('.3~s')(n))
      }
    })
  })
}

function drawAuthorTable(container: Container) {
  container.selectAll('*').remove()
  const rows = view.authors
    .filter((a) => a.commits > 0)
    .map((a) => {
      const commits = commitsForAuthor(a)
      const byRepo = d3.rollup(
        commits,
        (v) => d3.sum(v, metricOf),
        (c) => c.repo,
      )
      return {
        a,
        value: d3.sum(commits, metricOf),
        added: d3.sum(commits, (c) => c.added),
        deleted: d3.sum(commits, (c) => c.deleted),
        top: [...byRepo].sort((p, q) => q[1] - p[1]).slice(0, 3),
      }
    })
    .sort((p, q) => q.value - p.value)
    .slice(0, 40)
  if (rows.length === 0) return emptyNote(container, 'No commits in the selected range.')

  const table = container.append('table').attr('class', 'compact')
  table
    .append('thead')
    .append('tr')
    .selectAll('th')
    .data(['Author', 'Commits', 'Lines', 'Active days', 'Repos', 'Top repos'])
    .join('th')
    .text((d) => d)
  const tr = table
    .append('tbody')
    .selectAll('tr')
    .data(rows)
    .join('tr')
    .classed('subject', (d) => d.a.isSubject)
  tr.append('td').text((d) => d.a.name)
  tr.append('td').text((d) => num(d.a.commits))
  tr.append('td')
    .attr('class', 'nowrap')
    .each(function (d) {
      appendChurn(d3.select(this), d.added, d.deleted)
    })
  tr.append('td').text((d) => num(d.a.activeDays.length))
  tr.append('td').text((d) => num(d.a.repos.length))
  tr.append('td').each(function (d) {
    const cell = d3.select(this)
    for (const [repo, n] of d.top) {
      cell
        .append('span')
        .attr('class', 'repo-chip nowrap')
        .style('--swatch', repoColor(repo))
        .style('margin-right', '0.9rem')
        .text(`${repoLabel(repo)} ${d3.format('.3~s')(n)}`)
    }
  })
}

// ---------------------------------------------------------------------------
// Theme

function currentTheme(): 'light' | 'dark' {
  const t = document.documentElement.getAttribute('data-theme')
  return t === 'light' ? 'light' : 'dark'
}

function setTheme(theme: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem('commit-visibility-theme', theme)
  } catch {
    // ignore quota / private mode
  }
  const btn = document.getElementById('theme-toggle')
  if (btn) {
    btn.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false')
    btn.textContent = theme === 'light' ? 'Dark theme' : 'Light theme'
  }
}

// ---------------------------------------------------------------------------
// Rendering

function renderCards() {
  const author = selectedAuthor()
  d3.select('#subtitle').text(`${rangeText()} · ${author.name} · ${metricName().toLowerCase()} per ${grain}`)
  d3.select('#range-label').text(rangeText())
  d3.selectAll('.scope').text(`report window ${data.window.start} → ${data.window.end}`)

  drawKpis(d3.select('#kpis'), author)
  drawEvolution(author)
  drawCalendar(d3.select('#calendar'), author)
  drawLanes(d3.select('#lanes'), author)
  drawChurn(d3.select('#churn'), author, churnScale)
  drawWeekdays(d3.select('#weekdays'), author)
  drawSizes(d3.select('#sizes'), author)
  drawTypes(d3.select('#types'), author)
  drawPunchcard(d3.select('#punchcard'), author)
  drawHotspots(d3.select('#hotspots'), author, hotspotMode)
  drawBranches(d3.select('#branches'), author)
  if (data.github) {
    drawPullRequests(d3.select('#prs'), author)
    drawReviews(d3.select('#reviews'), author)
    drawCi(d3.select('#ci'), author)
  }
  drawCollab(d3.select('#collab'), author)
  drawHeatmap(d3.select('#heatmap'))
  drawAuthorTable(d3.select('#authors'))
}

function renderAll() {
  syncAuthorOptions()
  renderCards()
}

function main() {
  setTheme(currentTheme())
  if (preset) setFilters({ range: presetRange(preset), grain: grainFor(preset) })
  else setFilters({ grain: grainFor(null) })
  press('#f-metric', metric)
  press('#f-range', preset)
  setupEvolution()

  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    setTheme(currentTheme() === 'light' ? 'dark' : 'light')
    // Calendar and heatmap bake resolved theme colors; redraw with the new palette.
    renderCards()
  })

  d3.select<HTMLSelectElement, unknown>('#author').on('change', function () {
    const key = this.value
    selected = view.authors.find((a) => authorKey(a) === key) ?? selected
    syncAuthorOptions()
    renderCards()
  })

  wire('#f-metric', (mode) => {
    setFilters({ metric: mode as Metric })
    renderCards()
  })
  wire('#f-range', (mode) => applyPreset(mode as Preset))
  wire('#hotspots-mode', (mode) => {
    hotspotMode = mode === 'folders' ? 'folders' : 'files'
    drawHotspots(d3.select('#hotspots'), selectedAuthor(), hotspotMode)
  })
  wire('#churn-scale', (mode) => {
    churnScale = mode === 'linear' ? 'linear' : 'log'
    drawChurn(d3.select('#churn'), selectedAuthor(), churnScale)
  })

  const pngBtn = document.getElementById('export-png') as HTMLButtonElement | null
  pngBtn?.addEventListener('click', async () => {
    pngBtn.disabled = true
    pngBtn.textContent = 'Exporting…'
    try {
      await exportPng(['commit-visibility', range.start, range.end, selectedAuthor().name])
    } catch (err) {
      console.error('PNG export failed', err)
    } finally {
      pngBtn.disabled = false
      pngBtn.textContent = 'Export PNG'
    }
  })
  document.getElementById('export-pdf')?.addEventListener('click', () => window.print())
  // Calendar and heatmap bake resolved theme colors; repaint them whenever print swaps the theme.
  setupPrintTheme(() => renderCards())

  // Charts drawn at true pixel width follow the container.
  const main = document.querySelector('main')
  if (main) {
    let lastWidth = main.clientWidth
    let frame = 0
    new ResizeObserver(() => {
      if (Math.abs(main.clientWidth - lastWidth) < 8) return
      lastWidth = main.clientWidth
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(renderAll)
    }).observe(main)
  }

  renderAll()
}

main()
