# YTD Channel Update — September 15, 2026

## Files changed

- `index.html`
  - Added a new **YTD Channel** tab.
  - Added closed-month YTD KPIs, first vs. recurring analysis, monthly detail and chart.
  - Changed the Overview fallback subscription-revenue card to use the active Shopify order filters instead of the ETL lookback summary.
  - Added a client-side fallback so the YTD view still renders if an older `analytics_summary.json` is temporarily present.

- `src/main.py`
  - Added `build_ytd_channel_summary()`.
  - `analytics_summary.json` now contains a `ytd_channel` block built from the merged Shopify subscription-order history.
  - Current partial month is excluded from headline YTD and retained separately for context.

- `data/analytics_summary.json`
  - Seeded with the current closed-month YTD snapshot so the static site displays the new view immediately after upload.

- `README.md`
  - Added the YTD methodology and deployment/run instructions.

## Validated values for Jan 1-Aug 31, 2026

- Gross Sales: **$16,162.08**
- Discounts: **$11.86**
- Returns: **$611.06**
- Net Sales: **$15,539.16**
- Subscription Orders: **178**
- Unique Customers: **89**
- AOV: **$87.30**
- First Subscription Orders: **48**
- First Subscription Net Sales: **$6,659.26**
- Recurring Orders: **130**
- Recurring Net Sales: **$8,879.90**

September partial snapshot in the supplied data is shown separately and excluded from headline YTD.

## After uploading to GitHub

1. Commit/push these changes to the existing `smartrr-shopify-report` repository.
2. Open **Actions**.
3. Select **Subscriptions ETL**.
4. Click **Run workflow**.
5. Enter `2026` in `report_year`.
6. Run it from the branch used by GitHub Pages (normally `main`).
7. Wait for the workflow to finish successfully and for its data commit to complete.
8. Refresh the GitHub Pages URL and open **YTD Channel**.

Do not replace or merge the separate `corro-smartrr-report` project for this update. That project remains the operational subscription/duplicate-audit view.
