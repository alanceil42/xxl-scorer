# Working on xxl-scorer (for Claude sessions)

Read the private decision log first (project knowledge). docs/HOW-IT-WORKS.md has the core
(score, IVs, reading, merging), written for a Pokémon GO player who codes.

- One task, one branch `claude/<topic>` from an up-to-date main, one pull request. Never push
  to main. `git fetch origin main` and rebase before starting and before pushing. The
  maintainer merges. Force-push (`--force-with-lease`) only the open pull request's own branch,
  when the maintainer asks to amend it.
- Commits: repo-local `git config user.name Claude` and `user.email noreply@anthropic.com`;
  end each message with `Co-Authored-By: Claude <model> <noreply@anthropic.com>`. No
  `Claude-Session:` line and no session links, in commits or pull request texts.
- Before pushing: `npm test` and `bash tools/vendor.sh --check`. For changes to reading or
  merging screenshots, say in the pull request that the maintainer's real-screenshot tests
  (log X09) have to run before the merge.
- Decisions go into the private decision log, not into this repository. Code comments give
  the reason where it matters, without decision numbers. docs/HOW-IT-WORKS.md changes only
  when the core changes, and stays at about 100 lines.
- User-visible changes get a line under "## Unreleased" in CHANGELOG.md, in the same pull
  request. Releases (docs/RELEASING.md): Claude prepares the release pull request; the
  maintainer merges it and publishes the release, which creates the tag and updates the
  public copy on GitHub Pages.
- Never add game data, game art or screenshots of the game (log X11). Screenshots show where
  Pokémon were caught; the maintainer's are private and not in this repository.
- Docs: lines at most 101 columns, tables padded for reading in vi. Bash: indent with tabs.
- Plain JavaScript modules, no build step, no dependencies (log X07).
