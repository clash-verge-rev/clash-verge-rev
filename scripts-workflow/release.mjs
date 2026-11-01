import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const env = process.env
const repository = env.GITHUB_REPOSITORY
const refreshLabel = 'Refresh this PR from latest dev'
const publishLabel = 'Publish this approved release'
const minorLabel = 'Use the next minor version'
const checked = (body, label = refreshLabel) =>
  (body || '')
    .split('\n')
    .some((line) => line.toLowerCase() === `- [x] ${label}`.toLowerCase())
const versionPattern = '(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)'
const rcPattern = new RegExp(`^v${versionPattern}-rc(?:\\.(0|[1-9][0-9]*))?$`)
const stablePattern = new RegExp(`^v${versionPattern}$`)
const versionFiles = [
  'package.json',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'Cargo.lock',
]
const read = (path) => readFileSync(path, 'utf8')
const json = (path) => JSON.parse(read(path))
const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: 'utf8', ...options }).trim()
const git = (...args) => run('git', args)
const gitFile = (sha, path) =>
  execFileSync('git', ['show', `${sha}:${path}`], { encoding: 'utf8' })
const isRc = (tag) => tag.match(rcPattern)?.[0] === tag
const isRelease = (tag) => isRc(tag) || stablePattern.test(tag)
const titleFor = (tag) => `${isRc(tag) ? 'Pre-Release' : 'Release'}: ${tag}`
const branchTag = (branch, prefix = 'release/') =>
  branch.startsWith(prefix) && isRelease(branch.slice(prefix.length))
    ? branch.slice(prefix.length)
    : undefined
const latest = (tags) =>
  tags.sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).at(-1)
