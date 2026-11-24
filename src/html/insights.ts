import * as d3 from 'd3'
import { COMMIT_TYPES, SIZE_BUCKETS, commitType, sizeBucket, sizeBucketLabel } from '../commit-kinds.ts'
import {
  activeRepos,
  authorNameFor,
  churnParts,
  commitsForAuthor,
  data,
  fillRepoLegend,
  grain,
  hideTip,
  historyForAuthor,
  hourFromIso,
  lineCount,
  metric,
  metricName,
  metricOf,
  metricText,
  num,
  periodAxisLabel,
  periodOf,
  periodTitle,
  prefersReducedMotion,
  previousCommitsForAuthor,
  previousRange,
  range,
  repoColor,
  repoLabel,
  shortHash,
  showTip,
  slotNoun,
  sparseTicks,
  styleAxis,
  view,
  widthOf,
  windowCommitsForAuthor,
} from './common.ts'
import type { AuthorSummary, Commit, TipLine } from './common.ts'
import { branchPrCell } from './github.ts'

type Container = d3.Selection<HTMLElement, unknown, null, undefined>

function plural(n: number, word: string): string {
  return `${num(n)} ${word}${n === 1 ? '' : 's'}`
}

function emailsOf(author: AuthorSummary): Set<string> {
  return new Set(author.emails.map((e) => e.toLowerCase()))
}

function emptyNote(container: Container, text: string) {
  container.append('p').attr('class', 'hint').text(text)
}

// ---------------------------------------------------------------------------
// KPI tiles

