#!/usr/bin/env node
/**
 * Shopify actuals sync for Strategic Operating Model.
 *
 * Runs only in GitHub Actions. It uses repository secrets and writes a safe,
 * token-free file for GitHub Pages:
 *   data/shopify_actuals.json
 *
 * Required repository secrets:
 *   SHOPIFY_CORRO_STORE
 *   SHOPIFY_CORRO_TOKEN
 *   SHOPIFY_CAVALI_STORE
 *   SHOPIFY_CAVALI_TOKEN
 */

import fs from "node:fs/promises";
import path from "node:path";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";
const START_DATE = process.env.SHOPIFY_SYNC_START_DATE || "2024-01-01";
const END_DATE = process.env.SHOPIFY_SYNC_END_DATE || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const stores = [
  { brand: "corro", label: "Corro", store: process.env.SHOPIFY_CORRO_STORE, token: process.env.SHOPIFY_CORRO_TOKEN },
  { brand: "cavali", label: "Cavali", store: process.env.SHOPIFY_CAVALI_STORE, token: process.env.SHOPIFY_CAVALI_TOKEN },
];

function normalizeStore(store) {
  return String(store || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}
function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }
function money(node) { return Number(node?.shopMoney?.amount || 0); }
function monthKey(dateString) { return String(dateString || "").slice(0, 7); }
function monthStart(period) { return `${period}-01`; }
function monthEnd(period) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
function tagText(tags) { return (tags || []).join(" ").toLowerCase(); }

function classifyOrder(order, lineItems) {
  const orderTags = tagText(order.tags);
  const sourceName = String(order.sourceName || "").toLowerCase();
  const productTags = tagText(lineItems.flatMap(li => li.product?.tags || []));
  const combined = `${orderTags} ${productTags} ${sourceName}`;

  // Match the same channel logic used by the reporting pipeline:
  // POS/Wellington tags => Wellington, concierge tag/source => Concierge.
  if (/drop\s*ship|dropship/.test(combined)) return "Drop ship";
  if (/shopify\s*collective/.test(combined)) return "Shopify Collective";
  if (/concierge/.test(combined)) return "Concierge";
  if (sourceName === "pos" || /wellington|point of sale|\bpos\b/.test(combined)) return "Wellington";
  if (/legacy/.test(combined)) return "Legacy";
  return "e-commerce";
}

function emptyAgg(period, source = "shopify_admin_graphql") {
  return {
    period,
    period_start: monthStart(period),
    period_end: monthEnd(period),
    gross_sales: 0,
    net_sales: 0,
    gross_profit: 0,
    total_discounts: 0,
    total_returns: 0,
    cogs: 0,
    shipping_income: 0,
    taxes: 0,
    nb_orders: 0,
    nb_units: 0,
    customers: new Set(),
    updated_at: new Date().toISOString(),
    source,
  };
}

const ORDERS_QUERY = `
query OrdersForActuals($cursor: String, $query: String!) {
  orders(first: 100, after: $cursor, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      createdAt
      cancelledAt
      tags
      sourceName
      totalShippingPriceSet { shopMoney { amount currencyCode } }
      currentTotalTaxSet { shopMoney { amount currencyCode } }
      customer { id email }
      lineItems(first: 250) {
        nodes {
          quantity
          title
          sku
          originalUnitPriceSet { shopMoney { amount currencyCode } }
          discountedTotalSet { shopMoney { amount currencyCode } }
          variant {
            inventoryItem {
              unitCost { amount currencyCode }
            }
          }
          product {
            id
            title
            vendor
            productType
            tags
          }
        }
      }
    }
  }
}`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function retryDelayMs(attempt, retryAfterHeader = "") {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  const exponential = Math.min(60000, 1000 * (2 ** attempt));
  const jitter = Math.floor(Math.random() * 750);
  return exponential + jitter;
}

function isRetryableNetworkError(error) {
  const code = error?.cause?.code || error?.code || "";
  return ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET"].includes(code)
    || /fetch failed|network|socket|timeout/i.test(String(error?.message || ""));
}

