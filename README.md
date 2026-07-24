# zakat-prices

Daily gold & silver price feed for the Zakat calculator app. A GitHub Action fetches
metal prices once a day, converts them into all supported currencies, and commits the
result as a static `prices.json` that the app reads directly. No server, no API key in
the app binary, ~60 upstream API calls/month regardless of user count.

## How it works

1. `.github/workflows/update-prices.yml` runs daily at 07:00 UTC (and on manual trigger).
2. `scripts/fetch-prices.mjs` fetches XAU + XAG in USD from GoldAPI and FX rates from
   open.er-api.com (free, no key needed), computes per-gram prices and Nisab thresholds
   for USD, EUR, GBP, MAD, SAR, IDR, and writes `prices.json`.
3. The workflow commits `prices.json` back to the repo. That commit also counts as repo
   activity, so GitHub never pauses the schedule for inactivity.
4. If any upstream call fails or returns implausible data, the script exits non-zero and
   the last good `prices.json` stays untouched.

## App endpoint

```
https://raw.githubusercontent.com/Forstman1/zakat-prices/main/prices.json
```

## Setup (one-time)

1. Repo Settings -> Secrets and variables -> Actions -> add `GOLDAPI_KEY` (your GoldAPI key).
2. Actions tab -> "Update metal prices" -> Run workflow. `prices.json` gets its first real data.
3. Remove the GoldAPI key from the app code entirely. If it was ever committed to the app's
   repo history, rotate it at goldapi.io.

## prices.json schema

```json
{
  "fetched_at": "2026-07-24T07:00:00.000Z",
  "base": "USD",
  "metals": { "XAU": { "usd_per_oz": 2400.5 }, "XAG": { "usd_per_oz": 28.1 } },
  "fx": { "USD": 1, "EUR": 0.92, "GBP": 0.79, "MAD": 9.93, "SAR": 3.75, "IDR": 16200 },
  "nisab_standard": { "gold_grams": 87.48, "silver_grams": 612.36 },
  "prices": {
    "USD": {
      "gold_per_gram": 77.18,
      "silver_per_gram": 0.9036,
      "gold_per_oz": 2400.5,
      "silver_per_oz": 28.1,
      "nisab_gold": 6751.59,
      "nisab_silver": 553.39
    }
  }
}
```

Nisab uses the common standards: 87.48 g gold / 612.36 g silver.

## App-side usage (React Native)

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";

const PRICES_URL = "https://raw.githubusercontent.com/Forstman1/zakat-prices/main/prices.json";
const CACHE_KEY = "metalPrices.v1";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // each device refetches at most 2x/day

export async function getMetalPrices() {
  const cachedRaw = await AsyncStorage.getItem(CACHE_KEY);
  const cached = cachedRaw ? JSON.parse(cachedRaw) : null;

  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return { payload: cached.payload, stale: false };
  }

  try {
    const res = await fetch(PRICES_URL, { headers: { "Cache-Control": "no-cache" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    if (!payload?.fetched_at || !payload?.prices?.USD) throw new Error("bad payload");
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), payload }));
    return { payload, stale: false };
  } catch (e) {
    if (cached) return { payload: cached.payload, stale: true }; // show stale data + notice
    throw e; // no cache at all -> UI falls back to manual price entry
  }
}
```

Show `fetched_at` in the UI ("prices as of ...") to preempt "your price is wrong" reviews.

## Quota math

- GoldAPI free tier: ~100 calls/month. Usage: 2 metals x 1 run/day = ~60/month.
- open.er-api.com free endpoint: no key, generous limits. Usage: 1 call/day.
- GitHub Actions on a public repo: free.
