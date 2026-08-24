# Training (RACE GPU workstation only)

This package is for **model training** on RMIT **RACE**: a private, customisable AWS virtual station with GPU — not a public training API.

## Where it runs

| Machine | Use |
|---------|-----|
| Laptop (no GPU) | Do not train here. Use mock inference only. |
| RACE GPU station | Log in like a remote PC; train; push weights to shared AWS Storage. |

## Intended flow

1. Annotations / datasets live in **AWS object storage** (sync or download onto the station).
2. Train on RACE (`DEVICE=cuda`).
3. Export checkpoint + metadata (dataset version, commit SHA, metrics) **to Storage**.
4. Register the artifact in the model registry (`configs/models.yaml` + DB row).
5. The **inference worker** on RACE loads those weights for `RUN_MODE=real` and writes job results back to the data plane (browser never calls RACE).

## Status

Placeholder for Phase 6. Training entrypoints are not implemented yet.

```bash
# On RACE GPU station (future)
cd services/training
# python -m train ...
```

Keep secrets and large weights out of git. Service-role credentials stay on the station only.
