// The size of a PNG or JPEG from its header, so that a huge image is refused before decoding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageSize } from '../src/core/image.js';
import { encodePng } from './lib/png.js';

const bytes = (...parts) => Uint8Array.from(parts.flat());
const u16 = n => [n >> 8, n & 255];
const segment = (marker, body) => [0xff, marker, ...u16(body.length + 2), ...body];
const sof = (marker, w, h) => segment(marker, [8, ...u16(h), ...u16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);

test('PNG: the size from IHDR, whatever follows', () => {
	const png = encodePng({ width: 3, height: 5, data: new Uint8ClampedArray(60) });
	assert.deepEqual(imageSize(png), { width: 3, height: 5 });
	// a 100 000 × 100 000 header alone: no pixels needed to know
	const huge = Uint8Array.from(png.subarray(0, 24));
	huge.set([0, 1, 0x86, 0xa0, 0, 1, 0x86, 0xa0], 16);
	assert.deepEqual(imageSize(huge), { width: 100000, height: 100000 });
	assert.equal(imageSize(png.subarray(0, 20)), null, 'cut off before the size');
});

test('JPEG: the frame header after the metadata, an embedded thumbnail skipped', () => {
	const app0 = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
	// EXIF with a thumbnail inside: its own SOI and frame header must not count
	const app1 = segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 0xff, 0xd8, ...sof(0xc0, 160, 120), 0xff, 0xd9]);
	const dqt = segment(0xdb, new Array(65).fill(1));
	const dht = segment(0xc4, new Array(20).fill(0));
	const sos = segment(0xda, [1, 1, 0, 0, 63, 0]);
	assert.deepEqual(imageSize(bytes(0xff, 0xd8, app0, app1, dqt, dht, sof(0xc0, 1206, 2622), sos)), { width: 1206, height: 2622 });
	assert.deepEqual(imageSize(bytes(0xff, 0xd8, app0, sof(0xc2, 9000, 6000), sos)), { width: 9000, height: 6000 }, 'progressive');
	assert.deepEqual(imageSize(bytes(0xff, 0xd8, 0xff, 0xff, app0, sof(0xc1, 20, 10))), { width: 20, height: 10 }, 'fill bytes');
	assert.equal(imageSize(bytes(0xff, 0xd8, app0, app1)), null, 'the first bytes end before the frame header');
	assert.equal(imageSize(bytes(0xff, 0xd8, app0, sos, sof(0xc0, 9000, 9000))), null, 'image data before any frame header');
	assert.equal(imageSize(bytes(0xff, 0xd8, 0x12, 0x34, 0, 0, 0, 0, 0, 0, 0)), null, 'not a segment');
});

test('neither PNG nor JPEG: no size (checked once decoded instead)', () => {
	assert.equal(imageSize(new TextEncoder().encode('GIF89a\x01\x00\x01\x00')), null);
	assert.equal(imageSize(new Uint8Array(0)), null);
	assert.equal(imageSize(new TextEncoder().encode('RIFF....WEBPVP8 ')), null);
});
