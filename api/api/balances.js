import { TOKENS, WALLETS } from "../lib/config.js";

const ETHERSCAN_BASE = "https://api.etherscan.io/v2/api";

function toTokenAmount(raw, decimals = 18) {
  const s = String(raw || "0");
  const d = Number(decimals);
  if (!s || s === "0") return 0;

  const padded = s.padStart(d + 1, "0");
  const whole = padded.slice(0, -d);
  const frac = padded.slice(-d).replace(/0+$/, "");
  return Number(`${whole}.${frac || "0"}`);
}

function fmtUsd(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return x.toLocaleString("en-US", {
    maximumFractionDigits: 2
  });
}

async function etherscanGet(params) {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ETHERSCAN_API_KEY in Vercel Environment Variables");
  }

  const url = new URL(ETHERSCAN_BASE);
  url.searchParams.set("chainid", "1");

  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  url.searchParams.set("apikey", apiKey);

  const r = await fetch(url.toString());
  const data = await r.json();

  if (data.status === "0" && data.message !== "No transactions found") {
    throw new Error(`Etherscan error: ${data.message || data.result}`);
  }

  return data.result;
}

async function getBinancePrice(pair) {
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const data = await r.json();
  return Number(data.price);
}

export default async function handler(req, res) {
  const symbol = String(req.query.symbol || "ALLO").toUpperCase();
  const token = TOKENS[symbol];

  if (!token) {
    return res.status(404).json({
      ok: false,
      error: `Unknown token: ${symbol}`
    });
  }

  try {
    const price = await getBinancePrice(token.binancePair);
    const results = [];

    for (const wallet of WALLETS) {
      const ethRaw = await etherscanGet({
        module: "account",
        action: "balance",
        address: wallet.address,
        tag: "latest"
      });

      const tokenRaw = await etherscanGet({
        module: "account",
        action: "tokenbalance",
        contractaddress: token.contractAddress,
        address: wallet.address,
        tag: "latest"
      });

      const ethBalance = toTokenAmount(ethRaw, 18);
      const tokenBalance = toTokenAmount(tokenRaw, token.decimals);
      const tokenValueUsd = price ? tokenBalance * price : null;

      results.push({
        label: wallet.label,
        address: wallet.address,
        ethBalance,
        token: {
          symbol: token.symbol,
          balance: tokenBalance,
          valueUsd: tokenValueUsd
        }
      });
    }

    return res.status(200).json({
      ok: true,
      symbol: token.symbol,
      priceUsd: price,
      wallets: results,
      summaryText: results
        .map((w) => {
          return [
            `Wallet: ${w.label}`,
            `Address: ${w.address}`,
            `ETH: ${w.ethBalance}`,
            `${token.symbol}: ${w.token.balance}`,
            price ? `Estimated ${token.symbol} value: $${fmtUsd(w.token.valueUsd)}` : "USD value unavailable"
          ].join("\n");
        })
        .join("\n\n")
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message
    });
  }
      }
