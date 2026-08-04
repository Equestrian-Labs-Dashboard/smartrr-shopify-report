# Validation v1.4

Validated locally:

- `assets/js/app.js` JavaScript syntax
- `assets/js/dataService.js` JavaScript syntax
- `scripts/sync-shopify-actuals.mjs` syntax
- `scripts/sync-connected-data.mjs` syntax
- `tests-model.mjs` formula tests
- duplicate function declarations removed
- scenario save uses the complete STATE object
- active input is committed before Save
- Refresh Actuals does not overwrite Cavali forecast years
- three SKUSavvy warehouse CSV files included
- Google Sheets sync writes `data/connected_actuals.json`

The live API test runs in GitHub Actions because repository secrets are not available locally.
