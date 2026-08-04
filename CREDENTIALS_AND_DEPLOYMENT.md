# Credentials and deployment — v1.4

## Required repository secrets

- `SHOPIFY_CORRO_STORE`
- `SHOPIFY_CORRO_TOKEN`
- `SHOPIFY_CAVALI_STORE`
- `SHOPIFY_CAVALI_TOKEN`
- `GOOGLE_CREDENTIALS`
- `SHEET_ID_CORRO`
- `SHEET_ID_CAVALI`
- `ADS_SHEET_ID`

## Present but not required by this workflow

- `SMARTRR_API_KEY_CORRO`
- `SMARTRR_API_KEY_CAVALI`

Smartrr data is read from the `smartrr_subscribers` and `smartrr_product_volume` tabs of the connected dashboard sheets. Keep the secrets for the separate pipeline repository that populates those tabs.

## SKUSavvy

This project reads the three committed warehouse exports:

- `data/skusavvy/wellington_inventory.csv`
- `data/skusavvy/corro_trailer_1_inventory.csv`
- `data/skusavvy/drop_ship_inventory.csv`

Therefore `SKUSAVVY_BASE_URL` and `SKUSAVVY_API_KEY` are not required here. Replace the three CSV files whenever a new inventory export is available and run the deployment workflow.

A direct SKUSavvy API refresh can be added later using the existing `SKUSAVVY_TOKEN` from the `corro_skusavvy` repository. GitHub Secrets are repository-scoped, so the token would need to be added again to this repository under the exact name `SKUSAVVY_TOKEN`.

## Save behavior

All editable fields are stored in one complete state object. The Save button commits the active field, recalculates Tabs 1–4, saves the active Draft/Budget/Forecast/Board scenario, and verifies the browser write. Refresh Actuals updates only Current/Baseline fields and does not overwrite saved forecast years.
