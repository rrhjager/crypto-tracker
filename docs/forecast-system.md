# Forecast System

## Purpose
A leakage-free, cost-aware probabilistic signal layer for swing horizons on equities and crypto.

Supported horizons:
- `7D`
- `14D`
- `30D`

Supported asset types:
- `equity`
- `crypto`

## Labels
For each day `t`, the feature vector uses only candles up to and including day `t`.

The target label for horizon `H` is:
- `prob_up = P(log_return(H) > 0)`
- `y_t = 1` if `ln(close[t+H] / close[t]) > 0`
- `y_t = 0` otherwise

Additional target values retained for diagnostics:
- `futureLogReturn = ln(close[t+H] / close[t])`
- `futureReturnPct = ((close[t+H] / close[t]) - 1) * 100`

### Alignment
- Features at day `t` are never allowed to read future candles.
- Labels begin after day `t` and end at `t + horizon`.
- Walk-forward evaluation inserts a purge/embargo gap of `horizon` days between train, calibration, and test blocks.

## Features
The production forecast uses robust features already compatible with the repo data sources:

- Trend
  - price vs `200D`
  - `50D / 200D` spread
  - `50D` slope
  - `ret7`, `ret20`, `ret60`
  - breakout bias `20D` / `55D`
- Momentum
  - `ROC14`
  - range-derived momentum / RSI-style timing
  - normalized MACD-style momentum proxy
- Volatility
  - `ATR% 14`
  - realized vol `20D`
  - rolling `63D` drawdown
- Volume / flow
  - volume z-score `20D`
  - volume trend `SMA5 / SMA20`
- Regime proxy
  - benchmark `20D` trend
  - benchmark/asset risk proxy via vol + ATR
  - relative strength vs benchmark `20D` / `60D`

## Models
Implemented models:
1. Regularized logistic regression baseline
2. Simple boosted stump ensemble (tree ensemble fallback because no dedicated gradient boosting library is installed)

Probability calibration:
- Platt scaling
- calibrated on a time-series calibration block after the train window

Final live probability:
- average of calibrated logistic probability and calibrated tree-ensemble probability

## Cost Model
Live and evaluation logic include round-trip friction:

- Equities fee: `fee_bps_equity` (default `10` bps round-trip)
- Crypto fee: `fee_bps_crypto` (default `20` bps round-trip)
- Slippage: `slippage_bps` (default `10` bps round-trip)

The round-trip cost is split half on entry and half on exit in strategy evaluation.

## Turnover Controls
The production forecast is long/cash in the MVP:

- enter `LONG` when `prob_up >= 0.60` and regime is not `RISK_OFF`
- remain `HOLD` between thresholds
- issue `EXIT` when `prob_up <= 0.50` or regime is `RISK_OFF`
- minimum hold period in evaluation: `3` days

This hysteresis prevents rapid churn.

## Evaluation
The endpoint returns walk-forward metrics for the requested symbol/horizon:

Classification:
- AUC
- Brier score
- log loss
- calibration error

Strategy metrics after costs:
- CAGR
- Sharpe
- max drawdown
- hit rate
- average trade return
- turnover
- compounded value of `100`

Baselines returned alongside the model:
- buy & hold
- long above `200D`, else cash
- simple momentum baseline

Regime slices returned:
- `RISK_ON`
- `RISK_OFF`
- `NEUTRAL`

## Production Endpoint
Route:
- `/api/forecast`

Query params:
- `symbol`
- `assetType=equity|crypto`
- `horizon=7|14|30`
- optional `market`
- optional `fee_bps_equity`
- optional `fee_bps_crypto`
- optional `slippage_bps`

Cache:
- Vercel KV + CDN cache
- default TTL `5 minutes`

### Example: Equity
```bash
curl "https://www.signalhub.tech/api/forecast?symbol=ASML.AS&assetType=equity&horizon=14&market=AEX"
```

### Example: Crypto
```bash
curl "https://www.signalhub.tech/api/forecast?symbol=BTC&assetType=crypto&horizon=7"
```

## Reproducible Evaluation Run
Start the app locally:

```bash
npm run dev
```

In a second shell, call the same forecast module through the saved evaluator:

```bash
npm run forecast:eval -- \
  --symbol ASML.AS \
  --asset-type equity \
  --market AEX \
  --horizon 14 \
  --fee-bps-equity 10 \
  --slippage-bps 10
```

Crypto example:

```bash
npm run forecast:eval -- \
  --symbol BTC \
  --asset-type crypto \
  --horizon 7 \
  --fee-bps-crypto 20 \
  --slippage-bps 10
```

The evaluator:
- hits the same `/api/forecast` route used by the UI
- passes explicit cost assumptions
- writes the full JSON response to `tmp/forecast-evals/`
- prints a compact summary with the live action plus the saved evaluation metrics

## UI Integration
Active pages now expose a page-level horizon selector (`7D / 14D / 30D`) and load a cached forecast panel on featured cards.

Each panel shows:
- `prob_up`
- confidence `0-100`
- expected return and prediction interval
- regime label
- action (`LONG / HOLD / EXIT`)
- position size scalar `0-1`
- top reasons
- key validation stats (AUC / hit rate / turnover)

## Reproducibility
Reproduce forecasts by calling the same endpoint with explicit parameters.
Because the endpoint returns the evaluation block, the live output and the saved metrics use the same code path.