const summary = (text) => appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`)
const endpoint = (path) =>
  path === 'graphql' ? path : `repos/${repository}/${path}`
const list = (path) =>
  JSON.parse(run('gh', ['api', '--paginate', '--slurp', endpoint(path)])).flat()

function api(path, body, method = 'POST') {
  const response = run(
    'gh',
    ['api', '--method', method, endpoint(path), '--input', '-'],
    {
      input: JSON.stringify(body),
    },
  )
  const result = response ? JSON.parse(response) : null
  if (result?.errors) throw new Error(JSON.stringify(result.errors))
  return result
}

const get = (path) => JSON.parse(run('gh', ['api', endpoint(path)]))
const canWrite = (login) =>
  ['write', 'maintain', 'admin'].includes(
    get(`collaborators/${login}/permission`).permission,
  )

function output(values) {
  appendFileSync(
    env.GITHUB_OUTPUT,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  )
}

function versionPatternFor(path) {
  if (path.endsWith('.json')) return /("version"\s*:\s*")[^"]+/
  return path === 'Cargo.lock'
    ? /(\[\[package\]\]\r?\nname = "clash-verge"\r?\nversion = ")[^"]+/
    : /(^version\s*=\s*")[^"]+/m
}

function validateVersions(tag, sha) {
  for (const path of versionFiles) {
    const content = sha ? gitFile(sha, path) : read(path)
    const version = path.endsWith('.json')
      ? JSON.parse(content).version
      : content.match(versionPatternFor(path))?.[0].split('"').at(-1)
    if (`v${version}` !== tag)
      throw new Error(`${path} version does not match ${tag}.`)
  }
}

function validateVersionCommit(tag, sha) {
  validateVersions(tag, sha)
  const commit = get(`commits/${sha}`)
  if (!commit.commit.verification.verified || commit.parents.length !== 1)
    throw new Error('The version commit must be signed and have one parent.')
  const title = commit.commit.message.split('\n')[0]
  if (title.replace(/ \(#\d+\)$/, '') !== titleFor(tag))
    throw new Error('The final version commit has an unexpected title.')
  const parent = commit.parents[0].sha
  const changed = git('diff', '--name-only', parent, sha)
    .split('\n')
    .filter(Boolean)
  if (
    changed.some((path) => !versionFiles.includes(path)) ||
    git('diff', '--summary', parent, sha)
  )
    throw new Error(
      'The version commit changes files outside the four version files.',
    )
  for (const path of versionFiles) {
    const before = gitFile(parent, path)
    const after = gitFile(sha, path)
    if (
      before.replace(versionPatternFor(path), '$1VERSION') !==
      after.replace(versionPatternFor(path), '$1VERSION')
    )
      throw new Error(`${path} contains changes other than its version.`)
  }
}

function remoteRefs() {
  return git('ls-remote', '--heads', '--tags', '--refs', 'origin')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
}

function fetchBranches() {
  git(
    'fetch',
    '--no-tags',
    'origin',
    '+refs/heads/dev:refs/remotes/origin/dev',
    '+refs/heads/main:refs/remotes/origin/main',
  )
}

function discardClosedCandidate(branch, base, prefix) {
  const candidates = list(
    `pulls?state=all&base=${base}&head=${repository.split('/')[0]}:${branch}&per_page=100`,
  )
  const latest = candidates[0]
  if (!latest || candidates.some((pr) => pr.state === 'open'))
    throw new Error(
      `Branch ${branch} is reserved by an active or unknown candidate.`,
    )
  const pr = get(`pulls/${latest.number}`)
  requireBotPr(pr, base, prefix)
  if (pr.state !== 'closed' || pr.merged)
    throw new Error(
      `Close the unmerged candidate before retrying: ${pr.html_url}`,
    )
  updateRefs(pr.base.repo.node_id, [
    {
      name: `refs/heads/${branch}`,
      beforeOid: pr.head.sha,
      afterOid: '0'.repeat(40),
    },
  ])
  summary(`Released the unused branch from closed PR: ${pr.html_url}`)
}

function prepare() {
  let refresh
  if (env.GITHUB_EVENT_NAME === 'pull_request_target') {
    const event = json(env.GITHUB_EVENT_PATH)
    if (checked(event.changes?.body?.from) || !checked(event.pull_request.body))
      return
    if (!canWrite(event.sender.login))
      throw new Error('Refreshing a version PR requires write access.')
    refresh = get(`pulls/${event.pull_request.number}`)
    if (refresh.state !== 'open' || !checked(refresh.body)) return
    requireBotPr(refresh, 'dev', 'release/')
  }
  fetchBranches()
  git('checkout', '--detach', 'origin/dev')
  const channel = refresh
    ? isRc(branchTag(refresh.head.ref))
      ? 'rc'
      : 'stable'
    : env.RELEASE_CHANNEL || 'rc'
  if (!['rc', 'stable'].includes(channel))
    throw new Error('Unknown release channel.')
  const requested = refresh
    ? branchTag(refresh.head.ref)
    : env.RELEASE_TAG || ''
  if (
    requested &&
    !(channel === 'rc' ? isRc(requested) : stablePattern.test(requested))
  )
    throw new Error(
      channel === 'rc'
        ? 'Expected vX.Y.Z-rc or vX.Y.Z-rc.N.'
        : 'Expected vX.Y.Z.',
    )
  const existing =
    !refresh &&
    list('pulls?state=open&base=dev&per_page=100').find(
      (pr) =>
        pr.head.repo?.full_name === repository &&
        pr.user.login === 'github-actions[bot]' &&
        branchTag(pr.head.ref) &&
        isRc(branchTag(pr.head.ref)) === (channel === 'rc') &&
        (!requested || branchTag(pr.head.ref) === requested),
    )
  if (existing) {
    api(`issues/${existing.number}/labels`, { labels: ['release'] })
    output({ existing_pr: existing.html_url })
    summary(
      `Existing version PR: ${existing.html_url}\nClose it before preparing a replacement; its candidate is unchanged.`,
    )
    return
  }
  const base = (requested || `v${json('package.json').version}`).split(
    /[-+]/,
  )[0]
  if (!stablePattern.test(base))
    throw new Error(`Invalid base version: ${base}`)
  const refs = remoteRefs().map(([, ref]) => ref)
  const tags = refs
    .filter((ref) => ref.startsWith('refs/tags/'))
    .map((ref) => ref.slice(10))
  const reserved = refs
    .filter((ref) => ref.startsWith('refs/heads/'))
    .filter((ref) => !refresh || ref !== `refs/heads/${refresh.head.ref}`)
    .map(
      (ref) => branchTag(ref.slice(11)) || branchTag(ref.slice(11), 'publish/'),
    )
    .filter(Boolean)
  const sameBase = (tag) => isRc(tag) && tag.startsWith(`${base}-rc`)
  const occupied = [...tags, ...reserved]
  const last = latest(occupied.filter(sameBase))
  const tag =
    requested ||
    (channel === 'stable'
      ? base
      : last
        ? `${base}-rc.${BigInt(last.match(rcPattern)[4] ?? 0) + 1n}`
        : `${base}-rc`)
  if (tags.includes(tag)) throw new Error(`Tag ${tag} already exists.`)
  for (const [prefix, target] of [
    ['release/', 'dev'],
    ['publish/', 'main'],
  ]) {
    const branch = `${prefix}${tag}`
    if (refs.includes(`refs/heads/${branch}`) && branch !== refresh?.head.ref)
      discardClosedCandidate(branch, target, prefix)
  }
  const sha = git('rev-parse', 'HEAD')
  const body = releaseBody(tag, sha, tags, false)
  summary(body)
  if (
    remoteRefs().some(
      ([, ref]) =>
        ref === `refs/tags/${tag}` || ref === `refs/heads/publish/${tag}`,
    )
  )
    throw new Error(`Tag ${tag} already exists or is reserved for publication.`)
  if (json('package.json').version !== tag.slice(1))
    run('node', ['scripts/release-version.mjs', tag])
  validateVersions(tag)
  const title = titleFor(tag)
  const branch = refresh
    ? `release-refresh/${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`
    : `release/${tag}`
  writeVersionPr({ sha, body, refresh, title, branch, files: versionFiles })
}

function releaseBody(tag, sha, tags, publishing) {
  const previous =
    (isRc(tag) &&
      latest(
        tags.filter(
          (value) =>
            isRc(value) &&
            value.startsWith(`${tag.split('-')[0]}-rc`) &&
            value !== tag,
        ),
      )) ||
    latest(tags.filter((value) => stablePattern.test(value) && value !== tag))
  const url = `${env.GITHUB_SERVER_URL}/${repository}`
  let range = sha
  let comparison = 'No previous release tag'
  if (previous) {
    git('fetch', '--no-tags', 'origin', `refs/tags/${previous}`)
    range = `${git('rev-parse', 'FETCH_HEAD^{commit}')}..${sha}`
    comparison = `Changes since **${previous}** · [Compare changes](${url}/compare/${previous}...${sha})`
  }
  comparison += ` · **${git('rev-list', '--count', range)} commits**`
  const commits = git('log', '--format=%h %s', range)
  const groups = Object.groupBy(commits ? commits.split('\n') : [], (line) => {
    if (/^\S+ chore\(deps\)!?: /i.test(line)) return 'deps'
    const type = line.match(/^\S+ (\w+)(?:\([^)]*\))?!?: /)?.[1]?.toLowerCase()
    return type === 'doc' ? 'docs' : type || 'other'
  })
  const labels = {
    fix: 'Fixes',
    feat: 'Features',
    perf: 'Performance',
    revert: 'Reverts',
    refactor: 'Refactoring',
    build: 'Build',
    deps: 'Dependencies',
    ci: 'CI',
    docs: 'Documentation',
    test: 'Tests',
    chore: 'Maintenance',
    style: 'Style',
    other: 'Other',
  }
  const names = {
    macos: 'macOS',
    windows: 'Windows',
    ui: 'UI',
    ci: 'CI',
    tun: 'TUN',
  }
  const order = Object.keys(labels)
  const rank = (type) =>
    order.includes(type) ? order.indexOf(type) : order.length
  const scope =
    Object.entries(groups)
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([type, lines]) => {
        const entries = lines.map((line) => {
          const hash = line.slice(0, line.indexOf(' '))
          const title = line
            .slice(hash.length + 1)
            .replace(/\s*\((?:[\w.-]+\/[\w.-]+)?#\d+\)/g, '')
            .replace(/(?:[\w.-]+\/[\w.-]+)?#\d+\b/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim()
            .replace(
              /^\w+(?:\(([^)]*)\))?(!)?:\s*/,
              (_, scope, breaking) =>
                `${breaking ? 'Breaking: ' : ''}${scope ? `${Object.hasOwn(names, scope) ? names[scope] : scope}: ` : ''}`,
            )
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replace(/[\\`*_[\]]/g, '\\$&')
          return `- ${title} [#${hash}](${url}/commit/${hash})`
        })
        return `### ${Object.hasOwn(labels, type) ? labels[type] : type} · ${lines.length}\n\n${entries.join('\n')}`
      })
      .join('\n\n') || 'No new commits.'
  return `## ${titleFor(tag)}

Source: \`dev\` · [${sha}](${url}/commit/${sha})  \n${comparison}
${
  publishing
    ? `<!-- release-source:${sha} -->

