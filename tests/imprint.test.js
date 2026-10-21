// The footer's legal notice link: off unless configured, http(s) or same-site paths only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imprintLink, DEFAULT_IMPRINT_LABEL } from '../src/core/imprint.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('no link unless the site names one', () => {
	assert.equal(imprintLink({}), null);
	assert.equal(imprintLink({ imprintUrl: '' }), null);
	assert.equal(imprintLink({ imprintUrl: '   ' }), null);
	assert.equal(imprintLink({ imprintUrl: 42 }), null);
	assert.equal(imprintLink(undefined), null);
});

test('http(s) and same-site paths only', () => {
	assert.deepEqual(imprintLink({ imprintUrl: 'https://example.org/impressum/' }),
		{ href: 'https://example.org/impressum/', label: DEFAULT_IMPRINT_LABEL });
	assert.deepEqual(imprintLink({ imprintUrl: 'local/imprint.html', imprintLabel: 'Impressum' }),
		{ href: 'local/imprint.html', label: 'Impressum' });
	for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'mailto:a@example.org', 'http://[bad']) {
		assert.equal(imprintLink({ imprintUrl: bad }), null, bad);
	}
});

test('label: trimmed, default when empty', () => {
	assert.equal(imprintLink({ imprintUrl: '/i', imprintLabel: '  Impressum ' }).label, 'Impressum');
	assert.equal(imprintLink({ imprintUrl: '/i', imprintLabel: '' }).label, DEFAULT_IMPRINT_LABEL);
	assert.equal(imprintLink({ imprintUrl: '/i', imprintLabel: 7 }).label, DEFAULT_IMPRINT_LABEL);
});

test('the shipped config.json shows no link', () => {
	const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
	assert.equal(imprintLink(config), null);
	assert.ok('imprintUrl' in config && 'imprintLabel' in config, 'keys documented in config.json');
});

test('the footer\'s text ends with the hidden link the page fills in, opening in a new tab', () => {
	const html = readFileSync(join(root, 'index.html'), 'utf8');
	assert.match(html, /<span class="imprint" hidden> <a id="imprint" target="_blank" rel="noopener nofollow"><\/a><\/span><\/p>\s*<\/footer>/);
});
