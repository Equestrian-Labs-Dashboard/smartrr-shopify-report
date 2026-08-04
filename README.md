# Strategic Operating Model v1.0 Freeze Candidate (v4.3)

## Freeze implementation — 2026-07-28
- Magic Page contains the only Dashboard Display controls: Scenario and Display Year.
- Display Year supports 2026–2029 and controls every KPI-card block in Tabs 1–4.
- Every KPI card states its period as `Forecast YYYY`; years are never mixed in one card block.
- Returning Customers % and Incremental Revenue Carryover % are read directly from the Magic Page Retention Strategy rows. They are not hardcoded in output cards.
- Tabs 2–4 remain calculated outputs with no manual inputs.
- Tabs 5–6 are hidden for this freeze and remain next-phase scope.
- Shopify actuals continue to populate 2026; changing Display Year only changes the view and never overwrites 2026 actuals.

# Strategic Operating Model v3.6

Includes Page 1 Magic Page + Page 2 Growth & Margin Engine with Easy Numbers Test formula alignment.

Key changes:
- Draft / Budget / Forecast / Board scenario persistence.
- Publish To flow copies current scenario inputs to Budget, Forecast or Board.
- Currency format unified: < $1M shown as k; >= $1M shown as M.
- Dover, Ecommerce Revenue Build, Carryover, 2029 reinvestment, and Margin Bridge formulas aligned to the Easy Numbers Test.
- Inventory Turns current set to 0.17x from SKU/Savy report until Shopify/SKU source is validated.

Deploy by replacing the repo contents, commit/push, then hard refresh.


## V26 update — HITS Marketing Subscription

Added **HITS Marketing Subscription** to Section 6 — Growth Initiatives as a Base / Active marketing tool with investment **$306** (rounded from $305.64). This is treated as **Sales & Marketing OPEX reference**, not CapEx. The strategic page shows it for visibility; the financial impact belongs in Tab 03 / Financial P&L or the Financial Dashboard OPEX mapping.


## V26 update — Tab 3 / Tab 4 visual structure
Added Tab 03 Financial Summary and Tab 04 Commercial Cash Flow as read-only executive outputs. Tab 03 follows the PRD: KPI Cards, Commercial P&L, Operating KPIs. Tab 04 follows the PRD: KPI Cards, Cash In, Cash Out, Net Cash Flow and Waterfall. Values are generated from Tabs 1–2 model outputs and funding plan; no editable fields are included.

## Legacy clarification for SKU/Savy
Legacy classification does not come from this Strategic Model. It must be verified in the SKU/Savy data pipeline/source logic: whether it is Shopify tag/metafield/status, SKU/Savy mapping, collection, product age, or another rule. Do not assume source of truth until the SKU/Savy code or source data is checked.


## V29 final audit updates
- Tab 03 removes “No editable inputs” subtitle noise and uses softer visual hierarchy.
- Tab 03 Commercial P&L highlights Gross Sales, Net Sales, GP1, GP2, GP3 and EBITDA.
- Zero values display as — in financial output views; negative values use soft red.
- Technology is renamed Other Operating Expenses.
- Operating KPIs use Checkout Abandonment Rate instead of Paid Revenue.
- Tab 04 Cash Flow now follows commercial cash timing: Shopify Deposits Corro, Shopify Deposits Cavali, Funding and Other Cash Receipts.
- Cash Out uses Operating Cash Out plus Inventory, Advertising, Shipping & Fulfillment, S&M, G&A, Growth Investments, CapEx, Private Label Investment and Other.
- Cash Coverage = Ending Cash ÷ Average Monthly Operating Cash Out.
- Formula QA documents Default Logic (2029 onwards), Constant ROAS assumption, and carryover anti-double-counting rule.


## Final QA notes from 2026-07-22
- Carryover applies only once when calculating the following year Base Ecommerce Revenue; do not re-add the same revenue downstream.
- GM1% must be defined over Net Sales, not Gross Sales.
- Annual GP per Customer must use AOV, Purchase Frequency and GM1 from the same business population.
- 2029 Default Logic onwards: Prior Year Ecommerce Gross Sales × Reinvestment %.
- Paid Growth Revenue: revenue influenced by paid media; assumes constant ROAS during the selected fiscal year.
- HITS is OPEX / Sales & Marketing for $305.64, not CapEx.


## V32 notes

