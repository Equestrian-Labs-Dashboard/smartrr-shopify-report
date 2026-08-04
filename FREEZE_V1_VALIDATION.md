# Freeze v1.0 Validation

## Implemented
- Magic Page single source of truth for assumptions.
- Returning Customers % and Carryover % linked from Retention Strategy.
- Dashboard Display block added to Magic Page.
- Scenario selector centralized in Dashboard Display.
- Display Year selector added for 2026–2029.
- KPI cards in Tabs 1–4 use the selected Display Year.
- KPI cards show `Forecast YYYY`.
- Tabs 5–6 hidden as next-phase scope.
- 2026 Shopify actuals are preserved.

## Technical validation
- `node --check assets/js/app.js`
- `node --check assets/js/dataService.js`
- `node --check scripts/sync-shopify-actuals.mjs`
- JSON parse validation for `data/assumptions.json`

## Functional test
1. Open Magic Page and select each Display Year.
2. Confirm every KPI block in Tabs 1–4 changes to the same selected year.
3. Confirm each card displays `Forecast YYYY`.
4. Edit Returning Customers % and Carryover % on Magic Page; confirm Purchase Frequency card updates.
5. Edit Magic Page inputs and verify Tabs 2–4 update without manual edits.
6. Refresh Shopify actuals and confirm 2026 remains sourced from Shopify.
