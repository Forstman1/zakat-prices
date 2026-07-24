// Fetches gold + silver (USD/oz) from GoldAPI and USD FX rates from
// open.er-api.com (free, key-less), then writes a single prices.json
// containing all supported currencies + Nisab thresholds.
//
// Fails loudly (exit 1) on any bad upstream data, so the workflow never
// commits garbage over the last good file.

import { writeFileSync } from "node:fs";

const GOLDAPI_KEY = process.env.GOLDAPI_KEY;
if (!GOLDAPI_KEY) {
  console.error("GOLDAPI_KEY secret is not set. Add it in repo Settings -> Secrets -> Actions.");
  process.exit(1);
}

const TROY_OZ_GRAMS = 31.1034768;
const CURRENCIES = ["USD", "EUR", "GBP", "MAD", "SAR", "IDR"];
// Nisab thresholds (widely used standards)
const NISAB = { gold_grams: 87.48, silver_grams: 612.36 };

async function fetchMetal(symbol) {
  const res = await fetch(`https://www.goldapi.io/api/${symbol}/USD`, {
    headers: { "x-access-token": GOLDAPI_KEY, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`GoldAPI ${symbol} failed: HTTP ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const price = data?.price;
  if (typeof price !== "number" || !(price > 0)) {
    throw new Error(`GoldAPI ${symbol}: unexpected payload ${JSON.stringify(data).slice(0, 300)}`);
  }
  return price; // USD per troy oz
}

// Guard against committing obviously wrong data (bad parse, API bug, etc.)
function assertSane(symbol, usdPerOz) {
  const [min, max] = symbol === "XAU" ? [500, 20000] : [5, 500];
  if (usdPerOz < min || usdPerOz > max) {
    throw new Error(`${symbol} price ${usdPerOz} USD/oz outside sanity range [${min}, ${max}]`);
  }
}

async function fetchFx() {
  const res = await fetch("https://open.er-api.com/v6/latest/USD");
  if (!res.ok) throw new Error(`FX fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  if (data?.result !== "success" || !data.rates) {
    throw new Error(`FX: unexpected payload ${JSON.stringify(data).slice(0, 300)}`);
  }
  for (const c of CURRENCIES) {
    if (typeof data.rates[c] !== "number" || !(data.rates[c] > 0)) {
      throw new Error(`FX: missing or invalid rate for ${c}`);
    }
  }
  return data.rates;
}

const round = (n, d = 4) => Number(n.toFixed(d));

const goldUsdOz = await fetchMetal("XAU");
const silverUsdOz = await fetchMetal("XAG");
assertSane("XAU", goldUsdOz);
assertSane("XAG", silverUsdOz);
const rates = await fetchFx();

const fx = Object.fromEntries(CURRENCIES.map((c) => [c, round(rates[c], 6)]));

const prices = {};
for (const c of CURRENCIES) {
  const rate = rates[c];
  const goldGram = (goldUsdOz / TROY_OZ_GRAMS) * rate;
  const silverGram = (silverUsdOz / TROY_OZ_GRAMS) * rate;
  prices[c] = {
    gold_per_gram: round(goldGram),
    silver_per_gram: round(silverGram),
    gold_per_oz: round(goldUsdOz * rate, 2),
    silver_per_oz: round(silverUsdOz * rate, 2),
    nisab_gold: round(goldGram * NISAB.gold_grams, 2),
    nisab_silver: round(silverGram * NISAB.silver_grams, 2),
  };
}

const out = {
  fetched_at: new Date().toISOString(),
  base: "USD",
  metals: {
    XAU: { usd_per_oz: goldUsdOz },
    XAG: { usd_per_oz: silverUsdOz },
  },
  fx,
  nisab_standard: NISAB,
  prices,
};

writeFileSync("prices.json", JSON.stringify(out, null, 2) + "\n");
console.log("prices.json written OK:", JSON.stringify(out.metals));
