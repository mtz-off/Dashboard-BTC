import { ema, rsi, macd, bollinger, atr, last } from "./indicators.mjs";

const BULLISH_WORDS = [
  "rally", "surge", "soar", "bull", "breakout", "record high", "all-time high", "ath",
  "inflow", "accumulat", "adoption", "approve", "approval", "etf inflow", "buy the dip",
  "upgrade", "outperform", "rebound", "recovery", "halving", "institutional buying",
];
const BEARISH_WORDS = [
  "crash", "plunge", "selloff", "sell-off", "bear", "dump", "liquidat", "hack", "exploit",
  "ban", "regulat", "lawsuit", "sec charges", "outflow", "correction", "fear", "recession",
  "rate hike", "default", "collapse", "fraud", "downgrade", "sanction",
];

export function scoreNewsSentiment(newsItems) {
  let score = 0;
  const hits = [];
  for (const item of newsItems) {
    const t = item.title.toLowerCase();
    let itemScore = 0;
    for (const w of BULLISH_WORDS) if (t.includes(w)) itemScore += 1;
    for (const w of BEARISH_WORDS) if (t.includes(w)) itemScore -= 1;
    if (itemScore !== 0) hits.push({ title: item.title, source: item.source, itemScore });
    score += itemScore;
  }
  // Normalise dans [-3, 3] pour ne pas laisser le volume de news dominer le score composite.
  const normalized = Math.max(-3, Math.min(3, score / 3));
  return { rawScore: score, normalized, hits: hits.slice(0, 8) };
}

export function buildSignal({ hourlyCloses, ohlc4h, fearGreed, fundingRate, newsItems }) {
  const closes = hourlyCloses.map((c) => c.close);
  const price = last(closes);

  const ema20 = last(ema(closes, 20));
  const ema50 = last(ema(closes, 50));
  const rsi14 = last(rsi(closes, 14));
  const { histogram } = macd(closes, 12, 26, 9);
  const macdHist = last(histogram);
  const macdHistPrev = histogram.length > 1 ? histogram[histogram.length - 2] : null;
  const bb = bollinger(closes, 20, 2);
  const bbUpper = last(bb.upper);
  const bbLower = last(bb.lower);
  const bbMid = last(bb.mid);

  const atr14series = atr(ohlc4h, 14);
  const atr14 = last(atr14series);

  const breakdown = [];
  let score = 0;

  // 1. Tendance: croisement EMA20/EMA50
  if (ema20 != null && ema50 != null) {
    const trendPts = ema20 > ema50 ? 2 : -2;
    score += trendPts;
    breakdown.push({ factor: "Tendance EMA20/EMA50", detail: `EMA20=${ema20.toFixed(0)} vs EMA50=${ema50.toFixed(0)}`, points: trendPts });
  }

  // 2. Momentum RSI14
  if (rsi14 != null) {
    let rsiPts = 0;
    if (rsi14 < 30) rsiPts = 1.5; // survendu -> rebond probable
    else if (rsi14 > 70) rsiPts = -1.5; // suracheté -> repli probable
    else if (rsi14 > 55) rsiPts = 0.5;
    else if (rsi14 < 45) rsiPts = -0.5;
    score += rsiPts;
    breakdown.push({ factor: "RSI(14)", detail: rsi14.toFixed(1), points: rsiPts });
  }

  // 3. MACD histogram + son sens de variation
  if (macdHist != null) {
    let macdPts = macdHist > 0 ? 1.5 : -1.5;
    if (macdHistPrev != null && Math.sign(macdHist) === Math.sign(macdHist - macdHistPrev)) macdPts *= 1.3;
    score += macdPts;
    breakdown.push({ factor: "MACD histogramme", detail: macdHist.toFixed(1), points: Number(macdPts.toFixed(2)) });
  }

  // 4. Position dans les bandes de Bollinger (retour à la moyenne)
  if (bbUpper != null && bbLower != null) {
    let bbPts = 0;
    if (price <= bbLower) bbPts = 1;
    else if (price >= bbUpper) bbPts = -1;
    score += bbPts;
    breakdown.push({ factor: "Bollinger(20,2)", detail: `prix ${price.toFixed(0)} vs [${bbLower.toFixed(0)}, ${bbUpper.toFixed(0)}]`, points: bbPts });
  }

  // 5. Fear & Greed Index (contrarian aux extrêmes)
  if (fearGreed) {
    let fgPts = 0;
    if (fearGreed.value <= 25) fgPts = 1; // peur extrême -> opportunité d'achat historique
    else if (fearGreed.value >= 75) fgPts = -1; // avidité extrême -> risque de retournement
    score += fgPts;
    breakdown.push({ factor: "Fear & Greed Index", detail: `${fearGreed.value} (${fearGreed.classification})`, points: fgPts });
  }

  // 6. Funding rate perpétuel (positionnement des traders à levier, contrarian aux extrêmes)
  if (fundingRate) {
    let fPts = 0;
    const fr = fundingRate.lastFundingRate;
    if (fr > 0.0005) fPts = -0.5; // marché très "long", surchauffe
    else if (fr < -0.0002) fPts = 0.5; // marché très "short", carburant pour squeeze haussier
    score += fPts;
    breakdown.push({ factor: "Funding rate BTC perp", detail: `${(fr * 100).toFixed(4)}%`, points: fPts });
  }

  // 7. Sentiment des news réelles (RSS CoinDesk / Cointelegraph / Decrypt)
  const news = scoreNewsSentiment(newsItems);
  score += news.normalized;
  breakdown.push({ factor: "Sentiment news (RSS temps réel)", detail: `${newsItems.length} articles pertinents, score brut ${news.rawScore}`, points: Number(news.normalized.toFixed(2)) });

  const direction = score >= 0 ? "LONG" : "SHORT";
  const strength = Math.min(1, Math.abs(score) / 8); // 0..1

  return {
    price,
    direction,
    score: Number(score.toFixed(2)),
    strength: Number(strength.toFixed(2)),
    atr14,
    indicators: { ema20, ema50, rsi14, macdHist, bbUpper, bbMid, bbLower },
    fearGreed,
    fundingRate,
    newsHighlights: news.hits,
    breakdown,
    computedAt: new Date().toISOString(),
  };
}
