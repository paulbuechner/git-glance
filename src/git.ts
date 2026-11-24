import { $ } from 'bun'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import type { BranchInfo, Commit, DateWindow, FileChange, HistoryData, RepoRef, TagInfo } from './types.ts'

/**
 * Calendar day from an ISO-8601 author date with offset.
 * Uses the date shown in the offset-local wall clock (the YYYY-MM-DD before T).
 */
export function dayFromIso(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(iso)
  if (!m) throw new Error(`Unexpected ISO date: ${iso}`)
  return m[1]!
}

/**
 * Every ref (`--all`) minus the stash and notes, whose commits are snapshots, not work.
 * Tool refs such as T3 Code's `refs/t3/*` checkpoints stay: they can be the only thing
 * that still reaches commits of a deleted branch. Their own snapshot commits are dropped
 * by author instead (`ignoreAuthors`).
 */
const ALL_REFS = ['--exclude=refs/stash', '--exclude=refs/notes/*', '--all']

/** True for a commit by one of `ignoreAuthors` (emails or names, any case). */
export function authorIgnorer(list: string[]): (name: string, email: string) => boolean {
  const set = new Set(list.map((s) => s.trim().toLowerCase()))
  return (name, email) => set.size > 0 && (set.has(email.toLowerCase()) || set.has(name.trim().toLowerCase()))
}

export async function isGitRepo(dir: string): Promise<boolean> {
  if (!existsSync(dir)) return false
  const check = await $`git -C ${dir} rev-parse --is-inside-work-tree`.quiet().nothrow()
  return check.exitCode === 0
}

