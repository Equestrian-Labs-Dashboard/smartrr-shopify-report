# Security and GitHub Secrets Setup

## Immediate rotation required
The Google service-account private key, SKU Savvy token, and Smartrr token were exposed in chat. Revoke them and create new credentials before deployment. Never commit them to this repository.

## Required by this Strategic Model repository
- `SHOPIFY_CORRO_STORE`
- `SHOPIFY_CORRO_TOKEN`
- `SHOPIFY_CAVALI_STORE`
- `SHOPIFY_CAVALI_TOKEN`

These four secrets are used by `.github/workflows/deploy.yml`.

## Google Sheets
The current browser model reads the Corro, Cavali, and Marketing Stats workbooks through read-only Google Sheets CSV endpoints. Therefore `GOOGLE_CREDENTIALS` is not consumed by this repository. The sheets must be accessible as read-only to the deployed dashboard.

`GOOGLE_CREDENTIALS` belongs in the separate Python data-pipeline repository that writes the dashboard tabs. If that pipeline is moved into this repository later, add the rotated JSON as one GitHub Actions secret named `GOOGLE_CREDENTIALS`.

## Required by the Python pipeline repository
- `GOOGLE_CREDENTIALS` (new rotated service-account JSON)
- `SHOPIFY_TOKEN_CORRO`
- `SHOPIFY_TOKEN_CAVALI`
- `SHOPIFY_URL_CORRO` (optional; default exists)
- `SHOPIFY_URL_CAVALI` (optional; default exists)
- `SHEET_ID_CORRO` = `1nq8xkDzowAvhD3wpMBlVK2M3FZSNS2DrAiPxz-Y2tdU`
- `SHEET_ID_CAVALI` = `1QUdJc2EIdElIX5nlLQxWxS98aAz-TgQnSg9glJpNtig`
- `SMARTRR_API_KEY_CAVALI` (still required for Cavali subscription data)
- `SMARTRR_API_KEY_CORRO` only when Corro Smartrr data is required
- `SKUSAVVY_API_KEY` only after the SKU Savvy API endpoint and response schema are confirmed

## Marketing Stats workbook
Workbook ID: `1ROTaII-_S_0VntYvOZj8GFCoUnkQVcr1rPES0p-14mI`
Tabs: `Total Shopify`, `Total Google+META`, `Google Ads`, and `META`.

## Still missing for full external automation
1. A rotated `SMARTRR_API_KEY_CAVALI`.
2. The SKU Savvy base URL/endpoint and response schema. A token alone is not enough to implement a reliable integration.
3. QuickBooks credentials and account mapping are required only for Phase 3 accounting integration; they are not part of the current Tabs 1-4 deployment.
