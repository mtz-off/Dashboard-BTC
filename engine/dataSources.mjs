// Toutes les données ici viennent de vraies APIs publiques, sans clé (pas de simulation).
import { getJSON, getText } from "./net.mjs";

const CG = "https://api.coingecko.com/api/v3";

export async function fetchSpotPrice() {
  const j = await getJSON(
    `${CG}/simple/price?ids=bitcoin&vs_currencies=usd,eur&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`
  );
  return {
    usd: j.bitcoin.usd,
    eur: j.bitcoin.eur,
    change24h: j.bitcoin.usd_24h_change,
    vol24h: j.bitcoin.usd_24h_vol,
    marketCap: j.bitcoin.usd_market_cap,
    fetchedAt: new Date().toISOString(),
  };
}

// Séries de clôtures ~horaires (fenêtre 10 jours -> granularité horaire chez CoinGecko).
export async function fetchHourlyCloses() {
  const j = await getJSON(`${CG}/coins/bitcoin/market_chart?vs_currency=usd&days=10`);
  return j.prices.map(([t, price]) => ({ t, close: price }));
}

// Bougies OHLC ~4h (fenêtre 14 jours) pour l'ATR / Bollinger sur données réelles haut/bas.
export async function fetchOhlc4h() {
  const j = await getJSON(`${CG}/coins/bitcoin/ohlc?vs_currency=usd&days=14`);
  return j.map(([t, open, high, low, close]) => ({ t, open, high, low, close }));
}

export async function fetchFearGreed() {
  const j = await getJSON(`https://api.alternative.me/fng/?limit=1`);
  const d = j.data[0];
  return { value: Number(d.value), classification: d.value_classification, timestamp: Number(d.timestamp) * 1000 };
}

// Funding rate perpétuel BTC (sentiment des traders à effet de levier). Best-effort: certaines
// régions bloquent Binance, donc on tolère l'échec sans casser tout le cycle.
export async function fetchFundingRate() {
  try {
    const j = await getJSON("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT");
    return { lastFundingRate: Number(j.lastFundingRate), markPrice: Number(j.markPrice) };
  } catch (e) {
    return null;
  }
}

const FEEDS = [
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { name: "Decrypt", url: "https://decrypt.co/feed" },
];

function extractItems(xml, source) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) && items.length < 25) {
    const block = m[1];
    const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const dateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    if (titleMatch) {
      items.push({
        source,
        title: titleMatch[1].trim(),
        link: linkMatch ? linkMatch[1].trim() : null,
        publishedAt: dateMatch ? new Date(dateMatch[1].trim()).toISOString() : null,
      });
    }
  }
  return items;
}

export async function fetchNews() {
  const results = await Promise.allSettled(FEEDS.map((f) => getText(f.url)));
  const items = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      items.push(...extractItems(r.value, FEEDS[i].name));
    }
  });
  // Ne garde que les news des dernières 48h, triées par date desc.
  const cutoff = Date.now() - 48 * 3600 * 1000;
  return items
    .filter((it) => !it.publishedAt || new Date(it.publishedAt).getTime() >= cutoff)
    .filter((it) => /btc|bitcoin|crypto|fed|rate|sec |etf|inflation|macro/i.test(it.title))
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, 30);
}
