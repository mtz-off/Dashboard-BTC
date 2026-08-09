// Réseau: en local (sandbox de dev) le trafic sortant passe par un proxy HTTP.
// En production (GitHub Actions), il n'y a pas de proxy: le fetch natif est utilisé tel quel.
import { ProxyAgent, setGlobalDispatcher } from "undici";

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || null;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

export async function getJSON(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": "btc-dashboard/1.0", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status}`);
  }
  return res.json();
}

export async function getText(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": "btc-dashboard/1.0", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status}`);
  }
  return res.text();
}