After approval, select the checkbox below to publish.
Do not use the normal Squash or Rebase merge buttons.

- [ ] ${publishLabel}`
    : `
- [ ] ${refreshLabel}

Refreshing requires a new approval.`
}

## Changes

${scope}
`
}

function writeVersionPr({ sha, body, refresh, title, branch, files }) {
  // Create-only ref and expectedHeadOid prevent replacing another candidate.
  api('git/refs', { ref: `refs/heads/${branch}`, sha })
  let pr
  try {
    const commit = api('graphql', {
      query: `mutation($input: CreateCommitOnBranchInput!) {
      createCommitOnBranch(input: $input) { commit { oid } }
    }`,
      variables: {
        input: {
          branch: { repositoryNameWithOwner: repository, branchName: branch },
          expectedHeadOid: sha,
          message: { headline: title },
          fileChanges: {
            additions: files.map((path) => ({
              path,
              contents: readFileSync(path).toString('base64'),
            })),
          },
        },
      },
    })
    if (!commit.data?.createCommitOnBranch?.commit?.oid)
      throw new Error('Signed version commit failed.')
    if (refresh) {
      const current = get(`pulls/${refresh.number}`)
      if (
        current.state !== 'open' ||
        current.head.sha !== refresh.head.sha ||
        current.base.ref !== refresh.base.ref ||
        current.body !== refresh.body
      )
        throw new Error(
          'The version pull request changed while preparing the update.',
        )
      const oid = commit.data.createCommitOnBranch.commit.oid
      updateRefs(refresh.base.repo.node_id, [
        {
          name: `refs/heads/${refresh.head.ref}`,
          beforeOid: refresh.head.sha,
          afterOid: oid,
          force: true,
        },
        {
          name: `refs/heads/${branch}`,
          beforeOid: oid,
          afterOid: '0'.repeat(40),
        },
      ])
      for (const review of list(
        `pulls/${refresh.number}/reviews?per_page=100`,
      )) {
        if (review.state === 'APPROVED')
          api(
            `pulls/${refresh.number}/reviews/${review.id}/dismissals`,
            {
              message:
                'The version PR was refreshed from dev; please review again.',
            },
            'PUT',
          )
      }
      pr = api(`pulls/${refresh.number}`, { title, body }, 'PATCH')
    } else {
      pr = api('pulls', {
        head: branch,
        base: 'dev',
        title,
        body,
      })
    }
  } catch (error) {
    if (refresh) {
      try {
        api(`git/refs/heads/${branch}`, {}, 'DELETE')
      } catch {}
    }
    throw error
  }
  api(`issues/${pr.number}/labels`, { labels: ['release'] })
  summary(`Version pull request: ${pr.html_url}`)
}

