// "Which screenshots": two phone outlines, drawn, no game art. One with the
// appraisal open (bars and the "was caught" line), one without it (height and weight).
// Colours come from the page's tokens (app.css), so light and dark mode both work.

const BAR = [[1, 1, 0.6], [1, 0.3, 0], [1, 1, 1]];	// how full each third of the three bars is

/** A phone outline: 'appraisal' or 'plain'. Returns SVG markup. */
export function phoneSvg(kind) {
	const appraisal = kind === 'appraisal';
	const t = (x, y, s, cls, txt, anchor = 'middle') => `<text x="${x}" y="${y}" font-size="${s}" class="${cls}" text-anchor="${anchor}">${txt}</text>`;
	const mark = (x, y, w, h, n) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" class="hf-mark"/>`
		+ `<circle cx="${x + w}" cy="${y}" r="8" class="hf-num"/>${t(x + w, y + 3.5, 10, 'hf-num-t', n)}`;
	const parts = [
		// phone, screen, photo backdrop, CP, arc, a stand-in for the Pokémon
		'<rect x="4" y="4" width="192" height="412" rx="26" class="hf-frame"/>',
		'<rect x="10" y="12" width="180" height="396" rx="20" class="hf-screen"/>',
		'<path d="M10 32a20 20 0 0 1 20-20h140a20 20 0 0 1 20 20v112H10z" class="hf-sky"/>',
		t(100, 45, 15, 'hf-strong', '<tspan font-size="9">CP</tspan>372'),
		'<path d="M34 128a66 66 0 0 1 132 0" class="hf-arc"/>',
		'<ellipse cx="100" cy="112" rx="24" ry="20" class="hf-sprite"/>',
		// the info card: year tag, name, HP bar, stats row
		'<rect x="16" y="140" width="168" height="270" rx="10" class="hf-card"/>',
		'<rect x="146" y="148" width="40" height="15" rx="7.5" class="hf-pill"/>',
		t(166, 159, 8, 'hf-pill-t', '2024'),
		t(100, 180, 13, 'hf-strong', 'Name'),
		'<rect x="58" y="186" width="84" height="3" rx="1.5" class="hf-hp"/>',
		t(100, 198, 7, 'hf-muted', '60 / 60 HP'),
		t(46, 220, 10, 'hf-strong', '22.38kg'), t(46, 230, 6, 'hf-muted', 'WEIGHT'),
		'<circle cx="100" cy="214" r="6" class="hf-type"/>', t(100, 230, 6, 'hf-muted', 'WATER'),
		'<rect x="146" y="200" width="18" height="8" rx="4" class="hf-pill"/>', t(155, 206.5, 5.5, 'hf-pill-t', 'XXL'),
		t(155, 220, 10, 'hf-strong', '0.79m'), t(155, 230, 6, 'hf-muted', 'HEIGHT'),
		'<path d="M26 242h148" class="hf-rule"/>',
	];
	if (!appraisal) {
		parts.push(
			'<rect x="30" y="252" width="40" height="5" rx="2.5" class="hf-ghost"/><rect x="80" y="252" width="40" height="5" rx="2.5" class="hf-ghost"/><rect x="130" y="252" width="40" height="5" rx="2.5" class="hf-ghost"/>',
			'<rect x="30" y="264" width="30" height="4" rx="2" class="hf-ghost"/><rect x="80" y="264" width="30" height="4" rx="2" class="hf-ghost"/><rect x="130" y="264" width="30" height="4" rx="2" class="hf-ghost"/>',
			'<rect x="26" y="290" width="70" height="18" rx="9" class="hf-button"/><rect x="26" y="318" width="70" height="18" rx="9" class="hf-button"/>',
			'<circle cx="160" cy="300" r="13" class="hf-button"/>',
			mark(20, 209, 160, 27, 1),
		);
	} else {
		// laid out from the bottom edge: medallion, trainer, the bars, the "was caught" line
		const bars = BAR.map((thirds, i) => {
			const y = 334 + i * 13;
			return t(28, y - 3, 5.5, 'hf-bar-t', ['Attack', 'Defense', 'HP'][i], 'start')
				+ thirds.map((f, k) => `<rect x="${28 + k * 22}" y="${y}" width="20" height="4" rx="2" class="hf-bar-bg"/>`
					+ (f ? `<rect x="${28 + k * 22}" y="${y}" width="${20 * f}" height="4" rx="2" class="hf-bar"/>` : '')).join('');
		}).join('');
		parts.push(
			'<rect x="16" y="200" width="168" height="210" class="hf-dim"/>',
			'<path d="M112 408c0-40 10-70 38-74c28 4 40 34 40 74z" class="hf-trainer"/>',
			'<circle cx="150" cy="306" r="22" class="hf-trainer"/>',
			'<circle cx="42" cy="306" r="19" class="hf-medal"/>', t(42, 310, 10, 'hf-medal-t', '★★★'),
			'<rect x="22" y="322" width="72" height="44" rx="5" class="hf-card"/>', bars,
			'<rect x="18" y="372" width="164" height="32" rx="6" class="hf-card"/>',
			t(26, 385, 7, 'hf-text', 'This Name was caught on 4/19/2024', 'start'),
			t(26, 396, 7, 'hf-text', 'around …', 'start'),
			mark(20, 318, 78, 51, 1),
			mark(15, 369, 170, 38, 2),
		);
	}
	const label = appraisal
		? 'A phone screen with the appraisal open: the three bars (1) and the line saying when the Pokémon was caught (2) are marked.'
		: 'A phone screen without the appraisal: the row with weight and height (1) is marked.';
	return `<svg class="hf" viewBox="0 0 200 420" role="img" aria-label="${label}">${parts.join('')}</svg>`;
}
