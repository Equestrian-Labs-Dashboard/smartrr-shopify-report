import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUT = path.join(DATA_DIR, 'connected_actuals.json');

function env(name, required = false) {
  const value = String(process.env[name] || '').trim();
  if (required && !value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseCredentials() {
  const raw = env('GOOGLE_CREDENTIALS', true);
  try { return JSON.parse(raw); }
  catch (error) { throw new Error(`GOOGLE_CREDENTIALS is not valid JSON: ${error.message}`); }
}


function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || '').replace(/^\uFEFF/, '').trim());
  return rows.slice(1).filter(r => r.some(v => String(v || '').trim())).map(r => {
    const out = {};
    headers.forEach((h, i) => { out[h || `column_${i + 1}`] = r[i] ?? ''; });
    return out;
  });
}

function rowsToObjects(values = []) {
  if (!Array.isArray(values) || !values.length) return [];
  const headers = values[0].map((h, i) => String(h || `column_${i + 1}`).trim());
  return values.slice(1).filter(row => row.some(v => String(v ?? '').trim() !== '')).map(row => {
    const out = {};
    headers.forEach((h, i) => { out[h] = row[i] ?? ''; });
    return out;
  });
}

async function fetchTab(sheets, spreadsheetId, tabName) {
  if (!spreadsheetId) return [];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tabName}'` });
    return rowsToObjects(res.data.values || []);
  } catch (error) {
    const status = error?.response?.status;
    if (status === 400 || status === 404) {
      console.warn(`Tab not found or unavailable: ${tabName}`);
      return [];
    }
    throw error;
  }
}

async function fetchBundle(sheets, spreadsheetId, brand) {
  const productTabs = ['products_q1_2026', 'products_2026', 'products_current'];
  let products = [];
  for (const tab of productTabs) {
    products = await fetchTab(sheets, spreadsheetId, tab);
    if (products.length) break;
  }
  return {
    brand,
    kpis_daily: await fetchTab(sheets, spreadsheetId, 'kpis_daily'),
    revenue_share: await fetchTab(sheets, spreadsheetId, 'revenue_share'),
    new_vs_returning: await fetchTab(sheets, spreadsheetId, 'new_vs_returning'),
    ad_spend: await fetchTab(sheets, spreadsheetId, 'ad_spend'),
    smartrr_subscribers: await fetchTab(sheets, spreadsheetId, 'smartrr_subscribers'),
    smartrr_product_volume: await fetchTab(sheets, spreadsheetId, 'smartrr_product_volume'),
    products_q1_2026: products
  };
}

function findField(row, names) {
  const entries = Object.entries(row || {});
  for (const wanted of names) {
    const normalized = wanted.toLowerCase().replace(/[^a-z0-9]/g, '');
    const match = entries.find(([k]) => k.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized);
    if (match) return match[1];
  }
  return '';
}

function number(value) {
  const n = Number(String(value ?? '').replace(/[$,%()]/g, '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function loadInventoryCsv(filePath, warehouse) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsv(text);
  return rows.map(row => {
    const quantity = number(findField(row, ['quantity', 'qty', 'available', 'inventory quantity', 'stock']));
    let unitCost = number(findField(row, ['unit cost', 'cost', 'avg cost', 'avgCost', 'average cost', 'landed cost']));
    let price = number(findField(row, ['price', 'retail price', 'unit price', 'retail']));
    // SKUSavvy warehouse exports store monetary values in thousandths (130380 = $130.38).
    if (unitCost > 10000) unitCost /= 1000;
    if (price > 10000) price /= 1000;
    return {
      warehouse,
      sku: String(findField(row, ['sku', 'variant sku']) || '').trim(),
      product_title: String(findField(row, ['product', 'product name', 'title', 'item']) || '').trim(),
      quantity,
      cost: unitCost,
      price,
      inventory_value: quantity * unitCost,
      retail_value: quantity * price,
      markup: unitCost > 0 && price > 0 ? (price - unitCost) / unitCost : null
    };
  }).filter(r => r.sku || r.product_title);
}

function buildSkuSavvySummary() {
  const csvDir = path.join(DATA_DIR, 'skusavvy');
  const configs = [
    ['Wellington Warehouse', 'wellington_inventory.csv'],
    ['Corro Trailer 1', 'corro_trailer_1_inventory.csv'],
    ['Drop Ship', 'drop_ship_inventory.csv']
  ];
  const products = configs.flatMap(([warehouse, file]) => loadInventoryCsv(path.join(csvDir, file), warehouse));
  const totals = products.reduce((a, r) => {
    a.quantity += r.quantity;
    a.inventoryValue += r.inventory_value;
    a.retailValue += r.retail_value;
    if (Number.isFinite(r.markup)) {
      const weight = Math.max(r.inventory_value, r.quantity, 1);
      a.markupNumerator += r.markup * weight;
      a.markupWeight += weight;
    }
    return a;
  }, { quantity: 0, inventoryValue: 0, retailValue: 0, markupNumerator: 0, markupWeight: 0 });
  return {
    source: 'Committed SKUSavvy warehouse CSV exports',
    csvFiles: configs.map(([, file]) => `data/skusavvy/${file}`),
    rows: products.length,
    totalQuantity: totals.quantity,
    inventoryValue: totals.inventoryValue,
    retailValue: totals.retailValue,
    weightedMarkup: totals.markupWeight ? totals.markupNumerator / totals.markupWeight : null,
    products
  };
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const credentials = parseCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const corroId = env('SHEET_ID_CORRO', true);
  const cavaliId = env('SHEET_ID_CAVALI', true);
  const adsId = env('ADS_SHEET_ID');

  const [corro, cavali] = await Promise.all([
    fetchBundle(sheets, corroId, 'corro'),
    fetchBundle(sheets, cavaliId, 'cavali')
  ]);

  const marketing = adsId ? {
    total_shopify: await fetchTab(sheets, adsId, 'Total Shopify'),
    total_google_meta: await fetchTab(sheets, adsId, 'Total Google+META'),
    google_ads: await fetchTab(sheets, adsId, 'Google Ads'),
    meta: await fetchTab(sheets, adsId, 'META')
  } : {};

  const payload = {
    generated_at: new Date().toISOString(),
    sources: {
      corroSheetId: corroId,
      cavaliSheetId: cavaliId,
      adsSheetId: adsId || null
    },
    brands: { corro, cavali },
    marketing,
    skusavvy: buildSkuSavvySummary()
  };

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`Connected actuals written: ${OUT}`);
  console.log(`Corro KPI rows: ${corro.kpis_daily.length}`);
  console.log(`Cavali KPI rows: ${cavali.kpis_daily.length}`);
  console.log(`SKUSavvy rows: ${payload.skusavvy.rows}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
