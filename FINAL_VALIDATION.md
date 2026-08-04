# Final Validation

Validated on 2026-07-30.

- `assets/js/app.js`: JavaScript syntax valid.
- `assets/js/dataService.js`: JavaScript syntax valid.
- `scripts/sync-shopify-actuals.mjs`: JavaScript syntax valid.
- `data/assumptions.json`: valid JSON.
- `tests-model.mjs`: passed.
- GP bridge test: GP1, GP2 and GP3 produce distinct, reconciled values when shipping/packaging/ad spend are present.
- Funding timing test: Jan-27 funding is recognized in 2027 and changes Dover/Paid Growth timing compared with Oct-26.

External Shopify/GitHub Pages validation still runs through the repository workflow because it depends on repository secrets and live services.