function updateRefs(repositoryId, refUpdates) {
  api('graphql', {
    query: `mutation($input: UpdateRefsInput!) { updateRefs(input: $input) { clientMutationId } }`,
    variables: { input: { repositoryId, refUpdates } },
  })
}

function requireBotPr(pr, base, prefix) {
  const tag = branchTag(pr.head.ref, prefix)
  if (
    !tag ||
    pr.base.ref !== base ||
    pr.base.repo.full_name !== repository ||
    pr.head.repo?.full_name !== repository ||
    pr.user.login !== 'github-actions[bot]'
  )
    throw new Error(
      'Expected a release PR created by this repository workflow.',
    )
  return tag
}

function publishPr() {
  const event = json(env.GITHUB_EVENT_PATH)
  const pr = get(`pulls/${event.pull_request.number}`)
  const tag = requireBotPr(pr, 'dev', 'release/')
  if (!pr.merged || pr.merge_commit_sha !== event.pull_request.merge_commit_sha)
    throw new Error('Expected the final merged version commit on dev.')
  const sha = pr.merge_commit_sha
  fetchBranches()
  git('fetch', '--no-tags', 'origin', sha)
  git('merge-base', '--is-ancestor', sha, 'origin/dev')
  validateVersionCommit(tag, sha)
  const branch = `publish/${tag}`
  const existing = list(
    `pulls?state=open&base=main&head=${repository.split('/')[0]}:${branch}&per_page=100`,
  )
  if (existing.length) {
    const publication = existing[0]
    requireBotPr(publication, 'main', 'publish/')
    if (publication.head.sha !== sha)
      throw new Error(
        'This tag is already reserved by a different publication snapshot.',
      )
    summary(`Existing publication PR: ${publication.html_url}`)
    return
  }
  const refs = remoteRefs()
  if (refs.some(([, ref]) => ref === `refs/tags/${tag}`))
    throw new Error(`Tag ${tag} already exists.`)
  git('merge-base', '--is-ancestor', 'origin/main', sha)
  const head = refs.find(([, ref]) => ref === `refs/heads/${branch}`)?.[0]
  if (head && head !== sha)
    throw new Error('Publication branch already points to another commit.')
  if (!head) api('git/refs', { ref: `refs/heads/${branch}`, sha })
  const body = releaseBody(
    tag,
    sha,
    refs
      .filter(([, ref]) => ref.startsWith('refs/tags/'))
      .map(([, ref]) => ref.slice(10)),
    true,
  )
  const publication = api('pulls', {
    head: branch,
    base: 'main',
    title: titleFor(tag),
    body,
  })
  api(`issues/${publication.number}/labels`, { labels: ['release'] })
  summary(`Publication PR: ${publication.html_url}\n\n${body}`)
}

