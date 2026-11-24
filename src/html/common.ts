import * as d3 from 'd3'
import { personKey } from '../commit-kinds.ts'
import type { AuthorSummary, BranchInfo, Commit, GithubData, HistoryData, TagInfo } from '../types.ts'

export type {
  AuthorSummary,
  BranchInfo,
  Commit,
  DayMark,
  GithubData,
  HistoryData,
  PullRequestInfo,
  TagInfo,
  WorkflowRunInfo,
} from '../types.ts'

type ReportWindow = { start: string; end: string; label: string; grain: 'day' | 'month' }

export type ReportPayload = {
  repos: string[]
  repoLabels: Record<string, string>
  subjectEmails: string[]
  /** Report-window commits with file lists (hotspots, collaboration, CI attribution). */
  allCommits: Commit[]
  window: ReportWindow
  branches: BranchInfo[]
  /** Every tag up to the window end. */
  allTags: TagInfo[]
  /** Null when GitHub data is off or gh is unavailable. */
  github: GithubData | null
  /** Whole-history commits; null when history is off (the range is then the window). */
  history: HistoryData | null
}

declare global {
  interface Window {
    __REPORT__: ReportPayload
  }
}

export const data = window.__REPORT__
export const num = d3.format(',')

// ---------------------------------------------------------------------------
// Days

const DAY_MS = 86_400_000

export function utcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function addDays(day: string, n: number): string {
  return dayKey(new Date(utcDate(day).getTime() + n * DAY_MS))
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utcDate(to).getTime() - utcDate(from).getTime()) / DAY_MS)
}

export function isWeekend(day: string): boolean {
  const d = utcDate(day).getUTCDay()
  return d === 0 || d === 6
}

// ---------------------------------------------------------------------------
// Whole history (every author, no file lists)

function buildHistory(): Commit[] {
  const h = data.history
  if (!h) return data.allCommits.map((c) => ({ ...c }))
  const start = utcDate(h.start).getTime()
  const days = new Map<number, string>()
  return h.commits.map(([off, hour, repo, email, added, deleted, hash, subject]) => {
    let day = days.get(off)
    if (!day) {
      day = dayKey(new Date(start + off * DAY_MS))
      days.set(off, day)
    }
    return {
      hash,
      iso: `${day}T${String(hour).padStart(2, '0')}:00:00`,
      day,
      authorName: h.names[email] ?? h.emails[email] ?? '',
      authorEmail: h.emails[email] ?? '',
      subject,
      repo: data.repos[repo] ?? '',
      added,
      deleted,
      files: [],
    }
  })
}

/** Every commit the dashboard can filter, sorted by day. */
export const history: Commit[] = buildHistory()
export const historyStart = history[0]?.day ?? data.window.start
export const historyEnd = data.window.end

const subjectSet = new Set(data.subjectEmails.map((e) => e.toLowerCase()))

export function isSubjectEmail(email: string): boolean {
  return subjectSet.has(email.toLowerCase())
}

const subjectName = [...history].reverse().find((c) => isSubjectEmail(c.authorEmail))?.authorName ?? 'You'

// ---------------------------------------------------------------------------
// Global filters: range, grain and metric drive every card except the window-only ones.

export type Grain = 'day' | 'week' | 'month' | 'year'
export type Metric = 'commits' | 'lines'
export type DayRange = { start: string; end: string }

export let grain: Grain = data.window.grain === 'month' ? 'month' : 'day'
export let metric: Metric = 'commits'
export let range: DayRange = clampRange({ start: data.window.start, end: data.window.end })
/** Same-length range just before `range`; null when `range` starts at the first commit. */
export let previousRange: DayRange | null = null

/** Derived from the filters; recomputed by `setFilters`. */
export const view = {
  /** Every author's commits in the range. */
  commits: [] as Commit[],
  /** Every author's commits in the previous range. */
  previous: [] as Commit[],
  /** Period keys covering the range at the current grain. */
  periods: [] as string[],
  /** Slots that count as gaps when empty: weekdays at day grain, else every period. */
  slots: [] as string[],
  /** Authors with commits in the range (the subject always included). */
  authors: [] as AuthorSummary[],
}