- System-wide modern Corro blue visual refresh.
- Light/dark mode toggle in the header: sun for light mode, moon for dark mode.
- Editable percentage fields keep the `%` symbol visible.
- Shopify direct API is not exposed in GitHub Pages; actuals refresh through Google Sheets/dashboard outputs until a secure backend/pipeline is connected.


## Shopify direct sync

This version includes a secure Shopify sync step in GitHub Actions.

Required repository secrets:

- `SHOPIFY_CORRO_STORE`
- `SHOPIFY_CORRO_TOKEN`
- `SHOPIFY_CAVALI_STORE`
- `SHOPIFY_CAVALI_TOKEN`

The workflow runs `scripts/sync-shopify-actuals.mjs`, calls the Shopify Admin GraphQL API, and writes:

```text
data/shopify_actuals.json
```

The browser reads this JSON. Shopify tokens are never exposed in frontend JavaScript.

Important: Shopify sync provides sales/order metrics. COGS/GM1, inventory turns, Klaviyo and QuickBooks/ShipStation still require their respective data sources.


## Shopify sync update v36

The model now prefers `data/shopify_actuals.json` when present. This file is generated by GitHub Actions using the repository secrets for Corro and Cavali. The browser never reads Shopify tokens. If the JSON does not exist yet, Refresh Actuals falls back to Google Sheets.

Corro channel splits are derived from Shopify order/product tags: Drop ship, Shopify Collective, Concierge, Wellington, Legacy, and e-commerce. Cavali order count feeds Section 3 and future years remain editable placeholders.


## v37 Cavali Section 3 fill
Cavali Section 3 now fills all baseline/2026 fields, not only Orders. Shopify sync counts Cavali orders; 2026 count placeholders use actual + 10. Member counts also use current + 10, while boxes/year, prices, GM1, ad spend and CAC carry current/default values so formulas can run and future years remain editable.

## Language standard

- All client-facing interface text is written in English.
- Source code identifiers, comments, console messages, validation messages, and runtime errors are written in English.
- Internal team instructions may be maintained in Spanish outside the client-facing application and production source code.
- New contributions must preserve this standard.


## July 22, 2026 review corrections

- Checkout Abandonment Rate is connected through `STATE.actuals.checkoutAbandonmentRate`, `shopifySync.checkoutAbandonmentRate`, or the model assumption. When no analytics value exists, the card explicitly shows `Data unavailable` instead of a blank dash.
- Other Operating Expenses displays `$0` when the calculated value is zero.
- Cash Flow order is Inventory, Shipping & Fulfillment, Advertising, Sales & Marketing, G&A, and Other Operating Expenses.
- Private Label is classified under Growth Investments.
- Embroidery Machine is classified under CapEx.
- Removed the duplicate Private Label Investment and Other rows; only Other Cash Out remains.
- The Cash Bridge separates Cash Out from CapEx and shows Opening Cash as `$0` when the opening balance is zero.
- Section accent bars use green for KPI/commercial, purple for financial/margin, yellow for operations/business units, and blue for cash flow/funding where semantically appropriate.

## Cash roll-forward and checkout KPI

The 2026 Opening Cash assumption defaults to `$100k` and can be edited by clicking its value in the Cash Summary. Each later year's Opening Cash equals the prior year's Ending Cash automatically.

The Shopify sync also requests session metrics through ShopifyQL. When available, Checkout Abandonment Rate is calculated as:

`Checkout Abandonment Rate = 100% - Checkout Conversion Rate`

The GitHub repository must keep the existing Shopify store and access-token secrets configured for the scheduled workflow.


## v1.2 review corrections
- 2026 Ecommerce forecast = Shopify actuals YTD + remaining months x editable monthly run rate.
- Organic Growth starts in 2027; it is not added again to 2026.
- Refresh Actuals updates current/baseline fields only and preserves saved forecast inputs.
- Concierge and Wellington use their own channel GM1 when revenue_share provides channel gross profit/net sales.
- Current revenue carryover uses returning revenue / total customer revenue.
- CAC uses Marketing Stats Purchases when available; new customers are an explicit fallback.
- S&M OPEX is separate from Advertising and defaults to $210k (2026), then $300k annually (2027-2029), editable in assumptions.
- Membership-to-Signature migration is applied from 2026-08-01 when Smartrr product rows identify legacy Membership.