/** Longest run and the run ending at the last slot (the current one may still be empty). */
function streaks(slots: string[], active: Set<string>): { current: number; longest: number } {
  let longest = 0
  let run = 0
  for (const s of slots) {
    run = active.has(s) ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  let i = slots.length - 1
  if (i >= 0 && !active.has(slots[i]!) && slots[i] === periodOf(range.end)) i--
  let current = 0
  while (i >= 0 && active.has(slots[i]!)) {
    current++
    i--
  }
  return { current, longest }
}

function median(values: number[]): number {
  return values.length === 0 ? 0 : Math.round(d3.median(values) ?? 0)
}

type Kpi = { label: string; value: string; title?: string; now?: number; prev?: number; note?: string }

/** Tile number: exact up to 99,999, compact above (1.95M) so it fits the tile; exact value in `title`. */
function tileNumber(n: number, sign = ''): { value: string; title: string } {
  const exact = `${sign}${num(n)}`
  return { value: n >= 100_000 ? `${sign}${d3.format('.3~s')(n)}` : exact, title: exact }
}

function kpiStats(commits: Commit[]) {
  return {
    commits: commits.length,
    activeDays: new Set(commits.map((c) => c.day)).size,
    added: d3.sum(commits, (c) => c.added),
    deleted: d3.sum(commits, (c) => c.deleted),
    medianSize: median(commits.map(lineCount)),
    repos: new Set(commits.map((c) => c.repo)).size,
  }
}

export function drawKpis(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const commits = commitsForAuthor(author)
  const now = kpiStats(commits)
  // No comparison when the range starts at (or before) the author's first commit.
  const first = historyForAuthor(author)[0]?.day
  const comparable = previousRange !== null && first !== undefined && first < range.start
  const prev = comparable ? kpiStats(previousCommitsForAuthor(author)) : null
  const { current, longest } = streaks(view.slots, new Set(commits.map((c) => periodOf(c.day))))

  const tiles: Kpi[] = [
    { label: 'Commits', ...tileNumber(now.commits), now: now.commits, prev: prev?.commits },
    { label: 'Active days', ...tileNumber(now.activeDays), now: now.activeDays, prev: prev?.activeDays },
    { label: 'Lines added', ...tileNumber(now.added, '+'), now: now.added, prev: prev?.added },
    { label: 'Lines deleted', ...tileNumber(now.deleted, '−'), now: now.deleted, prev: prev?.deleted },
    {
      label: 'Median commit size',
      ...tileNumber(now.medianSize),
      now: now.medianSize,
      prev: prev?.medianSize,
      note: 'lines',
    },
    { label: 'Repos touched', value: `${now.repos} / ${data.repos.length}`, now: now.repos, prev: prev?.repos },
    { label: 'Current streak', value: num(current), note: `${slotNoun(true)} · longest ${num(longest)}` },
  ]

  const tile = container.selectAll('div.kpi').data(tiles).join('div').attr('class', 'kpi')
  tile
    .append('div')
    .attr('class', 'label')
    .text((d) => d.label)
  tile
    .append('div')
    .attr('class', 'value')
    .attr('title', (d) => d.title ?? null)
    .text((d) => d.value)
  tile.each(function (d) {
    const el = d3.select(this).append('div').attr('class', 'delta')
    if (d.now === undefined || d.prev === undefined) {
      el.text(d.note ?? '')
      return
    }
    if (d.prev === 0) {
      el.text(d.now === 0 ? 'no change' : 'new vs previous').classed('up', d.now > 0)
      return
    }
    const pct = Math.round(((d.now - d.prev) / d.prev) * 100)
    el.classed('up', pct > 0)
      .classed('down', pct < 0)
      .text(`${pct > 0 ? '▲' : pct < 0 ? '▼' : '='} ${num(Math.abs(pct))}% vs ${tileNumber(d.prev).value}`)
  })

  d3.select('#kpi-hint').text(
    comparable && previousRange
      ? `${range.start} → ${range.end}, compared with ${previousRange.start} → ${previousRange.end}. Line counts skip merges and excluded paths.`
      : `${range.start} → ${range.end}: starts at this author's first commit, so there is no earlier period to compare. Line counts skip merges and excluded paths.`,
  )
}

// ---------------------------------------------------------------------------
// Churn: lines added (up) and deleted (down) per period, stacked by repo

export type ChurnScale = 'log' | 'linear'

/** Powers of ten up to `max` (10, 100, 1k, …) so log-axis ticks read as round numbers. */
function decades(max: number): number[] {
  const out: number[] = []
  for (let v = 10; v <= max; v *= 10) out.push(v)
  return out
}

export function drawChurn(container: Container, author: AuthorSummary, scale: ChurnScale) {
  container.selectAll('*').remove()
  d3.select('#churn-title').text(`Lines added and deleted per ${grain}`)
  const commits = commitsForAuthor(author)
  if (commits.length === 0) return emptyNote(container, 'No commits in the selected range.')
  const periods = view.periods
  const repos = activeRepos(commits)

  type Row = { day: string } & Record<string, number | string>
  const byPeriod = d3.group(commits, (c) => periodOf(c.day))
  const sumBy = (field: 'added' | 'deleted'): Row[] =>
    periods.map((day) => {
      const row: Row = { day }
      const inPeriod = byPeriod.get(day) ?? []
      for (const repo of repos) row[repo] = 0
      for (const c of inPeriod) row[c.repo] = Number(row[c.repo] ?? 0) + c[field]
      return row
    })
  const stack = d3
    .stack<Row>()
    .keys(repos)
    .value((d, key) => Number(d[key] ?? 0))
  const up = stack(sumBy('added'))
  const down = stack(sumBy('deleted'))

  const maxUp = Math.max(1, d3.max(up[up.length - 1] ?? [], (d) => d[1]) ?? 1)
  const maxDown = Math.max(1, d3.max(down[down.length - 1] ?? [], (d) => d[1]) ?? 1)

  const margin = { top: 12, right: 72, bottom: 32, left: 52 }
  const width = widthOf(container.node(), 640)
  const height = 280
  const innerW = width - margin.left - margin.right
  const innerH = height - margin.top - margin.bottom

  const svg = container
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('role', 'img')
    .attr('aria-label', `Lines added and deleted per ${grain} for ${author.name}`)
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

  const x = d3
    .scaleBand()
    .domain(periods)
    .range([0, innerW])
    .padding(periods.length > 120 ? 0 : 0.15)
  // Symlog keeps one 10k-line day from flattening every other bar; linear keeps
  // stacked segments proportional.
  const y =
    scale === 'log'
      ? d3.scaleSymlog().constant(10).domain([-maxDown, maxUp]).range([innerH, 0])
      : d3.scaleLinear().domain([-maxDown, maxUp]).nice().range([innerH, 0])
  const zero = y(0)

  const ticks =
    scale === 'log'
      ? [...decades(maxDown).map((v) => -v), 0, ...decades(maxUp)]
      : (y as d3.ScaleLinear<number, number>).ticks(6)
  g.append('g')
    .call(
      d3
        .axisLeft(y)
        .tickValues(ticks)
        .tickFormat((v) => d3.format('.3~s')(Math.abs(Number(v)))),
    )
    .call(styleAxis)
  g.append('g')
    .attr('transform', `translate(0,${innerH})`)
    .call(
      d3
        .axisBottom(x)
        .tickValues(sparseTicks(periods, Math.floor(innerW / 56)))
        .tickFormat((d) => periodAxisLabel(String(d))),
    )
    .call(styleAxis)
  g.append('line')
    .attr('x1', 0)
    .attr('x2', innerW)
    .attr('y1', zero)
    .attr('y2', zero)
    .attr('stroke', 'var(--axis-stroke)')

  const tipFor = (day: string): string | TipLine[] => {
    const inDay = byPeriod.get(day) ?? []
    if (inDay.length === 0) return `${periodTitle(day)}: no commits`
    const added = d3.sum(inDay, (c) => c.added)
    const deleted = d3.sum(inDay, (c) => c.deleted)
    const net = added - deleted
    const rows = d3
      .rollups(
        inDay,
        (v) => [d3.sum(v, (c) => c.added), d3.sum(v, (c) => c.deleted)] as const,
        (c) => c.repo,
      )
      .sort((a, b) => b[1][0] + b[1][1] - (a[1][0] + a[1][1]))
      .map(
        ([repo, [a, d]]): TipLine => ({
          text: [{ text: `${repoLabel(repo)}: ` }, ...churnParts(a, d)],
          color: repoColor(repo),
        }),
      )
    return [
      {
        text: [
          { text: `${periodTitle(day)} — ` },
          ...churnParts(added, deleted),
          { text: ` (net ${net >= 0 ? '+' : '−'}${num(Math.abs(net))})` },
        ],
      },
      ...rows,
    ]
  }

  const bw = Math.max(1, x.bandwidth())
  const drawSide = (series: d3.Series<Row, string>[], sign: 1 | -1) => {
    const rects = g
      .append('g')
      .selectAll('g')
      .data(series)
      .join('g')
      .attr('fill', (d) => repoColor(d.key))
      .attr('fill-opacity', sign === 1 ? 1 : 0.55)
      .selectAll('rect')
      .data((d) => d.filter((p) => p[1] > p[0]))
      .join('rect')
      .attr('x', (d) => x(String(d.data.day))!)
      .attr('width', bw)
      .on('mousemove', (event: MouseEvent, d) => showTip(event, tipFor(String(d.data.day))))
      .on('mouseleave', hideTip)
    const top = (d: d3.SeriesPoint<Row>) => (sign === 1 ? y(d[1]) : y(-d[0]))
    const h = (d: d3.SeriesPoint<Row>) => Math.abs(y(sign * d[1]) - y(sign * d[0]))
    if (prefersReducedMotion() || periods.length > 120) {
      rects.attr('y', top).attr('height', h)
    } else {
      rects.attr('y', zero).attr('height', 0).transition().duration(400).attr('y', top).attr('height', h)
    }
  }
  drawSide(up, 1)
  drawSide(down, -1)

  g.append('text')
    .attr('x', innerW + 8)
    .attr('y', 10)
    .attr('font-size', 11)
    .attr('fill', 'var(--muted)')
    .text('▲ added')
  g.append('text')
    .attr('x', innerW + 8)
    .attr('y', innerH - 6)
    .attr('font-size', 11)
    .attr('fill', 'var(--muted)')
    .text('▼ deleted')

  fillRepoLegend(container.append('div').attr('class', 'chart-legend'), repos)
}

// ---------------------------------------------------------------------------
// Commit types (Conventional Commits) per repo

export function drawTypes(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const commits = commitsForAuthor(author)
  if (commits.length === 0) return emptyNote(container, 'No commits in the selected range.')

  const rows = [
    { key: 'all', label: 'All repos', commits },
    ...activeRepos(commits).map((repo) => ({
      key: repo,
      label: repoLabel(repo),
      commits: commits.filter((c) => c.repo === repo),
    })),
  ]
  const present = COMMIT_TYPES.filter((t) => commits.some((c) => commitType(c.subject) === t))

  const labelW = 190
  const rowH = 24
  // True pixel size: the card is full width, and a scaled viewBox would blow the text up.
  const width = widthOf(container.node(), 480)
  const barW = width - labelW - 60
  const height = rows.length * rowH + 4

  const svg = container
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', width)
    .attr('height', height)
    .attr('role', 'img')
    .attr('aria-label', `Commit types per repository for ${author.name}`)

  rows.forEach((row, ri) => {
    const y = ri * rowH + 2
    const byType = d3.group(row.commits, (c) => commitType(c.subject))
    const rowTotal = d3.sum(row.commits, metricOf)
    svg
      .append('text')
      .attr('x', 0)
      .attr('y', y + rowH / 2 + 2)
      .attr('font-size', 12)
      .attr('font-weight', ri === 0 ? 650 : 400)
      .attr('fill', ri === 0 ? 'var(--accent)' : 'var(--ink)')
      .text(row.label.length > 22 ? `${row.label.slice(0, 21)}…` : row.label)
    svg
      .append('text')
      .attr('x', width)
      .attr('y', y + rowH / 2 + 2)
      .attr('text-anchor', 'end')
      .attr('font-size', 11)
      .attr('fill', 'var(--muted)')
      .text(d3.format('.3~s')(rowTotal))

    let offset = 0
    for (const t of present) {
      const list = byType.get(t) ?? []
      const value = d3.sum(list, metricOf)
      if (value === 0 || rowTotal === 0) continue
      const w = (value / rowTotal) * barW
      const pct = Math.round((value / rowTotal) * 100)
      const examples = list
        .slice(-4)
        .reverse()
        .map((c) => `• ${c.subject}`)
      svg
        .append('rect')
        .attr('x', labelW + offset)
        .attr('y', y + 4)
        .attr('width', Math.max(0, w - 1))
        .attr('height', rowH - 10)
        .attr('rx', 2)
        .attr('fill', `var(--type-${t})`)
        .on('mousemove', (event: MouseEvent) =>
          showTip(event, [`${row.label} · ${t}: ${metricText(value)} (${pct}%)`, ...examples].join('\n')),
        )
        .on('mouseleave', hideTip)
      offset += w
    }
  })

  const legend = container.append('div').attr('class', 'chart-legend')
  for (const t of present) legend.append('span').style('--swatch', `var(--type-${t})`).text(t)
}

// ---------------------------------------------------------------------------
// Commit size histogram

export function drawSizes(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const commits = commitsForAuthor(author).filter((c) => commitType(c.subject) !== 'merge')
  if (commits.length === 0) return emptyNote(container, 'No commits in the selected range.')
  const repos = activeRepos(commits)

  const buckets = SIZE_BUCKETS.map((b) => b.key)
  type Row = { bucket: string } & Record<string, number | string>
  const rows: Row[] = buckets.map((bucket) => {
    const row: Row = { bucket }
    for (const repo of repos) row[repo] = 0
    return row
  })
  for (const c of commits) {
    const row = rows[buckets.indexOf(sizeBucket(lineCount(c)))]!
    row[c.repo] = Number(row[c.repo] ?? 0) + metricOf(c)
  }
  const stacked = d3
    .stack<Row>()
    .keys(repos)
    .value((d, key) => Number(d[key] ?? 0))(rows)
  const max = Math.max(1, d3.max(stacked[stacked.length - 1] ?? [], (d) => d[1]) ?? 1)

  const margin = { top: 12, right: 12, bottom: 32, left: 40 }
  const width = 520
  const height = 240
  const innerW = width - margin.left - margin.right
  const innerH = height - margin.top - margin.bottom
  const svg = container
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('role', 'img')
    .attr('aria-label', `Commit size distribution for ${author.name}`)
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
  const x = d3.scaleBand().domain(buckets).range([0, innerW]).padding(0.25)
  const y = d3.scaleLinear().domain([0, max]).nice().range([innerH, 0])
  g.append('g')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickFormat((d) => sizeBucketLabel(d as (typeof buckets)[number])))
    .call(styleAxis)
  g.append('g')
    .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format('.3~s')))
    .call(styleAxis)

  const tipFor = (bucket: string) => {
    const inBucket = commits
      .filter((c) => sizeBucket(lineCount(c)) === bucket)
      .sort((a, b) => lineCount(b) - lineCount(a))
    const head = `${sizeBucketLabel(bucket as (typeof buckets)[number])} lines — ${plural(inBucket.length, 'commit')}${
      metric === 'lines' ? ` · ${metricText(d3.sum(inBucket, lineCount))}` : ''
    }`
    const top: TipLine[] = inBucket.slice(0, 5).map((c) => ({
      text: [
        { text: `${repoLabel(c.repo)} ${shortHash(c.hash)} ` },
        ...churnParts(c.added, c.deleted),
        { text: ` ${c.subject}` },
      ],
      color: repoColor(c.repo),
    }))
    return [{ text: head }, ...top]
  }

  const rects = g
    .selectAll('g.layer')
    .data(stacked)
    .join('g')
    .attr('class', 'layer')
    .attr('fill', (d) => repoColor(d.key))
    .selectAll('rect')
    .data((d) => d.filter((p) => p[1] > p[0]))
    .join('rect')
    .attr('x', (d) => x(String(d.data.bucket))!)
    .attr('width', x.bandwidth())
    .on('mousemove', (event: MouseEvent, d) => showTip(event, tipFor(String(d.data.bucket))))
    .on('mouseleave', hideTip)
  if (prefersReducedMotion()) {
    rects.attr('y', (d) => y(d[1])).attr('height', (d) => Math.max(0, y(d[0]) - y(d[1])))
  } else {
    rects
      .attr('y', innerH)
      .attr('height', 0)
      .transition()
      .duration(400)
      .attr('y', (d) => y(d[1]))
      .attr('height', (d) => Math.max(0, y(d[0]) - y(d[1])))
  }
  d3.select('#sizes-hint').text(
    metric === 'commits'
      ? 'Commits per size bucket (lines added + deleted), merges excluded.'
      : 'Lines changed per size bucket: where the volume comes from. Merges excluded.',
  )
  fillRepoLegend(container.append('div').attr('class', 'chart-legend'), repos)
}