function requireApproval(pr, sha) {
  const reviews = new Map()
  for (const review of list(`pulls/${pr.number}/reviews?per_page=100`)) {
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state))
      reviews.set(review.user.login, review)
  }
  let approved = false
  for (const review of reviews.values()) {
    if (!canWrite(review.user.login)) continue
    if (review.state === 'CHANGES_REQUESTED')
      throw new Error('A reviewer with write access has requested changes.')
    if (review.state === 'APPROVED' && review.commit_id === sha) approved = true
  }
  if (!approved)
    throw new Error(
      'The current PR head needs approval from a reviewer with write access.',
    )
}

function releaseOutput(tag, sha) {
  output({
    release_tag: tag,
    source_sha: sha,
    channel: isRc(tag) ? 'rc' : 'stable',
  })
}

function publish() {
  const event = json(env.GITHUB_EVENT_PATH)
  const tag = requireBotPr(event.pull_request, 'main', 'publish/')
  if (
    checked(event.changes?.body?.from, publishLabel) ||
    !checked(event.pull_request.body, publishLabel)
  )
    throw new Error('Publishing requires a new checkbox selection.')
  if (!canWrite(event.sender.login))
    throw new Error('Publishing requires write access.')
  const sha = event.pull_request.head.sha
  const pr = get(`pulls/${event.pull_request.number}`)
  requireBotPr(pr, 'main', 'publish/')
  if (
    pr.head.sha !== sha ||
    !checked(pr.body, publishLabel) ||
    !pr.body.includes(`<!-- release-source:${sha} -->`)
  )
    throw new Error(
      'The publication snapshot changed after the checkbox selection.',
    )
  fetchBranches()
  git('fetch', '--no-tags', 'origin', sha)
  git('merge-base', '--is-ancestor', sha, 'origin/dev')
  validateVersionCommit(tag, sha)
  const marker = `Release workflow run: ${env.GITHUB_RUN_ID}\nSource: ${sha}\nPR: ${pr.number}`
  const existing = remoteRefs().find(([, ref]) => ref === `refs/tags/${tag}`)
  if (existing) {
    const ref = get(`git/ref/tags/${tag}`)
    const object =
      ref.object.type === 'tag' && get(`git/tags/${ref.object.sha}`)
    if (
      !object ||
      object.object.type !== 'commit' ||
      object.object.sha !== sha ||
      object.message.trim() !== marker ||
      Number(env.GITHUB_RUN_ATTEMPT) <= 1
    )
      throw new Error(
        'An existing tag can only be recovered by its original release run.',
      )
    git('merge-base', '--is-ancestor', sha, 'origin/main')
    summary(`Resuming ${tag} at ${sha} from this release run.`)
  } else {
    if (pr.state !== 'open' || pr.draft)
      throw new Error('Expected an open, ready publication PR.')
    requireApproval(pr, sha)
    const main = git('rev-parse', 'origin/main')
    git('merge-base', '--is-ancestor', main, sha)
    git(
      '-c',
      'user.name=github-actions[bot]',
      '-c',
      'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'tag',
      '--annotate',
      '--no-sign',
      '--message',
      marker,
      tag,
      sha,
    )
    // GraphQL updateRefs rejects annotated tag objects; Git preserves atomicity.
    git(
      'push',
      '--atomic',
      `--force-with-lease=refs/heads/main:${main}`,
      `--force-with-lease=refs/heads/${pr.head.ref}:${sha}`,
      `--force-with-lease=refs/tags/${tag}:`,
      'origin',
      `${sha}:refs/heads/main`,
      `${sha}:refs/heads/${pr.head.ref}`,
      `refs/tags/${tag}:refs/tags/${tag}`,
    )
    summary(`Fast-forwarded main and tagged ${tag} at approved commit ${sha}.`)
  }
  releaseOutput(tag, sha)
}

