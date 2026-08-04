# Strategic Operating Model v3.6 Formula Map

## Ecommerce Revenue Build
Annual Base Ecommerce Revenue = Base Ecommerce Monthly Run Rate × 12

Organic Growth Revenue = Base Ecommerce Revenue × Organic Growth %

Paid Growth Revenue = Total Ad Spend × ROAS

Gross Dover Opportunity = Dover Market Opportunity × Dover Target Capture % × Annual Ramp %

Net Dover Capture = Gross Dover Opportunity × (1 - Paid Ads Overlap %)

Total Ecommerce Gross Sales = Base Ecommerce Revenue + Organic Growth Revenue + Paid Growth Revenue + Net Dover Capture

## Carryover / Next-Year Base
Latest Easy Numbers Test logic:

Next Year Ecommerce Base = Prior Year Base + Carryover % × (Prior Year Organic Growth + Prior Year Paid Growth Revenue + Prior Year Net Dover Capture)

2026 carryover default = 0%; later forecast years default to 50% and remain editable.

## Ad Spend
2026–2028 can use Ad Spend % / ROAS circular logic:

Ecommerce Gross Sales = Pre-Paid Ecommerce Revenue ÷ (1 - Ad Spend % × ROAS)

Total Ad Spend = Ecommerce Gross Sales × Ad Spend %

2029 logic reverses: Ad Spend % is editable management reinvestment and dollars are calculated from it / or direct spend remains editable depending management choice.

## Growth Engines
Ecommerce Gross Sales ties exactly to Ecommerce Revenue Build.

Concierge Gross Sales = Active Clients × Orders per Client × AOV

Wellington Gross Sales = Orders × AOV

Cavali Signature Revenue = Signature Members × Boxes per Year × $99

Cavali Premium Revenue = Premium Members × Boxes per Year × $199

Cavali Paid Growth Members = Cavali Ad Spend ÷ Cavali CAC

## Gross-to-Net / Margin Bridge
Discounts & Returns = Gross Sales × Discounts & Returns %

Net Sales = Gross Sales - Discounts & Returns

COGS = Net Sales × (1 - GM1 %)

GP1 = Net Sales - COGS

GP2 = GP1 - Outbound Shipping - Packaging + Shipping Revenue

GP3 = GP2 - Ad Spend

## GP1 by Growth Engine
Engine Net Sales = Engine Gross Sales × (1 - Discounts & Returns %)

Engine GP1 = Engine Net Sales × GM1 %

## Reconciliation
Total Portfolio Gross Sales = Financial Snapshot Gross Sales

Total Portfolio GP1 = Financial Snapshot GP1

% Total Sales = 100%

% Total GP1 = 100%


## HITS Marketing Subscription treatment

- Amount: **$305.64**, displayed as **$306** in the Strategic Model for clean software-style formatting.
- Classification decision: **OPEX / Sales & Marketing**, not CapEx.
- Strategic Model treatment: visible in Section 6 — Growth Initiatives as **HITS Marketing Subscription**.
- Financial treatment: should flow to Financial / Summary P&L OPEX mapping, not to Page 2 GP1–GP3 calculations.

Formula impact on Pages 1–2: none. Pages 1–2 remain strategic assumptions and margin through GP3; fixed/operating expense items stay in Tab 03 / Financial P&L.


## V26 final notes
- HITS subscription = Sales & Marketing OPEX reference, investment $305.64; display as $306 in Strategic Growth Initiatives. It is not CapEx and does not affect Page 2 GP1–GP3.
- Tab 03 Financial Summary is read-only and extends Page 2 GP3 to EBITDA using Financial assumptions: Payroll $40k/month, G&A $45k/month, S&M 6.62% of Gross Sales, Other Operating Expenses $0.
- Tab 04 Commercial Cash Flow is read-only and shows Opening Cash → Cash In → Funding → Cash Out → CapEx → Ending Cash.
- Inventory Turns current remains a data-source validation item until SKU/Savy vs Shopify is reconciled.
- Carryover formula follows the latest Easy Numbers Test note: Next-Year Base = Prior Base + Carryover % × (Organic Growth Revenue + Paid Growth Revenue + Net Dover Capture). Ensure carryover is not double-counted in later years.


## Latest formula-detail clarifications

### Default Logic (2029 onwards)
2029 Default Ad Spend = Prior Year Ecommerce Gross Sales × Reinvestment %.

This is documented separately because 2029 changes logic: it is no longer driven by the current funding allocation period; it is a management reinvestment assumption.

### Paid Growth Revenue note
Paid Growth Revenue = Total Ad Spend × ROAS.

Assumption: Constant ROAS during the selected fiscal year. In the future, ROAS can be split by quarter or channel.

### Carryover anti-double-counting rule
Carryover applies only once when calculating the following year's Base Ecommerce Revenue.

Example: if 2028 Base already includes 2027 carryover, do not add that same carried-over revenue again downstream as incremental revenue.

### GP1 denominator
GM1% is defined on Net Sales, not Gross Sales. Therefore GP1 by engine is: Engine Net Sales × GM1%.

### Annual GP per Customer population check
AOV, Purchase Frequency and GM1 must belong to the same business population, preferably Ecommerce-only when validating Ecommerce retention.

### Commercial Cash Flow principle
Commercial Cash Flow is not P&L sales minus expenses. It reflects cash timing: when Shopify deposits arrive, when bills are paid, inventory payment timing, taxes, funding and strategic investments.

Cash Coverage (Months) = Ending Cash ÷ Average Monthly Operating Cash Out.


## Shopify sync source logic

Shopify direct sync is generated by GitHub Actions, not by the browser.

```text
Shopify Corro + Shopify Cavali
→ GitHub Actions reads repository secrets
→ scripts/sync-shopify-actuals.mjs calls Shopify Admin GraphQL API
→ data/shopify_actuals.json is generated without tokens
→ dashboard reads data/shopify_actuals.json
```

Shopify is used for sales/order actuals:

```text
Gross Sales = SUM(line item original unit price × quantity)
Net Sales = SUM(line item discounted total)
Discounts = Gross Sales - Net Sales
AOV = Gross Sales ÷ Orders
```

COGS/GM1 are preserved from Google Sheets/SKU source until product-cost automation is added.


## Shopify tag/channel mapping v36

Corro Shopify sync classifies order/product tags in this order:
1. Drop ship
2. Shopify Collective
3. Concierge
4. Wellington
5. Legacy
6. e-commerce fallback

These channel rows feed Growth Engines baseline/current. Cavali orders are counted directly from Shopify and Section 3 forecasts use actual orders plus simple +10 placeholders for editable future-year review.
