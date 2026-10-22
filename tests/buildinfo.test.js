// The footer's name for what is running, from src/build.js as git archive fills it in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir, devNull } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readBuild, branchOf, buildLink, REPO } from '../src/core/buildinfo.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const line = (describe, refs, commit) => `export default { describe: '${describe}', refs: '${refs}', commit: '${commit}' };\n`;
const footer = (describe, refs, commit = '2652777') => buildLink(readBuild(line(describe, refs, commit)));

test('a plain checkout keeps the footer as index.html has it', () => {
	const build = readBuild(read('src/build.js'));
	assert.deepEqual(build, { describe: '$Format:%(describe:tags)$', refs: '$Format:%D$', commit: '$Format:%h$' });
	assert.equal(buildLink(build), null);
	// only part of it filled in: not trusted either
	assert.equal(footer('$Format:%(describe:tags)$', 'HEAD -> main'), null);
	assert.equal(footer('v1.1', '$Format:%D$'), null);
	assert.equal(footer('v1.1', 'tag: v1.1', '$Format:%h$'), null);
});

test('exactly a release tag: the version, linking to the release', () => {
	const release = { text: 'version 1.1', href: `${REPO}/releases/tag/v1.1` };
	assert.deepEqual(footer('v1.1', 'HEAD, tag: v1.1, origin/main'), release);
	assert.deepEqual(footer('v1.1', 'tag: v1.1'), release);
	assert.deepEqual(footer('v1.1', 'HEAD -> main, tag: v1.1, origin/main'), release);
	assert.deepEqual(footer('v1.1', 'grafted, HEAD, tag: v1.1'), release);
	assert.deepEqual(footer('v1.0.1', 'HEAD, tag: v1.0.1'), { text: 'version 1.0.1', href: `${REPO}/releases/tag/v1.0.1` });
	assert.deepEqual(footer('v2.0', 'HEAD -> demo, tag: v2.0'), { text: 'version 2.0', href: `${REPO}/releases/tag/v2.0` });
});

test('anything else: branch and commit, linking to the commit', () => {
	const at = branch => ({ text: `${branch} · 2652777`, href: `${REPO}/commit/2652777` });
	assert.deepEqual(footer('v1.1-1-g2652777', 'HEAD -> main, origin/main, origin/HEAD'), at('main'));
	assert.deepEqual(footer('v1.1-3-g2652777', 'HEAD -> claude/brave-bell'), at('claude/brave-bell'));
	// not a release tag, though exactly on it
	assert.deepEqual(footer('v1.1-rc1', 'HEAD, tag: v1.1-rc1'), at('detached'));
	assert.deepEqual(footer('release', 'HEAD -> main, tag: release'), at('main'));
	// no tag reachable at all
	assert.deepEqual(footer('', 'HEAD -> main'), at('main'));
	assert.deepEqual(footer('v1.1-1-g2652777', ''), at('detached'));
	assert.deepEqual(footer('v1.1-1-gabcdef0123', 'HEAD -> main', 'abcdef0123'),
		{ text: 'main · abcdef0123', href: `${REPO}/commit/abcdef0123` });
});

test('the branch from the refs', () => {
	assert.equal(branchOf('HEAD -> main'), 'main');
	assert.equal(branchOf('HEAD -> main, origin/main, origin/HEAD'), 'main');
	assert.equal(branchOf('HEAD -> demo, tag: v9.9'), 'demo');
	// after "HEAD -> " wins, wherever it stands
	assert.equal(branchOf('tag: v1.1, other, HEAD -> mine'), 'mine');
	// else the first that is neither a tag nor a remote
	assert.equal(branchOf('HEAD, tag: v9.9, demo'), 'demo');
	assert.equal(branchOf('HEAD, tag: v1.1, origin/main, claude/release-1.1, main'), 'claude/release-1.1');
	assert.equal(branchOf('tag: v1.1, origin/claude/x, main'), 'main');
	// else detached
	assert.equal(branchOf('HEAD, tag: v1.1, origin/main'), 'detached');
	assert.equal(branchOf('HEAD'), 'detached');
	assert.equal(branchOf('grafted, HEAD, tag: v1.1'), 'detached');
	assert.equal(branchOf('origin/claude/x'), 'detached');
	assert.equal(branchOf(''), 'detached');
});

test('ref names with quotes stay text', () => {
	// valid ref names (git check-ref-format), which would break or inject into a script
	for (const name of ["it's", 'a"b', 'x`y', "x'+alert(1)+'", 'x${1}']) {
		assert.deepEqual(footer('v1.1-1-g2652777', `HEAD -> ${name}, origin/${name}`),
			{ text: `${name} · 2652777`, href: `${REPO}/commit/2652777` }, name);
	}
	assert.deepEqual(footer('v1.1', `HEAD, tag: v1.1, origin/it's`), { text: 'version 1.1', href: `${REPO}/releases/tag/v1.1` });
});

test('anything but the line: nothing', () => {
	assert.equal(readBuild(''), null);
	assert.equal(readBuild(undefined), null);
	assert.equal(readBuild('<!doctype html><title>Not found</title>'), null);
	assert.equal(buildLink(null), null);
	assert.equal(footer('v1.1', 'tag: v1.1', 'not-hex'), null);
	assert.equal(footer('v1.1', 'tag: v1.1', ''), null);
});

test('the page has the link to fill in, and git fills in the file', () => {
	assert.match(read('index.html'), new RegExp(`<a id="version" href="${REPO}/releases/tag/v`));
	assert.match(read('.gitattributes'), /^src\/build\.js export-subst$/m);
	assert.match(read('src/ui/app.js'), /fetch\('src\/build\.js'/);
});

test('git archive fills in src/build.js', () => {
	const dir = mkdtempSync(join(tmpdir(), 'xxl-build-'));
	try {
		// a repository of its own, untouched by the user's git settings
		const env = { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1' };
		for (const k of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE)$/.test(k)) delete env[k];
		const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.org', ...args],
			{ cwd: dir, env, encoding: 'utf8' }).trim();
		const archived = ref => buildLink(readBuild(execFileSync('tar', ['-xO'],
			{ input: execFileSync('git', ['archive', ref, 'src/build.js'], { cwd: dir, env }), encoding: 'utf8' })));
		git('init', '-q', '-b', 'main');
		mkdirSync(join(dir, 'src'));
		writeFileSync(join(dir, '.gitattributes'), read('.gitattributes'));
		writeFileSync(join(dir, 'src/build.js'), read('src/build.js'));
		git('add', '.');
		git('commit', '-q', '-m', 'one');
		git('tag', 'v9.9');
		writeFileSync(join(dir, 'later'), '');
		git('add', 'later');
		git('commit', '-q', '-m', 'two');
		const [one, two] = [git('rev-parse', '--short', 'v9.9'), git('rev-parse', '--short', 'HEAD')];

		assert.deepEqual(archived('main'), { text: `main · ${two}`, href: `${REPO}/commit/${two}` });
		assert.deepEqual(archived('refs/tags/v9.9'), { text: 'version 9.9', href: `${REPO}/releases/tag/v9.9` });
		git('checkout', '-q', '--detach', 'v9.9');
		assert.deepEqual(archived('HEAD'), { text: 'version 9.9', href: `${REPO}/releases/tag/v9.9` });
		git('tag', '-d', 'v9.9');
		assert.deepEqual(archived('HEAD'), { text: `detached · ${one}`, href: `${REPO}/commit/${one}` });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