// ---------------------------------------------------------------------------
// Punchcard: weekday × hour

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function weekdayOf(day: string): number {
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7
}

export function drawPunchcard(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const commits = commitsForAuthor(author)
  const counts = d3.range(7).map(() => d3.range(24).map(() => 0))
  for (const c of commits) counts[weekdayOf(c.day)]![hourFromIso(c.iso)]! += metricOf(c)
  const max = Math.max(1, d3.max(counts.flat()) ?? 1)

  const labelW = 40
  const col = 26
  const rowH = 28
  const totalW = 52
  const top = 18
  const width = labelW + 24 * col + totalW
  const height = top + 7 * rowH + 4
  const r = d3
    .scaleSqrt()
    .domain([0, max])
    .range([0, rowH / 2 - 2])

  const svg = container
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('role', 'img')
    .attr('aria-label', `${metricName()} by weekday and hour for ${author.name}`)

  for (let h = 0; h < 24; h += 3) {
    svg
      .append('text')
      .attr('x', labelW + h * col + col / 2)
      .attr('y', 11)
      .attr('text-anchor', 'middle')
      .attr('font-size', 11)
      .attr('fill', 'var(--muted)')
      .text(String(h).padStart(2, '0'))
  }

  counts.forEach((row, wi) => {
    const cy = top + wi * rowH + rowH / 2
    const weekend = wi >= 5
    svg
      .append('text')
      .attr('x', 0)
      .attr('y', cy + 4)
      .attr('font-size', 12)
      .attr('fill', weekend ? 'var(--muted)' : 'var(--ink)')
      .text(WEEKDAYS[wi]!)
    svg
      .append('line')
      .attr('x1', labelW)
      .attr('x2', labelW + 24 * col)
      .attr('y1', cy)
      .attr('y2', cy)
      .attr('stroke', 'var(--line)')
    svg
      .append('text')
      .attr('x', width)
      .attr('y', cy + 4)
      .attr('text-anchor', 'end')
      .attr('font-size', 11)
      .attr('fill', 'var(--muted)')
      .text(d3.format('.3~s')(d3.sum(row)))

    row.forEach((n, h) => {
      if (n === 0) return
      const tipText = `${WEEKDAYS[wi]} ${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59 — ${metricText(n)}`
      const dot = svg
        .append('circle')
        .attr('cx', labelW + h * col + col / 2)
        .attr('cy', cy)
        .attr('r', r(n))
        .attr('fill', 'var(--clock)')
        .attr('fill-opacity', weekend ? 0.6 : 0.9)
        .on('mousemove', (event: MouseEvent) => showTip(event, tipText))
        .on('mouseleave', hideTip)
      if (!prefersReducedMotion()) {
        dot
          .attr('r', 0)
          .transition()
          .delay(h * 8)
          .duration(300)
          .attr('r', r(n))
      }
    })
  })
}

