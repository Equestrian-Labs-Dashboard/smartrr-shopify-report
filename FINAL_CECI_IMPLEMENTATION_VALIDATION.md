# Final implementation validation — Ceci requirements

Validated in this package:

- Every editable cell updates the in-memory model and schedules persistence.
- Save commits the active field, snapshots the complete active scenario, recalculates the model, and persists the complete state.
- Draft, Budget, Forecast, and Board are stored independently.
- Refresh Actuals updates current/baseline data and does not overwrite saved forecast assumptions.
- Corro Ecommerce, Concierge, and Wellington are classified separately from Shopify order/product tags.
- Channel GM1 is Gross Profit / Net Sales using Shopify variant inventory unit cost when Shopify provides it.
- Cavali GM1 is calculated from Cavali Shopify net sales and unit costs.
- Missing Shopify unit costs remain zero and must be corrected in Shopify; they are not replaced with an invented margin.
- Google Sheets Corro, Cavali, Stats/Ads, Smartrr tabs, and the three committed SKUSavvy CSV files are included in the connected-data workflow.
- GP2, GP3, funding timing, launch timing, and cash-flow formula tests pass.

Important production limitation:

GitHub Pages saves editable scenarios in the browser localStorage. This persists on the same browser/profile/device. Shared multi-user persistence requires a write backend or a Google Sheets write endpoint and is not provided by static GitHub Pages.
