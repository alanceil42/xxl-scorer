// Every icon the page uses is in the vendored sprite, and the sprite holds nothing
// but Lucide's line drawings: no scripts, no links, nothing fetched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const sprite = read('vendor/lucide/icons.svg');
const symbols = new Set([...sprite.matchAll(/<symbol id="([a-z0-9-]+)"/g)].map(m => m[1]));

test('icons used in index.html and src/ui exist in vendor/lucide/icons.svg', () => {
	const used = new Set();
	for (const m of read('index.html').matchAll(/icons\.svg#([a-z0-9-]+)/g)) used.add(m[1]);
	for (const f of readdirSync(join(root, 'src/ui')).filter(f => f.endsWith('.js'))) {
		for (const m of read(`src/ui/${f}`).matchAll(/\bicon\('([a-z0-9-]+)'\)/g)) used.add(m[1]);
	}
	assert.ok(used.size >= 8, `found ${used.size} icons in use`);
	for (const n of used) assert.ok(symbols.has(n), `${n} missing: add it to ICONS in tools/vendor.sh`);
});

test('the sprite: shapes only', () => {
	const tags = new Set([...sprite.matchAll(/<([a-z]+)[\s>/]/g)].map(m => m[1]));
	for (const t of tags) assert.ok(['svg', 'symbol', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'].includes(t), `unexpected <${t}>`);
	assert.doesNotMatch(sprite, /href|on[a-z]+=|url\(/i);
});
