import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchSpotPrice,
  fetchHourlyCloses,
  fetchOhlc4h,
  fetchFearGreed,
  fetchFundingRate,
  fetchNews,
} from "./dataSources.mjs";
import { buildSignal } from "./strategy.mjs";
import { freshState, runCycleOnState } from "./portfolio.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, "..", "data", "state.json");

async function loadState() {
  if (!existsSync(STATE_PATH)) return freshState();
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return freshState();
  }
}

async function main() {
  console.log(`[cycle] démarrage ${new Date().toISOString()}`);

  const [spot, hourlyCloses, ohlc4h, fearGreed, fundingRate, newsItems] = await Promise.all([
    fetchSpotPrice(),
    fetchHourlyCloses(),
    fetchOhlc4h(),
    fetchFearGreed().catch(() => null),
    fetchFundingRate(),
    fetchNews().catch(() => []),
  ]);

  console.log(`[cycle] prix BTC: $${spot.usd} / €${spot.eur} | news: ${newsItems.length} | F&G: ${fearGreed?.value ?? "n/a"}`);

  const signal = buildSignal({ hourlyCloses, ohlc4h, fearGreed, fundingRate, newsItems });
  signal.priceUSD = spot.usd;
  signal.priceEUR = spot.eur;
  signal.change24h = spot.change24h;

  console.log(`[cycle] signal: ${signal.direction} (score=${signal.score}, force=${signal.strength})`);

  const state = await loadState();
  runCycleOnState(state, { priceEUR: spot.eur, signal });

  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));

  console.log(
    `[cycle] solde=€${state.balanceEUR} équité=€${state.equityEUR} positions ouvertes=${state.openPositions.length} trades=${state.trades.length} stopped=${state.stopped}`
  );
  console.log(`[cycle] terminé ${new Date().toISOString()}`);
}

main().catch((err) => {
  console.error("[cycle] ERREUR:", err);
  process.exit(1);
});
