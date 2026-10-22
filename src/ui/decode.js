// A screenshot's pixels and thumbnail, on the page or in a worker of its own (reader.js): the
// same steps with an HTML canvas on the page and an OffscreenCanvas in a worker.
import { readScreenshot } from '../core/pipeline.js';
import { REGIONS, boxOf, crop, downscale, imageSize } from '../core/image.js';

// a phone screenshot is 1-4 megapixels; refuse what would only exhaust the tab's memory
const MAX_PIXELS = 40e6;
const TOO_LARGE = 'image too large for a screenshot';

/** A canvas of w × h on the page. */
export function pageCanvas(w, h) {
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	return c;
}

/** A canvas of w × h in a worker. */
export const workerCanvas = (w, h) => new OffscreenCanvas(w, h);

/**
 * The screenshot's pixels, RGBA.
 * @param {(w: number, h: number) => any} canvas  pageCanvas or workerCanvas
 */
export async function decode(file, canvas) {
	// PNG and JPEG by the size in their header, before anything is decoded; other kinds (and a
	// JPEG whose metadata runs past the first 256 KB) once decoded
	const size = imageSize(new Uint8Array(await file.slice(0, 1 << 18).arrayBuffer()));
	if (size && size.width * size.height > MAX_PIXELS) throw new Error(TOO_LARGE);
	const bmp = await createImageBitmap(file);
	if (bmp.width * bmp.height > MAX_PIXELS) { bmp.close && bmp.close(); throw new Error(TOO_LARGE); }
	const c = canvas(bmp.width, bmp.height);
	const ctx = c.getContext('2d', { willReadFrequently: true });
	ctx.drawImage(bmp, 0, 0);
	bmp.close && bmp.close();
	const d = ctx.getImageData(0, 0, c.width, c.height);
	return { width: d.width, height: d.height, data: d.data };
}

/** Sprite crop only: no info-line text is ever stored. A JPEG, as a data: URL. */
export async function thumbnail(img, canvas) {
	const small = downscale(crop(img, boxOf(img, REGIONS.sprite)), 112);
	const c = canvas(small.width, small.height);
	c.getContext('2d').putImageData(new ImageData(small.data, small.width, small.height), 0, 0);
	if (c.toDataURL) return c.toDataURL('image/jpeg', 0.72);
	return new FileReaderSync().readAsDataURL(await c.convertToBlob({ type: 'image/jpeg', quality: 0.72 }));
}

/**
 * Readings and thumbnail of one decoded screenshot.
 * @param {{width: number, height: number, data: Uint8ClampedArray}} img  from decode
 * @param {any} source  what the engine reads the whole screenshot from (the file)
 */
export async function readImage(img, source, engine, rules, canvas) {
	if (img.width > img.height) throw new Error('landscape image: not a Pokémon screenshot?');
	const reading = await readScreenshot(img, source, engine, rules);
	return { reading, thumb: await thumbnail(img, canvas), size: [img.width, img.height] };
}