function clampRange(r: DayRange): DayRange {
  const start = r.start < historyStart ? historyStart : r.start
  const end = r.end > historyEnd ? historyEnd : r.end
  return start <= end ? { start, end } : { start: end, end }
}

export function setFilters(next: { grain?: Grain; metric?: Metric; range?: DayRange }) {
  if (next.grain) grain = next.grain
  if (next.metric) metric = next.metric
  if (next.range) range = clampRange(next.range)
  recompute()
}

function recompute() {
  view.commits = history.filter((c) => c.day >= range.start && c.day <= range.end)
  const len = daysBetween(range.start, range.end) + 1
  const prev = range.start > historyStart ? { start: addDays(range.start, -len), end: addDays(range.start, -1) } : null
  previousRange = prev
  view.previous = prev ? history.filter((c) => c.day >= prev.start && c.day <= prev.end) : []
  view.periods = eachPeriod(range.start, range.end)
  view.slots = grain === 'day' ? view.periods.filter((d) => !isWeekend(d)) : view.periods
  view.authors = buildAuthors(view.commits)
  authorCache.clear()
}

// ---------------------------------------------------------------------------
// Periods

const INTERVALS: Record<Grain, d3.CountableTimeInterval> = {
  day: d3.utcDay,
  week: d3.utcMonday,
  month: d3.utcMonth,
  year: d3.utcYear,
}

export function intervalOf(g: Grain = grain): d3.CountableTimeInterval {
  return INTERVALS[g]
}

function periodKey(d: Date, g: Grain): string {
  const iso = dayKey(d)
  if (g === 'month') return iso.slice(0, 7)
  if (g === 'year') return iso.slice(0, 4)
  return iso
}

/**
 * Period key for a commit day: YYYY-MM-DD (day, or the Monday of a week), YYYY-MM or YYYY.
 * The period helpers default to the global grain; the Activity graph passes its own.
 */
export function periodOf(day: string, g: Grain = grain): string {
  if (g === 'day') return day
  if (g === 'month') return day.slice(0, 7)
  if (g === 'year') return day.slice(0, 4)
  return dayKey(d3.utcMonday.floor(utcDate(day)))
}

export function periodStartDate(period: string, g: Grain = grain): Date {
  if (g === 'month') return utcDate(`${period}-01`)
  if (g === 'year') return utcDate(`${period}-01-01`)
  return utcDate(period)
}

/** Exclusive end of a period. */
export function periodEndDate(period: string, g: Grain = grain): Date {
  return intervalOf(g).offset(periodStartDate(period, g), 1)
}

export function eachPeriod(start: string, end: string, g: Grain = grain): string[] {
  const iv = intervalOf(g)
  return iv.range(iv.floor(utcDate(start)), new Date(utcDate(end).getTime() + DAY_MS)).map((d) => periodKey(d, g))
}

const fmt = (spec: string) => d3.utcFormat(spec)

/** Short axis label for a period. */
export function periodAxisLabel(period: string, g: Grain = grain): string {
  const d = periodStartDate(period, g)
  if (g === 'day') return view.periods.length <= 45 ? fmt('%-d')(d) : fmt('%b %-d')(d)
  if (g === 'week') return fmt('%b %-d')(d)
  if (g === 'month') return fmt('%b %y')(d)
  return period
}

/** Long label for tooltips. */
export function periodTitle(period: string, g: Grain = grain): string {
  const d = periodStartDate(period, g)
  if (g === 'day') return fmt('%a %Y-%m-%d')(d)
  if (g === 'week') return `Week ${fmt('%V')(d)} · from ${fmt('%Y-%m-%d')(d)}`
  if (g === 'month') return fmt('%B %Y')(d)
  return period
}

/** "weekday"/"week"/"month"/"year": the unit gaps and streaks count in. */
export function slotNoun(plural = false): string {
  const noun = grain === 'day' ? 'weekday' : grain
  return plural ? `${noun}s` : noun
}

