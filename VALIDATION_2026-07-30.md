# Validation – Funding Drivers and Margin Reconciliation

Executed on 2026-07-30.

## Automated checks passed

- JavaScript syntax (`assets/js/app.js`).
- Shopify sync syntax (`scripts/sync-shopify-actuals.mjs`).
- JSON validity (`data/assumptions.json`).
- GP2 formula: `GP1 - Outbound Shipping - Packaging + Shipping Revenue`.
- GP3 formula: `GP2 - Advertising`.
- Tab 2 and Tab 3 use the same `marginBridge()` calculation source.
- Funding Date `Jan-27`: Funding Cash In is zero in 2026 and $3M in 2027.
- Embroidery launch: Funding Date + 3 months, prorated for active months.
- Private Label launch: Funding Date + 15 months, matching Oct-26 → Jan-28 and Jan-27 → Apr-28.
- Dover ramp shifts with Funding Date.
- Incremental marketing and Paid Growth shift with Funding Date.
- Legacy Cavali Membership rows are added to Signature from 1-Aug-2026 when supplied by Smartrr.

## Test command

```bash
node tests-model.mjs
```
