// TEMPORARY diagnostic endpoint — capture the firewall block page evidence
// (status, response headers, body head/tail) when fetched from this host's
// egress IP. Remove after the WAF product/rule is identified.
import { BASE_URL, USER_AGENT } from './_utils.js';

const MAX_HOPS = 5;

export default async function handler(req, res) {
  const hops = [];
  let url = `${BASE_URL}/my-account/`;

  try {
    for (let i = 0; i < MAX_HOPS; i++) {
      const r = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'manual',
      });

      const hop = {
        url,
        status: r.status,
        headers: Object.fromEntries(r.headers.entries()),
      };

      if ([301, 302, 303, 307, 308].includes(r.status)) {
        hops.push(hop);
        const location = r.headers.get('location');
        if (!location) break;
        url = new URL(location, url).href;
        continue;
      }

      const text = await r.text();
      hop.bodyLength = text.length;
      hop.bodyHead = text.slice(0, 800);
      hop.bodyTail = text.slice(-2500);
      hop.wafLines = text
        .split('\n')
        .filter((l) => /wordfence|firewall|blocked|limited|cloudflare|sucuri|imunify/i.test(l))
        .map((l) => l.trim().slice(0, 300))
        .slice(0, 15);
      hops.push(hop);
      break;
    }

    return res.status(200).json({ hops });
  } catch (err) {
    return res.status(500).json({ error: err.message, hops });
  }
}