export async function listRemotes(dir: string): Promise<string[]> {
  const result = await $`git -C ${dir} remote`.quiet().nothrow()
  if (result.exitCode !== 0) return []
  return result.stdout
    .toString()
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Age of FETCH_HEAD in ms, or null if missing / unreadable. */
export function fetchHeadAgeMs(dir: string): number | null {
  const pathResult = Bun.spawnSync(['git', '-C', dir, 'rev-parse', '--git-path', 'FETCH_HEAD'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (pathResult.exitCode !== 0) return null
  const rel = pathResult.stdout.toString().trim()
  if (!rel) return null
  const abs = resolve(dir, rel)
  if (!existsSync(abs)) return null
  try {
    const mtime = statSync(abs).mtimeMs
    return Date.now() - mtime
  } catch {
    return null
  }
}

export type FetchReposResult = {
  ok: string[]
  failed: string[]
}

export async function fetchRepos(repos: RepoRef[]): Promise<FetchReposResult> {
  const ok: string[] = []
  const failed: string[] = []

  for (const repo of repos) {
    if (!(await isGitRepo(repo.path))) {
      console.error(`✗ ${repo.name}: not a git repo (${repo.path})`)
      failed.push(repo.name)
      continue
    }

    console.log(`→ fetching ${repo.name}…`)
    const result = await $`git -C ${repo.path} fetch --all --prune`.nothrow()
    if (result.exitCode !== 0) {
      const err = result.stderr.toString().trim() || result.stdout.toString().trim()
      console.error(`✗ ${repo.name}: ${err || `exit ${result.exitCode}`}`)
      failed.push(repo.name)
      continue
    }
    console.log(`✓ ${repo.name}`)
    ok.push(repo.name)
  }

  return { ok, failed }
}

/** Earliest author-date calendar day across repos, or null if none. */
export async function earliestCommitDay(repos: RepoRef[]): Promise<string | null> {
  let earliest: string | null = null
  for (const repo of repos) {
    if (!(await isGitRepo(repo.path))) continue
    // Newest-first log; last line is the oldest. Avoid `log -n 1 --reverse`,
    // which selects one commit then reverses it (still the newest).
    const result = await $`git -C ${repo.path} log ${ALL_REFS} --format=%aI`.quiet().nothrow()
    if (result.exitCode !== 0) continue
    const lines = result.stdout
      .toString()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (lines.length === 0) continue
    const iso = lines[lines.length - 1]!
    const day = dayFromIso(iso)
    if (earliest === null || day < earliest) earliest = day
  }
  return earliest
}

/** Lock files, build output and snapshots skew line counts; always left out of stats. */
export const DEFAULT_EXCLUDE_PATHS = [
  '**/bun.lock',
  '**/bun.lockb',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/Cargo.lock',
  '**/go.sum',
  '**/poetry.lock',
  '**/composer.lock',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/*.snap',
  '**/dist/**',
  '**/build/**',
  '**/node_modules/**',
]

export type LoadCommitsOptions = {
  /** Read `--numstat` into `added`, `deleted` and `files`. */
  stats?: boolean
  /** Extra globs on top of DEFAULT_EXCLUDE_PATHS. */
  excludePaths?: string[]
  /** Globs that always count, even when they match excludePaths. */
  keepPaths?: string[]
  /** Count the deletions of bulk-deletion commits too (see `isBulkDeletion`). */
  countBulkDeletions?: boolean
  /** Emails or names whose commits are left out entirely (bots, tool snapshots). */
  ignoreAuthors?: string[]
}

/** Smallest deletion that can count as a bulk deletion. */
const BULK_DELETION_LINES = 5_000

/**
 * A commit that deletes 5,000+ lines while adding less than a tenth of that is cleanup
 * (removing inherited, vendored or generated files): its deletions do not count as work.
 * The commit itself still counts.
 */
export function isBulkDeletion(added: number, deleted: number): boolean {
  return deleted >= BULK_DELETION_LINES && added * 10 <= deleted
}

/**
 * Resolve git's rename notation to the new path:
 * `src/{old => new}/x.ts` → `src/new/x.ts`, `old.ts => new.ts` → `new.ts`.
 */
export function renamedPath(path: string): string {
  const braced = path
    .replace(/\{[^{}]* => ([^{}]*)\}/g, '$1')
    .replace(/\/\/+/g, '/')
    .replace(/^\//, '')
  if (braced !== path) return braced
  const arrow = path.indexOf(' => ')
  return arrow >= 0 ? path.slice(arrow + 4) : path
}

export function excluder(patterns: string[], keep: string[] = []): (path: string) => boolean {
  const globs = [...DEFAULT_EXCLUDE_PATHS, ...patterns].map((p) => new Bun.Glob(p))
  const keepers = keep.map((p) => new Bun.Glob(p))
  return (path) => !keepers.some((g) => g.match(path)) && globs.some((g) => g.match(path))
}

/** True for paths matching any of `patterns` (keepPaths). */
export function matcher(patterns: string[]): (path: string) => boolean {
  const globs = patterns.map((p) => new Bun.Glob(p))
  return (path) => globs.some((g) => g.match(path))
}

const RECORD = '\x1e'

/**
 * Parse `git log --format=<RS>%H…%s [--numstat]` output. `ignoreBulkDeletions` zeroes the
 * deletions of bulk-deletion commits (the raw cache parses without it).
 */
export function parseLog(
  text: string,
  repo: string,
  isExcluded: (path: string) => boolean,
  ignoreBulkDeletions = false,
): Commit[] {
  const commits: Commit[] = []
  for (const record of text.split(RECORD)) {
    if (!record.trim()) continue
    const [header, ...statLines] = record.split('\n')
    const parts = header!.split('\t')
    if (parts.length < 5) continue
    const [hash, iso, authorName, authorEmail, ...subjectParts] = parts
    if (!hash || !iso || !authorName || !authorEmail) continue

    const files: FileChange[] = []
    let changed = 0
    for (const line of statLines) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
      if (!m) continue
      changed++
      const path = renamedPath(m[3]!)
      if (isExcluded(path)) continue
      files.push({
        path,
        added: m[1] === '-' ? 0 : Number(m[1]),
        deleted: m[2] === '-' ? 0 : Number(m[2]),
      })
    }
    // A commit that only touched excluded paths (generated code, test data, lock files) is
    // noise: drop it entirely so it adds no commit either. Merges have no numstat and stay.
    if (changed > 0 && files.length === 0) continue
    if (ignoreBulkDeletions) {
      const added = files.reduce((n, f) => n + f.added, 0)
      const deleted = files.reduce((n, f) => n + f.deleted, 0)
      if (isBulkDeletion(added, deleted)) for (const f of files) f.deleted = 0
    }

    commits.push({
      hash,
      iso,
      day: dayFromIso(iso),
      authorName,
      authorEmail: authorEmail.toLowerCase(),
      subject: subjectParts.join('\t'),
      repo,
      added: files.reduce((n, f) => n + f.added, 0),
      deleted: files.reduce((n, f) => n + f.deleted, 0),
      files,
    })
  }
  return commits
}

export async function loadCommits(repo: RepoRef, window: DateWindow, opts: LoadCommitsOptions = {}): Promise<Commit[]> {
  if (!(await isGitRepo(repo.path))) {
    throw new Error(`Not a git repo: ${repo.path}`)
  }

  // --until is exclusive in git for date-only forms in some versions; use end+1 day
  // with a time so the inclusive end day is fully included.
  const until = `${window.end} 23:59:59`
  const format = '%x1e%H%x09%aI%x09%an%x09%ae%x09%s'
  const stats = opts.stats ? ['--numstat'] : []

  const result =
    window.label === 'all-time'
      ? await $`git -c core.quotePath=false -C ${repo.path} log ${ALL_REFS} --until=${until} --format=${format} ${stats}`
          .quiet()
          .nothrow()
      : await $`git -c core.quotePath=false -C ${repo.path} log ${ALL_REFS} --since=${`${window.start} 00:00:00`} --until=${until} --format=${format} ${stats}`
          .quiet()
          .nothrow()

  if (result.exitCode !== 0) {
    const err = result.stderr.toString().trim()
    throw new Error(`git log failed in ${repo.name}: ${err || result.exitCode}`)
  }

  const ignored = authorIgnorer(opts.ignoreAuthors ?? [])
  return parseLog(
    result.stdout.toString(),
    repo.name,
    excluder(opts.excludePaths ?? [], opts.keepPaths ?? []),
    !opts.countBulkDeletions,
  ).filter((c) => !ignored(c.authorName, c.authorEmail))
}

export async function loadAllCommits(
  repos: RepoRef[],
  window: DateWindow,
  opts: LoadCommitsOptions = {},
): Promise<Commit[]> {
  const perRepo = await Promise.all(repos.map((repo) => loadCommits(repo, window, opts)))
  const all = perRepo.flat()
  all.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0))
  return all
}

const DAY_MS = 86_400_000

function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS)
}

function dayFromNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10)
}

/** Bump when the cache layout changes. */
const STATS_CACHE_VERSION = 2

/**
 * Raw `--numstat` per commit, before any path exclusion, so changing excludePaths never
 * forces a recompute. `stats[hash]` is flat [pathIndex, added, deleted, …] into `paths`.
 * `generated[pathIndex]` caches the header check (1 = generated, 0 = not).
 */
type StatsCache = {
  v: number
  paths: string[]
  stats: Record<string, number[]>
  generated?: Record<string, number>
}

type LoggedCommit = { hash: string; iso: string; name: string; email: string; subject: string }

/** Generator banners; only matched in comment lines, so a generator's own source does not trip it. */
const GENERATED_BANNER =
  /<auto-?generated|auto-generated by|generated by (a tool|javacc|jjtree|xsd|the )|Generated By:(JavaCC|JJTree)|Dieser Code wurde von einem Tool generiert|openapi-generator|@generated|DO NOT EDIT|template \w+\.ftl/i
const COMMENT_LINE = /^(\/\/|\/\*|\*|#|'|--|<!--)/
/** Source files worth a header check; data formats are left to excludePaths. */
const CODE_FILE = /\.(cs|vb|java|kt|scala|ts|tsx|js|mjs|cpp|cc|cxx|c|h|hh|hpp|hxx|py|go|swift|rs)$/i
/** Only files that once gained at least this many lines in one commit are checked. */
const GENERATED_MIN_LINES = 100

/** True when a comment line among the first 40 lines carries a generator banner. */
export function looksGenerated(head: string): boolean {
  for (const raw of head
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .slice(0, 40)) {
    const line = raw.trim()
    if (COMMENT_LINE.test(line) && GENERATED_BANNER.test(line)) return true
  }
  return false
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** Raw `--numstat` for exactly these commits (hashes on stdin), nothing excluded. */
async function numstatFor(repo: RepoRef, hashes: string[]): Promise<Map<string, FileChange[]>> {
  const proc = Bun.spawn(
    [
      'git',
      '-c',
      'core.quotePath=false',
      '-C',
      repo.path,
      'log',
      '--no-walk=unsorted',
      '--stdin',
      '--format=%x1e%H%x09%aI%x09%an%x09%ae%x09%s',
      '--numstat',
    ],
    { stdin: new Blob([`${hashes.join('\n')}\n`]), stdout: 'pipe', stderr: 'pipe' },
  )
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`git log --numstat failed in ${repo.name}: ${err.trim() || code}`)
  const files = new Map<string, FileChange[]>()
  for (const c of parseLog(out, repo.name, () => false)) files.set(c.hash, c.files)
  return files
}

/** Header check for `hash:path` blobs via one `git cat-file --batch`; true = generated. */
async function checkGenerated(repo: RepoRef, blobs: { hash: string; path: string }[]): Promise<boolean[]> {
  const proc = Bun.spawn(['git', '-C', repo.path, 'cat-file', '--batch'], {
    stdin: new Blob([`${blobs.map((b) => `${b.hash}:${b.path}`).join('\n')}\n`]),
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const buf = Buffer.from(await new Response(proc.stdout).arrayBuffer())
  await proc.exited
  const out: boolean[] = []
  let pos = 0
  for (let i = 0; i < blobs.length; i++) {
    const nl = buf.indexOf(10, pos)
    if (nl < 0) break
    const header = buf.subarray(pos, nl).toString()
    pos = nl + 1
    const m = /^\S+ blob (\d+)$/.exec(header)
    if (!m) {
      out.push(false) // missing object or not a blob
      continue
    }
    const size = Number(m[1])
    out.push(looksGenerated(buf.subarray(pos, pos + Math.min(size, 4000)).toString()))
    pos += size + 1
  }
  return out
}

/** How a path counts: excluded by pattern, detected as generated, or kept regardless. */
export type PathRules = {
  isExcluded: (path: string) => boolean
  isKept: (path: string) => boolean
  detectGenerated: boolean
  /** Count the deletions of bulk-deletion commits too (see `isBulkDeletion`). */
  countBulkDeletions?: boolean
  /** Authors whose commits are left out entirely. */
  isIgnoredAuthor?: (name: string, email: string) => boolean
}

/**
 * Every commit reachable in `repo` up to `until`, with line counts after the path rules.
 * Raw per-file stats are cached per commit hash in `cacheDir`, so only commits not seen
 * before run `--numstat` (the first run over a large history takes minutes; later runs
 * take seconds), and editing excludePaths only re-reads the cache.
 */
async function repoHistory(
  repo: RepoRef,
  until: string,
  rules: PathRules,
  cacheDir: string,
): Promise<{
  commits: (LoggedCommit & { added: number; deleted: number })[]
  computed: number
  generated: string[]
}> {
  const result =
    await $`git -C ${repo.path} log ${ALL_REFS} --until=${until} --format=${'%H%x09%aI%x09%an%x09%ae%x09%s'}`
      .quiet()
      .nothrow()
  if (result.exitCode !== 0) {
    const err = result.stderr.toString().trim()
    throw new Error(`git log (history) failed in ${repo.name}: ${err || result.exitCode}`)
  }
  const logged: LoggedCommit[] = []
  for (const line of result.stdout.toString().split('\n')) {
    const [hash, iso, name, email, ...subject] = line.split('\t')
    if (!hash || !iso || !name || !email) continue
    if (rules.isIgnoredAuthor?.(name, email)) continue
    logged.push({ hash, iso, name, email: email.toLowerCase(), subject: subject.join('\t') })
  }

  const cachePath = join(cacheDir, `${repo.name}.json`)
  let cache: StatsCache = { v: STATS_CACHE_VERSION, paths: [], stats: {} }
  try {
    const file = (await Bun.file(cachePath).json()) as StatsCache
    if (file.v === STATS_CACHE_VERSION) cache = file
  } catch {
    // no cache yet, or unreadable: recompute
  }
  const pathIndex = new Map(cache.paths.map((p, i) => [p, i]))
  const indexOf = (path: string) => {
    let i = pathIndex.get(path)
    if (i === undefined) {
      i = cache.paths.length
      cache.paths.push(path)
      pathIndex.set(path, i)
    }
    return i
  }

  let dirty = false
  const missing = logged.filter((c) => cache.stats[c.hash] === undefined).map((c) => c.hash)
  if (missing.length > 0) {
    const fresh = await numstatFor(repo, missing)
    for (const hash of missing) {
      cache.stats[hash] = (fresh.get(hash) ?? []).flatMap((f) => [indexOf(f.path), f.added, f.deleted])
    }
    dirty = true
  }
  const kept: Record<string, number[]> = {}
  for (const c of logged) kept[c.hash] = cache.stats[c.hash] ?? []
  if (Object.keys(cache.stats).length !== logged.length) dirty = true

  // Header check for large source files not checked yet, at the commit that added the most lines.
  const generated = cache.generated ?? {}
  if (rules.detectGenerated) {
    const best = new Map<number, { hash: string; added: number }>()
    for (const [hash, flat] of Object.entries(kept)) {
      for (let i = 0; i < flat.length; i += 3) {
        const p = flat[i]!
        const added = flat[i + 1]!
        if (added < GENERATED_MIN_LINES || generated[p] !== undefined) continue
        if (!CODE_FILE.test(cache.paths[p]!)) continue
        const prev = best.get(p)
        if (!prev || added > prev.added) best.set(p, { hash, added })
      }
    }
    if (best.size > 0) {
      const todo = [...best]
      const flags = await checkGenerated(
        repo,
        todo.map(([p, b]) => ({ hash: b.hash, path: cache.paths[p]! })),
      )
      todo.forEach(([p], i) => {
        generated[p] = flags[i] ? 1 : 0
      })
      dirty = true
    }
  }
  if (dirty) {
    await Bun.write(
      cachePath,
      JSON.stringify({ v: STATS_CACHE_VERSION, paths: cache.paths, stats: kept, generated } satisfies StatsCache),
    )
  }

  const excluded = cache.paths.map(
    (p, i) => !rules.isKept(p) && (rules.isExcluded(p) || (rules.detectGenerated && generated[i] === 1)),
  )
  const commits: (LoggedCommit & { added: number; deleted: number })[] = []
  for (const c of logged) {
    const flat = kept[c.hash]!
    let added = 0
    let deleted = 0
    let files = 0
    for (let i = 0; i < flat.length; i += 3) {
      if (excluded[flat[i]!]) continue
      files++
      added += flat[i + 1]!
      deleted += flat[i + 2]!
    }
    // Same rules as parseLog: a commit that only touched excluded paths is dropped, and a
    // bulk deletion keeps its added lines only.
    if (flat.length > 0 && files === 0) continue
    if (!rules.countBulkDeletions && isBulkDeletion(added, deleted)) deleted = 0
    commits.push({ ...c, added, deleted })
  }
  const generatedPaths = rules.detectGenerated
    ? cache.paths.filter((p, i) => generated[i] === 1 && !rules.isKept(p))
    : []
  return { commits, computed: missing.length, generated: generatedPaths }
}

export type HistoryResult = {
  history: HistoryData
  /** Paths detected as generated, per repo name (already left out of `history`). */
  generated: Record<string, string[]>
  /** Commit hashes per repo name that are counted in another repo (shared history). */
  elsewhere: Record<string, string[]>
}

/**
 * Every author's commits across the whole history up to `end`, one compact row per
 * commit, for the dashboard's global range filter. File lists are left out; the
 * report window keeps those.
 */
export async function loadHistory(
  repos: RepoRef[],
  end: string,
  rules: PathRules,
  cacheDir: string,
  log: (message: string) => void = () => {},
): Promise<HistoryResult | null> {
  await mkdir(cacheDir, { recursive: true })
  const until = `${end} 23:59:59`

  let computed = 0
  const generated: Record<string, string[]> = {}
  const loaded = await mapLimit(repos, 6, async (repo) => {
    const r = await repoHistory(repo, until, rules, cacheDir)
    if (r.computed > 0) {
      computed += r.computed
      log(`History: line stats for ${r.computed} new commits in ${repo.name}`)
    }
    if (r.generated.length > 0) generated[repo.name] = r.generated
    return r.commits
  })

  // A commit reachable from several repos (a clone that kept its history) counts once, in
  // the repo with the most commits: usually the original the others were cloned from.
  const order = repos.map((_, i) => i).sort((a, b) => loaded[b]!.length - loaded[a]!.length || a - b)
  const owner = new Map<string, number>()
  for (const i of order) {
    for (const c of loaded[i]!) if (!owner.has(c.hash)) owner.set(c.hash, i)
  }
  const elsewhere: Record<string, string[]> = {}
  const perRepo = loaded.map((commits, i) => {
    const mine = commits.filter((c) => owner.get(c.hash) === i)
    if (mine.length < commits.length) {
      const shared = commits.filter((c) => owner.get(c.hash) !== i)
      elsewhere[repos[i]!.name] = shared.map((c) => c.hash)
      const where = [...new Set(shared.map((c) => repos[owner.get(c.hash)!]!.name))].join(', ')
      log(`History: ${shared.length} commits of ${repos[i]!.name} are shared with ${where} and counted there`)
    }
    return mine
  })

  let startNum = Number.POSITIVE_INFINITY
  for (const commits of perRepo) {
    for (const c of commits) startNum = Math.min(startNum, dayNumber(dayFromIso(c.iso)))
  }
  if (!Number.isFinite(startNum)) return null
  const endNum = dayNumber(end)

  const emails: string[] = []
  const names: string[] = []
  const newest: string[] = []
  const emailIndex = new Map<string, number>()
  const rows: HistoryData['commits'] = []
  perRepo.forEach((commits, repoIndex) => {
    for (const c of commits) {
      let ei = emailIndex.get(c.email)
      if (ei === undefined) {
        ei = emails.length
        emailIndex.set(c.email, ei)
        emails.push(c.email)
        names.push(c.name)
        newest.push(c.iso)
      } else if (c.iso > newest[ei]!) {
        names[ei] = c.name
        newest[ei] = c.iso
      }
      const off = Math.min(dayNumber(dayFromIso(c.iso)), endNum) - startNum
      const hour = Number(c.iso.slice(11, 13)) || 0
      rows.push([off, hour, repoIndex, ei, c.added, c.deleted, c.hash.slice(0, 10), c.subject.slice(0, 140)])
    }
  })
  rows.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (computed > 0) log(`History: computed line stats for ${computed} commits (cached in ${cacheDir})`)

  return { history: { start: dayFromNumber(startNum), end, emails, names, commits: rows }, generated, elsewhere }
}

/** Drop commits that the history counts in another repo (shared history between clones). */
export function withoutShared(commits: Commit[], elsewhere: Record<string, string[]>): Commit[] {
  const sets = new Map(Object.entries(elsewhere).map(([repo, hashes]) => [repo, new Set(hashes)]))
  return commits.filter((c) => !sets.get(c.repo)?.has(c.hash))
}

/**
 * Leave detected generated files out of already-loaded commits (the report window loads
 * its own file lists): drop those files, recount lines, and drop commits left with none.
 */
export function withoutGenerated(commits: Commit[], generated: Record<string, string[]>): Commit[] {
  const sets = new Map(Object.entries(generated).map(([repo, paths]) => [repo, new Set(paths)]))
  const out: Commit[] = []
  for (const c of commits) {
    const set = sets.get(c.repo)
    if (!set || c.files.length === 0) {
      out.push(c)
      continue
    }
    const files = c.files.filter((f) => !set.has(f.path))
    if (files.length === c.files.length) out.push(c)
    else if (files.length > 0) {
      out.push({
        ...c,
        files,
        added: files.reduce((n, f) => n + f.added, 0),
        deleted: files.reduce((n, f) => n + f.deleted, 0),
      })
    }
  }
  return out
}

async function lines(cmd: ReturnType<typeof $>): Promise<string[] | null> {
  const result = await cmd.quiet().nothrow()
  if (result.exitCode !== 0) return null
  return result.stdout
    .toString()
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** origin/HEAD target, else the first of origin/main, origin/master, main, master that exists. */
export async function defaultBranch(dir: string): Promise<string | null> {
  const head = await lines($`git -C ${dir} symbolic-ref --short refs/remotes/origin/HEAD`)
  if (head?.[0]) return head[0]
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    const ok = await lines($`git -C ${dir} rev-parse --verify --quiet ${`${candidate}^{commit}`}`)
    if (ok?.length) return candidate
  }
  return null
}

/**
 * Branches (local or remote) whose tip moved since `window.start` and that hold
 * commits not on the default branch. Local and remote copies of the same branch
 * collapse to whichever tip is newer.
 */
export async function loadBranches(repo: RepoRef, window: DateWindow): Promise<BranchInfo[]> {
  if (!(await isGitRepo(repo.path))) return []
  const base = await defaultBranch(repo.path)
  if (!base) return []
  const baseShort = base.replace(/^[^/]+\//, '')

  const refs = await lines(
    $`git -C ${repo.path} for-each-ref --format=${'%(refname)%09%(refname:short)%09%(committerdate:iso-strict)'} refs/heads refs/remotes`,
  )
  if (!refs) return []

  const newest = new Map<string, { ref: string; iso: string }>()
  for (const line of refs) {
    const [full, short, iso] = line.split('\t')
    if (!full || !short || !iso) continue
    if (full.endsWith('/HEAD')) continue
    const name = full.startsWith('refs/remotes/') ? short.replace(/^[^/]+\//, '') : short
    if (name === baseShort || short === base) continue
    if (window.label !== 'all-time' && dayFromIso(iso) < window.start) continue
    const prior = newest.get(name)
    if (!prior || iso > prior.iso) newest.set(name, { ref: short, iso })
  }

  const branches = await Promise.all(
    [...newest].map(async ([name, { ref, iso }]): Promise<BranchInfo | null> => {
      const emails = await lines($`git -C ${repo.path} log --no-merges --format=%ae ${`${base}..${ref}`}`)
      if (!emails || emails.length === 0) return null
      const behind = await lines($`git -C ${repo.path} rev-list --count ${`${ref}..${base}`}`)
      const authors: Record<string, number> = {}
      for (const e of emails) {
        const key = e.toLowerCase()
        authors[key] = (authors[key] ?? 0) + 1
      }
      return {
        repo: repo.name,
        name,
        ref,
        base,
        lastIso: iso,
        ahead: emails.length,
        behind: Number(behind?.[0] ?? 0),
        authors,
      }
    }),
  )
  return branches.filter((b): b is BranchInfo => b !== null).sort((a, b) => (a.lastIso < b.lastIso ? 1 : -1))
}

/** Tags whose creator date falls inside the window. */
export async function loadTags(repo: RepoRef, window: DateWindow): Promise<TagInfo[]> {
  if (!(await isGitRepo(repo.path))) return []
  const rows = await lines(
    $`git -C ${repo.path} for-each-ref --format=${'%(refname:short)%09%(creatordate:iso-strict)'} refs/tags`,
  )
  if (!rows) return []
  const tags: TagInfo[] = []
  for (const row of rows) {
    const [name, iso] = row.split('\t')
    if (!name || !iso) continue
    const day = dayFromIso(iso)
    if (day > window.end || (window.label !== 'all-time' && day < window.start)) continue
    tags.push({ repo: repo.name, name, iso, day })
  }
  return tags.sort((a, b) => (a.iso < b.iso ? -1 : 1))
}

/** True if any commit in the last `sinceDays` matches the author email (case-insensitive). */
export async function emailHasCommits(repos: RepoRef[], email: string, sinceDays: number): Promise<boolean> {
  const needle = email.toLowerCase()
  const since = `${sinceDays} days ago`
  for (const repo of repos) {
    if (!(await isGitRepo(repo.path))) continue
    const result = await $`git -C ${repo.path} log ${ALL_REFS} --since=${since} --author=${needle} --format=%ae -n 1`
      .quiet()
      .nothrow()
    if (result.exitCode !== 0) continue
    const hit = result.stdout.toString().trim().toLowerCase()
    if (hit) return true
  }
  return false
}
