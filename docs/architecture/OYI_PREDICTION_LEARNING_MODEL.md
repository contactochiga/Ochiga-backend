# Oyi Prediction And Learning Model

Status: Phase A foundation.

## Contract Owner

- `src/oyi-core/contracts/intelligence.ts`
- Existing prediction implementation remains in `src/intelligence-core/predictionEngine.ts`.

## Distinction

Anomaly detection answers: what is abnormal now?

Forecasting answers: what is likely to happen next?

The current prediction engine is preserved and should be wrapped progressively into the formal contracts rather than deleted.

## Standard Artifacts

The foundation defines:

- `OperationalAnomaly`
- `OperationalPrediction`
- `PredictionOutcome`
- `RecommendationOutcome`
- `ActionOutcome`

## Learning Boundary

Learning may improve rankings, thresholds, recommendation weights, model parameters and alert sensitivity.

Learning must not rewrite:

- permissions
- privacy policy
- financial authority
- access-control authority
- security policy

## Next Required Slice

Add persistence/evaluation for prediction outcomes and deterministic fixtures for utility/device forecasts. Do not claim learning until outcomes are compared with reality.
