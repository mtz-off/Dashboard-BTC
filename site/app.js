const fmtEUR = (n) => (n == null ? "—" : n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }));
const fmtUSD = (n) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" }) : "—");

async function loadState() {
  const res = await fetch(`./data/state.json?t=${Date.now()}`);
  if (!res.ok) throw new Error("state.json introuvable");
  return res.json();
}

function renderSignal(state) {
  const s = state.lastSignal;
  if (!s) return;
  const dirEl = document.getElementById("signalDirection");
  dirEl.textContent = s.direction === "LONG" ? "LONG ▲" : "SHORT ▼";
  dirEl.className = "signal-direction " + (s.direction === "LONG" ? "long" : "short");
  document.getElementById("signalScore").textContent = `score composite: ${s.score}`;
  document.getElementById("signalUpdated").textContent = `màj ${fmtDate(s.computedAt)}`;
  document.getElementById("strengthFill").style.width = `${Math.round(s.strength * 100)}%`;
  document.getElementById("strengthValue").textContent = `${Math.round(s.strength * 100)}%`;
  document.getElementById("leverageBadge").textContent = `Levier: ${state.meta.leverage}x (aucun levier)`;

  const tbody = document.querySelector("#breakdownTable tbody");
  tbody.innerHTML = "";
  for (const row of s.breakdown) {
    const tr = document.createElement("tr");
    const cls = row.points > 0 ? "pts-pos" : row.points < 0 ? "pts-neg" : "";
    tr.innerHTML = `<td>${row.factor}</td><td>${row.detail}</td><td class="${cls}">${row.points > 0 ? "+" : ""}${row.points}</td>`;
    tbody.appendChild(tr);
  }

  const newsList = document.getElementById("newsList");
  newsList.innerHTML = "";
  if (!s.newsHighlights || s.newsHighlights.length === 0) {
    newsList.innerHTML = `<li class="empty-state">Aucun article n'a impacté le score sur ce cycle.</li>`;
  } else {
    for (const item of s.newsHighlights) {
      const li = document.createElement("li");
      const sign = item.itemScore > 0 ? "+" : "";
      li.innerHTML = `${item.title} <span class="news-source">${item.source} · impact ${sign}${item.itemScore}</span>`;
      newsList.appendChild(li);
    }
  }
}

function renderPortfolio(state) {
  const stats = document.getElementById("portfolioStats");
  const pnlTotal = state.equityEUR - 100;
  const pnlCls = pnlTotal >= 0 ? "pnl-pos" : "pnl-neg";
  stats.innerHTML = `
    <div class="stat"><div class="stat-label">Solde libre</div><div class="stat-value">${fmtEUR(state.balanceEUR)}</div></div>
    <div class="stat"><div class="stat-label">Équité totale</div><div class="stat-value">${fmtEUR(state.equityEUR)}</div></div>
    <div class="stat"><div class="stat-label">PnL depuis départ</div><div class="stat-value ${pnlCls}">${pnlTotal >= 0 ? "+" : ""}${fmtEUR(pnlTotal)}</div></div>
    <div class="stat"><div class="stat-label">Positions ouvertes</div><div class="stat-value">${state.openPositions.length}</div></div>
    <div class="stat"><div class="stat-label">Trades clôturés</div><div class="stat-value">${state.trades.length}</div></div>
  `;
  document.getElementById("stoppedBanner").classList.toggle("hidden", !state.stopped);

  const openBody = document.querySelector("#openPositionsTable tbody");
  openBody.innerHTML = "";
  document.getElementById("openPositionsEmpty").classList.toggle("hidden", state.openPositions.length > 0);
  for (const p of state.openPositions) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="${p.side === "LONG" ? "side-long" : "side-short"}">${p.side}</td>
      <td>${fmtEUR(p.entryPrice)}</td>
      <td>${fmtEUR(p.sizeEUR)}</td>
      <td>${fmtEUR(p.sl)}</td>
      <td>${fmtEUR(p.tp)}</td>
      <td>${fmtDate(p.entryTime)}</td>`;
    openBody.appendChild(tr);
  }

  const tradesBody = document.querySelector("#tradesTable tbody");
  tradesBody.innerHTML = "";
  const trades = [...state.trades].reverse();
  document.getElementById("tradesEmpty").classList.toggle("hidden", trades.length > 0);
  for (const t of trades) {
    const tr = document.createElement("tr");
    const pnlCls2 = t.pnlEUR >= 0 ? "pnl-pos" : "pnl-neg";
    tr.innerHTML = `
      <td>${fmtDate(t.exitTime)}</td>
      <td class="${t.side === "LONG" ? "side-long" : "side-short"}">${t.side}</td>
      <td>${fmtEUR(t.entryPrice)}</td>
      <td>${fmtEUR(t.exitPrice)}</td>
      <td>${fmtEUR(t.sizeEUR)}</td>
      <td class="${pnlCls2}">${t.pnlEUR >= 0 ? "+" : ""}${fmtEUR(t.pnlEUR)} (${t.pnlPct}%)</td>
      <td>${t.reason}</td>`;
    tradesBody.appendChild(tr);
  }

  renderEquityChart(state.history || []);
  document.getElementById("lastRun").textContent = `Dernier cycle de décision: ${fmtDate(state.lastRun)}`;
}

function renderEquityChart(history) {
  const svg = document.getElementById("equityChart");
  svg.innerHTML = "";
  if (history.length < 2) return;
  const values = history.map((h) => h.equityEUR);
  const min = Math.min(...values, 100);
  const max = Math.max(...values, 100);
  const range = max - min || 1;
  const w = 600, h = 160, pad = 6;
  const points = history.map((pt, i) => {
    const x = pad + (i / (history.length - 1)) * (w - pad * 2);
    const y = h - pad - ((pt.equityEUR - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const baseline = h - pad - ((100 - min) / range) * (h - pad * 2);
  const ns = "http://www.w3.org/2000/svg";

  const baseLine = document.createElementNS(ns, "line");
  baseLine.setAttribute("x1", pad); baseLine.setAttribute("x2", w - pad);
  baseLine.setAttribute("y1", baseline); baseLine.setAttribute("y2", baseline);
  baseLine.setAttribute("stroke", "#2a3441"); baseLine.setAttribute("stroke-dasharray", "4,4");
  svg.appendChild(baseLine);

  const poly = document.createElementNS(ns, "polyline");
  poly.setAttribute("points", points.join(" "));
  poly.setAttribute("fill", "none");
  const last = values[values.length - 1];
  poly.setAttribute("stroke", last >= 100 ? "#16c784" : "#ea3943");
  poly.setAttribute("stroke-width", "2");
  svg.appendChild(poly);
}

async function refreshDashboard() {
  try {
    const state = await loadState();
    renderSignal(state);
    renderPortfolio(state);
  } catch (e) {
    console.error(e);
  }
}

async function refreshLivePrice() {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur&include_24hr_change=true"
    );
    const j = await res.json();
    const price = j.bitcoin.eur;
    const change = j.bitcoin.eur_24h_change;
    document.getElementById("tickerPrice").textContent = fmtEUR(price);
    const changeEl = document.getElementById("tickerChange");
    changeEl.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}% (24h)`;
    changeEl.className = "ticker-change " + (change >= 0 ? "up" : "down");
  } catch (e) {
    console.error("live price error", e);
  }
}

refreshDashboard();
refreshLivePrice();
setInterval(refreshDashboard, 60_000);
setInterval(refreshLivePrice, 12_000);
