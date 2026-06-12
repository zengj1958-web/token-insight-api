import { TOKENS } from "../../lib/config.js";

function fmtNumber(n, digits = 2) {
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  return num.toLocaleString("en-US", {
    maximumFractionDigits: digits
  });
}

function daysBetween(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

async function getBinanceTicker(pair) {
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Binance error ${r.status}`);
  return await r.json();
}

export default async function handler(req, res) {
  const symbol = String(req.query.symbol || "").toUpperCase();
  const token = TOKENS[symbol];

  if (!token) {
    return res.status(404).json({
      ok: false,
      error: `Unknown token: ${symbol}`
    });
  }

  let market = null;
  let marketError = null;

  try {
    const ticker = await getBinanceTicker(token.binancePair);
    market = {
      pair: token.binancePair,
      price: Number(ticker.lastPrice),
      change24hPercent: Number(ticker.priceChangePercent),
      volume24hUsdt: Number(ticker.quoteVolume)
    };
  } catch (e) {
    marketError = e.message;
  }

  const now = new Date();
  const next30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const upcomingUnlocks = (token.unlockSchedule || [])
    .map((u) => {
      const date = new Date(`${u.date}T00:00:00Z`);
      return {
        ...u,
        daysFromNow: daysBetween(now, date)
      };
    })
    .filter((u) => {
      const d = new Date(`${u.date}T00:00:00Z`);
      return d >= now && d <= next30;
    });

  let pressure = "LOW";
  if (market && upcomingUnlocks.length > 0) {
    const totalUnlockValue = upcomingUnlocks.reduce(
      (sum, u) => sum + Number(u.amount || 0) * Number(market.price || 0),
      0
    );
    const ratio = market.volume24hUsdt > 0 ? totalUnlockValue / market.volume24hUsdt : 0;

    if (ratio > 1) pressure = "EXTREME";
    else if (ratio > 0.3) pressure = "HIGH";
    else if (ratio > 0.1) pressure = "MEDIUM";
  }

  return res.status(200).json({
    ok: true,
    symbol: token.symbol,
    name: token.name,
    market,
    marketError,
    upcomingUnlocks,
    pressure,
    summaryText: [
      `Summary: ${token.name} (${token.symbol})`,
      market
        ? `Price: $${fmtNumber(market.price, 4)}, 24h Change: ${fmtNumber(market.change24hPercent, 2)}%, 24h Volume: $${fmtNumber(market.volume24hUsdt, 0)}`
        : `Market data unavailable: ${marketError}`,
      upcomingUnlocks.length
        ? `Upcoming unlocks in next 30 days: ${upcomingUnlocks.map((u) => `${u.date} ${fmtNumber(u.amount, 0)} ${token.symbol}`).join("; ")}`
        : "No configured unlocks in next 30 days.",
      `Pressure: ${pressure}`
    ].join("\n")
  });
                                                                             }
