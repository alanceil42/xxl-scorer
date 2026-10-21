// The Content-Security-Policy: index.html's <meta> tag, and the same as a header in the nginx
// example (plus frame-ancestors, which a meta tag can't carry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const parse = policy => new Map(policy.split(';').map(d => d.trim()).filter(Boolean).map(d => {
	const [name, ...values] = d.split(/\s+/);
	return [name, values.join(' ')];
}));
const meta = parse(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(read('index.html'))[1]);
const header = parse(/add_header Content-Security-Policy "([^"]+)" always;/.exec(read('contrib/nginx/xxl-scorer.conf'))[1]);

test('the nginx header is the page\'s policy plus frame-ancestors', () => {
	assert.equal(header.get('frame-ancestors'), "'none'");
	header.delete('frame-ancestors');
	assert.deepEqual([...header], [...meta]);
});

test('the engine\'s worker may start from a blob: URL, and loads like the page', () => {
	assert.equal(meta.get('worker-src'), "'self' blob:");
	assert.equal(meta.get('script-src'), "'self' 'wasm-unsafe-eval'", 'no inline scripts, no eval');
	assert.equal(meta.get('connect-src'), "'self' https://raw.githubusercontent.com/PokeMiners/");
	assert.match(read('src/ui/ocr.js'), /workerBlobURL: true,/);
});

test('no markup parsed from strings in the page\'s code', () => {
	for (const dir of ['src/core', 'src/ui', 'src/rules']) {
		for (const f of readdirSync(join(root, dir))) {
			assert.doesNotMatch(read(join(dir, f)).replace(/\/\/.*$/gm, ''), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser/, `${dir}/${f}`);
		}
	}
});
