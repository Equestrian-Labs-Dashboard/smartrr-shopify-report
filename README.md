# SmartPay — Shopify + Smartrr Analytics

This version separates metrics by source and confidence.

## Sources

- **Shopify:** orders, discounts, returns, product lines, unit costs, net sales, COGS, gross profit and gross margin.
- **Smartrr vendor customer lookup:** subscription records, readable contract status and future billing dates.
- **Smartrr Advanced Analytics:** active subscriptions, churn, CLTV and subscription revenue are a separate analytics dataset. The vendor lookup endpoint does not guarantee the same results.

## Important correction

Subscription status is now read only from the subscription contract object. Parent formatted-order status is never used to overwrite a subscription status. This prevents active subscriptions from being incorrectly classified as cancelled.

Unknown subscription statuses are excluded from active and cancelled counts. A future billing date is shown as `active_inferred`, not as a confirmed active status.

## Optional official Smartrr metrics

To display the same headline values shown in Smartrr Advanced Analytics, add repository variables populated from its export:

- `SMARTRR_OFFICIAL_ACTIVE_SUBSCRIPTIONS`
- `SMARTRR_OFFICIAL_CHURN_RATE` as a decimal, e.g. `0.3421`
- `SMARTRR_OFFICIAL_CLTV`
- `SMARTRR_OFFICIAL_SUBSCRIPTION_REVENUE`

When these are absent, the dashboard clearly labels operational or derived metrics and leaves churn unavailable rather than displaying a false `100%`.

## Rebuild

Run the workflow for:

1. `2025`
2. `2026`

Set `SUBSCRIPTION_HISTORY_START=2025-01-01T00:00:00Z`.

## Smartrr YTD view (added 2026-09-15; renamed 2026-09-16)

The dashboard includes a **Smartrr YTD** tab for closed-month subscription revenue. It was originally labeled YTD Channel and was renamed to prevent confusion with total Shopify e-commerce revenue.

- **Financial source of truth:** Shopify subscription orders.
- **Subscription lifecycle/status source:** Smartrr.
- **Headline YTD rule:** January 1 through the last fully closed month. The current partial month is shown only for context and is excluded from headline YTD.
- **Net Sales:** Gross Sales - Discounts - Returns.
- The view includes Gross Sales, Discounts, Returns, Net Sales, Orders, Customers, AOV, First vs. Recurring subscription revenue, and monthly detail.

For the September 15, 2026 delivery, the headline period is **January 1-August 31, 2026**.

### Refresh after deploying this change

Run **Actions -> Subscriptions ETL -> Run workflow** and set `report_year` to `2026`.

This performs a full 2026 Shopify rebuild before refreshing the Smartrr subscription data and committing the updated JSON/CSV report files. The normal daily scheduled action can continue afterward.

## Management acquisition split (added 2026-09-16)

The dashboard now includes a **Shopify Acquisition** tab based on the exported Shopify **Performance by Referring Channel** report for **Jan 1-Aug 31, 2026** using **Last non-direct click** attribution.

Current management snapshot:

- Paid attributed sales: **$223,518.69**
- Organic attributed sales: **$87,667.37**
- Direct: **$56,441.98**
- Other / Unclassified: **$242,116.43**
- Total Shopify sales in the attribution export: **$609,744.47**
- Klaviyo within Shopify Paid: **$19,580.41**

Important reporting rule: **Smartrr is a subscription overlay, not a mutually exclusive acquisition bucket.** A Smartrr order can also be Paid, Organic, Direct or Other. The acquisition view therefore keeps Smartrr visually separate to avoid double counting.

The requested extension from sales by channel down to **OPEX and EBITDA** is deliberately not fabricated in this repository. It requires the general Sales Report / Financial Model channel cost-allocation logic and channel-level COGS/OPEX inputs.