function validateTag() {
  const tag = env.GITHUB_REF_NAME
  if (!isRelease(tag)) throw new Error('Expected a stable or RC release tag.')
  fetchBranches()
  const sha = git('rev-parse', `${env.GITHUB_SHA}^{commit}`)
  const ref = get(`git/ref/tags/${tag}`)
  const object = ref.object.type === 'tag' && get(`git/tags/${ref.object.sha}`)
  if (object && object.message.includes('Release workflow run:'))
    throw new Error(
      'Resume the original publication run for workflow-owned tags.',
    )
  git('fetch', '--no-tags', 'origin', `refs/tags/${tag}`)
  if (git('rev-parse', 'FETCH_HEAD^{commit}') !== sha)
    throw new Error('The tag moved after this run started.')
  for (const branch of ['main', 'dev'])
    git('merge-base', '--is-ancestor', sha, `origin/${branch}`)
  validateVersions(tag, sha)
  releaseOutput(tag, sha)
}

function prepareDraft() {
  const tag = env.RELEASE_TAG
  verifyTarget()
  const release = list('releases?per_page=100').find(
    (release) => release.tag_name === tag,
  )
  if (release && !release.draft)
    throw new Error('This release is already public.')
  const draft =
    release ||
    api('releases', {
      tag_name: tag,
      target_commitish: env.SOURCE_SHA,
      name: `Clash Verge Rev ${tag}`,
      body: 'Draft release, will be updated later.',
      draft: true,
      prerelease: isRc(tag),
    })
  output({ id: draft.id })
}

function verifyTarget(tag = env.RELEASE_TAG, sha = env.SOURCE_SHA) {
  const ref = get(`git/ref/tags/${tag}`)
  const target =
    ref.object.type === 'tag'
      ? get(`git/tags/${ref.object.sha}`).object
      : ref.object
  if (target.type !== 'commit' || target.sha !== sha)
    throw new Error('The release tag no longer points to the validated source.')
}

