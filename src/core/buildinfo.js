// The footer's name for what is running. git archive fills in src/build.js (export-subst): the
// nearest tag (`git describe --tags`), the refs that point at the commit and the short commit.
// Files that are exactly a release tag show that version; anything else shows the branch and
// the commit, so a server running main or a pull request's branch says which one. A plain
// checkout leaves the placeholders as they are, and the footer keeps index.html's text.
//
// The file is read as text, never run: ref names may contain quotes and other characters that
// would break or inject into a script. They can't contain spaces, colons or control characters,
// which keeps the fields of the line apart.

export const REPO = 'https://github.com/alanceil42/xxl-scorer';

const LINE = /^export default \{ describe: '([^ ]*)', refs: '(.*)', commit: '([^ ]*)' \};$/m;
const RELEASE = /^v\d+\.\d+(\.\d+)?$/;

/**
 * The three fields of src/build.js, or null when the text isn't that line.
 * @param {string} text
 * @returns {{describe: string, refs: string, commit: string} | null}
 */
export function readBuild(text) {
	const m = LINE.exec(String(text ?? ''));
	return m ? { describe: m[1], refs: m[2], commit: m[3] } : null;
}

/**
 * The branch named by git's %D: the one after "HEAD -> ", else the first ref that is neither a
 * tag nor a remote (origin/…), else "detached". "grafted" marks a shallow clone's oldest commit.
 * @param {string} refs e.g. "HEAD -> main, origin/main" or "HEAD, tag: v1.1, origin/main"
 */
export function branchOf(refs) {
	const names = refs.split(', ').filter(Boolean);
	const head = names.find(n => n.startsWith('HEAD -> '));
	if (head) return head.slice('HEAD -> '.length);
	return names.find(n => n !== 'HEAD' && n !== 'grafted' && !n.startsWith('tag: ') && !n.startsWith('origin/'))
		?? 'detached';
}

/**
 * The footer's link, or null to keep index.html's text (placeholders not filled in).
 * @param {{describe: string, refs: string, commit: string} | null} build
 * @returns {{text: string, href: string} | null}
 */
export function buildLink(build) {
	if (!build || Object.values(build).some(v => v.startsWith('$Format:'))) return null;
	const { describe, refs, commit } = build;
	if (!/^[0-9a-f]{4,40}$/.test(commit)) return null;
	if (RELEASE.test(describe)) return { text: `version ${describe.slice(1)}`, href: `${REPO}/releases/tag/${describe}` };
	return { text: `${branchOf(refs)} · ${commit}`, href: `${REPO}/commit/${commit}` };
}