// ---------------------------------------------------------------------------
// Hotspots: most-changed files or folders (report window only: file lists)

export type HotspotMode = 'files' | 'folders'

function folderOf(path: string): string {
  const parts = path.split('/')
  if (parts.length === 1) return '(root)'
  return parts.slice(0, Math.min(2, parts.length - 1)).join('/')
}

function truncateLeft(s: string, max: number): string {
  return s.length <= max ? s : `…${s.slice(s.length - max + 1)}`
}

export function drawHotspots(container: Container, author: AuthorSummary, mode: HotspotMode) {
  container.selectAll('*').remove()
  const commits = windowCommitsForAuthor(author)
  type Spot = { repo: string; path: string; added: number; deleted: number; commits: Set<string> }
  const spots = new Map<string, Spot>()
  for (const c of commits) {
    for (const f of c.files) {
      const path = mode === 'files' ? f.path : folderOf(f.path)
      const key = `${c.repo}\u0000${path}`
      let s = spots.get(key)
      if (!s) {
        s = { repo: c.repo, path, added: 0, deleted: 0, commits: new Set() }
        spots.set(key, s)
      }
      s.added += f.added
      s.deleted += f.deleted
      s.commits.add(c.hash)
    }
  }
  const lines = (s: Spot) => s.added + s.deleted
  const spotValue = (s: Spot) => (metric === 'commits' ? s.commits.size : lines(s))
  // Commits: rank by touches, then lines (touches say more about focus than size does).
  const top = [...spots.values()].sort((a, b) => spotValue(b) - spotValue(a) || lines(b) - lines(a)).slice(0, 15)
  if (top.length === 0) return emptyNote(container, 'No file changes in the report window.')

  const labelW = 300
  const rowH = 22
  const valueW = 150
  const width = 900
  const barW = width - labelW - valueW
  const height = top.length * rowH + 4
  const max = d3.max(top, spotValue) ?? 1
  const x = d3.scaleLinear().domain([0, max]).range([0, barW])

  const svg = container
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('role', 'img')
    .attr('aria-label', `Most changed ${mode} for ${author.name}`)

  top.forEach((s, i) => {
    const y = i * rowH + 2
    const tipText: TipLine[] = [
      { text: `${repoLabel(s.repo)} · ${s.path}`, color: repoColor(s.repo) },
      { text: [{ text: `${plural(s.commits.size, 'commit')} · ` }, ...churnParts(s.added, s.deleted)] },
    ]
    svg
      .append('text')
      .attr('x', labelW - 8)
      .attr('y', y + rowH / 2 + 3)
      .attr('text-anchor', 'end')
      .attr('font-size', 11)
      .attr('font-family', 'var(--mono)')
      .attr('fill', 'var(--ink)')
      .text(truncateLeft(s.path, 40))
      .on('mousemove', (event: MouseEvent) => showTip(event, tipText))
      .on('mouseleave', hideTip)
    const bar = svg
      .append('rect')
      .attr('x', labelW)
      .attr('y', y + 4)
      .attr('height', rowH - 8)
      .attr('rx', 2)
      .attr('fill', repoColor(s.repo))
      .on('mousemove', (event: MouseEvent) => showTip(event, tipText))
      .on('mouseleave', hideTip)
    if (prefersReducedMotion()) bar.attr('width', x(spotValue(s)))
    else
      bar
        .attr('width', 0)
        .transition()
        .duration(400)
        .attr('width', x(spotValue(s)))
    const label = svg
      .append('text')
      .attr('x', labelW + x(spotValue(s)) + 6)
      .attr('y', y + rowH / 2 + 3)
      .attr('font-size', 11)
      .attr('fill', 'var(--muted)')
    label.append('tspan').text(`${s.commits.size} · `)
    label
      .append('tspan')
      .attr('fill', 'var(--added)')
      .text(`+${num(s.added)}`)
    label.append('tspan').text(' ')
    label
      .append('tspan')
      .attr('fill', 'var(--deleted)')
      .text(`−${num(s.deleted)}`)
  })
  fillRepoLegend(container.append('div').attr('class', 'chart-legend'), [...new Set(top.map((s) => s.repo))])
}

