import fs from 'node:fs';
const app = fs.readFileSync('assets/js/app.js','utf8');
const assumptions = JSON.parse(fs.readFileSync('data/assumptions.json','utf8'));
const forbidden = ['Actuals + 10','"Editable"','row[year] = "100"'];
for (const token of forbidden) {
  if (app.includes(token)) throw new Error(`Forbidden placeholder remains in app.js: ${token}`);
}
for (const block of assumptions.growthEngines || []) {
  for (const row of block.rows || []) {
    for (const key of ['y2026','y2027','y2028','y2029']) {
      const value = String(row[key] ?? '').trim().toLowerCase();
      if (['editable','actuals + 10','auto forecast from shopify ytd','auto forecast from shopify channel actuals','calculated / manual','manual forecast'].includes(value)) {
        throw new Error(`Placeholder remains: ${block.title} / ${row.driver} / ${key} = ${row[key]}`);
      }
    }
  }
}
console.log('PASS: no fake 100 / Editable / Actuals + 10 placeholders');
