// The version number lives in three places: package.json, the page's footer (text and
// link to the release) and the newest released section of CHANGELOG.md. They must agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');

test('package.json, footer and CHANGELOG name the same version', () => {
	const version = JSON.parse(read('package.json')).version;
	assert.match(version, /^\d+\.\d+(\.\d+)?$/, 'package.json: MAJOR.MINOR, or MAJOR.MINOR.PATCH for a fix');

	const html = read('index.html');
	const foot = html.match(/releases\/tag\/v([^"]+)">version ([^<]+)<\/a>/);
	assert.ok(foot, 'index.html: footer link to the release not found');
	assert.equal(foot[1], version, 'index.html: footer link');
	assert.equal(foot[2], version, 'index.html: footer text');

	const log = read('CHANGELOG.md');
	assert.match(log, /^## Unreleased$/m, 'CHANGELOG.md: "## Unreleased" section missing');
	const released = log.match(/^## (\d+\.\d+(?:\.\d+)?) - (\d{4}-\d{2}-\d{2})$/m);
	assert.ok(released, 'CHANGELOG.md: no "## X.Y - YYYY-MM-DD" section');
	assert.equal(released[1], version, 'CHANGELOG.md: newest released section');
});

test('tools/release-notes.sh prints the section with joined lines', () => {
	const version = JSON.parse(read('package.json')).version;
	const notes = execFileSync('bash', [join(root, 'tools/release-notes.sh'), version], { encoding: 'utf8' });
	const lines = notes.trimEnd().split('\n');
	assert.ok(lines.length > 2 && lines[0] !== '', 'starts with text');
	assert.ok(!lines.some(l => /^## /.test(l)), 'no version heading');
	assert.ok(!lines.some(l => /^ /.test(l)), 'continuation lines joined');
	assert.equal(notes, notes.trimEnd() + '\n', 'no trailing blank lines');
});
