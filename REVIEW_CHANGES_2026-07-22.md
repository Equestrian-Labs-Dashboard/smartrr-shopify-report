# Review Changes - July 22, 2026

## Completed

1. Checkout Abandonment Rate now reads from Shopify/model data when available. When the source is unavailable, the UI displays `Data unavailable` instead of an unexplained dash.
2. Other Operating Expenses displays `$0` when its calculated value is zero.
3. Opening Cash displays `$0` when the opening balance is zero.
4. Cash Out detail order is Inventory, Shipping & Fulfillment, Advertising, Sales & Marketing, G&A, Other Operating Expenses.
5. Private Label is classified as Growth Investments.
6. Embroidery Machine is classified as CapEx.
7. Removed the duplicate Private Label Investment and Other rows; Other Cash Out remains.
8. Cash Bridge separates Cash Out excluding CapEx from CapEx to avoid a misleading double presentation.
9. Existing section accent colors are retained and documented: green KPI/commercial, purple financial/margin, yellow operations/business units, blue cash flow/funding.
10. Financial Summary remains fed by the model calculations from the prior tabs.

## External data still required

- A true Shopify Checkout Abandonment Rate requires Shopify analytics data or a maintained model assumption. The current order sync alone cannot calculate it reliably.
- QuickBooks/ShipStation integration remains pending for operating-cost actuals and cash timing.

## Final cash-flow and Shopify KPI correction

- 2026 Opening Cash is no longer zero by default. It starts at an editable `$100k` assumption.
- Clicking the Opening Cash value in the Cash Summary lets the user change the 2026 opening balance.
- Opening Cash for 2027–2029 is calculated from the immediately preceding year's Ending Cash, preserving the cash roll-forward.
- The Net Cash Flow table now displays Opening Cash for every year.
- Blank/manual future count assumptions for 2027–2029 default to `100` while remaining editable.
- The secure GitHub Actions Shopify sync now requests sessions, visitors, pageviews, conversion rate, and checkout conversion rate through ShopifyQL.
- Checkout Abandonment Rate is calculated as `100% - checkout conversion rate` and is passed into the dashboard JSON.
- When Shopify does not expose checkout conversion rate for a store or date range, the dashboard continues to show a clear unavailable-data message instead of a false zero.