/** Every n-th period so axis labels do not overlap. */
export function sparseTicks(periods: string[], maxTicks: number): string[] {
  if (periods.length <= maxTicks) return periods
  const step = Math.ceil(periods.length / maxTicks)
  return periods.filter((_, i) => i % step === 0)
}

export function rangeText(r: DayRange = range): string {
  const n = daysBetween(r.start, r.end) + 1
  return `${r.start} → ${r.end} (${num(n)} day${n === 1 ? '' : 's'})`
}

// ---------------------------------------------------------------------------
// Metric

export function lineCount(c: Commit): number {
  return c.added + c.deleted
}

/** One commit's weight under the current metric. */
export function metricOf(c: Commit): number {
  return metric === 'commits' ? 1 : c.added + c.deleted
}

export function metricTotal(commits: Commit[]): number {
  return metric === 'commits' ? commits.length : d3.sum(commits, lineCount)
}

export function metricText(n: number): string {
  const unit = metric === 'commits' ? 'commit' : 'line'
  return `${num(n)} ${unit}${n === 1 ? '' : 's'}`
}

export function metricName(): string {
  return metric === 'commits' ? 'Commits' : 'Lines changed'
}

// ---------------------------------------------------------------------------
// Authors

export function authorKey(author: AuthorSummary): string {
  return author.emails.join('|')
}

function summary(name: string, emails: string[], commits: Commit[], isSubject: boolean): AuthorSummary {
  const repos = new Set(commits.map((c) => c.repo))
  return {
    name,
    emails,
    commits: commits.length,
    activeDays: [...new Set(commits.map((c) => c.day))].sort(),
    repos: data.repos.filter((r) => repos.has(r)),
    isSubject,
  }
}

/** Group commits into authors: the subject (all subject emails) plus one per other email. */
export function buildAuthors(commits: Commit[]): AuthorSummary[] {
  const mine: Commit[] = []
  // One person per normalized name ("Doe, Jane" = "Jane Doe"), across addresses.
  const byPerson = new Map<string, { names: Map<string, number>; emails: Set<string>; commits: Commit[] }>()
  for (const c of commits) {
    if (isSubjectEmail(c.authorEmail)) {
      mine.push(c)
      continue
    }
    const key = personKey(c.authorName, c.authorEmail)
    let row = byPerson.get(key)
    if (!row) {
      row = { names: new Map(), emails: new Set(), commits: [] }
      byPerson.set(key, row)
    }
    row.commits.push(c)
    row.emails.add(c.authorEmail.toLowerCase())
    row.names.set(c.authorName, (row.names.get(c.authorName) ?? 0) + 1)
  }
  const others = [...byPerson.values()].map((row) => {
    // Show the spelling used most often.
    const name = [...row.names].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
    return summary(name, [...row.emails].sort(), row.commits, false)
  })
  return [summary(subjectName, [...subjectSet], mine, true), ...others].sort((a, b) => b.commits - a.commits)
}

export const subjectAuthor: AuthorSummary = summary(subjectName, [...subjectSet], [], true)

function emailSet(author: AuthorSummary): Set<string> {
  return author.isSubject ? subjectSet : new Set(author.emails.map((e) => e.toLowerCase()))
}

const authorCache = new Map<string, Commit[]>()
const historyCache = new Map<string, Commit[]>()

/** The author's commits in the current range. */
export function commitsForAuthor(author: AuthorSummary): Commit[] {
  const key = authorKey(author)
  let list = authorCache.get(key)
  if (!list) {
    const emails = emailSet(author)
    list = view.commits.filter((c) => emails.has(c.authorEmail.toLowerCase()))
    authorCache.set(key, list)
  }
  return list
}

/** The author's commits in the previous range (for deltas). */
export function previousCommitsForAuthor(author: AuthorSummary): Commit[] {
  const emails = emailSet(author)
  return view.previous.filter((c) => emails.has(c.authorEmail.toLowerCase()))
}

/** The author's whole history, ignoring the range. */
export function historyForAuthor(author: AuthorSummary): Commit[] {
  const key = authorKey(author)
  let list = historyCache.get(key)
  if (!list) {
    const emails = emailSet(author)
    list = history.filter((c) => emails.has(c.authorEmail.toLowerCase()))
    historyCache.set(key, list)
  }
  return list
}

