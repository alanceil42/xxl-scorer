// tools/vendor.sh --check: the vendored files are exactly the ones listed in SHA256SUMS. The site
// publishes all of vendor/, so a file nobody listed must fail the check too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A copy of tools/vendor.sh and vendor/, changed by `change`, then checked. */
async function check(change = async () => {}) {
	const dir = await mkdtemp(join(tmpdir(), 'xxl-vendor-'));
	try {
		await cp(join(root, 'tools/vendor.sh'), join(dir, 'tools/vendor.sh'));
		await cp(join(root, 'vendor'), join(dir, 'vendor'), { recursive: true });
		await change(join(dir, 'vendor'));
		return spawnSync('bash', [join(dir, 'tools/vendor.sh'), '--check'], { encoding: 'utf8' });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test('vendor/ as committed passes', async () => {
	const r = await check();
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stderr, /vendor\/ OK/);
});

test('a file not in SHA256SUMS fails, wherever it is', async () => {
	for (const f of ['lucide/extra.svg', 'tesseract/core/x.js', 'page.html', '.hidden']) {
		const r = await check(v => writeFile(join(v, f), 'x'));
		assert.equal(r.status, 1, f);
		assert.match(r.stderr, new RegExp(`Not in vendor/SHA256SUMS[^]*\\n${f.replace('.', '\\.')}\\n`), f);
	}
});

test('a changed or missing listed file fails', async () => {
	assert.notEqual((await check(v => appendFile(join(v, 'lucide/icons.svg'), ' '))).status, 0);
	assert.notEqual((await check(v => rm(join(v, 'lucide/LICENSE')))).status, 0);
});
