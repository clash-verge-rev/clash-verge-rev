---
steps:
  - name: Prepare bounded PR context
    uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0
    env:
      PR_NUMBER: ${{ github.event.pull_request.number || github.event.issue.number || inputs.pr_number }}
      EXPECTED_HEAD: ${{ inputs.head_sha }}
    with:
      script: |
        const fs = require('fs');
        const number = process.env.PR_NUMBER;
        if (!/^[1-9][0-9]*$/.test(number)) throw new Error('A PR number is required');
        const params = { ...context.repo, pull_number: Number(number) };
        const { data: pr } = await github.rest.pulls.get(params);
        if (process.env.EXPECTED_HEAD && pr.head.sha !== process.env.EXPECTED_HEAD) {
          throw new Error('PR head changed after trigger; await the newer run');
        }
        const { data: files } = await github.rest.pulls.listFiles({ ...params, per_page: 100 });
        const body = pr.body || '';
        const snapshot = {
          repository: `${context.repo.owner}/${context.repo.repo}`,
          number: pr.number, url: pr.html_url, state: pr.state, draft: pr.draft,
          title: pr.title, body: body.slice(0, 12000), body_truncated: body.length > 12000,
          created_at: pr.created_at, author: pr.user.login,
          base_sha: pr.base.sha, head_sha: pr.head.sha,
          head_repository: pr.head.repo?.full_name,
          labels: pr.labels.map(label => label.name),
          changed_files: pr.changed_files, files_truncated: pr.changed_files > files.length,
          files: files.map(({ filename, previous_filename, status, additions, deletions }) =>
            ({ filename, previous_filename, status, additions, deletions })),
        };
        fs.mkdirSync('/tmp/gh-aw/agent', { recursive: true });
        fs.writeFileSync('/tmp/gh-aw/agent/pr-context.json', JSON.stringify(snapshot));
---
