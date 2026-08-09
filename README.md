# BTC Signal Dashboard

Dashboard qui calcule un signal **Long / Short** sur le BTC à partir de vraies données de marché
et de vraies news, et qui simule un portefeuille papier de **100 €** pour tester la stratégie.
**Aucun ordre réel n'est jamais passé. Aucun fonds réel n'est engagé. Ce n'est pas un conseil financier.**

## Ce qui est réel

- **Prix BTC/USD, BTC/EUR, volume, market cap** — API publique CoinGecko
- **Historique de prix (indicateurs)** — CoinGecko `market_chart` (clôtures horaires) et `ohlc` (bougies 4h réelles pour l'ATR)
- **Fear & Greed Index** — alternative.me
- **Funding rate BTC perpétuel** — Binance Futures API (best-effort : si bloqué depuis une région, le cycle continue sans ce facteur)
- **News** — flux RSS réels de CoinDesk, Cointelegraph et Decrypt, filtrés sur les dernières 48h et sur les mots-clés crypto/macro pertinents

Aucune donnée n'est inventée ou simulée, à l'exception explicite du **portefeuille** (100 €
fictifs) et de son **historique de trades**.

## Limites honnêtes (à lire avant de faire confiance au signal)

1. **Pas d'accès à X/Twitter.** Je n'ai pas de clé API X. Le "sentiment" utilise à la place de
   vrais flux RSS d'actus crypto (CoinDesk, Cointelegraph, Decrypt) avec un scoring par
   mots-clés bullish/bearish — c'est une heuristique simple, pas un modèle de NLP. Si tu as une
   clé API X (v2) ou un service comme LunarCrush/Santiment, je peux l'intégrer.
2. **Pas de décision "à la seconde".** Le cycle de décision (récupération des données, calcul du
   signal, gestion des positions) tourne toutes les **15 minutes** via GitHub Actions — c'est déjà
   très généreux pour une stratégie basée sur EMA/RSI/MACD en 1h/4h (du vrai scalping seconde par
   seconde demanderait un serveur dédié + exchange connecté par WebSocket + exécution réelle, hors
   périmètre d'une simulation). **Le prix affiché en haut du dashboard, lui, est bien mis à jour en
   direct dans le navigateur (~10 secondes).**
3. **Le cron ne tourne que depuis la branche par défaut du dépôt.** GitHub n'exécute les workflows
   `schedule` que sur la branche par défaut (généralement `main`). Tant que cette branche
   (`claude/btc-trading-dashboard-9w93u1`) n'est pas mergée dans `main`, **le cycle 24/7 ne se
   déclenche pas automatiquement** — tu peux le lancer manuellement via l'onglet Actions
   ("Run workflow") en attendant.
4. **GitHub désactive les workflows planifiés après 60 jours sans activité** sur le dépôt (règle
   GitHub, pas de contournement possible). Un simple commit/push relance le compteur.
5. **Aucun effet de levier n'est appliqué.** Toutes les positions sont simulées "au comptant"
   (1x). C'est un choix délibéré pour rester réaliste sur un capital de 100 €.
6. Une fois le solde du portefeuille papier à **0 €, le bot arrête définitivement d'ouvrir de
   nouvelles positions** (comportement demandé).

## Stratégie utilisée

Chaque cycle calcule un score composite (facteurs réels, pondérés) :

| Facteur | Poids |
|---|---|
| Croisement EMA20 / EMA50 (tendance) | ±2 |
| RSI(14) (survente/surachat) | ±0.5 à ±1.5 |
| MACD histogramme (momentum + accélération) | ±1.5 à ±2 |
| Position vs Bandes de Bollinger(20,2) | ±1 |
| Fear & Greed Index (contrarian aux extrêmes) | ±1 |
| Funding rate BTC perpétuel (contrarian aux extrêmes) | ±0.5 |
| Sentiment news RSS temps réel | ±3 |

Score ≥ 0 → **LONG**, score < 0 → **SHORT**. Le signal est toujours affiché ; une position n'est
réellement ouverte que si sa **force** dépasse un seuil (évite de trader sur du bruit).

**Gestion du risque (portefeuille papier) :**
- 20 % du solde courant engagé par position
- Stop-loss / take-profit dimensionnés sur l'**ATR(14)** réel (bougies 4h) — ratio risque/rendement ≈ 1:2
- Maximum 3 positions ouvertes simultanément, une seule par sens (pas d'empilement Long+Long)
- Arrêt définitif à 0 €

## Architecture

```
engine/        moteur Node.js (zéro dépendance de calcul, undici pour le fetch)
  dataSources.mjs   appels aux APIs réelles (CoinGecko, alternative.me, Binance, RSS)
  indicators.mjs    EMA, RSI, MACD, Bollinger, ATR
  strategy.mjs      calcul du signal composite + sentiment news
  portfolio.mjs      moteur du portefeuille papier (ouverture/fermeture, SL/TP, historique)
  runCycle.mjs        orchestrateur d'un cycle complet -> écrit data/state.json
site/           dashboard statique (HTML/CSS/JS, zéro framework)
data/state.json état persistant (portefeuille + dernier signal + historique d'équité)
.github/workflows/trading-cycle.yml   cron GitHub Actions (cycle + déploiement Pages)
server.mjs      petit serveur local pour prévisualiser le dashboard
```

## Lancer en local

```bash
npm install
npm run cycle   # exécute un cycle réel, met à jour data/state.json
npm run serve   # sert le dashboard sur http://localhost:8787
```

## Mise en prod (une fois le repo mergé sur la branche par défaut)

1. **Settings → Pages → Source : "GitHub Actions"** (à faire une seule fois, à la main — aucun
   outil ne me permet de le faire depuis ici).
2. Le workflow `trading-cycle.yml` s'occupe ensuite de tout : cycle toutes les 15 min, commit de
   `data/state.json`, déploiement du dashboard sur GitHub Pages.
3. Tu peux aussi déclencher un cycle manuellement depuis l'onglet **Actions → BTC trading cycle
   (24/7) → Run workflow**.
