// The footer's link to the site operator's legal notice (Impressum): shown only when the site's
// own settings name one (local/config.json "imprintUrl"), so a copy hosted elsewhere never
// points at someone else's page. Only http(s) addresses or paths on the same site; anything else
// shows nothing.

export const DEFAULT_IMPRINT_LABEL = 'Legal notice';

/**
 * @param {{imprintUrl?: unknown, imprintLabel?: unknown}} config
 * @returns {{href: string, label: string} | null}
 */
export function imprintLink(config) {
	const raw = typeof config?.imprintUrl === 'string' ? config.imprintUrl.trim() : '';
	if (!raw) return null;
	let url;
	try {
		url = new URL(raw, 'https://site.invalid/');
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
	const label = typeof config.imprintLabel === 'string' && config.imprintLabel.trim()
		? config.imprintLabel.trim()
		: DEFAULT_IMPRINT_LABEL;
	return { href: raw, label };
}
