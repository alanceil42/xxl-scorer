# Making a release

A release is a version number on a commit of main, plus a page on GitHub that says what changed
and offers the files to download. Nothing is built: GitHub's "Source code" archives of the tag
are the release.

    Who          the maintainer: tags can only be pushed or created by the maintainer's account
                 (Claude's cloud sessions can't push tags); Claude prepares the release PR
    Version      MAJOR.MINOR (1.0, 1.1, 2.0); a third number only for a release that just
                 fixes something (1.0.1). What counts as which: step 1
    Tag          v1.1, on main, created when the release is published
    Notes        the version's section of CHANGELOG.md


## Once, before the first release

1. **Merge commits only**. Repository → Settings → General, section "Pull Requests": only
   **Allow merge commits** ticked. Rebasing on GitHub drops the commits' signatures (no
   "Verified").
2. **GitHub Pages**. Settings → Pages → Source: **GitHub Actions**. Settings →
   Environments → **github-pages** → Deployment branches and tags: add a tag rule `v*` (a
   release runs the workflow on its tag). Settings → Secrets and variables → Actions →
   Variables → **SITE_CONFIG**: the site's settings as JSON (e.g. imprintUrl, imprintLabel).


## Every release

### 1. Release pull request

Ask Claude for "a release PR for 1.1" (or do it by hand). It changes:

    package.json       "version": "1.1"
    index.html         footer: link .../releases/tag/v1.1 and the text "version 1.1"
    CHANGELOG.md       "## Unreleased" gets a new, empty one above it and becomes
                       "## 1.1 - YYYY-MM-DD" (the day it will be published)

tests/version.test.js fails if the three don't agree. Pick the number: something users or
self-hosters have to act on (a backup file that no longer imports, a setting that changes
meaning, paths in contrib/) → 2.0; anything new → 1.1; fixes only → 1.0.1. When in doubt, the
higher one.

### 2. Checks on your computer

On the release branch, in your checkout:

    git fetch origin && git switch claude/release-1.1   # the PR's branch
    npm test && bash tools/vendor.sh --check
    npm install --no-save tesseract.js@$(tools/vendor.sh --version tesseract.js)
    XXL_FIXTURES=/path/to/my/screenshots npm test        # real screenshots, a few minutes

Then `npm run serve`, open <http://localhost:8000/> in Safari (and on the phone, over the
network), add a few screenshots, look at the list, export a backup. A footer that names the new
version means the right files are served.

### 3. Merge

Pull request → **Merge pull request**. Wait until the CI run on main is green (Actions tab, or the
check mark next to the newest commit).

### 4. Publish the release on GitHub

In the browser, on a computer or a phone (if the phone's page lacks a button, switch it to the
desktop site).

1. Repository page → **Releases** (right of the file list) → **Draft a new release**.
2. **Choose a tag** → type `v1.1` → **Create new tag**. **Target**: `main`.
3. **Release title**: `1.1` (or `xxl-scorer 1.1`).
4. **Describe this release**: paste the output of `tools/release-notes.sh 1.1`: the version's
   section of CHANGELOG.md without its heading, each paragraph and list item on one line
   (GitHub may show the changelog's line breaks as breaks). "Generate release notes" would list
   the pull requests instead; the changelog says it better.
5. Leave **This is a pre-release** unticked; **Set as latest release** ticked.
6. No files to attach. **Publish release**.

The same from a terminal, with the [GitHub CLI](https://cli.github.com/) logged in as the
maintainer:

    git switch main && git pull
    tools/release-notes.sh 1.1 > /tmp/notes.md
    gh release create v1.1 --target main --title 1.1 --notes-file /tmp/notes.md

### 5. Check it

- The release page shows the notes and "Latest"; under **Assets**, "Source code (zip)" and
  "(tar.gz)" download.
- `git fetch --tags` on your computer lists the tag: `git tag` → `v1.1`.
- The footer link of the new version opens this release page.
- Actions → **Pages**: the run for the release is green, and the public copy's footer names
  the new version. The workflow publishes only a release's tag that is on main, and nothing
  for a pre-release. GitHub Pages lets browsers keep files for up to 10 minutes, so a reload
  may show the old version for a while.

### 6. Update a server that runs releases

From the tag rather than whatever main is at (docs/INSTALL.md, 4. Updating):

    git fetch --tags && git checkout v1.1                          # a git checkout
    git archive --format=tar.gz --prefix=xxl-scorer/ v1.1 > xxl-scorer-1.1.tgz       # a tarball

If the changelog says a file in `contrib/` changed, copy it to its place again.


## When something went wrong

- **Typo in the notes or title**: edit it on the release page.
- **A bug in the release**: fix it on main and release a fix version (1.1.1). Don't move a
  published tag: whoever downloaded or checked out 1.1 would have other files than the tag
  says.
- **Published by mistake**: delete the release (its page → Delete) and the tag (Tags → the tag
  → Delete), then publish the previous release to the public copy again: Actions → Pages →
  Run workflow, "Use workflow from" → Tags → the previous tag. Reuse the number only if nobody
  can have fetched it yet; otherwise carry on with the next.