// ---------------------------------------------------------------------------
// Work in flight: branches with unmerged commits

function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T12:00:00Z`) - Date.parse(`${fromDay}T12:00:00Z`)) / 86_400_000)
}

export function drawBranches(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const emails = emailsOf(author)
  const rows = data.branches
    .map((b) => ({
      b,
      mine: Object.entries(b.authors)
        .filter(([e]) => emails.has(e))
        .reduce((n, [, k]) => n + k, 0),
    }))
    .filter((r) => r.mine > 0)
  if (rows.length === 0) {
    return emptyNote(container, 'No branches with unmerged commits from this author moved in the report window.')
  }

  const table = container.append('table').attr('class', 'compact')
  table
    .append('thead')
    .append('tr')
    .selectAll('th')
    .data([
      'Repo',
      'Branch',
      'Unmerged (theirs / all)',
      'Behind base',
      'Last commit',
      ...(data.github ? ['Pull request'] : []),
    ])
    .join('th')
    .text((d) => d)
  const tr = table.append('tbody').selectAll('tr').data(rows).join('tr')
  tr.append('td')
    .append('span')
    .attr('class', 'repo-chip')
    .style('--swatch', (d) => repoColor(d.b.repo))
    .text((d) => repoLabel(d.b.repo))
  tr.append('td')
    .append('code')
    .text((d) => d.b.name)
    .attr('title', (d) => `${d.b.ref} vs ${d.b.base}`)
  tr.append('td').text((d) => `${d.mine} / ${d.b.ahead}`)
  tr.append('td')
    .text((d) => (d.b.behind === 0 ? 'up to date' : `${d.b.behind} behind ${d.b.base}`))
    .classed('muted', (d) => d.b.behind === 0)
  tr.append('td').each(function (d) {
    const day = d.b.lastIso.slice(0, 10)
    const age = daysBetween(day, data.window.end)
    const cell = d3.select(this)
    cell.append('span').text(age <= 0 ? 'today' : `${age}d ago`)
    if (age > 7) cell.append('span').attr('class', 'stale').text('stale')
  })
  if (data.github) {
    tr.append('td').each(function (d) {
      branchPrCell(d3.select(this), d.b.repo, d.b.name)
    })
  }
}

// ---------------------------------------------------------------------------
// Collaboration: ownership share and co-authors on the same files (report window only)

export function drawCollab(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const emails = emailsOf(author)
  const isMine = (c: Commit) => emails.has(c.authorEmail.toLowerCase())

  const rows = data.repos
    .map((repo) => {
      const repoCommits = data.allCommits.filter((c) => c.repo === repo)
      const mine = repoCommits.filter(isMine)
      if (mine.length === 0) return null
      const myFiles = new Set(mine.flatMap((c) => c.files.map((f) => f.path)))
      const repoChurn = d3.sum(repoCommits, lineCount)
      const myChurn = d3.sum(mine, lineCount)

      let sharedMine = 0
      let sharedOthers = 0
      const coauthors = new Map<string, number>()
      for (const c of repoCommits) {
        for (const f of c.files) {
          if (!myFiles.has(f.path)) continue
          const lines = f.added + f.deleted
          if (isMine(c)) sharedMine += lines
          else {
            sharedOthers += lines
            coauthors.set(c.authorEmail, (coauthors.get(c.authorEmail) ?? 0) + lines)
          }
        }
      }
      return {
        repo,
        files: myFiles.size,
        repoShare: repoChurn === 0 ? 0 : myChurn / repoChurn,
        fileShare: sharedMine + sharedOthers === 0 ? 1 : sharedMine / (sharedMine + sharedOthers),
        coauthors: [...coauthors].sort((a, b) => b[1] - a[1]).slice(0, 3),
      }
    })
    .filter((r) => r !== null)
  if (rows.length === 0) return emptyNote(container, 'No commits from this author in the report window.')

  const pct = d3.format('.0%')
  const table = container.append('table').attr('class', 'compact')
  table
    .append('thead')
    .append('tr')
    .selectAll('th')
    .data(['Repo', 'Share of repo changes', 'Files touched', 'Share on those files', 'Others on the same files'])
    .join('th')
    .text((d) => d)
  const tr = table.append('tbody').selectAll('tr').data(rows).join('tr')
  tr.append('td')
    .append('span')
    .attr('class', 'repo-chip')
    .style('--swatch', (d) => repoColor(d.repo))
    .text((d) => repoLabel(d.repo))
  const meter = (
    cell: d3.Selection<HTMLTableCellElement, (typeof rows)[number], HTMLTableSectionElement, unknown>,
    value: (d: (typeof rows)[number]) => number,
  ) => {
    const wrap = cell.append('div').attr('class', 'meter')
    wrap
      .append('div')
      .attr('class', 'meter-track')
      .append('div')
      .attr('class', 'meter-fill')
      .style('width', (d) => pct(value(d)))
      .style('background', (d) => repoColor(d.repo))
    wrap.append('span').text((d) => pct(value(d)))
  }
  meter(tr.append('td'), (d) => d.repoShare)
  tr.append('td').text((d) => num(d.files))
  meter(tr.append('td'), (d) => d.fileShare)
  tr.append('td')
    .text((d) =>
      d.coauthors.length === 0
        ? '—'
        : d.coauthors.map(([email, lines]) => `${authorNameFor(email)} (${num(lines)})`).join(', '),
    )
    .classed('muted', (d) => d.coauthors.length === 0)
}
