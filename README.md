# Shopify + Smartrr Subscription Performance

This project automatically retrieves subscription-tagged orders from Shopify, enriches them with Shopify variant unit costs, retrieves subscription records from Smartrr, and publishes an English-language dashboard through GitHub Pages.

## Source-of-truth rules

- **Shopify:** orders, customers, products, quantities, gross sales, discounts, returns, net sales, order totals, COGS, gross profit and gross margin.
- **Smartrr:** subscription IDs, plan IDs, subscription status when available, and next billing/order dates.
- Historical Excel or Google Sheet values are not imported into the live calculations.
- Orders and subscriptions remain separate datasets so a customer with multiple subscriptions cannot duplicate an order or inflate revenue.

## Dashboard fields

### Executive KPIs
- Orders
- Unique customers
- Gross sales
- Net sales
- Average Order Value (AOV)
- Gross profit
- Gross margin
- Shopify unit-cost coverage

### Analysis
- Monthly net sales and order trends
- Top products and variants by net sales
- Units sold and customer count by product
- Top customers by net sales
- Repeat customers and repeat rate
- Order-level gross sales, discounts, returns, net sales, COGS, gross profit and margin
- Smartrr subscription records and upcoming billings

## Metric definitions

- **Gross Sales:** Shopify `total_line_items_price`.
- **Discounts:** Shopify `total_discounts`.
- **Returns:** original Shopify subtotal minus current Shopify subtotal.
- **Net Sales:** Shopify `current_subtotal_price`.
- **AOV:** Net Sales divided by order count.
- **COGS:** net product quantity multiplied by Shopify Inventory Item unit cost.
- **Gross Profit:** Net Sales minus COGS.
- **Gross Margin:** Gross Profit divided by Net Sales.

Gross Profit and Gross Margin remain unavailable when Shopify unit costs are missing. The project does not substitute old spreadsheet costs.

## GitHub configuration

Repository secrets:
- `SHOPIFY_ACCESS_TOKEN`
- `SMARTRR_ACCESS_TOKEN`

Repository variables:
- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_API_VERSION` (optional, defaults to `2025-01`)
- `ORDERS_LOOKBACK_DAYS` (optional, defaults to `120`)

## Run and deploy

Run **Actions → Subscriptions ETL → Run workflow**. For a complete 2026 rebuild, enter `2026` in `report_year`. After the action commits the data files, run the existing GitHub Pages deployment workflow if Pages is not configured to deploy automatically from the main branch.
