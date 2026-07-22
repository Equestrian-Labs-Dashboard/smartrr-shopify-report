# Subscriptions Report — Shopify + Smartrr

Pipeline automatizado que corre diario por GitHub Actions: saca las órdenes con suscripción
de Shopify, las cruza con el estado real de la suscripción en Smartrr, y deja el reporte en
`data/subscriptions_report.csv` y `.json` dentro del mismo repo.

## 1. Subir esto a GitHub

```bash
cd smartrr-shopify-report
git init
git add .
git commit -m "Initial commit: Shopify + Smartrr subscriptions ETL"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/smartrr-shopify-report.git
git push -u origin main
```

## 2. Configurar Secrets y Variables en GitHub

En el repo: **Settings > Secrets and variables > Actions**

### Secrets (pestaña "Secrets" — nunca visibles, para credenciales)

| Nombre | De dónde lo sacás |
|---|---|
| `SHOPIFY_ACCESS_TOKEN` | El access token de tu app privada/custom de Shopify (el que ya tenés) |
| `SMARTRR_ACCESS_TOKEN` | Smartrr Admin > **Integrations** > generás el token ahí |

### Variables (pestaña "Variables" — no sensibles, solo config)

| Nombre | Valor de ejemplo |
|---|---|
| `SHOPIFY_STORE_DOMAIN` | `corro.myshopify.com` |
| `SHOPIFY_API_VERSION` | `2025-01` |

El dominio de la tienda y la versión del API no son secretas (no dan acceso a nada por sí
solas), por eso van en Variables. El token sí, porque con eso solo alguien puede leer/escribir
en tu tienda o en Smartrr.

## 3. Correrlo

- Automático: corre todos los días a las 09:00 UTC (cron en `.github/workflows/etl.yml`,
  ajustá el horario si querés).
- Manual: en GitHub, pestaña **Actions** > "Subscriptions ETL" > **Run workflow**.

## 4. Antes de confiar en los datos de Smartrr

Los campos `status`, `next_order_date` y `plan_id` en `src/smartrr_client.py` están inferidos
de nombres típicos de campo (no hay doc pública completa de Smartrr). Corré el pipeline una
vez, abrí `data/subscriptions_report.csv` y fijate si esas tres columnas tienen datos con
sentido. Si salen vacías o con nombres raros, agregá un `print(raw)` temporal en
`get_customer_subscriptions` para ver el JSON crudo y ajustamos el mapeo en
`parse_subscriptions`.

## 5. Prender el dashboard web (GitHub Pages)

`index.html` ya está en la raíz del repo y lee `data/subscriptions_report.json` — solo
falta prender Pages:

1. En el repo: **Settings > Pages**
2. En "Build and deployment" > Source: **Deploy from a branch**
3. Branch: **main**, carpeta: **/ (root)** → **Save**
4. Esperá 1-2 minutos, GitHub te da la URL (algo como
   `https://equestrian-labs-dashboard.github.io/smartrr-shopify-report/`)

Importante: para que el dashboard tenga algo que mostrar, primero tiene que haber corrido
el workflow "Subscriptions ETL" al menos una vez (Actions → Run workflow) para que exista
`data/subscriptions_report.json` en el repo. Si entrás a la página y no ves datos, ese es
el motivo — correlo y refrescá.

## 6. Escalar esto

- `shopify_client.py` y `smartrr_client.py` son independientes — si mañana Smartrr te da
  un endpoint bulk o webhooks, solo tocás `smartrr_client.py`, el resto del pipeline no cambia.
- Para dashboard visual: igual que en Corro/Cavali, se puede publicar `data/subscriptions_report.json`
  a través de GitHub Pages y consumirlo con Chart.js.
