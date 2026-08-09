import { randomUUID } from "node:crypto";

// Paramètres de risque du portefeuille papier (aucun argent réel).
export const RISK = {
  STARTING_BALANCE_EUR: 100,
  LEVERAGE: 1, // AUCUN LEVIER — positions au comptant simulées
  RISK_PER_TRADE_PCT: 0.2, // 20% du solde courant engagé par position
  MAX_OPEN_POSITIONS: 3,
  MIN_STRENGTH_TO_OPEN: 0.35, // en dessous, le signal est affiché mais aucune position n'est ouverte
  SL_ATR_MULT: 1.2,
  TP_ATR_MULT: 2.4, // ratio risque/rendement ~1:2
  MAX_HISTORY_POINTS: 2000,
};

export function freshState() {
  const now = new Date().toISOString();
  return {
    meta: {
      startedAt: now,
      currency: "EUR",
      leverage: RISK.LEVERAGE,
      note: "Portefeuille papier simulé — aucun fonds réel. Signal Long/Short basé sur données de marché et news réelles.",
    },
    balanceEUR: RISK.STARTING_BALANCE_EUR,
    equityEUR: RISK.STARTING_BALANCE_EUR,
    stopped: false,
    openPositions: [],
    trades: [],
    lastSignal: null,
    history: [],
    lastRun: null,
  };
}

function pctMove(entry, current, side) {
  return side === "LONG" ? (current - entry) / entry : (entry - current) / entry;
}

// Vérifie les positions ouvertes contre le prix courant, ferme celles qui touchent TP/SL.
function checkExits(state, priceEUR, nowIso) {
  const stillOpen = [];
  for (const pos of state.openPositions) {
    let exitReason = null;
    if (pos.side === "LONG") {
      if (priceEUR <= pos.sl) exitReason = "SL";
      else if (priceEUR >= pos.tp) exitReason = "TP";
    } else {
      if (priceEUR >= pos.sl) exitReason = "SL";
      else if (priceEUR <= pos.tp) exitReason = "TP";
    }
    if (exitReason) {
      const movePct = pctMove(pos.entryPrice, priceEUR, pos.side);
      const pnlEUR = pos.sizeEUR * movePct;
      state.balanceEUR += pos.sizeEUR + pnlEUR;
      state.trades.push({
        id: pos.id,
        side: pos.side,
        entryPrice: pos.entryPrice,
        entryTime: pos.entryTime,
        exitPrice: priceEUR,
        exitTime: nowIso,
        sizeEUR: pos.sizeEUR,
        qtyBTC: pos.qtyBTC,
        pnlEUR: Number(pnlEUR.toFixed(2)),
        pnlPct: Number((movePct * 100).toFixed(2)),
        reason: exitReason,
        status: "CLOSED",
      });
    } else {
      stillOpen.push(pos);
    }
  }
  state.openPositions = stillOpen;
}

function openPosition(state, signal, priceEUR, nowIso) {
  const sizeEUR = Number((state.balanceEUR * RISK.RISK_PER_TRADE_PCT).toFixed(2));
  if (sizeEUR <= 0) return;
  const atrPct = signal.atr14 && signal.price ? signal.atr14 / signal.price : 0.01;
  const slPct = Math.max(atrPct * RISK.SL_ATR_MULT, 0.003);
  const tpPct = Math.max(atrPct * RISK.TP_ATR_MULT, 0.006);
  const side = signal.direction;
  const sl = side === "LONG" ? priceEUR * (1 - slPct) : priceEUR * (1 + slPct);
  const tp = side === "LONG" ? priceEUR * (1 + tpPct) : priceEUR * (1 - tpPct);

  state.balanceEUR = Number((state.balanceEUR - sizeEUR).toFixed(2));
  state.openPositions.push({
    id: randomUUID(),
    side,
    entryPrice: priceEUR,
    entryTime: nowIso,
    sizeEUR,
    qtyBTC: Number((sizeEUR / priceEUR).toFixed(8)),
    sl: Number(sl.toFixed(2)),
    tp: Number(tp.toFixed(2)),
    slPct: Number((slPct * 100).toFixed(2)),
    tpPct: Number((tpPct * 100).toFixed(2)),
    signalScore: signal.score,
    signalStrength: signal.strength,
    status: "OPEN",
  });
}

export function runCycleOnState(state, { priceEUR, signal }) {
  const nowIso = new Date().toISOString();

  if (state.stopped) {
    state.lastSignal = signal;
    state.lastRun = nowIso;
    return state;
  }

  checkExits(state, priceEUR, nowIso);

  const sameDirectionOpen = state.openPositions.some((p) => p.side === signal.direction);
  const canOpen =
    !sameDirectionOpen &&
    state.openPositions.length < RISK.MAX_OPEN_POSITIONS &&
    signal.strength >= RISK.MIN_STRENGTH_TO_OPEN &&
    state.balanceEUR > 1;

  if (canOpen) {
    openPosition(state, signal, priceEUR, nowIso);
  }

  const unrealized = state.openPositions.reduce((sum, pos) => {
    const movePct = pctMove(pos.entryPrice, priceEUR, pos.side);
    return sum + pos.sizeEUR * movePct;
  }, 0);
  const openMargin = state.openPositions.reduce((s, p) => s + p.sizeEUR, 0);
  state.equityEUR = Number((state.balanceEUR + openMargin + unrealized).toFixed(2));

  if (state.balanceEUR <= 0 && state.openPositions.length === 0) {
    state.stopped = true;
    state.stoppedAt = nowIso;
    state.stoppedReason = "Solde du portefeuille papier tombé à 0€ — trading arrêté définitivement.";
  }

  state.history.push({ t: nowIso, equityEUR: state.equityEUR, priceEUR });
  if (state.history.length > RISK.MAX_HISTORY_POINTS) {
    state.history = state.history.slice(-RISK.MAX_HISTORY_POINTS);
  }

  state.lastSignal = signal;
  state.lastRun = nowIso;
  return state;
}