async function graphql(store, token, query, variables, options = {}) {
  const endpoint = `https://${normalizeStore(store)}/admin/api/${API_VERSION}/graphql.json`;
  const maxRetries = Number(options.maxRetries ?? 8);
  const timeoutMs = Number(options.timeoutMs ?? 90000);
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
          "User-Agent": "Equestrian-Labs-Strategic-Model/1.0",
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });

      const json = await res.json().catch(() => ({}));
      const retryableStatus = res.status === 429 || [500, 502, 503, 504].includes(res.status);

      if (retryableStatus && attempt < maxRetries) {
        const waitMs = retryDelayMs(attempt, res.headers.get("retry-after") || "");
        console.warn(`Shopify GraphQL HTTP ${res.status} for ${store}. Retry ${attempt + 1}/${maxRetries} in ${(waitMs / 1000).toFixed(1)}s.`);
        await sleep(waitMs);
        continue;
      }

      if (!res.ok || json.errors) {
        const detail = JSON.stringify(json.errors || json, null, 2).slice(0, 2000);
        throw new Error(`Shopify GraphQL failed for ${store}: HTTP ${res.status}. ${detail}`);
      }

      return json.data;
    } catch (error) {
      lastError = error;
      const retryable = error?.name === "AbortError" || isRetryableNetworkError(error);
      if (!retryable || attempt >= maxRetries) throw error;

      const waitMs = retryDelayMs(attempt);
      const code = error?.cause?.code || error?.code || error?.name || "NETWORK_ERROR";
      console.warn(`Shopify GraphQL ${code} for ${store}. Retry ${attempt + 1}/${maxRetries} in ${(waitMs / 1000).toFixed(1)}s.`);
      await sleep(waitMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error(`Shopify GraphQL failed for ${store} after retries.`);
}

async function fetchOrdersForStore(storeConfig) {
  const { store, token, label } = storeConfig;
  if (!store || !token) {
    console.warn(`Skipping ${label}: missing store/token secret.`);
    return [];
  }
  const query = `created_at:>=${START_DATE} created_at:<${END_DATE}`;
  let cursor = null;
  let orders = [];
  let page = 0;
  do {
    page += 1;
    const data = await graphql(store, token, ORDERS_QUERY, { cursor, query });
    const conn = data.orders;
    orders.push(...(conn.nodes || []));
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    console.log(`${label}: fetched page ${page}, total orders ${orders.length}`);

    // Small pause reduces the chance of long-running syncs being disconnected
    // after dozens of consecutive GraphQL requests.
    if (cursor) await sleep(page % 20 === 0 ? 1500 : 200);
  } while (cursor);
  return orders;
}

function addOrderToAgg(agg, order, lineItems) {
  let gross = 0, net = 0, units = 0, cogs = 0;
  for (const line of lineItems) {
    const qty = Number(line.quantity || 0);
    const originalUnit = money(line.originalUnitPriceSet);
    const discountedTotal = money(line.discountedTotalSet);
    const unitCost = Number(line.variant?.inventoryItem?.unitCost?.amount || 0);
    gross += originalUnit * qty;
    net += discountedTotal;
    cogs += unitCost * qty;
    units += qty;
  }
  const discount = Math.max(0, gross - net);
  const shipping = money(order.totalShippingPriceSet);
  const taxes = money(order.currentTotalTaxSet);

  agg.gross_sales += gross;
  agg.net_sales += net;
  agg.total_discounts += discount;
  agg.cogs += cogs;
  agg.gross_profit += net - cogs;
  agg.shipping_income += shipping;
  agg.taxes += taxes;
  agg.nb_orders += 1;
  agg.nb_units += units;
  if (order.customer?.id) agg.customers.add(order.customer.id);
}

function finalizeKpiRows(map) {
  return [...map.values()]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map(r => {
      const uniqueCustomers = r.customers.size;
      return {
        updated_at: r.updated_at,
        period: r.period,
        period_start: r.period_start,
        period_end: r.period_end,
        gross_sales: round2(r.gross_sales),
        net_sales: round2(r.net_sales),
        gross_profit: round2(r.gross_profit),
        total_discounts: round2(r.total_discounts),
        total_returns: round2(r.total_returns),
        cogs: round2(r.cogs),
        pct_discount: r.gross_sales ? round2((r.total_discounts / r.gross_sales) * 100) : 0,
        pct_returns: 0,
        pct_gm: r.net_sales ? round2((r.gross_profit / r.net_sales) * 100) : 0,
        nb_orders: r.nb_orders,
        nb_units: r.nb_units,
        aov: r.nb_orders ? round2(r.gross_sales / r.nb_orders) : 0,
        unique_customers: uniqueCustomers,
        shipping_income: round2(r.shipping_income),
        taxes: round2(r.taxes),
        source: r.source,
      };
    });
}

function aggregateOrders(orders) {
  const byMonth = new Map();
  const byMonthChannel = new Map();

  for (const order of orders) {
    if (order.cancelledAt) continue;
    const period = monthKey(order.createdAt);
    if (!period) continue;

    const lineItems = order.lineItems?.nodes || [];
    const channel = classifyOrder(order, lineItems);

    const agg = byMonth.get(period) || emptyAgg(period);
    addOrderToAgg(agg, order, lineItems);
    byMonth.set(period, agg);

    const channelKey = `${period}__${channel}`;
    const ch = byMonthChannel.get(channelKey) || { ...emptyAgg(period), channel };
    addOrderToAgg(ch, order, lineItems);
    byMonthChannel.set(channelKey, ch);
  }

  const kpis_daily = finalizeKpiRows(byMonth);

  const revenue_share = [...byMonthChannel.values()]
    .sort((a, b) => (a.period + a.channel).localeCompare(b.period + b.channel))
    .map(r => ({
      updated_at: r.updated_at,
      period: r.period,
      period_start: r.period_start,
      period_end: r.period_end,
      channel: r.channel,
      amount: round2(r.gross_sales),
      gross_sales: round2(r.gross_sales),
      net_sales: round2(r.net_sales),
      cogs: round2(r.cogs),
      gross_profit: round2(r.gross_profit),
      gross_margin: r.net_sales ? round2((r.gross_profit / r.net_sales) * 100) : 0,
      pct_gm: r.net_sales ? round2((r.gross_profit / r.net_sales) * 100) : 0,
      nb_orders: r.nb_orders,
      nb_units: r.nb_units,
      aov: r.nb_orders ? round2(r.gross_sales / r.nb_orders) : 0,
      unique_customers: r.customers.size,
      source: "shopify_tags",
    }));

  return { kpis_daily, revenue_share };
}


function parsePercentMetric(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(String(value).replace("%", "").replaceAll(",", "").trim());
  if (!Number.isFinite(numeric)) return null;
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

async function runShopifyQl(store, token, shopifyQl) {
  const escaped = shopifyQl.replaceAll("\\", "\\\\").replaceAll('"', '\"');
  const query = `{ shopifyqlQuery(query: "${escaped}") { tableData { rows } parseErrors } }`;
  const data = await graphql(store, token, query, {});
  const result = data?.shopifyqlQuery;
  if (!result || (result.parseErrors || []).length || !result.tableData) return [];
  const rows = result.tableData.rows;
  if (Array.isArray(rows)) return rows;
  if (typeof rows === "string") {
    try { return JSON.parse(rows); } catch { return []; }
  }
  return [];
}

async function fetchSessionMetrics(storeConfig, period) {
  const { store, token, label } = storeConfig;
  if (!store || !token) return null;
  const start = monthStart(period);
  const endExclusive = new Date(`${monthEnd(period)}T00:00:00Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const until = endExclusive.toISOString().slice(0, 10);

  let rows = await runShopifyQl(store, token,
    `FROM sessions SHOW online_store_visitors, sessions, pageviews, conversion_rate WHERE human_or_bot_session != 'human_bot' SINCE ${start} UNTIL ${until}`
  );
  if (!rows.length) {
    rows = await runShopifyQl(store, token,
      `FROM sessions SHOW online_store_visitors, sessions, pageviews, conversion_rate SINCE ${start} UNTIL ${until}`
    );
  }
  const base = rows.at(-1) || {};

  let checkoutRows = await runShopifyQl(store, token,
    `FROM sessions SHOW checkout_conversion_rate WHERE human_or_bot_session != 'human_bot' SINCE ${start} UNTIL ${until}`
  );
  if (!checkoutRows.length) {
    checkoutRows = await runShopifyQl(store, token,
      `FROM sessions SHOW checkout_conversion_rate SINCE ${start} UNTIL ${until}`
    );
  }
  const checkout = checkoutRows.at(-1) || {};
  const checkoutConversion = parsePercentMetric(
    checkout.checkout_conversion_rate ?? checkout.checkoutConversionRate ?? checkout["checkout conversion rate"]
  );
  const abandonment = checkoutConversion === null ? "" : round2(Math.max(0, Math.min(100, 100 - checkoutConversion)));

  console.log(`${label} ${period}: sessions=${Number(base.sessions || 0)}, checkout abandonment=${abandonment === "" ? "unavailable" : `${abandonment}%`}`);
  return {
    sessions: Number(base.sessions || 0),
    unique_visitors: Number(base.online_store_visitors || 0),
    pageviews: Number(base.pageviews || 0),
    conversion_rate: parsePercentMetric(base.conversion_rate) ?? 0,
    checkout_abandonment_rate: abandonment,
  };
}

async function enrichKpisWithSessionMetrics(storeConfig, rows) {
  for (const row of rows) {
    try {
      const metrics = await fetchSessionMetrics(storeConfig, row.period);
      if (metrics) Object.assign(row, metrics);
    } catch (error) {
      console.warn(`${storeConfig.label} ${row.period}: session metrics unavailable.`, error.message);
      Object.assign(row, { sessions: 0, unique_visitors: 0, pageviews: 0, conversion_rate: 0, checkout_abandonment_rate: "" });
    }
  }
  return rows;
}

function totals(rows) {
  return rows.reduce((acc, r) => {
    acc.gross_sales += Number(r.gross_sales || 0);
    acc.net_sales += Number(r.net_sales || 0);
    acc.total_discounts += Number(r.total_discounts || 0);
    acc.total_returns += Number(r.total_returns || 0);
    acc.shipping_income += Number(r.shipping_income || 0);
    acc.nb_orders += Number(r.nb_orders || 0);
    acc.nb_units += Number(r.nb_units || 0);
    return acc;
  }, { gross_sales: 0, net_sales: 0, total_discounts: 0, total_returns: 0, shipping_income: 0, nb_orders: 0, nb_units: 0 });
}

async function main() {
  const brands = {};
  for (const storeConfig of stores) {
    const orders = await fetchOrdersForStore(storeConfig);
    const { kpis_daily, revenue_share } = aggregateOrders(orders);
    await enrichKpisWithSessionMetrics(storeConfig, kpis_daily);
    brands[storeConfig.brand] = {
      label: storeConfig.label,
      store: normalizeStore(storeConfig.store),
      source: "shopify_admin_graphql",
      apiVersion: API_VERSION,
      orderCount: orders.length,
      kpis_daily,
      revenue_share,
      totals: totals(kpis_daily),
      notes: [
        "Shopify sync provides sales, orders, units, AOV, discounts, shipping, taxes, sessions, conversion rate, and checkout abandonment rate when ShopifyQL exposes checkout_conversion_rate.",
        "Corro channels are classified from order/product tags: Drop ship, Shopify Collective, Concierge, Wellington, Legacy, e-commerce.",
        "Cavali orders are counted directly from Shopify; membership fields still depend on Smartrr until Smartrr API is connected.",
        "COGS/GM1 are calculated from Shopify variant inventoryItem.unitCost when available; missing unit costs remain zero and should be reviewed in Shopify.",
        "Inventory turns should continue coming from SKU/Savy or product-cost inventory source.",
        "QuickBooks/ShipStation remain preferred source for cash timing, shipping cost, packaging, and OPEX."
      ],
    };
  }

  const output = {
    generated_at: new Date().toISOString(),
    source: "github_actions_shopify_sync",
    apiVersion: API_VERSION,
    date_range: { start: START_DATE, end: END_DATE },
    brands,
  };

  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(path.join("data", "shopify_actuals.json"), JSON.stringify(output, null, 2));
  console.log("Wrote data/shopify_actuals.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
