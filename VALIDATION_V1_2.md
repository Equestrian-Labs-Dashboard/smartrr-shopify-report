# Strategic Operating Model v1.2 Validation

Validated locally:
- `assets/js/app.js` syntax
- `assets/js/dataService.js` syntax
- `scripts/sync-shopify-actuals.mjs` syntax
- `data/assumptions.json` structure
- Refresh no longer writes forecast-year values for Ecommerce, Concierge, or Wellington
- Scenario is snapshotted before every save
- 2026 base forecast uses Shopify YTD plus remaining-month run rate
- Organic Growth returns zero for 2026 and starts in 2027
- Concierge/Wellington GM1 reads channel gross profit/net sales when available
- Carryover current is returning revenue divided by customer revenue
- CAC prefers Spend / Purchases and documents fallback to new customers
- S&M OPEX is separated from Advertising and uses flat annual assumptions

External validation still required after deployment:
- Shopify workflow with live repository secrets
- Google Sheet read access from GitHub Pages
- Channel revenue-share rows containing net sales and gross profit
- Cavali Smartrr rows after API refresh