function nextDev() {
  let refresh
  let tag = env.RELEASE_TAG
  let source = env.SOURCE_SHA
  let minor = false
  if (env.GITHUB_EVENT_NAME === 'pull_request_target') {
    const event = json(env.GITHUB_EVENT_PATH)
    const oldBody = event.changes?.body?.from
    const body = event.pull_request.body
    if (
      checked(oldBody, minorLabel) === checked(body, minorLabel) &&
      (checked(oldBody) || !checked(body))
    )
      return
    if (!canWrite(event.sender.login))
      throw new Error('Changing the next dev version requires write access.')
    refresh = get(`pulls/${event.pull_request.number}`)
    if (refresh.state !== 'open') return
    tag = requireBotPr(refresh, 'dev', 'next-dev/')
    if (
      refresh.head.sha !== event.pull_request.head.sha ||
      refresh.body !== body
    )
      throw new Error(
        'The version update PR changed after the checkbox selection.',
      )
    minor = checked(body, minorLabel)
    source = body.match(/<!-- next-dev-source:([a-f0-9]{40}) -->/)?.[1]
  }
  if (!stablePattern.test(tag) || !/^[a-f0-9]{40}$/.test(source))
    throw new Error('The next dev version requires a stable release snapshot.')
  verifyTarget(tag, source)
  const release = get(`releases/tags/${tag}`)
  if (release.draft || release.prerelease)
    throw new Error('The stable release must be public before preparing dev.')
  const branch = `next-dev/${tag}`
  if (!refresh) {
    const existing = list(
      `pulls?state=all&base=dev&head=${repository.split('/')[0]}:${branch}&per_page=100`,
    )[0]
    if (existing) {
      requireBotPr(existing, 'dev', 'next-dev/')
      summary(`Existing dev version PR: ${existing.html_url}`)
      return
    }
  }
  fetchBranches()
  git('fetch', '--no-tags', 'origin', source)
  git('merge-base', '--is-ancestor', source, 'origin/main')
  git('merge-base', '--is-ancestor', source, 'origin/dev')
  git('checkout', '--detach', 'origin/dev')
  const sha = git('rev-parse', 'HEAD')
  validateVersions(tag, source)
  validateVersions(tag, sha)
  if (read('Changelog.md') !== gitFile(source, 'Changelog.md'))
    throw new Error(
      'Changelog.md changed after this release. Preserve the unreleased entries and prepare the dev update manually.',
    )
  if (
    !read('Changelog.md').split('\n').includes(`## ${tag}`) ||
    read('docs/Changelog.history.md').split('\n').includes(`## ${tag}`)
  )
    throw new Error('The released changelog is missing or already archived.')
  const [major, minorVersion, patch] = tag.slice(1).split('.').map(BigInt)
  const patchTag = `v${major}.${minorVersion}.${patch + 1n}`
  const minorTag = `v${major}.${minorVersion + 1n}.0`
  const nextTag = minor ? minorTag : patchTag
  run('pnpm', ['release-version', nextTag])
  run('bash', ['scripts-workflow/bump_changelog.sh'])
  const changelog = read('Changelog.md')
  if (!changelog.includes('## v(Version Goes Here)'))
    throw new Error('The changelog template has no version placeholder.')
  writeFileSync(
    'Changelog.md',
    changelog.replace('## v(Version Goes Here)', `## ${nextTag}`),
  )
  validateVersions(nextTag)
  const title = `Dev: ${nextTag}`
  const body = `## ${title}

After [${tag}](${env.GITHUB_SERVER_URL}/${repository}/releases/tag/${tag}).
<!-- next-dev-source:${source} -->

Patch: \`${patchTag}\` · Minor: \`${minorTag}\`

- [${minor ? 'x' : ' '}] ${minorLabel}
- [ ] ${refreshLabel}

Changing the version or refreshing requires a new approval.
`
  writeVersionPr({
    sha,
    body,
    refresh,
    title,
    branch: refresh
      ? `next-dev-refresh/${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`
      : branch,
    files: [...versionFiles, 'Changelog.md', 'docs/Changelog.history.md'],
  })
}

const commands = {
  prepare,
  'next-dev': nextDev,
  'publish-pr': publishPr,
  publish,
  'validate-tag': validateTag,
  'prepare-draft': prepareDraft,
  'verify-target': verifyTarget,
}
const command = commands[process.argv[2]]
if (!command) throw new Error('Unknown release command.')
command()
