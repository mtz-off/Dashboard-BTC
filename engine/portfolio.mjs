import { randomUUID } from "node:crypto";

// Paramètres de risque du portefeuille papier (aucun argent réel — cf. demande explicite
// d'assumer un levier élevé pour que le compte fictif bouge visiblement).
export const RISK = {
  STARTING_BALANCE_EUR: 100,
  LEVERAGE: 15, // LEVIER x15 — amplifie gains ET pertes sur la marge engagée
  RISK_PER_TRADE_PCT: 0.25, // 25% du solde courant engagé comme marge par position
  MAX_OPEN_POSITIONS: 3,
  MIN_STRENGTH_TO_OPEN: 0.12, // en dessous, le signal est affiché mais aucune position n'est ouverte
  SL_ATR_MULT: 1.2,
  TP_ATR_MULT: 2.4, // ratio risque/rendement ~1:2
  LIQUIDATION_MARGIN_PCT: 0.9, // filet de sécurité: clôture forcée si la perte atteint 90% de la marge
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

// PnL d'une position à levier: la marge (sizeEUR) est ce qui est réellement engagé/débité du
// solde, mais le gain/perte se calcule sur l'exposition notionnelle (marge x levier).
function positionPnlEUR(pos, priceEUR) {
  const movePct = pctMove(pos.entryPrice, priceEUR, pos.side);
  return { movePct, pnlEUR: pos.notionalEUR * movePct };
}

// Vérifie les positions ouvertes contre le prix courant, ferme celles qui touchent TP/SL, ou
// qui seraient liquidées (perte >= LIQUIDATION_MARGIN_PCT de la marge, filet de sécurité levier).
function checkExits(state, priceEUR, nowIso) {
  const stillOpen = [];
  for (const pos of state.openPositions) {
    let exitReason = null;
    const { movePct, pnlEUR: rawPnl } = positionPnlEUR(pos, priceEUR);

    if (rawPnl <= -pos.sizeEUR * RISK.LIQUIDATION_MARGIN_PCT) {
      exitReason = "LIQUIDATION";
    } else if (pos.side === "LONG") {
      if (priceEUR <= pos.sl) exitReason = "SL";
      else if (priceEUR >= pos.tp) exitReason = "TP";
    } else {
      if (priceEUR >= pos.sl) exitReason = "SL";
      else if (priceEUR <= pos.tp) exitReason = "TP";
    }

    if (exitReason) {
      // La perte ne peut jamais dépasser la marge engagée (pas de dette dans la simulation).
      const pnlEUR = Math.max(rawPnl, -pos.sizeEUR);
      state.balanceEUR += pos.sizeEUR + pnlEUR;
      state.trades.push({
        id: pos.id,
        side: pos.side,
        entryPrice: pos.entryPrice,
        entryTime: pos.entryTime,
        exitPrice: priceEUR,
        exitTime: nowIso,
        sizeEUR: pos.sizeEUR,
        notionalEUR: pos.notionalEUR,
        leverage: pos.leverage,
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
  const notionalEUR = sizeEUR * RISK.LEVERAGE;
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
    notionalEUR: Number(notionalEUR.toFixed(2)),
    leverage: RISK.LEVERAGE,
    qtyBTC: Number((notionalEUR / priceEUR).toFixed(8)),
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
    const { pnlEUR } = positionPnlEUR(pos, priceEUR);
    return sum + Math.max(pnlEUR, -pos.sizeEUR);
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
