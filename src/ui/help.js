// "Which screenshots": two phone outlines, drawn, no game art. One with the
// appraisal open (bars and the "was caught" line), one without it (height and weight).
// Colours come from the page's tokens (app.css), so light and dark mode both work.
// The drawing is a tree of elements, built into the page with createElementNS: the page parses
// no markup from strings anywhere (no innerHTML).

const BAR = [[1, 1, 0.6], [1, 0.3, 0], [1, 1, 1]];	// how full each third of the three bars is

/** One SVG element: {tag, attrs, kids}; kids are elements or text. */
const n = (tag, attrs, ...kids) => ({ tag, attrs, kids });
const rect = (x, y, width, height, rx, cls) => n('rect', { x, y, width, height, ...(rx == null ? {} : { rx }), class: cls });
const circle = (cx, cy, r, cls) => n('circle', { cx, cy, r, class: cls });
const path = (d, cls) => n('path', { d, class: cls });

/** A phone outline: 'appraisal' or 'plain', as a tree of SVG elements. */
export function phone(kind) {
	const appraisal = kind === 'appraisal';
	const t = (x, y, s, cls, txt, anchor = 'middle') => n('text', { x, y, 'font-size': s, class: cls, 'text-anchor': anchor }, ...[txt].flat());
	const mark = (x, y, w, h, num) => [rect(x, y, w, h, 6, 'hf-mark'), circle(x + w, y, 8, 'hf-num'), t(x + w, y + 3.5, 10, 'hf-num-t', String(num))];
	const parts = [
		// phone, screen, photo backdrop, CP, arc, a stand-in for the Pokémon
		rect(4, 4, 192, 412, 26, 'hf-frame'),
		rect(10, 12, 180, 396, 20, 'hf-screen'),
		path('M10 32a20 20 0 0 1 20-20h140a20 20 0 0 1 20 20v112H10z', 'hf-sky'),
		t(100, 45, 15, 'hf-strong', [n('tspan', { 'font-size': 9 }, 'CP'), '372']),
		path('M34 128a66 66 0 0 1 132 0', 'hf-arc'),
		n('ellipse', { cx: 100, cy: 112, rx: 24, ry: 20, class: 'hf-sprite' }),
		// the info card: year tag, name, HP bar, stats row
		rect(16, 140, 168, 270, 10, 'hf-card'),
		rect(146, 148, 40, 15, 7.5, 'hf-pill'),
		t(166, 159, 8, 'hf-pill-t', '2024'),
		t(100, 180, 13, 'hf-strong', 'Name'),
		rect(58, 186, 84, 3, 1.5, 'hf-hp'),
		t(100, 198, 7, 'hf-muted', '60 / 60 HP'),
		t(46, 220, 10, 'hf-strong', '22.38kg'), t(46, 230, 6, 'hf-muted', 'WEIGHT'),
		circle(100, 214, 6, 'hf-type'), t(100, 230, 6, 'hf-muted', 'WATER'),
		rect(146, 200, 18, 8, 4, 'hf-pill'), t(155, 206.5, 5.5, 'hf-pill-t', 'XXL'),
		t(155, 220, 10, 'hf-strong', '0.79m'), t(155, 230, 6, 'hf-muted', 'HEIGHT'),
		path('M26 242h148', 'hf-rule'),
	];
	if (!appraisal) {
		parts.push(
			rect(30, 252, 40, 5, 2.5, 'hf-ghost'), rect(80, 252, 40, 5, 2.5, 'hf-ghost'), rect(130, 252, 40, 5, 2.5, 'hf-ghost'),
			rect(30, 264, 30, 4, 2, 'hf-ghost'), rect(80, 264, 30, 4, 2, 'hf-ghost'), rect(130, 264, 30, 4, 2, 'hf-ghost'),
			rect(26, 290, 70, 18, 9, 'hf-button'), rect(26, 318, 70, 18, 9, 'hf-button'),
			circle(160, 300, 13, 'hf-button'),
			...mark(20, 209, 160, 27, 1),
		);
	} else {
		// laid out from the bottom edge: medallion, trainer, the bars, the "was caught" line
		const bars = BAR.flatMap((thirds, i) => {
			const y = 334 + i * 13;
			return [t(28, y - 3, 5.5, 'hf-bar-t', ['Attack', 'Defense', 'HP'][i], 'start'),
				...thirds.flatMap((f, k) => [rect(28 + k * 22, y, 20, 4, 2, 'hf-bar-bg'), ...(f ? [rect(28 + k * 22, y, 20 * f, 4, 2, 'hf-bar')] : [])])];
		});
		parts.push(
			rect(16, 200, 168, 210, null, 'hf-dim'),
			path('M112 408c0-40 10-70 38-74c28 4 40 34 40 74z', 'hf-trainer'),
			circle(150, 306, 22, 'hf-trainer'),
			circle(42, 306, 19, 'hf-medal'), t(42, 310, 10, 'hf-medal-t', '★★★'),
			rect(22, 322, 72, 44, 5, 'hf-card'), ...bars,
			rect(18, 372, 164, 32, 6, 'hf-card'),
			t(26, 385, 7, 'hf-text', 'This Name was caught on 4/19/2024', 'start'),
			t(26, 396, 7, 'hf-text', 'around …', 'start'),
			...mark(20, 318, 78, 51, 1),
			...mark(15, 369, 170, 38, 2),
		);
	}
	const label = appraisal
		? 'A phone screen with the appraisal open: the three bars (1) and the line saying when the Pokémon was caught (2) are marked.'
		: 'A phone screen without the appraisal: the row with weight and height (1) is marked.';
	return n('svg', { class: 'hf', viewBox: '0 0 200 420', role: 'img', 'aria-label': label }, ...parts);
}

const SVG = 'http://www.w3.org/2000/svg';

/** The drawing as SVG elements of `doc`, for the page. */
export function phoneElement(kind, doc = document) {
	const build = node => {
		if (typeof node === 'string') return doc.createTextNode(node);
		const e = doc.createElementNS(SVG, node.tag);
		for (const [k, v] of Object.entries(node.attrs)) e.setAttribute(k, String(v));
		e.append(...node.kids.map(build));
		return e;
	};
	return build(phone(kind));
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The drawing as SVG markup: for the tests, and to look at. */
export function phoneSvg(kind) {
	const out = node => (typeof node === 'string' ? esc(node)
		: `<${node.tag}${Object.entries(node.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('')}${node.kids.length ? `>${node.kids.map(out).join('')}</${node.tag}>` : '/>'}`);
	return out(phone(kind));
}
