// tools/vendor.sh --check: the vendored files are exactly the ones listed in SHA256SUMS. The site
// publishes all of vendor/, so a file nobody listed must fail the check too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile, appendFile, symlink, rename } from 'node:fs/promises';
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

// The site's upload replaces a link by what it points to: anything on the machine.
test('a symbolic link fails, to a file or a directory, listed or not', async () => {
	for (const [name, target] of [['lucide/x.svg', '/etc/hostname'], ['tessdata/etc', '/etc']]) {
		const r = await check(v => symlink(target, join(v, name)));
		assert.equal(r.status, 1, name);
		assert.match(r.stderr, new RegExp(`Not a regular file[^]*\\./${name}\\n`), name);
	}
	// a listed file replaced by a link to a copy of itself still fails
	const r = await check(async v => {
		await rename(join(v, 'lucide/LICENSE'), join(v, 'LICENSE.copy'));
		await symlink('../LICENSE.copy', join(v, 'lucide/LICENSE'));
	});
	assert.equal(r.status, 1);
});

test('a line in SHA256SUMS that is not a checksum fails', async () => {
	const r = await check(async v => {
		await writeFile(join(v, 'tesseract/evil.js'), 'x');
		await appendFile(join(v, 'SHA256SUMS'), 'deadbeef  tesseract/evil.js\n');
	});
	assert.notEqual(r.status, 0, r.stderr);
});
