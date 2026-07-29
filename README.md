# SmartPay — Shopify + Smartrr Subscription Performance

This repository builds an English-language dashboard directly from Shopify and Smartrr. It does not use Google Sheets, Apps Script, `gspread`, or spreadsheet values as financial inputs.

## Dashboard sections

- **Overview:** period KPIs plus Year-to-Date subscription KPIs.
- **Orders:** order-level audit table and a three-order validation sample.
- **Products:** all products and variants sold in the selected period.
- **Customers:** all customers in the selected period.

The previous standalone Subscriptions tab was removed. Useful subscription KPIs now appear in Overview.

## Sales formulas

- `Gross Sales = Shopify total_line_items_price`
- `Discounts = Gross Sales - Shopify subtotal_price`
- `Returns = Shopify subtotal_price - Shopify current_subtotal_price`
- `Net Sales = Shopify current_subtotal_price`
- `Formula Check = Gross Sales - Discounts - Returns - Net Sales` (must be `0.00`)
- `COGS = net quantity × Shopify variant unit cost`
- `Gross Profit = Net Sales - COGS`
- `Gross Margin = Gross Profit / Net Sales`

Gross Profit and Gross Margin are shown only when every net unit in an order has a Shopify unit cost. Missing costs are never replaced with spreadsheet values.

## Required GitHub configuration

Repository secrets:

- `SHOPIFY_ACCESS_TOKEN`
- `SMARTRR_ACCESS_TOKEN`

Repository variables:

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_API_VERSION` (optional, defaults to `2025-01`)
- `ORDERS_LOOKBACK_DAYS` (optional, defaults to `120`)

## Full 2026 rebuild

Run:

**Actions → Subscriptions ETL → Run workflow**

Set `report_year` to `2026`. This is required after installing the new fields so historical orders receive discounts, returns, products, costs and audit columns.

## Manual audit required

In the Orders tab, validate the three rows under **Audit sample (3 orders)** against Shopify Admin:

1. The Horse Health approximately 30 lb or zero-margin order when available.
2. Two deterministic sample orders.

Compare order number, Gross Sales, Discounts, Net Sales, COGS, Gross Profit, Gross Margin and Order Total.
