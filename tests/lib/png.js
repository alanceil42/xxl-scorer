// Minimal PNG decode/encode for the local screenshot tests (8/16-bit RGB/RGBA/gray, not interlaced).
// Phone screenshots are often 16-bit; 16-bit samples are cut to their high byte.
import { inflateSync, deflateSync } from 'node:zlib';

export function decodePng(buf) {
	if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
	let pos = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0;
	const idat = [];
	while (pos < buf.length) {
		const len = buf.readUInt32BE(pos), kind = buf.toString('latin1', pos + 4, pos + 8);
		const body = buf.subarray(pos + 8, pos + 8 + len);
		if (kind === 'IHDR') {
			width = body.readUInt32BE(0); height = body.readUInt32BE(4);
			depth = body[8]; type = body[9]; interlace = body[12];
		} else if (kind === 'IDAT') idat.push(body);
		else if (kind === 'IEND') break;
		pos += 12 + len;
	}
	const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
	if ((depth !== 8 && depth !== 16) || !channels || interlace) throw new Error(`unsupported PNG (depth ${depth}, type ${type}, interlace ${interlace})`);
	const raw = inflateSync(Buffer.concat(idat));
	const bpp = channels * depth / 8;
	const stride = width * bpp;
	const px = Buffer.alloc(stride * height);
	for (let y = 0; y < height; y++) {
		const f = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const out = px.subarray(y * stride, (y + 1) * stride);
		const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
		for (let x = 0; x < stride; x++) {
			const a = x >= bpp ? out[x - bpp] : 0, b = prev ? prev[x] : 0, c = prev && x >= bpp ? prev[x - bpp] : 0;
			let v = line[x];
			if (f === 1) v += a;
			else if (f === 2) v += b;
			else if (f === 3) v += (a + b) >> 1;
			else if (f === 4) {
				const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
				v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			out[x] = v & 255;
		}
	}
	const data = new Uint8ClampedArray(width * height * 4);
	const k = depth / 8;	// bytes per sample; take the high byte
	const at = (j, c) => px[j + c * k];
	for (let i = 0, j = 0; i < width * height; i++, j += bpp) {
		const o = i * 4;
		if (channels >= 3) { data[o] = at(j, 0); data[o + 1] = at(j, 1); data[o + 2] = at(j, 2); }
		else data[o] = data[o + 1] = data[o + 2] = at(j, 0);
		data[o + 3] = channels === 4 ? at(j, 3) : channels === 2 ? at(j, 1) : 255;
	}
	return { width, height, data };
}

const CRC = new Int32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c;
});
const crc32 = b => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };

function chunk(kind, body) {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(body.length, 0);
	head.write(kind, 4, 'latin1');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
	return Buffer.concat([head, body, crc]);
}

export function encodePng({ width, height, data }) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; ihdr[9] = 6;
	const raw = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
	]);
}