/** The author's report-window commits, which carry file lists. */
export function windowCommitsForAuthor(author: AuthorSummary): Commit[] {
  const emails = emailSet(author)
  return data.allCommits.filter((c) => emails.has(c.authorEmail.toLowerCase()))
}

export function authorNameFor(email: string): string {
  const e = email.toLowerCase()
  return (
    view.authors.find((a) => a.emails.includes(e))?.name ??
    history.find((c) => c.authorEmail === e)?.authorName ??
    email
  )
}

recompute()

// ---------------------------------------------------------------------------
// Repos, colors, tooltips

export function repoLabel(repo: string): string {
  return data.repoLabels?.[repo] ?? repo
}

export function repoColor(repo: string): string {
  const i = data.repos.indexOf(repo)
  if (i >= 0) return `var(--repo-${i})`
  return 'var(--repo-0)'
}

/** Repos with at least one of these commits, in config order. */
export function activeRepos(commits: Commit[]): string[] {
  const seen = new Set(commits.map((c) => c.repo))
  return data.repos.filter((r) => seen.has(r))
}

export function commitsInPeriod(commits: Commit[], period: string, repo?: string): Commit[] {
  return commits.filter((c) => periodOf(c.day) === period && (repo === undefined || c.repo === repo))
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Pick dark or light ink from the cell fill’s perceived brightness. */
export function inkOn(bg: string): string {
  const c = d3.rgb(bg)
  if (Number.isNaN(c.r)) return 'var(--ink)'
  const yiq = (c.r * 299 + c.g * 587 + c.b * 114) / 1000
  // --heatmap-ink-light lets a light theme with dark high-end cells keep light ink on them.
  return yiq >= 140 ? 'var(--heatmap-ink-dark)' : 'var(--heatmap-ink-light, var(--ink))'
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function shortHash(h: string): string {
  return h.slice(0, 7)
}

export function hourFromIso(iso: string): number {
  const m = /T(\d{2}):/.exec(iso)
  return m ? Number(m[1]) : 0
}

/** A run of tooltip text; `tone` colors added lines green and deleted lines red. */
export type TipPart = { text: string; tone?: 'add' | 'del' }

/**
 * One tooltip line: plain text, or parts with colored added/deleted counts. `color` draws
 * a swatch before it that matches the chart's fill (`swatch: 'line'` for a series drawn as
 * a line, like the running total).
 */
export type TipLine = { text: string | TipPart[]; color?: string; swatch?: 'box' | 'line' }

/** "+1,234 −567" as tooltip parts: added in green, deleted in red. */
export function churnParts(added: number, deleted: number, sep = ' '): TipPart[] {
  return [{ text: `+${num(added)}`, tone: 'add' }, { text: sep }, { text: `−${num(deleted)}`, tone: 'del' }]
}

/** The same "+added / −deleted" with colors, appended into a table cell or other element. */
export function appendChurn(
  el: d3.Selection<d3.BaseType, unknown, d3.BaseType, unknown>,
  added: number,
  deleted: number,
  sep = ' / ',
) {
  el.append('span')
    .attr('class', 'add')
    .text(`+${num(added)}`)
  el.append('span').text(sep)
  el.append('span')
    .attr('class', 'del')
    .text(`−${num(deleted)}`)
}

/** HTML for "+added / −deleted" with colors, for strings that go through `.html()`. */
export function churnHtml(added: number, deleted: number, sep = ' / '): string {
  return `<span class="add">+${num(added)}</span>${sep}<span class="del">−${num(deleted)}</span>`
}

export function formatTooltip(period: string, commits: Commit[]): TipLine[] {
  const label = periodTitle(period)
  if (commits.length === 0) return [{ text: `${label}: no commits` }]
  const added = d3.sum(commits, (c) => c.added)
  const deleted = d3.sum(commits, (c) => c.deleted)
  const head: TipPart[] = [
    { text: `${label} — ${num(commits.length)} commit${commits.length === 1 ? '' : 's'} · ` },
    ...churnParts(added, deleted),
  ]
  const shown = commits.slice(-12).reverse()
  const lines: TipLine[] = shown.map((c) => ({
    text: `${grain === 'day' ? c.iso.slice(11, 16) : c.day} ${repoLabel(c.repo)} ${shortHash(c.hash)} ${c.subject}`,
    color: repoColor(c.repo),
  }))
  if (commits.length > shown.length) lines.push({ text: `… and ${num(commits.length - shown.length)} more` })
  return [{ text: head }, ...lines]
}

export function tip(): d3.Selection<d3.BaseType, unknown, HTMLElement, unknown> {
  return d3.select('#tooltip')
}

/** Show the tooltip: plain text, or lines with color swatches matching the chart. */
export function showTip(event: MouseEvent, content: string | TipLine[]) {
  const el = tip().style('opacity', 1)
  const node = el.node() as HTMLElement | null
  if (typeof content === 'string') el.text(content)
  else if (node) {
    node.replaceChildren(
      ...content.map((line) => {
        const row = document.createElement('div')
        row.className = 'tip-row'
        if (line.color) {
          const swatch = document.createElement('span')
          swatch.className = line.swatch === 'line' ? 'tip-swatch line' : 'tip-swatch'
          swatch.style.background = line.color
          row.append(swatch)
        }
        if (typeof line.text === 'string') row.append(line.text)
        else {
          for (const part of line.text) {
            if (!part.tone) {
              row.append(part.text)
              continue
            }
            const span = document.createElement('span')
            span.className = part.tone
            span.textContent = part.text
            row.append(span)
          }
        }
        return row
      }),
    )
  }
  // Keep the tooltip on screen near the right and bottom edges.
  const w = node?.offsetWidth ?? 0
  const h = node?.offsetHeight ?? 0
  const left = event.clientX + 12 + w > window.innerWidth ? event.clientX - 12 - w : event.clientX + 12
  const top = event.clientY + 12 + h > window.innerHeight ? Math.max(8, event.clientY - 12 - h) : event.clientY + 12
  el.style('left', `${Math.max(8, left)}px`).style('top', `${top}px`)
}

export function hideTip() {
  tip().style('opacity', 0)
}

export function styleAxis(ax: d3.Selection<SVGGElement, unknown, null, undefined>) {
  ax.selectAll('text').attr('font-size', 11).attr('fill', 'var(--muted)')
  ax.selectAll('line, path').attr('stroke', 'var(--axis-stroke)')
}

export function fillRepoLegend(
  container:
    | d3.Selection<d3.BaseType, unknown, HTMLElement, unknown>
    | d3.Selection<HTMLElement, unknown, null, undefined>,
  repos: string[] = data.repos,
) {
  container.selectAll('*').remove()
  for (const repo of repos) {
    container.append('span').style('--swatch', repoColor(repo)).text(repoLabel(repo))
  }
}

export function animateOpacity(el: d3.Selection<SVGElement, unknown, null, undefined>, delay: number, opacity: number) {
  if (prefersReducedMotion()) {
    el.attr('opacity', opacity)
    return
  }
  el.attr('opacity', 0).transition().delay(delay).duration(220).attr('opacity', opacity)
}

/** Width available to a chart container, for charts drawn at true pixel size. */
export function widthOf(el: HTMLElement | null, min = 320): number {
  return Math.max(min, Math.floor(el?.clientWidth ?? 900))
}

/** Mark the button with `data-mode === mode` as pressed in a `.segmented` group. */
export function press(selector: string, mode: string | null) {
  d3.selectAll<HTMLButtonElement, unknown>(`${selector} button`).attr('aria-pressed', function () {
    return String(this.dataset.mode === mode)
  })
}

/** Wire a `.segmented` button group: keeps aria-pressed in sync and reports the chosen data-mode. */
export function wire(selector: string, onChange: (mode: string) => void) {
  d3.selectAll<HTMLButtonElement, unknown>(`${selector} button`).on('click', function () {
    const mode = this.dataset.mode ?? ''
    press(selector, mode)
    onChange(mode)
  })
}
