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
  const isLong = s.direction === "LONG";
  dirEl.innerHTML = isLong
    ? `LONG <span style="font-size:0.7em">▲</span>`
    : `SHORT <span style="font-size:0.7em">▼</span>`;
  dirEl.className = "signal-direction " + (isLong ? "long" : "short");
  document.getElementById("signalCard").className = "signal-card " + (isLong ? "long" : "short");
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
  const w = 600, h = 180, pad = 8;
  const up = values[values.length - 1] >= 100;
  const color = up ? "#34d399" : "#fb7185";
  const ns = "http://www.w3.org/2000/svg";

  const points = history.map((pt, i) => {
    const x = pad + (i / (history.length - 1)) * (w - pad * 2);
    const y = h - pad - ((pt.equityEUR - min) / range) * (h - pad * 2);
    return [x, y];
  });
  const baseline = h - pad - ((100 - min) / range) * (h - pad * 2);

  const defs = document.createElementNS(ns, "defs");
  const gradId = "equityGrad";
  defs.innerHTML = `<linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
    <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
  </linearGradient>`;
  svg.appendChild(defs);

  const baseLine = document.createElementNS(ns, "line");
  baseLine.setAttribute("x1", pad); baseLine.setAttribute("x2", w - pad);
  baseLine.setAttribute("y1", baseline); baseLine.setAttribute("y2", baseline);
  baseLine.setAttribute("stroke", "rgba(255,255,255,0.12)"); baseLine.setAttribute("stroke-dasharray", "3,4");
  svg.appendChild(baseLine);

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1][0].toFixed(1)},${h - pad} L${points[0][0].toFixed(1)},${h - pad} Z`;

  const area = document.createElementNS(ns, "path");
  area.setAttribute("d", areaPath);
  area.setAttribute("fill", `url(#${gradId})`);
  area.setAttribute("stroke", "none");
  svg.appendChild(area);

  const line = document.createElementNS(ns, "path");
  line.setAttribute("d", linePath);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-width", "2.2");
  line.setAttribute("stroke-linejoin", "round");
  line.setAttribute("stroke-linecap", "round");
  svg.appendChild(line);

  const lastPt = points[points.length - 1];
  const dotOuter = document.createElementNS(ns, "circle");
  dotOuter.setAttribute("cx", lastPt[0]); dotOuter.setAttribute("cy", lastPt[1]); dotOuter.setAttribute("r", "7");
  dotOuter.setAttribute("fill", color); dotOuter.setAttribute("opacity", "0.18");
  svg.appendChild(dotOuter);
  const dot = document.createElementNS(ns, "circle");
  dot.setAttribute("cx", lastPt[0]); dot.setAttribute("cy", lastPt[1]); dot.setAttribute("r", "3.5");
  dot.setAttribute("fill", color);
  svg.appendChild(dot);
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

let lastLivePriceAt = null;

async function fetchKrakenEUR() {
  const res = await fetch("https://api.kraken.com/0/public/Ticker?pair=XBTEUR");
  const j = await res.json();
  if (j.error && j.error.length) throw new Error(j.error.join(","));
  const t = j.result.XXBTZEUR;
  const price = Number(t.c[0]);
  const open = Number(t.o);
  const change = ((price - open) / open) * 100;
  return { price, change };
}

async function fetchCoinbaseEUR() {
  const [spotRes, statsRes] = await Promise.all([
    fetch("https://api.coinbase.com/v2/prices/BTC-EUR/spot"),
    fetch("https://api.exchange.coinbase.com/products/BTC-EUR/stats"),
  ]);
  const spot = await spotRes.json();
  const price = Number(spot.data.amount);
  let change = null;
  try {
    const stats = await statsRes.json();
    const open = Number(stats.open);
    change = open ? ((price - open) / open) * 100 : null;
  } catch {}
  return { price, change };
}

async function refreshLivePrice() {
  const statusEl = document.getElementById("tickerLive");
  try {
    let result;
    let source = "Kraken";
    try {
      result = await fetchKrakenEUR();
    } catch {
      result = await fetchCoinbaseEUR();
      source = "Coinbase";
    }
    document.getElementById("tickerPrice").textContent = fmtEUR(result.price);
    const changeEl = document.getElementById("tickerChange");
    if (result.change != null) {
      changeEl.textContent = `${result.change >= 0 ? "+" : ""}${result.change.toFixed(2)}% (24h)`;
      changeEl.className = "ticker-change " + (result.change >= 0 ? "up" : "down");
    }
    lastLivePriceAt = new Date();
    if (statusEl) statusEl.textContent = `LIVE · ${source} · màj à l'instant`;
  } catch (e) {
    console.error("live price error", e);
    if (statusEl) {
      const secs = lastLivePriceAt ? Math.round((Date.now() - lastLivePriceAt) / 1000) : null;
      statusEl.textContent = secs != null ? `⚠ dernière maj il y a ${secs}s` : "⚠ prix indisponible";
    }
  }
}

refreshDashboard();
refreshLivePrice();
setInterval(refreshDashboard, 60_000);
setInterval(refreshLivePrice, 12_000);
