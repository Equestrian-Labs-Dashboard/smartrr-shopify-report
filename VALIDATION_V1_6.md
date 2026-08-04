# Strategic Operating Model v1.6 — Actuals and channel extraction fixes

- Shopify order extraction now includes `sourceName` and uses the same channel rules as the reporting pipeline.
- Wellington includes POS/source and Wellington tags.
- Concierge includes Concierge source/tags.
- Channel GM1 uses each channel net sales and Shopify variant unit costs.
- 2026 channel forecast values are seeded once from YTD actuals and then remain editable/saved.
- Current-month partial data is excluded from annualization; the latest closed month is used.
- Cavali subscribers read `smartrr_product_volume` or `smartrr_subscribers`.
- Local storage key moved to v61 to prevent stale placeholder values (`100`, `Editable`, `Actuals + 10`) from replacing corrected data.
- Workflow uses Node 24 without npm cache, so no lock-file error occurs.
