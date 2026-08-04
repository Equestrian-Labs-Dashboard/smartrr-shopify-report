let STATE = null;
let saveTimer = null;

function isFormulaToken(v) {
  const text = String(v ?? "").trim().toLowerCase();
  return text === "calculated" || text === "kpi / calculated" || text === "source" || text === "n/a" || text === "na" || text === "—" || text === "-" || text === "";
}


function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c !== null && c !== undefined && c !== "") node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return node;
}

function optionList(values, selected) {
  return values.map(v => `<option value="${v}" ${v === selected ? "selected" : ""}>${v}</option>`).join("");
}

function parseMoney(v) {
  if (typeof v === "number") return v;
  if (!v) return 0;
  const raw = String(v).trim();
  const cleaned = raw.replace(/[$,]/g, "").replace(/\/\s*month/i, "").trim();
  const m = cleaned.match(/^(-?\d+(?:\.\d+)?)\s*([kKmM])?$/);
  if (m) {
    const n = Number(m[1]);
    const suffix = (m[2] || "").toLowerCase();
    if (suffix === "k") return n * 1000;
    if (suffix === "m") return n * 1000000;
    return n;
  }
  return Number(cleaned) || 0;
}

function formatCurrency(n) {
  const value = Number(n || 0);
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return sign + "$" + Math.round(abs).toLocaleString("en-US");
}

function formatCompactCurrency(n) {
  const value = Number(n || 0);
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1000000) return sign + "$" + (abs / 1000000).toFixed(1).replace(".0", "") + "M";
  if (abs >= 1000) return sign + "$" + (abs / 1000).toFixed(0) + "k";
  return sign + "$" + Math.round(abs).toLocaleString("en-US");
}

function formatMoney(n) {
  // Software-style display: < $1M as k, >= $1M as M with one decimal.
  return formatCompactCurrency(n);
}

function formatFinancialMoney(n, opts = {}) {
  const value = Number(n || 0);
  if (opts.dashZero && Math.abs(value) < 0.5) return "—";
  return formatMoney(value);
}

function moneyClass(value, base = "calc-cell") {
  const text = String(value ?? "").trim();
  let cls = base;
  if (text === "—" || text === "$0") cls += " zero-value";
  if (text.startsWith("-$") || text.startsWith("(")) cls += " negative-value";
  return cls;
}

function fundingTotal(row) {
  if (row.total !== undefined && row.total !== null) return parseMoney(row.total);
  const label = String(row.scenario || "").replace("$", "").trim();
  if (!label || label === "Base") return 0;
  if (label.toLowerCase().endsWith("k")) return parseFloat(label) * 1000;
  if (label.toUpperCase().endsWith("M")) return parseFloat(label) * 1000000;
  return parseMoney(label);
}

function scenarioLabel() {
  return STATE.meta.fundingScenario === "Base $0" ? "Base" : STATE.meta.fundingScenario;
}

function displayYearKey() {
  const year = String((STATE && STATE.meta && STATE.meta.displayYear) || "2026");
  return `y${year}`;
}

function displayYearLabel() {
  return String((STATE && STATE.meta && STATE.meta.displayYear) || "2026");
}

function forecastPeriod(extra = "") {
  return [`Forecast ${displayYearLabel()}`, extra].filter(Boolean).join(" · ");
}

function magicPageCommercialValue(blockTitle, driver, yearKey = displayYearKey()) {
  const block = getBlock(STATE.commercial, blockTitle);
  return val(block ? block.rows : [], driver, yearKey);
}

function selectedFundingRow() {
  return STATE.funding.find(r => r.scenario === scenarioLabel()) || STATE.funding[0];
}

function updateIndicator(text) {
  const indicator = document.getElementById("saveIndicator");
  if (indicator) indicator.textContent = text;
}

function commitActiveEditor() {
  const active = document.activeElement;
  if (active && active.matches && active.matches("input, select, textarea")) {
    // Force the latest typed value into STATE before saving, even when the
    // user clicks Save without leaving the field first.
    active.dispatchEvent(new Event("change", { bubbles: true }));
    active.blur();
  }
}

function renderCalculatedOutputs() {
  // Recalculate every dependent output from the current Magic Page inputs.
  renderKpis();
  renderSheet2Draft();
  renderFinancialSummary();
  renderCommercialCashFlow();
  renderThesis();
}

function saveNow() {
  clearTimeout(saveTimer);
  commitActiveEditor();
  renderCalculatedOutputs();
  if (STATE && STATE.meta) {
    STATE.meta.lastSavedAt = new Date().toISOString();
    saveScenarioInputs(STATE.meta.modelStatus || "Draft");
  }
  DataService.save(STATE);
  updateIndicator("Saved ✓");
}

function scheduleSave() {
  if (STATE && typeof renderSheet2Draft === "function") renderSheet2Draft();
  clearTimeout(saveTimer);
  updateIndicator("Saving…");
  saveTimer = setTimeout(saveNow, 400);
}

function downloadState() {
  saveNow();
  const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `strategic-model-assumptions-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function isPercentDriver(rowObj) {
  const d = String(rowObj && rowObj.driver || "").toLowerCase();
  return d.includes("%") || d.includes("gm1") || d.includes("margin") || d.includes("growth") || d.includes("carryover") || d.includes("returning customer") || d.includes("email revenue") || d.includes("overlap") || d.includes("capture") || d.includes("discount");
}

function normalizePercentDisplay(v) {
  const text = String(v ?? "").trim();
  if (!text || isFormulaToken(text)) return text;
  if (text.includes("%")) return text;
  const n = Number(text.replace(/,/g, ""));
  if (Number.isFinite(n)) return `${n}%`;
  return text;
}

function makeEditableCell(rowObj, key, onChange, opts = {}) {
  const td = el("td", { class: "editable" });
  const input = el("input", { type: "text" });
  const percentDriver = opts.percent || isPercentDriver(rowObj);
  input.value = rowObj[key] ?? "";
  if (opts.money && typeof rowObj[key] === "number") input.value = formatMoney(rowObj[key]);
  if (!opts.money && percentDriver) input.value = normalizePercentDisplay(input.value);
  if (percentDriver) input.classList.add("percent-input");
  const writeValueToState = (rawValue, formatField = false) => {
    if (opts.money) {
      rowObj[key] = parseMoney(rawValue);
      if (formatField) input.value = rowObj[key] ? formatMoney(rowObj[key]) : "$0";
    } else if (percentDriver) {
      rowObj[key] = normalizePercentDisplay(rawValue);
      if (formatField) input.value = rowObj[key];
    } else {
      rowObj[key] = rawValue;
    }
  };
  input.addEventListener("input", e => {
    // Keep STATE synchronized while the user types. This prevents losing the
    // last edit when Save is clicked immediately.
    writeValueToState(e.target.value, false);
    clearTimeout(saveTimer);
    updateIndicator("Unsaved changes");
  });
  input.addEventListener("change", e => {
    writeValueToState(e.target.value, true);
    onChange();
  });
  td.appendChild(input);
  return td;
}

function makeCalcCell(value, className = "calc-cell") {
  return el("td", { class: moneyClass(value, className) }, value);
}


function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function scenarioSnapshot() {
  const snap = deepClone(STATE);
  delete snap.scenarioVersions;
  return snap;
}

function ensureScenarioStore() {
  if (!STATE.scenarioVersions) STATE.scenarioVersions = {};
}

function saveScenarioInputs(status) {
  ensureScenarioStore();
  const key = status || (STATE.meta && STATE.meta.modelStatus) || "Draft";
  STATE.scenarioVersions[key] = scenarioSnapshot();
}

function renderAll() {
  syncHeaderToTables();
  renderHeader();
  renderKpis();
  renderFunding();
  renderCommercial();
  renderBusinessUnits();
  renderPurchasing();
  renderOperations();
  renderSheet2Draft();
  renderFinancialSummary();
  renderCommercialCashFlow();
  renderFormulaQA();
  renderGrowth();
  renderThesis();
}

function switchModelStatus(nextStatus) {
  if (!STATE || !STATE.meta) return;
  const currentStatus = STATE.meta.modelStatus || "Draft";
  if (nextStatus === currentStatus) return;
  saveScenarioInputs(currentStatus);
  const store = STATE.scenarioVersions || {};
  if (store[nextStatus]) {
    const nextState = deepClone(store[nextStatus]);
    nextState.scenarioVersions = store;
    STATE = nextState;
  }
  STATE.meta.modelStatus = nextStatus;
  renderAll();
  saveNow();
}

function publishScenario() {
  ensureScenarioStore();
  const source = STATE.meta.modelStatus || "Draft";
  const choices = ["Budget", "Forecast", "Board"].filter(x => x !== source);
  const target = prompt(`Publish ${source} inputs to which scenario?\n${choices.join(" / ")}`, choices[0] || "Budget");
  if (!target || !choices.includes(target)) return;
  if (!confirm(`This will overwrite ${target} with the current ${source} inputs. Continue?`)) return;
  saveScenarioInputs(source);
  const snap = scenarioSnapshot();
  snap.meta.modelStatus = target;
  STATE.scenarioVersions[target] = snap;
  saveNow();
  alert(`${source} published to ${target}.`);
}

function renderHeader() {
  const { meta, lists } = STATE;
  if (!meta.displayYear) meta.displayYear = "2026";
  if (!lists.displayYear) lists.displayYear = ["2026", "2027", "2028", "2029"];
  document.getElementById("modelStatus").innerHTML = optionList(lists.modelStatus, meta.modelStatus);
  document.getElementById("displayYear").innerHTML = optionList(lists.displayYear, meta.displayYear);
  document.getElementById("fundingScenario").innerHTML = optionList(lists.fundingScenario, meta.fundingScenario);
  document.getElementById("fundingDate").innerHTML = optionList(lists.fundingDate, meta.fundingDate);
  document.getElementById("baseEcommerce").value = meta.baseEcommerceMonthly || "$70k";
  document.getElementById("doverCapture").innerHTML = optionList(lists.doverCapture || ["5%", "10%", "15%", "20%", "30%"], meta.doverCapture);
  document.getElementById("roas").innerHTML = optionList(lists.roas || ["3.0x", "3.5x", "4.0x"], meta.roas);
  document.getElementById("lastUpdate").value = meta.lastUpdate;
  meta.version = "1.2";
  document.getElementById("versionBadge").textContent = "v1.2";

  document.getElementById("modelStatus").onchange = e => switchModelStatus(e.target.value);
  document.getElementById("displayYear").onchange = e => {
    meta.displayYear = e.target.value;
    renderKpis();
    renderSheet2Draft();
    renderFinancialSummary();
    renderCommercialCashFlow();
    scheduleSave();
  };
  document.getElementById("fundingScenario").onchange = e => { meta.fundingScenario = e.target.value; applyFundingOrganicDefault(); renderKpis(); renderFunding(); renderCommercial(); renderGrowth(); renderBusinessUnits(); renderSheet2Draft(); renderThesis(); renderFinancialSummary(); renderCommercialCashFlow(); scheduleSave(); };
  document.getElementById("fundingDate").onchange = e => { meta.fundingDate = e.target.value; renderKpis(); renderGrowth(); renderSheet2Draft(); renderFinancialSummary(); renderCommercialCashFlow(); scheduleSave(); };
  document.getElementById("baseEcommerce").onchange = e => { meta.baseEcommerceMonthly = e.target.value; renderKpis(); renderSheet2Draft(); renderThesis(); renderFinancialSummary(); renderCommercialCashFlow(); scheduleSave(); };
  document.getElementById("doverCapture").onchange = e => { meta.doverCapture = e.target.value; syncHeaderToTables(); renderKpis(); renderCommercial(); renderSheet2Draft(); renderThesis(); renderFinancialSummary(); renderCommercialCashFlow(); scheduleSave(); };
  document.getElementById("roas").onchange = e => { meta.roas = e.target.value; syncHeaderToTables(); renderKpis(); renderCommercial(); renderSheet2Draft(); renderThesis(); renderFinancialSummary(); renderCommercialCashFlow(); scheduleSave(); };
  document.getElementById("lastUpdate").oninput = e => { meta.lastUpdate = e.target.value; scheduleSave(); };
}


function selectedOrganicGrowth() {
  const market = getBlock(STATE.commercial, "Market Growth");
  const row = market ? getRow(market.rows, "Organic Growth %") : {};
  return row.y2026 || (selectedFundingRow() || {}).organicGrowthDefault || STATE.meta.organicGrowth || "10%";
}

function applyFundingOrganicDefault() {
  const row = selectedFundingRow();
  const market = getBlock(STATE.commercial, "Market Growth");
  if (market && row && row.organicGrowthDefault) {
    const org = getRow(market.rows, "Organic Growth %");
    if (org) {
      org.y2026 = row.organicGrowthDefault;
      STATE.meta.organicGrowth = row.organicGrowthDefault;
    }
  }
}

function syncHeaderToTables() {
  const years = ["y2026", "y2027", "y2028", "y2029"];
  const market = STATE.commercial.find(b => b.title.includes("Market Growth"));
  if (market) {
    const dover = market.rows.find(r => String(r.driver || "").startsWith("Dover Target Capture")) || market.rows.find(r => r.driver === "Dover Capture %");
    // Header Dover Capture is the scenario target; when it changes, apply it across all forecast years.
    if (dover) years.forEach(y => { dover[y] = STATE.meta.doverCapture; });
  }
  const acq = STATE.commercial.find(b => b.title.includes("Acquisition"));
  if (acq) {
    const roas = acq.rows.find(r => r.driver === "ROAS");
    // Header ROAS is also a scenario assumption; keep all forecast years aligned unless users edit later.
    if (roas) years.forEach(y => { roas[y] = STATE.meta.roas; });
  }
}

function renderKpis() {
  const wrap = document.getElementById("kpiGrid");
  const row = selectedFundingRow();
  const period = forecastPeriod();
  const cards = [
    { label: "Funding", value: STATE.meta.fundingScenario, sub: period },
    { label: "Funding Date", value: STATE.meta.fundingDate || row.date, sub: period },
    { label: "Base Ecommerce", value: STATE.meta.baseEcommerceMonthly || "$70k", sub: forecastPeriod("Monthly Run Rate") },
    { label: "Dover Capture", value: STATE.meta.doverCapture, sub: period },
    { label: "ROAS", value: STATE.meta.roas, sub: period },
  ];
  wrap.innerHTML = "";
  cards.forEach(k => wrap.appendChild(el("div", { class: "kpi-card" }, [
    el("div", { class: "kpi-label" }, k.label),
    el("div", { class: "kpi-value" }, k.value),
    el("div", { class: "kpi-sub" }, k.sub),
  ])));
}

function renderFunding() {
  const cols = ["scenario", "date", "organicGrowthDefault", "payables", "inventory", "marketing", "embroidery", "privateLabel"];
  const heads = ["Scenario", "Date", "Organic Growth", "Payables", "Inventory", "Marketing", "Embroidery", "Private Label", "Unallocated Capital"];
  const table = document.getElementById("fundingTable");
  table.innerHTML = `<thead><tr>${heads.map(h => `<th>${h}</th>`).join("")}</tr></thead>`;
  const tbody = el("tbody");
  STATE.funding.forEach(row => {
    const tr = el("tr");
    cols.forEach(col => {
      if (col === "scenario") tr.appendChild(el("td", { class: "label-cell scenario-cell" }, row.scenario));
      else if (col === "date") tr.appendChild(makeEditableCell(row, col, () => { renderFunding(); scheduleSave(); }));
      else if (col === "organicGrowthDefault") tr.appendChild(makeEditableCell(row, col, () => { applyFundingOrganicDefault(); renderCommercial(); renderSheet2Draft(); renderThesis(); scheduleSave(); }));
      else tr.appendChild(makeEditableCell(row, col, () => { renderFunding(); scheduleSave(); }, { money: true }));
    });
    const allocated = ["marketing", "inventory", "payables", "embroidery", "privateLabel"].reduce((sum, k) => sum + parseMoney(row[k]), 0);
    const unallocated = fundingTotal(row) - allocated;
    const cls = unallocated === 0 ? "calc-cell" : "calc-cell warning-cell";
    tr.appendChild(makeCalcCell((unallocated === 0 ? "✓ " : "⚠ ") + formatMoney(unallocated), cls));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
}

function isMarketGrowthSharedAssumption(row) {
  const driver = String((row && row.driver) || "");
  return driver.startsWith("Dover Market Opportunity") || driver.startsWith("Dover Target Capture") || driver.startsWith("Paid Ads Overlap");
}

function syncSharedMarketGrowthAssumption(row, changedKey) {
  if (!row || !isMarketGrowthSharedAssumption(row)) return;
  const years = ["y2026", "y2027", "y2028", "y2029"];
  const sourceKey = years.includes(changedKey) ? changedKey : "y2026";
  const value = row[sourceKey] || row.current || row.y2026 || "";
  if (!value) return;
  years.forEach(y => { row[y] = value; });
  if (String(row.driver || "").startsWith("Dover Market Opportunity")) {
    row.current = value;
  }
}

function displayCurrentForDriver(row) {
  if (!row) return "";
  if (String(row.driver || "").startsWith("Dover Market Opportunity")) {
    return row.y2026 || row.current || "";
  }
  return row.current || "";
}

function renderDriverTable(tableEl, rows) {
  const heads = ["Driver", "Baseline / Current", "2026", "2027", "2028", "2029"];
  tableEl.innerHTML = `<thead><tr>${heads.map(h => `<th>${h}</th>`).join("")}</tr></thead>`;
  const tbody = el("tbody");
  rows.forEach(row => {
    const tr = el("tr", { class: row.driver === "Discounts & Returns %" ? "economics-row" : "" });
    tr.appendChild(el("td", { class: "label-cell" }, row.driver));
    ["current", "y2026", "y2027", "y2028", "y2029"].forEach(k => {
      if (k === "current") tr.appendChild(makeCalcCell(displayCurrentForDriver(row), "gray-cell"));
      else if (row.calculated && row.calculated.includes(k)) tr.appendChild(makeCalcCell(computedCommercialValue(row, k) || row[k] || "Calculated"));
      else tr.appendChild(makeEditableCell(row, k, () => {
        syncSharedMarketGrowthAssumption(row, k);
        renderCommercial();
        renderSheet2Draft();
        scheduleSave();
      }));
    });
    tbody.appendChild(tr);
  });
  tableEl.appendChild(tbody);
}

function renderCommercial() {
  syncHeaderToTables();
  const wrap = document.getElementById("commercialBlocks");
  wrap.innerHTML = "";
  STATE.commercial.forEach(block => {
    const card = el("div", { class: "block-card" }, [
      el("div", { class: "block-title" }, block.title),
      el("table", { class: "grid" })
    ]);
    renderDriverTable(card.querySelector("table"), block.rows);
    if (block.title && block.title.includes("Market Growth")) {
      card.appendChild(renderDoverRamp(block));
    }
    wrap.appendChild(card);
  });
}

function renderEngineTable(tableEl, rows) {
  const heads = ["Driver", "Baseline / Current", "2026", "2027", "2028", "2029"];
  tableEl.innerHTML = `<thead><tr>${heads.map(h => `<th>${h}</th>`).join("")}</tr></thead>`;
  const tbody = el("tbody");
  rows.forEach(row => {
    const tr = el("tr");
    tr.appendChild(el("td", { class: "label-cell" }, row.driver));
    ["current", "y2026", "y2027", "y2028", "y2029"].forEach(k => {
      if (k === "current") tr.appendChild(makeCalcCell(row[k] || "", "gray-cell"));
      else tr.appendChild(makeEditableCell(row, k, () => scheduleSave()));
    });
    tbody.appendChild(tr);
  });
  tableEl.appendChild(tbody);
}

function fundingAmountSelected() {
  return fundingTotal(selectedFundingRow());
}

function gateStatusForEngine(engine) {
  const funding = fundingAmountSelected();
  if (engine.title.startsWith("Embroidery")) {
    return funding >= 1000000 ? { text: "ACTIVE ✓", cls: "active" } : { text: "LOCKED 🔒 below $1M", cls: "locked" };
  }
  if (engine.title.startsWith("Private Label")) {
    return funding >= 3000000 ? { text: "ACTIVE ✓", cls: "active" } : { text: "LOCKED 🔒 below $3M", cls: "locked" };
  }
  return null;
}

function renderBusinessUnits() {
  const wrap = document.getElementById("engineBlocks");
  wrap.innerHTML = "";
  const order = ["Ecommerce", "Concierge", "Wellington", "Embroidery", "Cavali", "Private Label"];
  const engines = [...(STATE.growthEngines || [])].sort((a, b) => {
    const ai = order.findIndex(x => String(a.title || "").startsWith(x));
    const bi = order.findIndex(x => String(b.title || "").startsWith(x));
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  engines.forEach(engine => {
    const gate = gateStatusForEngine(engine);
    const full = String(engine.title || "").startsWith("Cavali") || String(engine.title || "").startsWith("Private Label");
    const card = el("div", { class: "block-card" + (full ? " full-width" : "") }, [
      el("div", { class: "block-title" }, engine.title),
      engine.note ? el("div", { class: "block-note" }, engine.note) : null,
      el("table", { class: "grid" }),
      gate ? el("div", { class: `status-pill ${gate.cls}` }, gate.text) : null,
    ]);
    renderEngineTable(card.querySelector("table"), engine.rows);
    wrap.appendChild(card);
  });
}

function renderPurchasing() {
  renderDriverTable(document.getElementById("purchasingTable"), STATE.purchasing.commercialTerms);
  const vmTable = document.getElementById("vendorMixTable");
  vmTable.innerHTML = `<thead><tr><th>Prepaid %</th><th>&lt;15 Days %</th><th>30–45 Days %</th></tr></thead>`;
  const tbody = el("tbody");
  const tr = el("tr");
  ["prepaid", "under15", "d30to45"].forEach(k => tr.appendChild(makeEditableCell(STATE.purchasing.vendorMix, k, () => { renderPurchasing(); scheduleSave(); })));
  tbody.appendChild(tr);
  const total = parsePercent(STATE.purchasing.vendorMix.prepaid) + parsePercent(STATE.purchasing.vendorMix.under15) + parsePercent(STATE.purchasing.vendorMix.d30to45);
  const check = el("tr");
  check.appendChild(el("td", { class: Math.abs(total - 1) < 0.001 ? "calc-cell" : "calc-cell warning-cell", colspan: "3" }, (Math.abs(total - 1) < 0.001 ? "✓ " : "⚠ ") + `Vendor mix total ${formatPercent(total)}`));
  tbody.appendChild(check);
  vmTable.appendChild(tbody);
  renderDriverTable(document.getElementById("capitalEfficiencyTable"), STATE.purchasing.capitalEfficiency);
}

function renderOperations() {
  renderDriverTable(document.getElementById("opsTable"), STATE.operations);
}

function parsePercent(v) {
  if (typeof v === "number") return v > 1 ? v / 100 : v;
  const n = parseFloat(String(v || "").replace("%", ""));
  if (isNaN(n)) return 0;
  return n > 1 ? n / 100 : n;
}

function parseMultiple(v) {
  const n = parseFloat(String(v || "").replace("x", ""));
  return isNaN(n) ? 0 : n;
}

function parseNumber(v) {
  if (typeof v === "number") return v;
  if (!v) return 0;
  const raw = String(v).trim();
  const cleaned = raw.replace(/[$,%x,]/g, "").replace(/\/\s*month/i, "").trim();
  const m = cleaned.match(/^(-?\d+(?:\.\d+)?)\s*([kKmM])?$/);
  if (m) {
    const n = Number(m[1]);
    const suffix = (m[2] || "").toLowerCase();
    if (suffix === "k") return n * 1000;
    if (suffix === "m") return n * 1000000;
    return n;
  }
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}

function formatPercent(n) {
  return (Number(n || 0) * 100).toFixed(1).replace(".0", "") + "%";
}

function formatMultiple(n) {
  return Number(n || 0).toFixed(1) + "x";
}


function monthIndexFromFundingDate(value) {
  const s = String(value || "").trim();
  const m = s.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const mon = months[m[1].toLowerCase()];
  if (mon === undefined) return null;
  return { year: 2000 + Number(m[2]), month: mon };
}

function addMonths(dateObj, monthsToAdd) {
  const d = new Date(dateObj.year, dateObj.month + monthsToAdd, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

function selectedFundingDate() {
  const row = selectedFundingRow() || {};
  return monthIndexFromFundingDate(STATE.meta.fundingDate || row.date || "");
}
function yearFromKey(yearKey) { return Number(String(yearKey || "").replace("y", "")); }
function activeMonthsInYear(startDate, yearKey) {
  const year = yearFromKey(yearKey);
  if (!startDate || !year || year < startDate.year) return 0;
  if (year > startDate.year) return 12;
  return Math.max(0, 12 - startDate.month);
}
function annualLaunchFactor(startDate, yearKey) { return activeMonthsInYear(startDate, yearKey) / 12; }
function embroideryLaunchStart() { const d = selectedFundingDate(); return d ? addMonths(d, 3) : null; }
function privateLabelLaunchStart() { const d = selectedFundingDate(); return d ? addMonths(d, 15) : null; }
function launchFactorForEngine(title, yearKey) {
  if (String(title || "").startsWith("Embroidery")) return annualLaunchFactor(embroideryLaunchStart(), yearKey);
  if (String(title || "").startsWith("Private Label")) return annualLaunchFactor(privateLabelLaunchStart(), yearKey);
  return 1;
}

function monthsBetweenInclusive(start, end) {
  if (!start || !end) return [];
  const out = [];
  let y = start.year, m = start.month;
  while (y < end.year || (y === end.year && m <= end.month)) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out;
}

function adSpendCoverageEndForScenario(total, start) {
  if (!start) return null;
  if (total <= 500000) return addMonths(start, 5);
  if (total <= 1000000) return { year: 2027, month: 11 };
  if (total <= 3000000) return { year: 2028, month: 11 };
  return { year: 2029, month: 11 };
}

function incrementalAdSpendByYear(yearKey) {
  const year = Number(String(yearKey).replace("y", ""));
  const funding = selectedFundingRow();
  const total = fundingTotal(funding);
  const marketingAllocation = parseMoney(funding.marketing);
  if (!year || !marketingAllocation || total <= 0) return 0;
  const fundingDate = monthIndexFromFundingDate(STATE.meta.fundingDate || funding.date);
  if (!fundingDate) return 0;
  const start = addMonths(fundingDate, 1);
  const end = adSpendCoverageEndForScenario(total, start);
  const months = monthsBetweenInclusive(start, end);
  if (!months.length) return 0;
  const monthly = marketingAllocation / months.length;
  return months.filter(x => x.year === year).length * monthly;
}

function baseAdSpendByYear(yearKey) {
  const year = Number(String(yearKey).replace("y", ""));
  return year ? 20000 * 12 : 0;
}

function totalAdSpendManualOrEditable(yearKey) {
  const acq = getBlock(STATE.commercial, "Acquisition");
  const rows = acq ? acq.rows : [];
  if (yearKey === "y2029") {
    const reinvestRow = getRow(rows, "2029 Reinvestment %");
    const pct = parsePercent(reinvestRow && reinvestRow[yearKey] ? reinvestRow[yearKey] : "20%");
    const priorGross = ecommerceBuild("y2028").total;
    return priorGross * pct;
  }
  const totalRow = getRow(rows, "Total Ad Spend");
  const directCell = totalRow ? totalRow[yearKey] : "";
  return !isFormulaToken(directCell) ? parseMoney(directCell) : 0;
}

function targetAdSpendPct(yearKey) {
  const acq = getBlock(STATE.commercial, "Acquisition");
  const rows = acq ? acq.rows : [];
  const targetRow = getRow(rows, "Target Ad Spend % of Ecommerce Gross Sales");
  const legacyRow = getRow(rows, "Ad Spend % of Gross Sales");
  const cell = (targetRow && targetRow[yearKey]) || (legacyRow && legacyRow[yearKey]) || (targetRow && targetRow.current) || "20%";
  return parsePercent(cell || "20%");
}

function roasForYear(yearKey) {
  const acq = getBlock(STATE.commercial, "Acquisition");
  return parseMultiple(val(acq ? acq.rows : [], "ROAS", yearKey) || STATE.meta.roas || "0x");
}

function totalAdSpendByYear(yearKey) { return ecommerceBuild(yearKey).adSpend; }

function privateLabelRevenueActiveForYear(yearKey) {
  return launchFactorForEngine("Private Label", yearKey) > 0;
}

function computedCommercialValue(row, key) {
  if (!row || !key || key === "current") return null;
  if (row.driver === "Base Ad Spend") return formatMoney(baseAdSpendByYear(key));
  if (row.driver === "Incremental Ad Spend") {
    if (key === "y2029") return "—";
    return formatMoney(incrementalAdSpendByYear(key));
  }
  if (row.driver === "Total Ad Spend") {
    // 2026–2028 are calculated from Target Ad Spend % of Ecommerce Gross Sales.
    // 2029 uses Default Logic: Prior Year Ecommerce Gross Sales × Reinvestment %.
    return formatMoney(totalAdSpendByYear(key));
  }
  if (row.driver === "Target Ad Spend % of Ecommerce Gross Sales") {
    if (key === "y2029") return "—";
    return null;
  }
  if (row.driver === "Ad Spend % of Ecommerce Gross Sales" || row.driver === "Ad Spend % of Gross Sales") {
    const gross = ecommerceBuild(key).total;
    return gross ? formatPercent(totalAdSpendByYear(key) / gross) : "—";
  }
  if (row.driver === "CAC") {
    const ecommerce = getBlock(STATE.growthEngines, "Ecommerce");
    const orders = parseNumber(val(ecommerce ? ecommerce.rows : [], "Orders", key));
    const newPct = parsePercent(val((getBlock(STATE.commercial, "Acquisition") || {}).rows, "New Customer Mix %", key));
    const newCustomers = orders * (newPct || 0);
    return newCustomers ? formatMoney(totalAdSpendByYear(key) / newCustomers) : "—";
  }
  if (row.driver === "Annual GP per Customer") {
    const ecommerce = getBlock(STATE.growthEngines, "Ecommerce");
    const retention = getBlock(STATE.commercial, "Retention");
    const aov = parseMoney(val(ecommerce ? ecommerce.rows : [], "AOV", key));
    const pf = parseNumber(val(retention ? retention.rows : [], "Purchase Frequency", key));
    const gm1 = parsePercent(val(ecommerce ? ecommerce.rows : [], "GM1 %", key));
    return (aov && pf && gm1) ? formatMoney(aov * pf * gm1) : "—";
  }
  return null;
}

function yearLabel(key) {
  return key === "current" ? "Current" : key.replace("y", "");
}

function getBlock(list, titleStarts) {
  return (list || []).find(b => String(b.title || "").startsWith(titleStarts));
}

function getRow(rows, driver) {
  return (rows || []).find(r => r.driver === driver) || {};
}

function isBlankLike(v) {
  const s = String(v ?? "").trim();
  if (!s || s === "$" || s === "-" || s === "—") return true;
  if (/^calculated$/i.test(s) || /^kpi \/ calculated$/i.test(s)) return true;
  if (/^no ad_spend/i.test(s) || /^needs /i.test(s) || /^revenue share/i.test(s)) return true;
  return false;
}
function val(rows, driver, year) {
  const row = getRow(rows, driver);
  const requested = row[year];
  if (year !== "current" && isBlankLike(requested) && !isBlankLike(row.current)) return row.current;
  return requested || "";
}

function engineKeyFromTitle(title) {
  const t = String(title || "").toLowerCase();
  if (t.startsWith("ecommerce")) return "Ecommerce";
  if (t.startsWith("concierge")) return "Concierge";
  if (t.startsWith("wellington")) return "Wellington";
  if (t.startsWith("cavali")) return "Cavali";
  if (t.startsWith("embroidery")) return "Embroidery";
  if (t.startsWith("private label")) return "Private Label";
  return "";
}

function actualEngineFallback(title, active) {
  if (!active || !STATE.actuals || !STATE.actuals.engineGrossSales) return null;
  const key = engineKeyFromTitle(title);
  const gross = parseNumber(STATE.actuals.engineGrossSales[key]);
  if (!key || !gross) return null;
  const gm1 = parsePercent((STATE.actuals.engineGm1 || {})[key]);
  return { gross, gp1: gross * gm1, gm1, active: true, note: "Google Sheet actual / baseline" };
}

function weightedAverageFromCavaliRows(rows, metric, year) {
  const sigMembers = parseNumber(val(rows, "Signature Active Members", year));
  const premMembers = parseNumber(val(rows, "Premium Active Members", year));
  const sigValue = parseMoney(val(rows, `Signature ${metric}`, year)) || parseNumber(val(rows, `Signature ${metric}`, year));
  const premValue = parseMoney(val(rows, `Premium ${metric}`, year)) || parseNumber(val(rows, `Premium ${metric}`, year));
  const totalMembers = sigMembers + premMembers;
  if (!totalMembers) return 0;
  return ((sigMembers * sigValue) + (premMembers * premValue)) / totalMembers;
}

function engineDiscountRate(year) {
  return parsePercent(val((STATE.purchasing || {}).commercialTerms || [], "Discounts & Returns %", year));
}

function engineGp1FromGross(gross, gm1, year) {
  const net = gross * (1 - engineDiscountRate(year));
  return net * gm1;
}

function engineGrossAndGp(engine, year) {
  const title = engine.title || "";
  const rows = engine.rows || [];
  let gross = 0;
  let gp1 = 0;
  let note = "";
  let active = true;

  if (title.startsWith("Embroidery") && fundingAmountSelected() < 1000000) active = false;
  if (title.startsWith("Private Label") && fundingAmountSelected() < 3000000) active = false;
  if (title.startsWith("Private Label") && active && !privateLabelRevenueActiveForYear(year)) return { gross: 0, gp1: 0, gm1: 0, active: true, note: "Active gate; pending launch" };

  if (!active) return { gross: 0, gp1: 0, gm1: 0, active: false, note: "Locked by funding gate" };
  const launchFactor = launchFactorForEngine(title, year);
  if ((title.startsWith("Embroidery") || title.startsWith("Private Label")) && launchFactor <= 0) return { gross: 0, gp1: 0, gm1: 0, active: true, note: "Pending funding-driven launch" };

  if (title.startsWith("Ecommerce")) {
    const build = ecommerceBuild(year);
    gross = build.total;
    const gm1 = parsePercent(val(rows, "GM1 %", year));
    gp1 = engineGp1FromGross(gross, gm1, year);
    note = "Ecommerce Revenue Build total";
    return { gross, gp1, gm1, active, note };
  }

  if (title.startsWith("Wellington") || title.startsWith("Embroidery")) {
    const orders = parseNumber(val(rows, "Orders", year));
    const aov = parseMoney(val(rows, "AOV", year));
    const gm1 = parsePercent(val(rows, "GM1 %", year));
    gross = orders * aov * launchFactor;
    gp1 = engineGp1FromGross(gross, gm1, year);
    note = "Orders × AOV";
    if (!gross) { const fallback = actualEngineFallback(title, active); if (fallback) return fallback; }
    return { gross, gp1, gm1, active, note };
  }

  if (title.startsWith("Concierge")) {
    const clients = parseNumber(val(rows, "Active Clients", year));
    const ordersPerClient = parseNumber(val(rows, "Orders per Client", year));
    const aov = parseMoney(val(rows, "AOV", year));
    const gm1 = parsePercent(val(rows, "GM1 %", year));
    gross = clients * ordersPerClient * aov;
    gp1 = engineGp1FromGross(gross, gm1, year);
    note = "Clients × Orders/Client × AOV";
    if (!gross) { const fallback = actualEngineFallback(title, active); if (fallback) return fallback; }
    return { gross, gp1, gm1, active, note };
  }

  if (title.startsWith("Cavali")) {
    const sigMembers = parseNumber(val(rows, "Signature Active Members", year));
    const sigBoxes = parseNumber(val(rows, "Signature Boxes per Year", year));
    const sigPrice = parseMoney(val(rows, "Signature Price", year));
    const premMembers = parseNumber(val(rows, "Premium Active Members", year));
    const premBoxes = parseNumber(val(rows, "Premium Boxes per Year", year));
    const premPrice = parseMoney(val(rows, "Premium Price", year));
    const cavaliAdSpend = parseMoney(val(rows, "Cavali Ad Spend", year));
    const cavaliCac = parseMoney(val(rows, "Cavali CAC", year));
    const weightedBoxes = weightedAverageFromCavaliRows(rows, "Boxes per Year", year) || 2;
    const weightedPrice = weightedAverageFromCavaliRows(rows, "Price", year) || ((sigPrice + premPrice) / 2 || 149);
    const paidMembers = cavaliCac ? cavaliAdSpend / cavaliCac : 0;
    const paidGrowthRevenue = paidMembers * weightedBoxes * weightedPrice;
    const gm1 = parsePercent(val(rows, "GM1 %", year));
    gross = sigMembers * sigBoxes * sigPrice + premMembers * premBoxes * premPrice + paidGrowthRevenue;
    gp1 = engineGp1FromGross(gross, gm1, year);
    note = "$99 + $199 membership products + paid member growth";
    if (!gross) { const fallback = actualEngineFallback(title, active); if (fallback) return fallback; }
    return { gross, gp1, gm1, active, note };
  }

  if (title.startsWith("Private Label")) {
    const units = parseNumber(val(rows, "Units Sold", year));
    const asp = parseMoney(val(rows, "Average Selling Price", year));
    const gm1 = parsePercent(val(rows, "GM1 %", year));
    gross = units * asp * launchFactor;
    gp1 = engineGp1FromGross(gross, gm1, year);
    note = "Units × ASP";
    if (!gross) { const fallback = actualEngineFallback(title, active); if (fallback) return fallback; }
    return { gross, gp1, gm1, active, note };
  }

  return { gross, gp1, gm1: 0, active, note };
}

function engineOutputs(year = "y2026") {
  return (STATE.growthEngines || []).map(engine => {
    const out = engineGrossAndGp(engine, year);
    return {
      engine: (engine.title || "").split(" — ")[0],
      owner: ((engine.title || "").split(" — ")[1] || ""),
      title: engine.title,
      ...out
    };
  });
}

function marginBridge(year = "y2026") {
  const outputs = engineOutputs(year);
  const grossSales = outputs.reduce((s, r) => s + r.gross, 0);
  const gp1 = outputs.reduce((s, r) => s + r.gp1, 0);
  const acq = getBlock(STATE.commercial, "Acquisition");
  const dnrPct = parsePercent(val((STATE.purchasing || {}).commercialTerms || [], "Discounts & Returns %", year));
  const discountsReturns = grossSales * dnrPct;
  const netSales = grossSales - discountsReturns;

  const outboundPct = parsePercent(val(STATE.operations, "Outbound Shipping Cost %", year));
  const packagingPct = parsePercent(val(STATE.operations, "Packaging Cost %", year));
  const shippingRevPct = parsePercent(val(STATE.operations, "Shipping Revenue %", year));
  const outboundShipping = netSales * outboundPct;
  const packaging = netSales * packagingPct;
  const shippingRevenue = netSales * shippingRevPct;
  const gp2 = gp1 - outboundShipping - packaging + shippingRevenue;

  const cavali = getBlock(STATE.growthEngines, "Cavali");
  const cavaliAdSpend = parseMoney(val(cavali ? cavali.rows : [], "Cavali Ad Spend", year));
  const adSpend = totalAdSpendByYear(year) + cavaliAdSpend;
  const gp3 = gp2 - adSpend;

  return { grossSales, discountsReturns, netSales, dnrPct, gp1, outboundShipping, packaging, shippingRevenue, gp2, adSpend, variableMarketing: adSpend, gp3 };
}

function renderMiniCards(id, cards) {
  const wrap = document.getElementById(id);
  if (!wrap) return;
  wrap.innerHTML = "";
  cards.forEach(k => wrap.appendChild(el("div", { class: "kpi-card" }, [
    el("div", { class: "kpi-label" }, k.label),
    el("div", { class: "kpi-value" }, k.value),
    k.sub ? el("div", { class: "kpi-sub" }, k.sub) : null,
  ])));
}


/* ---------------- V16 Dover ramp + Ecommerce Revenue Build + Carryover ---------------- */
function yearKeys() { return ["y2026", "y2027", "y2028", "y2029"]; }

function currentDoverTargetPct(year) {
  const market = getBlock(STATE.commercial, "Market Growth");
  const rows = market ? market.rows : [];
  const row = (rows || []).find(r => String(r.driver || "").startsWith("Dover Target Capture"));
  const v = row ? (row[year] || row.current || "") : "";
  return parsePercent(v || STATE.meta.doverCapture || "20%");
}

function doverRampPct(yearKey) {
  const market = getBlock(STATE.commercial, "Market Growth");
  const configured = market && market.doverRamp ? market.doverRamp : {};
  const selected = selectedFundingDate();
  const baseline = { year: 2026, month: 9 };
  const targetYear = yearFromKey(yearKey);
  if (!selected || !targetYear) return parsePercent(configured[yearKey] || "0%");
  const shift = (selected.year - baseline.year) * 12 + selected.month - baseline.month;
  let total = 0;
  yearKeys().forEach(sourceKey => {
    const sourceYear = yearFromKey(sourceKey), pct = parsePercent(configured[sourceKey] || "0%");
    for (let month = 0; month < 12; month += 1) {
      const shifted = addMonths({year: sourceYear, month}, shift);
      if (shifted.year === targetYear) total += pct / 12;
    }
  });
  return total;
}

function paidAdsOverlapPct(year) {
  const market = getBlock(STATE.commercial, "Market Growth");
  const rows = market ? market.rows : [];
  const row = (rows || []).find(r => String(r.driver || "").startsWith("Paid Ads Overlap"));
  const v = row ? (row[year] || row.current || "") : "";
  return parsePercent(v || "30%");
}

function doverMarketOpportunity(year) {
  const market = getBlock(STATE.commercial, "Market Growth");
  const rows = market ? market.rows : [];
  const row = (rows || []).find(r => String(r.driver || "").startsWith("Dover Market Opportunity"));
  const v = row ? (row[year] || row.current || "") : "";
  return parseMoney(v || "$100M");
}

function grossDoverOpportunity(year) {
  return doverMarketOpportunity(year) * currentDoverTargetPct(year) * doverRampPct(year);
}

function netDoverCapture(year) {
  return grossDoverOpportunity(year) * (1 - paidAdsOverlapPct(year));
}

function organicGrowthPct(year) {
  const market = getBlock(STATE.commercial, "Market Growth");
  return parsePercent(val(market ? market.rows : [], "Organic Growth %", year) || selectedOrganicGrowth());
}

function carryoverPctForYear(year) {
  const retention = getBlock(STATE.commercial, "Retention");
  return parsePercent(val(retention ? retention.rows : [], "Incremental Revenue Carryover %", year) || "0%");
}

function baseEcommerceRevenue(year) {
  const years = yearKeys();
  const idx = years.indexOf(year);
  const monthly = parseMoney(STATE.meta.baseEcommerceMonthly || "$70k");
  const actualYtd = parseMoney(STATE?.actuals?.corroGrossSalesYtd || 0);
  const throughMonth = Math.max(0, Math.min(12, Number(STATE?.actuals?.actualsThroughMonth || STATE?.meta?.actualsThroughMonth || 0)));
  // 2026 is a true closing forecast: Shopify actuals through the latest closed
  // month plus the editable monthly run rate for the remaining months.
  const initialBase = actualYtd > 0 ? actualYtd + Math.max(0, 12 - throughMonth) * monthly : monthly * 12;
  if (idx <= 0) return initialBase;

  let base = initialBase;
  for (let i = 1; i <= idx; i++) {
    const priorYear = years[i - 1];
    const priorOrganic = base * organicGrowthPct(priorYear);
    const priorPaid = incrementalPaidGrowth(priorYear);
    const priorDover = netDoverCapture(priorYear);
    const carryover = carryoverPctForYear(priorYear);
    // Latest Easy Numbers Test logic: the editable carryover rate applies to
    // Organic Growth + Paid Growth Revenue + Net Dover Capture. This keeps the
    // formula map and implemented model aligned before actuals are loaded.
    base = base + carryover * (priorOrganic + priorPaid + priorDover);
  }
  return base;
}

function organicGrowthRevenue(year) {
  // 2026 already contains actuals + run-rate forecast. The selected organic
  // growth assumption begins in 2027 and is not double-counted in 2026.
  if (year === "y2026") return 0;
  return baseEcommerceRevenue(year) * organicGrowthPct(year);
}

function incrementalPaidGrowth(year) {
  return ecommerceBuild(year).paid;
}

function ecommerceBuild(year) {
  const base = baseEcommerceRevenue(year);
  const organic = organicGrowthRevenue(year);
  const dover = netDoverCapture(year);
  const roas = roasForYear(year);
  const prePaidRevenue = base + organic + dover;

  let adSpend = 0;
  let paid = 0;
  let total = prePaidRevenue;
  let warning = "";

  const manualSpend = totalAdSpendManualOrEditable(year);
  if (year === "y2029" && manualSpend > 0) adSpend = manualSpend;
  else {
    adSpend = baseAdSpendByYear(year) + incrementalAdSpendByYear(year);
    if (manualSpend > 0) adSpend = manualSpend;
  }
  paid = adSpend * roas;
  total = prePaidRevenue + paid;

  return { base, organic, paid, dover, total, adSpend, roas, warning };
}

function renderDoverRamp(block) {
  const market = block || getBlock(STATE.commercial, "Market Growth");
  if (!market.doverRamp) market.doverRamp = { y2026: "5%", y2027: "55%", y2028: "25%", y2029: "15%" };
  const wrap = el("div", { class: "dover-ramp-wrap" });
  const opp = doverMarketOpportunity("y2026");
  const targetPct = currentDoverTargetPct("y2026");
  const target = opp * targetPct;
  wrap.appendChild(el("div", { class: "dover-assumption-grid" }, [
    el("div", { class: "dover-assumption" }, [el("span", {}, "Dover Market Opportunity (Gross)"), el("strong", {}, formatCompactCurrency(opp))]),
    el("div", { class: "dover-assumption" }, [el("span", {}, "Gross Addressable Opportunity"), el("strong", {}, `${formatPercent(targetPct)} Target = ${formatCompactCurrency(target)}`)]),
    el("div", { class: "dover-assumption" }, [el("span", {}, "Paid Ads Overlap"), el("strong", {}, formatPercent(paidAdsOverlapPct("y2026")))])
  ]));
  const table = el("table", { class: "grid dover-ramp-table" });
  table.innerHTML = `<thead><tr><th>Dover Capture Ramp</th>${yearKeys().map(y => `<th>${yearLabel(y)}</th>`).join("")}<th>Total</th></tr></thead>`;
  const tbody = el("tbody");
  const pctRow = el("tr");
  pctRow.appendChild(el("td", { class: "label-cell" }, "% of Target Capture"));
  yearKeys().forEach(y => pctRow.appendChild(makeEditableCell(market.doverRamp, y, () => { renderCommercial(); renderSheet2Draft(); scheduleSave(); })));
  const totalPct = yearKeys().reduce((s, y) => s + parsePercent(market.doverRamp[y]), 0);
  pctRow.appendChild(makeCalcCell(formatPercent(totalPct), Math.abs(totalPct - 1) < 0.001 ? "calc-cell" : "calc-cell warning-cell"));
  tbody.appendChild(pctRow);
  const grossRow = el("tr");
  grossRow.appendChild(el("td", { class: "label-cell" }, "Gross Dover Capture (before paid overlap)"));
  yearKeys().forEach(y => grossRow.appendChild(makeCalcCell(formatCompactCurrency(grossDoverOpportunity(y)))));
  grossRow.appendChild(makeCalcCell(formatCompactCurrency(yearKeys().reduce((s,y)=>s+grossDoverOpportunity(y),0))));
  tbody.appendChild(grossRow);
  const netRow = el("tr");
  netRow.appendChild(el("td", { class: "label-cell" }, "Net Dover Capture after paid ads overlap"));
  yearKeys().forEach(y => netRow.appendChild(makeCalcCell(formatCompactCurrency(netDoverCapture(y)))));
  netRow.appendChild(makeCalcCell(formatCompactCurrency(yearKeys().reduce((s,y)=>s+netDoverCapture(y),0))));
  tbody.appendChild(netRow);
  table.appendChild(tbody);
  wrap.appendChild(el("p", { class: "section-sub" }, "Dover Capture Ramp"));
  wrap.appendChild(table);
  return wrap;
}

function renderEcommerceRevenueBuild() {
  const table = document.getElementById("ecommerceBuildTable");
  if (!table) return;
  const years = yearKeys();
  const rows = [
    ["Base Ecommerce Revenue", y => ecommerceBuild(y).base],
    ["Organic Growth", y => ecommerceBuild(y).organic],
    ["Paid Growth", y => ecommerceBuild(y).paid],
    ["Net Dover Capture", y => ecommerceBuild(y).dover],
    ["Total Ecommerce Gross Sales", y => ecommerceBuild(y).total, true]
  ];
  table.innerHTML = `<thead><tr><th>Revenue Components</th>${years.map(y => `<th>${yearLabel(y)}</th>`).join("")}</tr></thead>`;
  const tbody = el("tbody");
  rows.forEach(([label, fn, total]) => {
    const tr = el("tr");
    tr.appendChild(el("td", { class: "label-cell" + (total ? " total-row-label" : "") }, label));
    years.forEach(y => tr.appendChild(makeCalcCell(formatCompactCurrency(fn(y)))));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
}

function selectedDnrPct(year) {
  return parsePercent(val((STATE.purchasing || {}).commercialTerms || [], "Discounts & Returns %", year));
}

function renderSheet2Scenario() {
  const period = forecastPeriod();
  renderMiniCards("sheet2ScenarioGrid", [
    { label: "Funding", value: STATE.meta.fundingScenario, sub: period },
    { label: "Funding Date", value: STATE.meta.fundingDate, sub: period },
    { label: "Base Ecommerce", value: STATE.meta.baseEcommerceMonthly || "$70k", sub: forecastPeriod("Monthly Run Rate") },
    { label: "Dover Capture", value: STATE.meta.doverCapture, sub: period },
    { label: "ROAS", value: STATE.meta.roas, sub: period },
  ]);
}

function renderFinancialSnapshot(year = displayYearKey()) {
  const m = marginBridge(year);
  const period = forecastPeriod();
  renderMiniCards("financialSnapshotGrid", [
    { label: "Gross Sales", value: formatMoney(m.grossSales), sub: period },
    { label: "Net Sales", value: formatMoney(m.netSales), sub: forecastPeriod("After Discounts & Returns") },
    { label: "Net-to-Gross", value: m.grossSales ? formatPercent(m.netSales / m.grossSales) : "—", sub: forecastPeriod("Net Sales / Gross Sales") },
    { label: "GP1", value: formatMoney(m.gp1), sub: forecastPeriod(m.netSales ? `${formatPercent(m.gp1 / m.netSales)} of Net Sales` : "GP1 / Net Sales") },
    { label: "GP2", value: formatMoney(m.gp2), sub: forecastPeriod(m.netSales ? `${formatPercent(m.gp2 / m.netSales)} of Net Sales` : "GP2 / Net Sales") },
    { label: "GP3", value: formatMoney(m.gp3), sub: forecastPeriod(m.netSales ? `${formatPercent(m.gp3 / m.netSales)} of Net Sales` : "GP3 / Net Sales") },
  ]);
}

function renderSheet2EngineDetail(year = "y2026") {
  const table = document.getElementById("sheet2EngineDetailTable");
  if (!table) return;
  const heads = ["Growth Engine", "Owner", "Formula", "Status", "Gross Sales", "GM1 %", "GP1"];
  table.innerHTML = `<thead><tr>${heads.map(h => `<th>${h}</th>`).join("")}</tr></thead>`;
  const tbody = el("tbody");
  engineOutputs(year).forEach(row => {
    const tr = el("tr");
    tr.appendChild(el("td", { class: "label-cell" }, row.engine));
    tr.appendChild(makeCalcCell(row.owner || "—"));
    tr.appendChild(makeCalcCell(row.note || "Formula pending"));
    tr.appendChild(el("td", { class: "calc-cell" }, el("span", { class: `status-pill ${row.active ? "active" : "locked"} inline` }, row.active ? "ACTIVE ✓" : "LOCKED 🔒")));
    tr.appendChild(makeCalcCell(formatMoney(row.gross)));
    tr.appendChild(makeCalcCell(row.gm1 ? formatPercent(row.gm1) : "—"));
    tr.appendChild(makeCalcCell(formatMoney(row.gp1)));
    tbody.appendChild(tr);
  });

  const acq = getBlock(STATE.commercial, "Acquisition");
  const adSpend = totalAdSpendByYear(year);
  const roas = parseMultiple(val(acq ? acq.rows : [], "ROAS", year));
  const support = el("tr");
  support.appendChild(el("td", { class: "label-cell" }, "Paid Revenue Influenced"));
  support.appendChild(makeCalcCell("Emma"));
  support.appendChild(makeCalcCell("Ad Spend × ROAS — informational only"));
  support.appendChild(makeCalcCell("Do not add to sales"));
  support.appendChild(makeCalcCell(formatMoney(adSpend * roas)));
  support.appendChild(makeCalcCell(formatMultiple(roas)));
  support.appendChild(makeCalcCell("Validation KPI"));
  tbody.appendChild(support);

  table.appendChild(tbody);
}

function renderSheet2ExecSummary(year = "y2026") {
  const table = document.getElementById("sheet2ExecSummaryTable");
  if (!table) return;
  const outputs = engineOutputs(year);
  const totalSales = outputs.reduce((s, r) => s + r.gross, 0);
  const totalGp1 = outputs.reduce((s, r) => s + r.gp1, 0);
  const heads = ["Growth Engine", "Owner", "Gross Sales", "% Total Sales", "GM1 %", "GP1", "% Total GP1"];
  table.innerHTML = `<thead><tr>${heads.map(h => `<th>${h}</th>`).join("")}</tr></thead>`;
  const tbody = el("tbody");
  outputs.forEach(row => {
    const tr = el("tr");
    tr.appendChild(el("td", { class: "label-cell" }, row.engine));
    tr.appendChild(makeCalcCell(row.owner || "—"));
    tr.appendChild(makeCalcCell(formatMoney(row.gross)));
    tr.appendChild(makeCalcCell(totalSales ? formatPercent(row.gross / totalSales) : "—"));
    tr.appendChild(makeCalcCell(row.gm1 ? formatPercent(row.gm1) : "—"));
    tr.appendChild(makeCalcCell(formatMoney(row.gp1)));
    tr.appendChild(makeCalcCell(totalGp1 ? formatPercent(row.gp1 / totalGp1) : "—"));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
}

function renderSheet2SupportingKpis(year = displayYearKey()) {
  const wrap = document.getElementById("sheet2SupportingKpis");
  if (!wrap) return;
  const adSpend = totalAdSpendByYear(year);
  const roas = parseMultiple(magicPageCommercialValue("Acquisition", "ROAS", year));
  const paidInfluenced = adSpend * roas;
  const ecommerceGross = ecommerceBuild(year).total;
  const paidShare = ecommerceGross ? formatPercent(paidInfluenced / ecommerceGross) : "—";
  const emailRev = magicPageCommercialValue("Retention", "Email Revenue %", year) || "—";
  const returning = magicPageCommercialValue("Retention", "Returning Customers %", year) || "—";
  const carryover = magicPageCommercialValue("Retention", "Incremental Revenue Carryover %", year) || "—";
  const purchaseFrequency = magicPageCommercialValue("Retention", "Purchase Frequency", year) || "—";
  const period = forecastPeriod();
  const cards = [
    { label: "Paid Revenue Influenced", value: formatFinancialMoney(Math.round(paidInfluenced), {dashZero:true}), note: `${period} · ${paidShare} of Ecommerce Gross Sales` },
    { label: "ROAS", value: formatMultiple(roas), note: `${period} · Paid efficiency assumption` },
    { label: "Email Revenue %", value: emailRev, note: `${period} · Influence KPI, not added again` },
    { label: "Purchase Frequency", value: purchaseFrequency, note: `${period} · Returning Customers: ${returning} · Carryover: ${carryover}` },
  ];
  wrap.innerHTML = "";
  cards.forEach(k => wrap.appendChild(el("div", { class: "supporting-card" }, [
    el("div", { class: "supporting-label" }, k.label),
    el("div", { class: "supporting-value" }, k.value),
    el("div", { class: "supporting-note" }, k.note),
  ])));
}

function renderSheet2MarginBridge(year = "y2026") {
  const table = document.getElementById("sheet2MarginBridgeTable");
  if (!table) return;
  const years = ["y2026", "y2027", "y2028", "y2029"];
  const stages = [
    ["Gross Sales", m => m.grossSales],
    ["Discounts & Returns", m => -m.discountsReturns],
    ["Net Sales", m => m.netSales],
    ["COGS", m => -(m.netSales - m.gp1)],
    ["GP1", m => m.gp1],
    ["Outbound Shipping", m => -m.outboundShipping],
    ["Packaging", m => -m.packaging],
    ["Shipping Revenue", m => m.shippingRevenue],
    ["GP2", m => m.gp2],
    ["Ad Spend", m => -m.adSpend],
    ["GP3", m => m.gp3],
  ];
  const bridges = Object.fromEntries(years.map(y => [y, marginBridge(y)]));
  table.innerHTML = `<thead><tr><th>Stage</th>${years.map(y => `<th>${yearLabel(y)}</th>`).join("")}</tr></thead>`;
  const tbody = el("tbody");
  stages.forEach(([stage, fn]) => {
    const tr = el("tr");
    const isTotal = ["Net Sales", "GP1", "GP2", "GP3"].includes(stage);
    tr.appendChild(el("td", { class: "label-cell" + (isTotal ? " total-row-label" : "") }, stage));
    years.forEach(y => tr.appendChild(makeCalcCell(formatMoney(fn(bridges[y])))));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
}

function renderSheet2FormulaNotes() {
  const table = document.getElementById("sheet2FormulaNotesTable");
  if (!table) return;
  const notes = (STATE.engineSheet && STATE.engineSheet.formulaNotes) || [];
  table.innerHTML = `<thead><tr><th>Item</th><th>Status</th><th>Needed to finish / automate</th></tr></thead>`;
  const tbody = el("tbody");
  notes.forEach(row => {
    const tr = el("tr");
    tr.appendChild(el("td", { class: "label-cell" }, row.item));
    tr.appendChild(makeCalcCell(row.status));
    tr.appendChild(makeCalcCell(row.needed));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
}

function renderSheet2Draft() {
  const year = displayYearKey();
  renderSheet2Scenario();
  renderFinancialSnapshot(year);
  renderEcommerceRevenueBuild();
  renderSheet2ExecSummary(year);
  renderSheet2SupportingKpis(year);
  renderSheet2MarginBridge(year);
}


function renderFormulaQA() {
  const root = document.getElementById("formulaQaBlocks");
  if (!root) return;
  root.innerHTML = "";
  const sections = [
    {title:"1. Core Ecommerce Revenue Build", rows:[
      ["Annual Base Ecommerce Revenue", "$100/month × 12", "$1.2k"],
      ["Organic Growth Revenue", "$1.2k base × 10%", "$120"],
      ["Paid Growth Revenue", "$100 Total Ad Spend × 3.0x ROAS. Assumption: Constant ROAS during selected fiscal year.", "$300"],
      ["Gross Dover Opportunity", "$1k market × 10% capture × 100% ramp", "$100"],
      ["Net Dover Capture", "$100 gross Dover × (1 − 20% overlap)", "$80"],
      ["Total Ecommerce Gross Sales", "$1.2k + $120 + $300 + $80", "$1.7k"]
    ]},
    {title:"2. Dover Capture & Paid Ads Overlap", rows:[
      ["Gross Dover Opportunity", "$10k market × 20% capture × 50% ramp", "$1k"],
      ["Net Dover Capture", "$1k × (1 − 30% overlap)", "$700"],
      ["Ramp validation", "5% + 55% + 25% + 15%", "100%"]
    ]},
    {title:"3. Carryover & Next-Year Ecommerce Base", rows:[
      ["Carryover anti-double-counting rule", "Carryover applies only once when calculating the following year's Base Ecommerce Revenue", "Test #1"],
      ["Next-Year Base — 0% carryover", "Prior Base $1k + Organic $100 + 0% × (Paid $200 + Dover $300)", "$1.1k"],
      ["Next-Year Base — 50% carryover", "Prior Base $1k + 50% × (Organic $100 + Paid $200 + Dover $300)", "$1.3k"],
      ["Carryover scope check", "Organic $100 + Paid $200 + Dover $300", "$600 incremental pool"]
    ]},
    {title:"4. Funding, Ad Spend & ROAS", rows:[
      ["Base Ad Spend", "$20k × 12 months", "$240k"],
      ["Incremental Ad Spend", "$600 marketing allocation ÷ 6 covered months", "$100/month"],
      ["Paid Growth Revenue", "$100 Total Ad Spend × 3.0x ROAS. Assumption: Constant ROAS during selected fiscal year.", "$300"],
      ["Paid Revenue Influenced %", "$300 influenced ÷ $1.5k Ecommerce Gross Sales", "20%"]
    ]},
    {title:"5. Default Logic (2029 onwards) — Reinvestment", rows:[
      ["2029 Default Ad Spend", "Prior Year Ecommerce Gross Sales $1k × Reinvestment % 20%", "$200"],
      ["2029 Paid Growth Revenue", "$200 Ad Spend × 3.0x ROAS", "$600"],
      ["Direction check", "Change reinvestment from 20% to 10%", "Ad Spend falls from $200 to $100"]
    ]},
    {title:"6. Growth Engine Formula Tests", rows:[
      ["Ecommerce Gross Sales", "Use Ecommerce Revenue Build total", "Must tie exactly to Ecommerce portfolio row"],
      ["Concierge Gross Sales", "10 active clients × 2 orders/client × $100 AOV", "$2k"],
      ["Wellington Gross Sales", "10 orders × $100 AOV", "$1k"],
      ["Cavali Signature Revenue", "10 members × 2 boxes/year × $99", "$2.0k"],
      ["Cavali Premium Revenue", "10 members × 2 boxes/year × $199", "$4.0k"],
      ["Cavali Paid Growth Members", "$1k Cavali Ad Spend ÷ $100 CAC", "10 new members"]
    ]},
    {title:"7. Gross-to-Net & Margin Bridge", rows:[
      ["Discounts & Returns", "$1.7k Gross Sales × 10%", "$170"],
      ["Net Sales", "$1.7k − $170", "$1.5k"],
      ["COGS", "$1.5k × (1 − 50% GM1)", "$765"],
      ["GP1", "$1.5k − $765", "$765"],
      ["Outbound Shipping", "$1.5k × 10%", "$153"],
      ["Packaging", "$1.5k × 5%", "$77"],
      ["Shipping Revenue", "$1.5k × 2%", "$31"],
      ["GP2", "$765 − $153 − $77 + $31", "$566"],
      ["GP3", "$566 − $100 Ad Spend", "$466"]
    ]},
    {title:"8. GP1 by Growth Engine", rows:[
      ["Engine Net Sales", "$1k Gross × (1 − 10% Discounts & Returns)", "$900"],
      ["Engine GP1", "$900 Net Sales × 50% GM1", "$450"]
    ]},
    {title:"9. Portfolio Reconciliation Checks", rows:[
      ["Total Portfolio Gross Sales", "Sum all Growth Engine Gross Sales", "Must equal Financial Snapshot Gross Sales"],
      ["Total Portfolio GP1", "Sum all Growth Engine GP1", "Must equal Financial Snapshot GP1"],
      ["% Total Sales", "Sum all engine revenue shares", "100%"],
      ["% Total GP1", "Sum all engine GP1 shares", "100%"],
      ["Ecommerce tie-out", "Ecommerce Revenue Build total", "Must equal Ecommerce row in Portfolio"]
    ]},
    {title:"10. Scenario & Gate Checks", rows:[
      ["Organic Growth defaults", "$0/$500k; $1M/$3M; $5M/$10M", "5%; 10%; 15%"],
      ["Unallocated Capital", "$1k funding − $200 payables − $300 inventory − $100 marketing", "$400"],
      ["Private Label gate", "Funding below required threshold", "Private Label remains inactive"],
      ["Private Label launch timing", "Funding Date + 12 months", "Launch date exactly 12 months later"]
    ]}
  ];
  sections.forEach(sec => {
    const wrap = el("section", {class:"mini-card qa-card"});
    wrap.appendChild(el("h3", {}, sec.title));
    const table = el("table", {class:"grid qa-table"});
    const thead = el("thead", {}, el("tr", {}, ["Test / Formula", "Simple Test Input", "Expected Result", "PASS / FAIL", "Notes"].map(h => el("th", {}, h))));
    const tbody = el("tbody");
    sec.rows.forEach(r => {
      const tr = el("tr");
      tr.appendChild(el("td", {class:"label-cell"}, r[0]));
      tr.appendChild(el("td", {}, r[1]));
      tr.appendChild(el("td", {class:"calc-cell"}, r[2]));
      tr.appendChild(el("td", {}, "☐ PASS   ☐ FAIL"));
      tr.appendChild(el("td", {}, ""));
      tbody.appendChild(tr);
    });
    table.appendChild(thead); table.appendChild(tbody);
    wrap.appendChild(table); root.appendChild(wrap);
  });
  const sourceCard = el("div", { class: "source-status-card" }, [
    el("h3", {}, "Data Source Status"),
    el("p", {}, "Actuals refresh from Shopify sync when data/shopify_actuals.json exists, with Google Sheets used as support data for COGS/GM1, product cost, ads, Smartrr and other tables. GitHub Actions reads Shopify secrets safely and writes a token-free JSON for GitHub Pages. Still needed for full automation: product-cost/COGS pipeline, SKU/Savy inventory turns, Klaviyo/email revenue and QuickBooks/ShipStation operating costs.")
  ]);
  root.appendChild(sourceCard);

  const load = document.getElementById("loadEasyNumbers");
  if (load) load.onclick = loadEasyNumberInputs;
  const restore = document.getElementById("restoreScenarioValues");
  if (restore) restore.onclick = restoreEasyNumberInputs;
}

function loadEasyNumberInputs() {
  const message = [
    "Load Easy Numbers Test assumptions for 2027–2029?",
    "",
    "2026 will NOT be changed. Shopify actuals and the current 2026 forecast remain intact.",
    "All loaded values stay editable in the model."
  ].join("\n");
  if (!confirm(message)) return;
  if (!STATE || !STATE.meta) return;

  // Keep a complete in-browser backup so the user can restore the scenario after QA.
  try {
    localStorage.setItem("strategicModelEasyTestBackup", JSON.stringify(STATE));
  } catch (error) {
    console.warn("Could not save Easy Test backup:", error);
  }

  saveScenarioInputs(STATE.meta.modelStatus || "Draft");
  STATE.meta.modelStatus = "Draft";

  const testYears = ["y2027", "y2028", "y2029"];
  const setYears = (row, values) => {
    if (!row) return;
    testYears.forEach((year, index) => {
      row[year] = Array.isArray(values) ? values[index] : values;
    });
  };

  const market = getBlock(STATE.commercial, "Market Growth");
  if (market) {
    setYears(getRow(market.rows, "Organic Growth %"), "10%");
    setYears(getRow(market.rows, "Dover Market Opportunity (Gross)"), "$1k");
    setYears(getRow(market.rows, "Dover Target Capture %"), "10%");
    setYears(getRow(market.rows, "Dover Target Capture % (Gross)"), "10%");
    setYears(getRow(market.rows, "Paid Ads Overlap %"), "20%");
    if (!market.doverRamp) market.doverRamp = {};
    market.doverRamp.y2027 = "100%";
    market.doverRamp.y2028 = "0%";
    market.doverRamp.y2029 = "0%";
  }

  const retention = getBlock(STATE.commercial, "Retention");
  if (retention) {
    const carryover = getRow(retention.rows, "Incremental Revenue Carryover %");
    if (carryover) {
      carryover.y2027 = "50%";
      carryover.y2028 = "50%";
      carryover.y2029 = "—";
    }
    setYears(getRow(retention.rows, "Purchase Frequency"), ["1.2", "1.2", "1.2"]);
  }

  const acquisition = getBlock(STATE.commercial, "Acquisition");
  if (acquisition) {
    setYears(getRow(acquisition.rows, "ROAS"), "3.0x");
    setYears(getRow(acquisition.rows, "Target Ad Spend % of Ecommerce Gross Sales"), "—");
    const totalAdSpend = getRow(acquisition.rows, "Total Ad Spend");
    if (totalAdSpend) {
      totalAdSpend.y2027 = "$100";
      totalAdSpend.y2028 = "$100";
      totalAdSpend.y2029 = "$100";
    }
    setYears(getRow(acquisition.rows, "New Customer Mix %"), "50%");
    const reinvestment = getRow(acquisition.rows, "2029 Reinvestment %");
    if (reinvestment) reinvestment.y2029 = "20%";
  }

  const ecommerce = getBlock(STATE.growthEngines, "Ecommerce");
  if (ecommerce) {
    setYears(getRow(ecommerce.rows, "Orders"), "10");
    setYears(getRow(ecommerce.rows, "AOV"), "$100");
    setYears(getRow(ecommerce.rows, "GM1 %"), "50%");
  }

  ["Concierge", "Wellington", "Embroidery"].forEach(name => {
    const engine = getBlock(STATE.growthEngines, name);
    if (!engine) return;
    const volumeDriver = name === "Concierge" ? "Active Clients" : "Orders";
    setYears(getRow(engine.rows, volumeDriver), "0");
  });

  const cavali = getBlock(STATE.growthEngines, "Cavali");
  if (cavali) {
    setYears(getRow(cavali.rows, "Signature Active Members"), "0");
    setYears(getRow(cavali.rows, "Premium Active Members"), "0");
  }

  const privateLabel = getBlock(STATE.growthEngines, "Private Label");
  if (privateLabel) setYears(getRow(privateLabel.rows, "Units Sold"), "0");

  setYears(getRow((STATE.purchasing || {}).commercialTerms || [], "Discounts & Returns %"), "10%");
  setYears(getRow(STATE.operations || [], "Outbound Shipping Cost %"), "10%");
  setYears(getRow(STATE.operations || [], "Shipping Revenue %"), "2%");
  setYears(getRow(STATE.operations || [], "Packaging Cost %"), "5%");

  renderAll();
  saveNow();
  alert("Easy Numbers Test loaded for 2027–2029. 2026 Shopify actuals were preserved. All test inputs remain editable.");
}

function restoreEasyNumberInputs() {
  let backup = null;
  try {
    backup = localStorage.getItem("strategicModelEasyTestBackup");
  } catch (error) {
    console.warn("Could not read Easy Test backup:", error);
  }
  if (!backup) {
    alert("No Easy Test backup was found. The current scenario has not been changed.");
    return;
  }
  if (!confirm("Restore the scenario values saved immediately before loading the Easy Test?")) return;
  try {
    STATE = JSON.parse(backup);
    localStorage.removeItem("strategicModelEasyTestBackup");
    renderAll();
    saveNow();
    alert("Scenario values restored successfully.");
  } catch (error) {
    console.error("Could not restore Easy Test backup:", error);
    alert("The saved backup could not be restored.");
  }
}

function parseTriggerAmount(trigger) {
  const t = String(trigger || "").toLowerCase();
  if (t.includes("base")) return 0;
  const m = t.match(/(\d+(?:\.\d+)?)\s*m/);
  if (m) return parseFloat(m[1]) * 1000000;
  const k = t.match(/(\d+(?:\.\d+)?)\s*k/);
  if (k) return parseFloat(k[1]) * 1000;
  return 0;
}

function statusForTrigger(trigger) {
  const needed = parseTriggerAmount(trigger);
  const active = fundingAmountSelected() >= needed;
  return { text: active ? "ACTIVE ✓" : "LOCKED 🔒", cls: active ? "active" : "locked" };
}

function renderGrowth() {
  const table = document.getElementById("growthTable");
  table.innerHTML = `<thead><tr><th>Initiative</th><th>Owner</th><th>Funding Trigger</th><th>Status</th><th>Launch Date</th><th>Investment</th></tr></thead>`;
  const tbody = el("tbody");
  STATE.growthInitiatives.forEach(row => {
    const tr = el("tr");
    ["initiative", "owner", "trigger"].forEach(k => tr.appendChild(makeEditableCell(row, k, () => { renderGrowth(); scheduleSave(); })));
    const st = statusForTrigger(row.trigger);
    tr.appendChild(el("td", { class: "calc-cell" }, el("span", { class: `status-pill ${st.cls} inline` }, st.text)));
    ["launch", "investment"].forEach(k => tr.appendChild(makeEditableCell(row, k, () => scheduleSave())));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
}

function addGrowthRow() {
  STATE.growthInitiatives.push({ initiative: "", owner: "", trigger: "", status: "", launch: "", investment: "" });
  renderGrowth();
  scheduleSave();
}

function renderThesis() {
  const wrap = document.getElementById("thesisGrid");
  wrap.innerHTML = "";
  const dynamic = (STATE.thesis || []).map(t => {
    if (t.label === "Base Ecommerce") return { ...t, value: STATE.meta.baseEcommerceMonthly || "$70k" };
    if (t.label === "Dover Capture") return { ...t, value: STATE.meta.doverCapture };
    return t;
  });
  dynamic.forEach(t => wrap.appendChild(el("div", { class: "thesis-card target-card" }, [
    el("div", { class: "thesis-label" }, t.label),
    el("div", { class: "thesis-value" }, t.value || "—"),
    el("div", { class: "thesis-target" }, t.sub || t.target || ""),
  ])));
}



/* ---------------- Tab 03 Financial Summary + Tab 04 Commercial Cash Flow ---------------- */
function pnlOpexForYear(yearKey, bridge) {
  const months = 12;
  const payroll = 40000 * months;
  const ga = 45000 * months;
  // Advertising is already deducted in GP3. S&M below GP3 is a separate,
  // nearly-flat branding/people OPEX assumption agreed in review.
  const smDefaults = { y2026: 210000, y2027: 300000, y2028: 300000, y2029: 300000 };
  const configured = STATE?.financialAssumptions?.salesMarketingOpexByYear?.[yearKey];
  const sm = parseMoney(configured || smDefaults[yearKey] || 300000);
  const tech = parseMoney(STATE?.financialAssumptions?.otherOperatingExpensesByYear?.[yearKey] || 0);
  return { payroll, ga, sm, tech, total: payroll + ga + sm + tech };
}

function ordersForYear(yearKey) {
  const ecommerce = getBlock(STATE.growthEngines, "Ecommerce");
  return parseNumber(val(ecommerce ? ecommerce.rows : [], "Orders", yearKey));
}

function newCustomersForYear(yearKey) {
  const acq = getBlock(STATE.commercial, "Acquisition");
  const mix = parsePercent(val(acq ? acq.rows : [], "New Customer Mix %", yearKey));
  return ordersForYear(yearKey) * (mix || 0);
}

function checkoutAbandonmentRateForYear(yearKey) {
  const candidates = [
    STATE?.actuals?.checkoutAbandonmentRate,
    STATE?.actuals?.shopifySync?.checkoutAbandonmentRate,
    STATE?.actuals?.latestKpis?.checkoutAbandonmentRate,
    STATE?.operatingKpis?.checkoutAbandonmentRate,
    STATE?.financialAssumptions?.checkoutAbandonmentRate
  ];
  for (const candidate of candidates) {
    const value = typeof candidate === "object" && candidate !== null ? candidate[yearKey] : candidate;
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      const parsed = parsePercent(value);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
  }
  return null;
}

function renderFinancialSummary() {
  const kpiWrap = document.getElementById("tab3KpiGrid");
  const table = document.getElementById("tab3PnlTable");
  const opsWrap = document.getElementById("tab3OperatingKpis");
  if (!kpiWrap || !table || !opsWrap) return;
  const years = yearKeys();
  const year = displayYearKey();
  const period = forecastPeriod();
  const bridges = Object.fromEntries(years.map(y => [y, marginBridge(y)]));
  const b = bridges[year];
  const o = pnlOpexForYear(year, b);
  const ebitda = b.gp3 - o.total;
  kpiWrap.innerHTML = "";
  [
    { label: "Gross Sales", value: formatFinancialMoney(b.grossSales, {dashZero:true}), sub: period },
    { label: "Net Sales", value: formatFinancialMoney(b.netSales, {dashZero:true}), sub: forecastPeriod("After Discounts") },
    { label: "GP1", value: formatFinancialMoney(b.gp1, {dashZero:true}), sub: forecastPeriod(b.gp1 ? `${formatPercent(b.netSales ? b.gp1 / b.netSales : 0)} of Net Sales` : "After COGS") },
    { label: "GP2", value: formatFinancialMoney(b.gp2, {dashZero:true}), sub: forecastPeriod(b.gp2 ? `${formatPercent(b.netSales ? b.gp2 / b.netSales : 0)} of Net Sales` : "After Fulfillment") },
    { label: "GP3", value: formatFinancialMoney(b.gp3, {dashZero:true}), sub: forecastPeriod(b.gp3 ? `${formatPercent(b.netSales ? b.gp3 / b.netSales : 0)} of Net Sales` : "After Advertising") },
    { label: "EBITDA", value: formatFinancialMoney(ebitda, {dashZero:true}), sub: forecastPeriod("After Operating Expenses") }
  ].forEach(card => kpiWrap.appendChild(el("div", { class: "kpi-card" }, [
    el("div", { class: "kpi-label" }, card.label), el("div", { class: "kpi-value " + moneyClass(card.value, "") }, card.value), el("div", { class: "kpi-sub" }, card.sub)
  ])));

  table.innerHTML = `<thead><tr><th>Commercial P&L</th>${years.map(y => `<th>${yearLabel(y)}</th>`).join("")}</tr></thead>`;
  const tbody = el("tbody");
  const rows = [
    ["Gross Sales", y => bridges[y].grossSales],
    ["Discounts & Returns", y => -bridges[y].discountsReturns],
    ["Net Sales", y => bridges[y].netSales, true],
    ["COGS", y => -(bridges[y].netSales - bridges[y].gp1)],
    ["GP1", y => bridges[y].gp1, true],
    ["Outbound Shipping", y => -bridges[y].outboundShipping],
    ["Packaging", y => -bridges[y].packaging],
    ["Shipping Revenue", y => bridges[y].shippingRevenue],
    ["GP2", y => bridges[y].gp2, true],
    ["Advertising", y => -bridges[y].adSpend],
    ["GP3", y => bridges[y].gp3, true],
    ["Sales & Marketing (S&M)", y => -pnlOpexForYear(y, bridges[y]).sm],
    ["General & Administrative (G&A)", y => -(pnlOpexForYear(y, bridges[y]).payroll + pnlOpexForYear(y, bridges[y]).ga)],
    ["Other Operating Expenses", y => -pnlOpexForYear(y, bridges[y]).tech, false, "money-zero"],
    ["EBITDA", y => bridges[y].gp3 - pnlOpexForYear(y, bridges[y]).total, true],
    ["EBITDA %", y => { const e = bridges[y].gp3 - pnlOpexForYear(y, bridges[y]).total; return bridges[y].netSales ? e / bridges[y].netSales : 0; }, true, "pct"]
  ];
  rows.forEach(([label, fn, bold, type]) => {
    const tr = el("tr", { class: bold ? "important-row" : "" });
    tr.appendChild(el("td", { class: "label-cell" + (bold ? " total-row-label" : "") }, label));
    years.forEach(y => tr.appendChild(makeCalcCell(type === "pct" ? formatPercent(fn(y)) : formatFinancialMoney(fn(y), {dashZero:type !== "money-zero"}))));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  opsWrap.innerHTML = "";
  [
    { label: "Orders", value: Math.round(ordersForYear(year) || 0).toLocaleString("en-US"), sub: forecastPeriod("Ecommerce") },
    { label: "New Customers", value: Math.round(newCustomersForYear(year) || 0).toLocaleString("en-US"), sub: forecastPeriod("Unique new customers") },
    { label: "ROAS", value: `${roasForYear(year).toFixed(1)}x`, sub: forecastPeriod("Scenario assumption") },
    { label: "Ad Spend", value: formatFinancialMoney(totalAdSpendByYear(year), {dashZero:true}), sub: forecastPeriod("Advertising") },
    { label: "Net / Gross Ratio", value: formatPercent(b.grossSales ? b.netSales / b.grossSales : 0), sub: forecastPeriod("Net Sales / Gross Sales") },
    { label: "Annual GP per Customer", value: computedCommercialValue({ driver: "Annual GP per Customer" }, year) || "—", sub: forecastPeriod("AOV × Purchase Frequency × GM1") }
  ].forEach(card => opsWrap.appendChild(el("div", { class: "kpi-card" }, [
    el("div", { class: "kpi-label" }, card.label), el("div", { class: "kpi-value " + moneyClass(card.value, "") }, card.value), el("div", { class: "kpi-sub" }, card.sub)
  ])));
}

function cashFlowRows(yearKey) {
  const outputs = engineOutputs(yearKey);
  const fundingRow = selectedFundingRow();
  const fundingDateObj = selectedFundingDate();
  const fundingYear = fundingDateObj ? `y${fundingDateObj.year}` : "y2026";
  const funding = yearKey === fundingYear ? fundingAmountSelected() : 0;
  const ecommerce = (outputs.find(x => x.engine === "Ecommerce") || {}).gross || 0;
  const concierge = (outputs.find(x => x.engine === "Concierge") || {}).gross || 0;
  const wellington = (outputs.find(x => x.engine === "Wellington") || {}).gross || 0;
  const embroidery = (outputs.find(x => x.engine === "Embroidery") || {}).gross || 0;
  const privateLabelRevenue = (outputs.find(x => x.engine === "Private Label") || {}).gross || 0;
  const cavali = (outputs.find(x => x.engine === "Cavali") || {}).gross || 0;
  const cashIn = {
    "Shopify Deposits Corro": ecommerce + concierge + wellington + embroidery + privateLabelRevenue,
    "Shopify Deposits Cavali": cavali,
    "Funding": funding,
    "Other Cash Receipts": 0
  };
  const b = marginBridge(yearKey);
  const o = pnlOpexForYear(yearKey, b);
  const recurrentInventory = yearKey === fundingYear ? parseMoney(fundingRow.inventory) : 0;
  const advertising = b.adSpend;
  const shipping = b.outboundShipping + b.packaging;
  const sm = o.sm;
  const ga = o.payroll + o.ga;
  const otherOperating = o.tech;
  const operatingCashOut = recurrentInventory + advertising + shipping + sm + ga + otherOperating;
  const cashOut = {
    "Operating Cash Out": operatingCashOut,
    "Inventory": recurrentInventory,
    "Shipping & Fulfillment": shipping,
    "Advertising": advertising,
    "Sales & Marketing (S&M)": sm,
    "General & Administrative (G&A)": ga,
    "Other Operating Expenses": otherOperating,
    "Growth Investments": yearKey === fundingYear ? parseMoney(fundingRow.privateLabel) : 0,
    "CapEx": yearKey === fundingYear ? parseMoney(fundingRow.embroidery) : 0,
    "Other Cash Out": 0
  };
  return { cashIn, cashOut, operatingCashOut };
}

function renderCashTable(id, title, rowsByYear, sign = 1) {
  const table = document.getElementById(id);
  if (!table) return;
  const years = yearKeys();
  table.innerHTML = `<thead><tr><th>${title}</th>${years.map(y => `<th>${yearLabel(y)}</th>`).join("")}</tr></thead>`;
  const tbody = el("tbody");
  const rowNames = Object.keys(rowsByYear.y2026 || {});
  rowNames.forEach(name => {
    const isSubtotal = name === "Operating Cash Out";
    const tr = el("tr", { class: isSubtotal ? "important-row" : "" });
    tr.appendChild(el("td", { class: "label-cell" + (isSubtotal ? " total-row-label" : "") }, name));
    years.forEach(y => tr.appendChild(makeCalcCell(formatFinancialMoney((rowsByYear[y][name] || 0) * sign, {dashZero:true}))));
    tbody.appendChild(tr);
  });
  const total = el("tr", { class: "important-row" });
  total.appendChild(el("td", { class: "label-cell total-row-label" }, title.startsWith("Cash In") ? "TOTAL CASH IN" : "TOTAL CASH OUT"));
  years.forEach(y => {
    let totalValue;
    if (title.startsWith("Cash Out")) {
      const r = rowsByYear[y];
      totalValue = (r["Operating Cash Out"] || 0) + (r["Growth Investments"] || 0) + (r["CapEx"] || 0) + (r["Other Cash Out"] || 0);
    } else {
      totalValue = Object.values(rowsByYear[y]).reduce((s, v) => s + Number(v || 0), 0);
    }
    total.appendChild(makeCalcCell(formatFinancialMoney(totalValue * sign, {dashZero:true})));
  });
  tbody.appendChild(total);
  table.appendChild(tbody);
}

function openingCashForYear(yearKey, totalsSoFar = {}) {
  if (!STATE.cashFlow) STATE.cashFlow = {};
  const configured = STATE.cashFlow.openingCashByYear || {};
  if (yearKey === "y2026") {
    return parseMoney(configured.y2026 || STATE.cashFlow.openingCash || "$100k");
  }
  const years = yearKeys();
  const index = years.indexOf(yearKey);
  const priorYear = index > 0 ? years[index - 1] : null;
  if (priorYear && totalsSoFar[priorYear]) return totalsSoFar[priorYear].ending;
  return parseMoney(configured[yearKey] || 0);
}

function renderCommercialCashFlow() {
  const kpis = document.getElementById("tab4CashKpis");
  const netTable = document.getElementById("tab4NetCashTable");
  if (!kpis || !netTable) return;
  const years = yearKeys();
  const flow = Object.fromEntries(years.map(y => [y, cashFlowRows(y)]));
  const cashInRows = Object.fromEntries(years.map(y => [y, flow[y].cashIn]));
  const cashOutRows = Object.fromEntries(years.map(y => [y, flow[y].cashOut]));
  renderCashTable("tab4CashInTable", "Cash In", cashInRows, 1);
  renderCashTable("tab4CashOutTable", "Cash Out", cashOutRows, -1);
  const totals = {};
  years.forEach(y => {
    const opening = openingCashForYear(y, totals);
    const cashIn = Object.values(cashInRows[y]).reduce((sum, value) => sum + Number(value || 0), 0);
    const cashOut = (cashOutRows[y]["Operating Cash Out"] || 0) + (cashOutRows[y]["Growth Investments"] || 0) + (cashOutRows[y]["CapEx"] || 0) + (cashOutRows[y]["Other Cash Out"] || 0);
    const net = cashIn - cashOut;
    totals[y] = { opening, cashIn, cashOut, cashOutExCapex: cashOut - (cashOutRows[y]["CapEx"] || 0), net, ending: opening + net };
  });
  const year = displayYearKey();
  const yearText = displayYearLabel();
  const selected = totals[year];
  const opening = selected.opening;
  const cashCoverage = selected.cashOut ? `${Math.max(0, (selected.ending / (selected.cashOut / 12))).toFixed(1)} mo` : "—";
  const minimumBuffer = Number((STATE.cashFlow && STATE.cashFlow.minimumCashBuffer) || 0);
  const capex = flow[year].cashOut["CapEx"] || 0;
  const endingDelta = selected.ending - opening;
  const endingDeltaPct = opening ? endingDelta / opening : 0;
  const lastUpdated = (STATE.meta && STATE.meta.lastUpdated) || new Date().toISOString().slice(0, 10);
  const cashRows = [
    { label: "Opening Cash", value: opening, icon: "wallet", tone: "neutral" },
    { label: "Cash In", value: selected.cashIn, icon: "in", tone: "positive" },
    { label: "Funding", value: flow[year].cashIn["Funding"] || 0, icon: "bank", tone: "positive" },
    { label: "Operating Cash Out", value: -selected.cashOutExCapex, icon: "out", tone: "negative" },
    { label: "CapEx", value: -capex, icon: "capex", tone: capex ? "negative" : "zero" }
  ];
  const iconMarkup = {
    wallet: "▣",
    in: "↓",
    bank: "▥",
    out: "↑",
    capex: "▤"
  };
  kpis.innerHTML = "";
  const card = el("div", { class: "cash-ui-card compact" }, [
    el("div", { class: "cash-ui-head" }, [
      el("div", { class: "cash-title-wrap" }, [
        el("div", { class: "cash-accent" }),
        el("div", {}, [
          el("h3", { class: "cash-title" }, "Cash Summary"),
          el("p", { class: "cash-subtitle" }, `Commercial Cash Flow · Forecast ${yearText}`)
        ])
      ]),
      el("div", { class: "cash-updated" }, `Updated ${lastUpdated}`)
    ]),
    el("div", { class: "cash-ui-body compact-grid" }, [
      el("div", { class: "cash-lines" }, cashRows.map(row => {
        const display = formatFinancialMoney(row.value, { dashZero: row.label !== "Opening Cash" });
        return el("div", { class: `cash-line ${row.tone}` }, [
          el("div", { class: `cash-line-icon ${row.tone}` }, iconMarkup[row.icon] || "•"),
          el("div", { class: "cash-line-label" }, row.label),
          el("div", { class: moneyClass(display, "cash-line-value") }, display)
        ]);
      })),
      el("div", { class: "cash-hero compact" }, [
        el("div", { class: "cash-hero-top" }, [
          el("div", { class: "cash-hero-icon" }, "↗"),
          el("div", {}, [
            el("div", { class: "cash-hero-label" }, "Ending Cash"),
            el("div", { class: moneyClass(formatFinancialMoney(selected.ending, {dashZero:true}), "cash-hero-value") }, formatFinancialMoney(selected.ending, {dashZero:true}))
          ])
        ]),
        el("div", { class: "cash-hero-divider" }),
        el("div", { class: "cash-hero-meta" }, [
          el("span", { class: endingDelta < 0 ? "negative-value" : "positive-value" }, `vs Opening ${formatFinancialMoney(endingDelta, {dashZero:true})}`),
          el("span", { class: "cash-hero-pct" }, opening ? `(${formatPercent(endingDeltaPct)})` : "")
        ]),
        el("div", { class: "cash-mini-grid" }, [
          el("div", { class: "cash-mini-pill" }, [el("span", {}, "Cash In"), el("strong", {}, formatFinancialMoney(selected.cashIn, {dashZero:true}))]),
          el("div", { class: "cash-mini-pill negative" }, [el("span", {}, "Cash Out"), el("strong", {}, formatFinancialMoney(-selected.cashOutExCapex, {dashZero:true}))]),
          el("div", { class: "cash-mini-pill" }, [el("span", {}, "Funding"), el("strong", {}, formatFinancialMoney(flow[year].cashIn["Funding"] || 0, {dashZero:true}))]),
          el("div", { class: "cash-mini-pill" }, [el("span", {}, "Coverage"), el("strong", {}, cashCoverage)])
        ]),
        el("div", { class: "cash-pattern" })
      ])
    ]),
    el("div", { class: "cash-ui-footer" }, [
      el("span", {}, "All figures are in USD"),
      el("span", { class: "cash-footer-sep" }, ""),
      el("span", {}, `Cash Coverage: ${cashCoverage}`),
      el("span", { class: "cash-footer-sep" }, ""),
      el("span", {}, `Minimum Buffer: ${formatFinancialMoney(minimumBuffer, {dashZero:true})}`)
    ])
  ]);
  kpis.appendChild(card);
  const openingValue = kpis.querySelector(".cash-line.neutral .cash-line-value");
  if (openingValue && year === "y2026") {
    openingValue.title = "Click to edit 2026 opening cash";
    openingValue.classList.add("editable-cash-value");
    openingValue.addEventListener("click", () => {
      const current = (STATE.cashFlow && (STATE.cashFlow.openingCashByYear?.y2026 || STATE.cashFlow.openingCash)) || "$100k";
      const next = prompt("Enter 2026 opening cash:", current);
      if (next === null || !String(next).trim()) return;
      if (!STATE.cashFlow) STATE.cashFlow = {};
      if (!STATE.cashFlow.openingCashByYear) STATE.cashFlow.openingCashByYear = {};
      STATE.cashFlow.openingCashByYear.y2026 = String(next).trim();
      STATE.cashFlow.openingCash = String(next).trim();
      renderCommercialCashFlow();
      scheduleSave();
    });
  }
  netTable.innerHTML = `<thead><tr><th>Net Cash Flow</th>${years.map(y => `<th>${yearLabel(y)}</th>`).join("")}</tr></thead>`;
  const tbody = el("tbody");
  [
    ["OPENING CASH", y => totals[y].opening],
    ["TOTAL CASH IN", y => totals[y].cashIn],
    ["TOTAL CASH OUT", y => -totals[y].cashOut],
    ["NET CASH FLOW", y => totals[y].net],
    ["ENDING CASH", y => totals[y].ending]
  ].forEach(([label, fn]) => {
    const tr = el("tr");
    tr.appendChild(el("td", { class: "label-cell total-row-label" }, label));
    years.forEach(y => tr.appendChild(makeCalcCell(formatFinancialMoney(fn(y), {dashZero:true}))));
    tbody.appendChild(tr);
  });
  netTable.appendChild(tbody);
}

function initTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  buttons.forEach(btn => btn.addEventListener("click", () => {
    buttons.forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  }));
}


/* ---------------- External actuals from Google Sheets ---------------- */
function sheetCsvUrl(source) {
  if (!source || !source.spreadsheetId) return null;
  const base = `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/gviz/tq?tqx=out:csv`;
  if (source.gid) return `${base}&gid=${encodeURIComponent(source.gid)}`;
  if (source.sheet) return `${base}&sheet=${encodeURIComponent(source.sheet)}`;
  return null;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') { cell += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      row.push(cell); cell = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(v => String(v).trim() !== "")) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some(v => String(v).trim() !== "")) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || "").trim());
  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (r[i] ?? "").trim(); });
    return obj;
  });
}

async function fetchSheetRows(source) {
  const url = sheetCsvUrl(source);
  if (!url) throw new Error("Missing sheet source");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${source.label || source.sheet || "Sheet"}: HTTP ${res.status}`);
  return parseCsv(await res.text());
}

async function fetchOptionalSheetRows(source, sheetName, label) {
  try {
    return await fetchSheetRows({ ...source, gid: "", sheet: sheetName, label });
  } catch (err) {
    console.warn(`Optional sheet not loaded: ${label || sheetName}`, err);
    return [];
  }
}

async function fetchDashboardBundle(source, brand) {
  const tabs = source.tabs || {};
  const base = { spreadsheetId: source.spreadsheetId };
  const [kpis, revenueShare, newVsReturning, adSpend, smartrrProductVolume, productsQ1] = await Promise.all([
    fetchOptionalSheetRows(base, tabs.kpis || source.sheet || "kpis_daily", `${brand} kpis_daily`),
    fetchOptionalSheetRows(base, tabs.revenueShare || "revenue_share", `${brand} revenue_share`),
    fetchOptionalSheetRows(base, tabs.newVsReturning || "new_vs_returning", `${brand} new_vs_returning`),
    fetchOptionalSheetRows(base, tabs.adSpend || "ad_spend", `${brand} ad_spend`),
    brand === "cavali" ? fetchOptionalSheetRows(base, tabs.smartrrProductVolume || "smartrr_product_volume", `${brand} smartrr_product_volume`) : Promise.resolve([]),
    fetchOptionalSheetRows(base, tabs.products || "products_q1_2026", `${brand} products_q1_2026`)
  ]);
  return { kpis, revenueShare, newVsReturning, adSpend, smartrrProductVolume, productsQ1 };
}

function monthlyRows(rows) {
  return (rows || []).filter(r => /^\d{4}-\d{2}$/.test(String(r.period || "")));
}

function latestYearAndMonth(rows) {
  const periods = monthlyRows(rows).map(r => String(r.period));
  if (!periods.length) return null;
  periods.sort();
  const latest = periods[periods.length - 1];
  const [year, month] = latest.split("-").map(Number);
  return { year, month };
}


function effectiveThroughMonth(latest) {
  if (!latest) return 0;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  // Do not annualize from an incomplete current month. Use the latest closed month.
  if (latest.year === currentYear && latest.month >= currentMonth) return Math.max(1, currentMonth - 1);
  return latest.month;
}

function rowsForYtd(rows, year, throughMonth) {
  return monthlyRows(rows).filter(r => {
    const [y, m] = String(r.period).split("-").map(Number);
    return y === year && m <= throughMonth;
  });
}

function sumField(rows, field) {
  return (rows || []).reduce((s, r) => s + parseNumber(r[field]), 0);
}

function weightedAov(rows) {
  const orders = sumField(rows, "nb_orders");
  const gross = sumField(rows, "gross_sales");
  return orders ? gross / orders : 0;
}

function weightedGm1(rows) {
  const net = sumField(rows, "net_sales");
  const gp = sumField(rows, "gross_profit");
  return net ? gp / net : 0;
}

function dashboardActuals(rows) {
  const latest = latestYearAndMonth(rows);
  if (!latest) return null;
  const throughMonth = effectiveThroughMonth(latest);
  const ytd = rowsForYtd(rows, latest.year, throughMonth);
  const prevYtd = rowsForYtd(rows, latest.year - 1, throughMonth);
  const gross = sumField(ytd, "gross_sales");
  const prevGross = sumField(prevYtd, "gross_sales");
  const orders = sumField(ytd, "nb_orders");
  const customers = sumField(ytd, "new_customers") + sumField(ytd, "returning_customers");
  const returning = sumField(ytd, "returning_customers");
  const discountsReturns = sumField(ytd, "total_discounts") + sumField(ytd, "total_returns");
  return {
    latest,
    periodLabel: `${latest.year} YTD through ${String(throughMonth).padStart(2, "0")}`,
    grossSales: gross,
    netSales: sumField(ytd, "net_sales"),
    grossProfit: sumField(ytd, "gross_profit"),
    organicGrowth: prevGross ? (gross / prevGross) - 1 : 0,
    discountReturnsPct: gross ? discountsReturns / gross : 0,
    orders,
    aov: weightedAov(ytd),
    gm1: weightedGm1(ytd),
    returningCustomerPct: customers ? returning / customers : 0,
    purchaseFrequency: customers ? orders / customers : 0,
    newCustomerPct: customers ? sumField(ytd, "new_customers") / customers : 0,
    newCustomers: sumField(ytd, "new_customers"),
    returningRevenue: sumField(ytd, "returning_revenue"),
    totalCustomerRevenue: sumField(ytd, "new_revenue") + sumField(ytd, "returning_revenue"),
    throughMonth
  };
}

function adSpendActuals(rows, kpiActuals) {
  if (!rows || !rows.length || !kpiActuals || !kpiActuals.latest) return null;
  const throughMonth = effectiveThroughMonth(kpiActuals.latest);
  const ytd = rowsForYtd(rows, kpiActuals.latest.year, throughMonth);
  const spend = sumField(ytd, "ad_spend") || sumField(ytd, "spend");
  const purchases = sumField(ytd, "purchases");
  const weightedRoasNumerator = (ytd || []).reduce((sum, row) => {
    const rowSpend = parseNumber(row.ad_spend || row.spend);
    return sum + rowSpend * parseNumber(row.roas);
  }, 0);
  const roas = spend ? (weightedRoasNumerator ? weightedRoasNumerator / spend : kpiActuals.grossSales / spend) : 0;
  const cos = kpiActuals.grossSales ? spend / kpiActuals.grossSales : 0;
  // Marketing Stats defines CAC as Spend / Purchases. If Purchases is not
  // available, use new customers as a clearly identified fallback.
  const denominator = purchases || kpiActuals.newCustomers || 0;
  const cac = denominator ? spend / denominator : 0;
  return { spend, roas, cos, cac, purchases, cacSource: purchases ? "Spend / Purchases" : "Spend / New Customers (fallback)" };
}

function channelRevenueYtd(rows, channel, latest) {
  if (!rows || !rows.length || !latest) return 0;
  const throughMonth = effectiveThroughMonth(latest);
  const ytd = rowsForYtd(rows, latest.year, throughMonth);
  return ytd
    .filter(r => String(r.channel || "").toLowerCase().includes(String(channel).toLowerCase()))
    .reduce((s, r) => s + parseNumber(r.amount), 0);
}

function normalizeProductKey(product) {
  const raw = String(product || "").toLowerCase();
  if (raw.includes("signature")) return "signature";
  if (raw.includes("premier") || raw.includes("premium")) return "premium";
  return raw.replace(/[^a-z0-9]+/g, "");
}

function latestRowsByPeriodStart(rows) {
  if (!rows || !rows.length) return [];
  const valid = rows.filter(r => r.period_start || r.period);
  if (!valid.length) return rows;
  const periods = valid.map(r => `${r.period_start || ""}|${r.period || ""}`).sort();
  const latestKey = periods[periods.length - 1];
  const [latestStart, latestPeriod] = latestKey.split("|");
  return valid.filter(r => String(r.period_start || "") === latestStart && String(r.period || "") === latestPeriod);
}

function smartrrMembershipActuals(rows) {
  const latestRows = latestRowsByPeriodStart(rows);
  const out = { signatureActive: 0, premiumActive: 0, signatureNew: 0, premiumNew: 0, legacyMembershipActive: 0 };
  const migrationEffective = new Date() >= new Date("2026-08-01T00:00:00Z");
  latestRows.forEach(r => {
    // smartrr_subscribers aggregate row support
    const aggregateSignature = parseNumber(r.signature);
    const aggregatePremium = parseNumber(r.premier || r.premium);
    if (aggregateSignature || aggregatePremium) {
      out.signatureActive += aggregateSignature;
      out.premiumActive += aggregatePremium;
      return;
    }
    const label = String(r.product_variant || r.product || r.plan_name || "");
    const key = normalizeProductKey(label);
    const active = parseNumber(r.active_subscribers_current);
    const newer = parseNumber(r.new_subscribers);
    if (key === "signature") {
      out.signatureActive += active;
      out.signatureNew += newer;
    } else if (key === "premium") {
      out.premiumActive += active;
      out.premiumNew += newer;
    } else if (/membership/i.test(label)) {
      out.legacyMembershipActive += active;
      if (migrationEffective) { out.signatureActive += active; out.signatureNew += newer; }
    }
  });
  return out;
}


function firstPresent(row, names) {
  const keys = Object.keys(row || {});
  for (const wanted of names) {
    const exact = keys.find(k => k.toLowerCase() === wanted.toLowerCase());
    if (exact && row[exact] !== "") return row[exact];
  }
  for (const wanted of names) {
    const partial = keys.find(k => k.toLowerCase().replace(/[^a-z0-9]/g, "").includes(wanted.toLowerCase().replace(/[^a-z0-9]/g, "")));
    if (partial && row[partial] !== "") return row[partial];
  }
  return "";
}

function parsePctOrDecimal(v) {
  const raw = String(v || "").trim();
  if (!raw) return null;
  const n = parseNumber(raw);
  if (!Number.isFinite(n)) return null;
  if (raw.includes("%")) return n / 100;
  return Math.abs(n) > 3 ? n / 100 : n;
}

function weightedMarkupActuals(productRowsList) {
  const rows = (productRowsList || []).flat().filter(Boolean);
  let numerator = 0;
  let denominator = 0;
  rows.forEach(r => {
    const explicitMarkup = parsePctOrDecimal(firstPresent(r, ["markup_pct", "pct_markup", "markup %", "markup", "margin_markup"]));
    const cost = parseNumber(firstPresent(r, ["cost", "unit_cost", "cost_per_item", "product_cost", "variant_cost", "cogs", "cost_of_goods_sold"]));
    const price = parseNumber(firstPresent(r, ["price", "selling_price", "average_selling_price", "avg_price", "retail_price", "unit_price", "aov"]));
    let weight = parseNumber(firstPresent(r, ["units_sold", "nb_units", "quantity", "qty", "total_quantity", "orders", "inventory_quantity", "variant_inventory_qty"]));
    if (!weight || weight < 0) weight = 1;

    let markup = explicitMarkup;
    if (markup === null && cost > 0 && price > 0) markup = (price - cost) / cost;
    if (markup === null || !Number.isFinite(markup)) return;

    numerator += markup * weight;
    denominator += weight;
  });
  return denominator ? numerator / denominator : null;
}

function weightedInventoryTurnsActuals(productRowsList) {
  const rows = (productRowsList || []).flat().filter(Boolean);
  let numerator = 0;
  let denominator = 0;
  rows.forEach(r => {
    const explicit = parsePctOrDecimal(firstPresent(r, ["inventory_turns", "inventory turns", "turns", "inventory_turnover", "inventory turnover"]));
    let weight = parseNumber(firstPresent(r, ["cogs", "cost_of_goods_sold", "gross_sales", "net_sales", "units_sold", "nb_units", "quantity", "qty"]));
    if (!weight || weight < 0) weight = 1;
    if (explicit !== null && Number.isFinite(explicit)) { numerator += explicit * weight; denominator += weight; }
  });
  return denominator ? numerator / denominator : null;
}

function setCurrentInRows(rows, driver, value) {
  const row = getRow(rows, driver);
  if (row && Object.keys(row).length) row.current = value;
}

function annualizeYtd(value, throughMonth) {
  const months = Math.max(1, Number(throughMonth || 0));
  return Number(value || 0) * 12 / months;
}

function seed2026ForecastsOnce({ corro, cavali, ecommerceMetrics, conciergeMetrics, wellingtonMetrics, cavaliMembers }) {
  STATE.meta = STATE.meta || {};
  if (STATE.meta.actualForecastSeedVersion === 3) return;
  const ecommerce = getBlock(STATE.growthEngines, "Ecommerce");
  const concierge = getBlock(STATE.growthEngines, "Concierge");
  const wellington = getBlock(STATE.growthEngines, "Wellington");
  const cavaliEngine = getBlock(STATE.growthEngines, "Cavali");

  if (corro && ecommerce) {
    setYearInRows(ecommerce.rows, "Orders", "y2026", Math.round(annualizeYtd(ecommerceMetrics.orders || corro.orders, corro.throughMonth)).toLocaleString("en-US"));
    setYearInRows(ecommerce.rows, "AOV", "y2026", formatMoney(ecommerceMetrics.aov || corro.aov));
    setYearInRows(ecommerce.rows, "GM1 %", "y2026", formatPercent(ecommerceMetrics.gm1 || corro.gm1));
  }
  if (corro && concierge) {
    const annualClients = annualizeYtd(conciergeMetrics.customers || 0, corro.throughMonth);
    const opc = conciergeMetrics.customers ? conciergeMetrics.orders / conciergeMetrics.customers : 0;
    setYearInRows(concierge.rows, "Active Clients", "y2026", Math.round(annualClients).toLocaleString("en-US"));
    setYearInRows(concierge.rows, "Orders per Client", "y2026", opc ? opc.toFixed(2) : "0");
    setYearInRows(concierge.rows, "AOV", "y2026", formatMoney(conciergeMetrics.aov || 0));
    setYearInRows(concierge.rows, "GM1 %", "y2026", formatPercent(conciergeMetrics.gm1 || 0));
  }
  if (corro && wellington) {
    setYearInRows(wellington.rows, "Orders", "y2026", Math.round(annualizeYtd(wellingtonMetrics.orders || 0, corro.throughMonth)).toLocaleString("en-US"));
    setYearInRows(wellington.rows, "AOV", "y2026", formatMoney(wellingtonMetrics.aov || 0));
    setYearInRows(wellington.rows, "GM1 %", "y2026", formatPercent(wellingtonMetrics.gm1 || 0));
  }
  if (cavali && cavaliEngine) {
    setYearInRows(cavaliEngine.rows, "Orders", "y2026", Math.round(annualizeYtd(cavali.orders, cavali.throughMonth)).toLocaleString("en-US"));
    setYearInRows(cavaliEngine.rows, "GM1 %", "y2026", formatPercent(cavali.gm1 || 0));
    if (cavaliMembers.signatureActive) setYearInRows(cavaliEngine.rows, "Signature Active Members", "y2026", Math.round(cavaliMembers.signatureActive).toLocaleString("en-US"));
    if (cavaliMembers.premiumActive) setYearInRows(cavaliEngine.rows, "Premium Active Members", "y2026", Math.round(cavaliMembers.premiumActive).toLocaleString("en-US"));
  }
  STATE.meta.actualForecastSeedVersion = 3;
}

function applyActualsToState(corroBundle, cavaliBundle) {
  const corro = dashboardActuals(corroBundle.kpis);
  const cavali = dashboardActuals(cavaliBundle.kpis);
  const corroAds = adSpendActuals(corroBundle.adSpend, corro);
  const cavaliAds = adSpendActuals(cavaliBundle.adSpend, cavali);
  const cavaliMembers = smartrrMembershipActuals((cavaliBundle.smartrrProductVolume || []).length ? cavaliBundle.smartrrProductVolume : (cavaliBundle.smartrrSubscribers || []));

  if (!STATE.actuals) STATE.actuals = {};
  STATE.actuals.lastRefresh = new Date().toISOString();
  STATE.actuals.corroPeriod = corro ? corro.periodLabel : "No monthly rows found";
  STATE.actuals.cavaliPeriod = cavali ? cavali.periodLabel : "No monthly rows found";
  STATE.actuals.sources = {
    corro: {
      kpis_daily: (corroBundle.kpis || []).length,
      revenue_share: (corroBundle.revenueShare || []).length,
      new_vs_returning: (corroBundle.newVsReturning || []).length,
      ad_spend: (corroBundle.adSpend || []).length,
      products_q1_2026: (corroBundle.productsQ1 || []).length
    },
    cavali: {
      kpis_daily: (cavaliBundle.kpis || []).length,
      revenue_share: (cavaliBundle.revenueShare || []).length,
      new_vs_returning: (cavaliBundle.newVsReturning || []).length,
      ad_spend: (cavaliBundle.adSpend || []).length,
      smartrr_product_volume: (cavaliBundle.smartrrProductVolume || []).length,
      smartrr_subscribers: (cavaliBundle.smartrrSubscribers || []).length,
      products_q1_2026: (cavaliBundle.productsQ1 || []).length
    }
  };

  const latestCorroKpi = (corroBundle.kpis || []).slice().sort((a, b) => String(a.period || "").localeCompare(String(b.period || ""))).pop();
  if (latestCorroKpi) {
    STATE.actuals.latestKpis = {
      checkoutAbandonmentRate: latestCorroKpi.checkout_abandonment_rate,
      conversionRate: latestCorroKpi.conversion_rate,
      sessions: latestCorroKpi.sessions,
      uniqueVisitors: latestCorroKpi.unique_visitors,
      pageviews: latestCorroKpi.pageviews
    };
  }

  const acq = getBlock(STATE.commercial, "Acquisition");
  const retention = getBlock(STATE.commercial, "Retention");
  const market = getBlock(STATE.commercial, "Market Growth");
  const ecommerce = getBlock(STATE.growthEngines, "Ecommerce");
  const cavaliEngine = getBlock(STATE.growthEngines, "Cavali");
  const concierge = getBlock(STATE.growthEngines, "Concierge");
  const wellington = getBlock(STATE.growthEngines, "Wellington");
  ensureCavaliOrdersRow(cavaliEngine);

  const markupActual = weightedMarkupActuals([corroBundle.productsQ1, cavaliBundle.productsQ1]);
  if (markupActual !== null && STATE.purchasing && STATE.purchasing.commercialTerms) {
    setCurrentInRows(STATE.purchasing.commercialTerms, "Markup %", formatPercent(markupActual));
  }
  const inventoryTurnsActual = weightedInventoryTurnsActuals([corroBundle.productsQ1, cavaliBundle.productsQ1]);
  if (inventoryTurnsActual !== null && STATE.purchasing && STATE.purchasing.capitalEfficiency) {
    setCurrentInRows(STATE.purchasing.capitalEfficiency, "Inventory Turns", inventoryTurnsActual.toFixed(2).replace(/\.00$/, "") + "x");
  }

  const conciergeMetrics = corro ? channelMetricsYtd(corroBundle.revenueShare, "Concierge", corro.latest) : { grossSales:0 };
  const wellingtonMetrics = corro ? channelMetricsYtd(corroBundle.revenueShare, "Wellington", corro.latest) : { grossSales:0 };
  const ecommerceMetrics = corro ? (
    channelMetricsYtd(corroBundle.revenueShare, "e-commerce", corro.latest).grossSales
      ? channelMetricsYtd(corroBundle.revenueShare, "e-commerce", corro.latest)
      : { grossSales: Math.max(0, corro.grossSales - conciergeMetrics.grossSales - wellingtonMetrics.grossSales), orders: corro.orders, aov: corro.aov }
  ) : { grossSales:0 };
  STATE.actuals.engineGrossSales = {
    Ecommerce: ecommerceMetrics.grossSales,
    Concierge: conciergeMetrics.grossSales,
    Wellington: wellingtonMetrics.grossSales,
    Cavali: cavali ? cavali.grossSales : 0
  };
  STATE.actuals.engineGm1 = {
    Ecommerce: ecommerceMetrics.gm1 || (corro ? corro.gm1 : 0),
    Concierge: conciergeMetrics.gm1 || 0,
    Wellington: wellingtonMetrics.gm1 || 0,
    Cavali: cavali ? cavali.gm1 : 0
  };
  seed2026ForecastsOnce({ corro, cavali, ecommerceMetrics, conciergeMetrics, wellingtonMetrics, cavaliMembers });
  if (corro) {
    STATE.actuals.corroGrossSalesYtd = corro.grossSales;
    STATE.actuals.actualsThroughMonth = corro.throughMonth || 0;
  }

  if (corro) {
    if (acq) {
      setCurrentInRows(acq.rows, "New Customer Mix %", formatPercent(corro.newCustomerPct));
      if (corroAds && corroAds.spend) {
        setCurrentInRows(acq.rows, "Base Ad Spend", "$20k / month");
        setCurrentInRows(acq.rows, "Incremental Ad Spend", "$0");
        setCurrentInRows(acq.rows, "ROAS", formatMultiple(corroAds.roas));
        setCurrentInRows(acq.rows, "Ad Spend % of Gross Sales", formatPercent(corroAds.cos));
        setCurrentInRows(acq.rows, "CAC", formatMoney(corroAds.cac));
        STATE.actuals.cacSource = corroAds.cacSource;
      } else {
        setCurrentInRows(acq.rows, "Base Ad Spend", "$20k / month");
        setCurrentInRows(acq.rows, "Incremental Ad Spend", "$0");
        setCurrentInRows(acq.rows, "ROAS", "No ad_spend rows");
      }
    }
    if (retention) {
      setCurrentInRows(retention.rows, "Returning Customers %", formatPercent(corro.returningCustomerPct));
      const carryoverActual = corro.totalCustomerRevenue ? corro.returningRevenue / corro.totalCustomerRevenue : 0;
      setCurrentInRows(retention.rows, "Incremental Revenue Carryover %", formatPercent(carryoverActual));
      setCurrentInRows(retention.rows, "Purchase Frequency", corro.purchaseFrequency.toFixed(2));
      const annualGp = corro.aov * corro.purchaseFrequency * corro.gm1;
      setCurrentInRows(retention.rows, "Annual GP per Customer", formatCurrency(Math.round(annualGp)));
    }
    if (market) {
      setCurrentInRows(market.rows, "Organic Growth %", formatPercent(corro.organicGrowth));
    }
    if (STATE.purchasing && STATE.purchasing.commercialTerms) {
      setCurrentInRows(STATE.purchasing.commercialTerms, "Discounts & Returns %", formatPercent(corro.discountReturnsPct));
    }
    if (ecommerce) {
      const ecommerceOrders = ecommerceMetrics.orders || corro.orders;
      const ecommerceAov = ecommerceMetrics.aov || corro.aov;
      setCurrentInRows(ecommerce.rows, "Orders", Math.round(ecommerceOrders).toLocaleString("en-US"));
      setCurrentInRows(ecommerce.rows, "AOV", formatMoney(ecommerceAov));
      setCurrentInRows(ecommerce.rows, "GM1 %", formatPercent(ecommerceMetrics.gm1 || corro.gm1));
    }
    if (concierge) {
      const activeClients = conciergeMetrics.customers || 0;
      const ordersPerClient = activeClients ? conciergeMetrics.orders / activeClients : 0;
      setCurrentInRows(concierge.rows, "Active Clients", activeClients ? Math.round(activeClients).toLocaleString("en-US") : "No Concierge tag rows");
      setCurrentInRows(concierge.rows, "Orders per Client", ordersPerClient ? ordersPerClient.toFixed(2) : "—");
      setCurrentInRows(concierge.rows, "AOV", conciergeMetrics.aov ? formatMoney(conciergeMetrics.aov) : "—");
      setCurrentInRows(concierge.rows, "GM1 %", conciergeMetrics.gm1 ? formatPercent(conciergeMetrics.gm1) : "Channel margin unavailable");
    }
    if (wellington) {
      setCurrentInRows(wellington.rows, "Orders", wellingtonMetrics.orders ? Math.round(wellingtonMetrics.orders).toLocaleString("en-US") : "No Wellington tag rows");
      setCurrentInRows(wellington.rows, "AOV", wellingtonMetrics.aov ? formatMoney(wellingtonMetrics.aov) : "—");
      setCurrentInRows(wellington.rows, "GM1 %", wellingtonMetrics.gm1 ? formatPercent(wellingtonMetrics.gm1) : "Channel margin unavailable");
    }
    // Concierge and Wellington now feed from Shopify tag-based revenue_share
    // when data/shopify_actuals.json is generated by the secure GitHub Action.
  }

  if (cavali && cavaliEngine) {
    ensureCavaliOrdersRow(cavaliEngine);
    setCurrentInRows(cavaliEngine.rows, "Orders", Math.round(cavali.orders).toLocaleString("en-US"));
    setCurrentInRows(cavaliEngine.rows, "GM1 %", formatPercent(cavali.gm1));
    setCurrentInRows(cavaliEngine.rows, "Organic Member Growth", formatPercent(cavali.organicGrowth));

    if (cavaliAds && cavaliAds.spend) {
      setCurrentInRows(cavaliEngine.rows, "Cavali Ad Spend", formatMoney(cavaliAds.spend));
      setCurrentInRows(cavaliEngine.rows, "Cavali CAC", formatMoney(cavaliAds.cac));
    } else {
      setCurrentInRows(cavaliEngine.rows, "Cavali Ad Spend", "No ad_spend rows");
      setCurrentInRows(cavaliEngine.rows, "Cavali CAC", "Needs members/ad source");
    }

    if (cavaliMembers.signatureActive || cavaliMembers.premiumActive) {
      setCurrentInRows(cavaliEngine.rows, "Signature Active Members", Math.round(cavaliMembers.signatureActive).toLocaleString("en-US"));
      setCurrentInRows(cavaliEngine.rows, "Premium Active Members", Math.round(cavaliMembers.premiumActive).toLocaleString("en-US"));
    }

    // Refresh Actuals updates current/baseline only. Forecast cells remain exactly
    // as saved by the user for the active scenario and are never overwritten here.
  }
}


async function fetchShopifyActualsJson() {
  try {
    const res = await fetch(`data/shopify_actuals.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return json && json.brands ? json : null;
  } catch (err) {
    console.warn("Shopify actuals JSON not available yet", err);
    return null;
  }
}

function shopifyKpisRows(shopifyJson, brandKey) {
  return (shopifyJson && shopifyJson.brands && shopifyJson.brands[brandKey] && shopifyJson.brands[brandKey].kpis_daily) || [];
}

function mergeKpisRows(sheetRows = [], shopifyRows = []) {
  if (!shopifyRows || !shopifyRows.length) return sheetRows || [];
  const byPeriod = new Map();
  (sheetRows || []).forEach(row => byPeriod.set(String(row.period || ""), { ...row }));
  (shopifyRows || []).forEach(row => {
    const period = String(row.period || "");
    if (!period) return;
    const existing = byPeriod.get(period) || {};
    // Shopify is the source of truth for order/sales fields.
    // Preserve COGS/GP/GM from the existing dashboard sheet until a product-cost Shopify/SKU pipeline is added.
    byPeriod.set(period, {
      ...existing,
      ...row,
      cogs: existing.cogs ?? row.cogs ?? "",
      gross_profit: existing.gross_profit ?? row.gross_profit ?? "",
      pct_gm: existing.pct_gm ?? row.pct_gm ?? "",
      source: "shopify_admin_graphql"
    });
  });
  return [...byPeriod.values()].sort((a, b) => String(a.period || "").localeCompare(String(b.period || "")));
}

function shopifyRevenueShareRows(shopifyJson, brandKey) {
  return (shopifyJson && shopifyJson.brands && shopifyJson.brands[brandKey] && shopifyJson.brands[brandKey].revenue_share) || [];
}

function overlayShopifyActuals(corroBundle = {}, cavaliBundle = {}, shopifyJson) {
  if (!shopifyJson) return { corroBundle, cavaliBundle, source: "google_sheets" };
  const corroRows = shopifyKpisRows(shopifyJson, "corro");
  const cavaliRows = shopifyKpisRows(shopifyJson, "cavali");
  const corroRevenueShare = shopifyRevenueShareRows(shopifyJson, "corro");
  const cavaliRevenueShare = shopifyRevenueShareRows(shopifyJson, "cavali");
  const nextCorro = {
    ...corroBundle,
    kpis: mergeKpisRows(corroBundle.kpis || [], corroRows),
    revenueShare: corroRevenueShare.length ? corroRevenueShare : (corroBundle.revenueShare || [])
  };
  const nextCavali = {
    ...cavaliBundle,
    kpis: mergeKpisRows(cavaliBundle.kpis || [], cavaliRows),
    revenueShare: cavaliRevenueShare.length ? cavaliRevenueShare : (cavaliBundle.revenueShare || [])
  };
  return { corroBundle: nextCorro, cavaliBundle: nextCavali, source: "shopify_json_overlay" };
}



async function fetchLocalShopifyActuals() {
  try {
    const res = await fetch("data/shopify_actuals.json", { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !json.brands) return null;
    return json;
  } catch (err) {
    console.warn("No local Shopify actuals JSON found yet.", err);
    return null;
  }
}


async function fetchConnectedActualsJson() {
  try {
    const res = await fetch(`data/connected_actuals.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.warn("Connected actuals JSON unavailable", error);
    return null;
  }
}

function connectedBundle(json, brand) {
  const b = json && json.brands ? json.brands[brand] : null;
  if (!b) return null;
  const skuProducts = brand === "corro" && json.skusavvy && Array.isArray(json.skusavvy.products)
    ? json.skusavvy.products.map(r => ({
        product_title: r.product_title, sku: r.sku, quantity: r.quantity,
        cost: r.cost, price: r.price, inventory_turns: r.inventory_turns || "",
        inventory_value: r.inventory_value, retail_value: r.retail_value
      }))
    : [];
  return {
    kpis: b.kpis_daily || [],
    revenueShare: b.revenue_share || [],
    newVsReturning: b.new_vs_returning || [],
    adSpend: b.ad_spend || [],
    smartrrProductVolume: b.smartrr_product_volume || [],
    smartrrSubscribers: b.smartrr_subscribers || [],
    productsQ1: (b.products_q1_2026 || []).concat(skuProducts),
    _source: "connected_actuals_json",
    _generatedAt: json.generated_at || ""
  };
}

function shopifyJsonToBundle(json, brand) {
  const b = json && json.brands ? json.brands[brand] : null;
  if (!b) return null;
  return {
    kpis: b.kpis_daily || [],
    revenueShare: b.revenue_share || [],
    newVsReturning: [],
    adSpend: [],
    smartrrProductVolume: [],
    smartrrSubscribers: [],
    productsQ1: [],
    _source: "shopify_actuals_json",
    _store: b.store || "",
    _generatedAt: json.generated_at || ""
  };
}

function channelMetricsYtd(rows, channel, latest) {
  if (!rows || !rows.length || !latest) return { grossSales:0, netSales:0, grossProfit:0, gm1:0, orders:0, units:0, customers:0, aov:0 };
  const throughMonth = effectiveThroughMonth(latest);
  const ytd = rowsForYtd(rows, latest.year, throughMonth)
    .filter(r => String(r.channel || "").toLowerCase().includes(String(channel).toLowerCase()));
  const grossSales = sumField(ytd, "gross_sales") || sumField(ytd, "amount");
  const netSales = sumField(ytd, "net_sales");
  const grossProfit = sumField(ytd, "gross_profit");
  const explicitGm = (ytd || []).reduce((sum, row) => sum + parsePercent(row.gross_margin || row.pct_gm) * (parseNumber(row.net_sales) || 0), 0);
  const gm1 = netSales ? (grossProfit ? grossProfit / netSales : explicitGm / netSales) : 0;
  const orders = sumField(ytd, "nb_orders");
  const units = sumField(ytd, "nb_units");
  const customers = sumField(ytd, "unique_customers");
  return { grossSales, netSales, grossProfit, gm1, orders, units, customers, aov: orders ? grossSales / orders : 0 };
}

function setYearInRows(rows, driver, year, value) {
  const row = getRow(rows, driver);
  if (row && Object.keys(row).length) row[year] = value;
}

function setForecastPlus10(rows, driver, baseNumber, formatter = (n) => String(Math.round(n))) {
  if (!rows) return;
  const row = getRow(rows, driver);
  if (!row || !Object.keys(row).length) return;
  const base = Number(baseNumber || 0);
  row.y2026 = formatter(base + 10);
  row.y2027 = formatter(base + 20);
  row.y2028 = formatter(base + 30);
  row.y2029 = formatter(base + 40);
}

function setForecastFromCurrentPlus10(rows, driver, formatter = (n) => String(Math.round(n))) {
  const row = getRow(rows, driver);
  if (!row || !Object.keys(row).length) return;
  const base = parseNumber(row.current);
  if (!Number.isFinite(base) || base === 0) return;
  row.y2026 = formatter(base + 10);
  row.y2027 = formatter(base + 20);
  row.y2028 = formatter(base + 30);
  row.y2029 = formatter(base + 40);
}

function carryCurrentToForecast(rows, driver, fallback = "—") {
  const row = getRow(rows, driver);
  if (!row || !Object.keys(row).length) return;
  const value = !isBlankLike(row.current) ? row.current : fallback;
  row.y2026 = value;
  row.y2027 = value;
  row.y2028 = value;
  row.y2029 = value;
}

function applyFutureEditableDefaults() {
  // Keep only the agreed opening-cash safety default. Do not inject artificial
  // values into editable forecast cells. Future assumptions must come from the
  // scenario data or explicit user input and must remain blank when undefined.
  if (!STATE.cashFlow) STATE.cashFlow = {};
  if (!STATE.cashFlow.openingCashByYear) STATE.cashFlow.openingCashByYear = {};
  const currentOpening = parseMoney(STATE.cashFlow.openingCashByYear.y2026 || STATE.cashFlow.openingCash || 0);
  if (!currentOpening) {
    STATE.cashFlow.openingCash = "$100k";
    STATE.cashFlow.openingCashByYear.y2026 = "$100k";
  }
}

function setCavaliForecastFields(cavaliEngine, cavali, cavaliAds) {
  if (!cavaliEngine || !Array.isArray(cavaliEngine.rows)) return;
  // Refresh actuals must never overwrite any editable forecast year.
  // It updates only the Baseline / Current values.
  if (cavali) setCurrentInRows(cavaliEngine.rows, "Orders", Math.round(cavali.orders || 0).toLocaleString("en-US"));
  if (cavaliAds) {
    setCurrentInRows(cavaliEngine.rows, "Cavali Ad Spend", formatMoney(cavaliAds.spend || 0));
    setCurrentInRows(cavaliEngine.rows, "Cavali CAC", cavaliAds.cac ? formatMoney(cavaliAds.cac) : "—");
  }
}


function ensureCavaliOrdersRow(cavaliEngine) {
  if (!cavaliEngine || !Array.isArray(cavaliEngine.rows)) return;
  if (!getRow(cavaliEngine.rows, "Orders").driver) {
    cavaliEngine.rows.unshift({
      driver: "Orders",
      current: "Actuals pending",
      y2026: "—",
      y2027: "—",
      y2028: "—",
      y2029: "—",
      note: "Current and 2026 forecast are seeded from Shopify Cavali actuals after refresh; later years remain user-editable."
    });
  }
}

async function refreshActualsFromSheets({ silent = false } = {}) {
  const sources = STATE.dataSources || {};
  const corroSource = sources.corroDashboard || sources.corro;
  const cavaliSource = sources.cavaliDashboard || sources.cavali;

  try {
    updateIndicator("Refreshing actuals…");

    const [shopifyJson, connectedJson] = await Promise.all([
      fetchShopifyActualsJson(),
      fetchConnectedActualsJson()
    ]);
    let baseCorroBundle = connectedBundle(connectedJson, "corro") || { kpis: [], revenueShare: [], newVsReturning: [], adSpend: [], smartrrProductVolume: [], smartrrSubscribers: [], productsQ1: [] };
    let baseCavaliBundle = connectedBundle(connectedJson, "cavali") || { kpis: [], revenueShare: [], newVsReturning: [], adSpend: [], smartrrProductVolume: [], smartrrSubscribers: [], productsQ1: [] };

    if (!connectedJson && corroSource && cavaliSource) {
      try {
        [baseCorroBundle, baseCavaliBundle] = await Promise.all([
          fetchDashboardBundle(corroSource, "corro"),
          fetchDashboardBundle(cavaliSource, "cavali")
        ]);
      } catch (sheetErr) {
        console.warn("Google Sheets fallback/support data unavailable. Continuing with Shopify JSON if present.", sheetErr);
        if (!shopifyJson) throw sheetErr;
      }
    }

    const overlay = overlayShopifyActuals(baseCorroBundle, baseCavaliBundle, shopifyJson);
    const corroBundle = overlay.corroBundle;
    const cavaliBundle = overlay.cavaliBundle;

    applyActualsToState(corroBundle, cavaliBundle);
    // Refresh updates only actual/current fields. Forecast assumptions remain
    // exactly as saved by the user for the active scenario.
    if (STATE.actuals) {
      STATE.actuals.actualsSource = overlay.source;
      STATE.actuals.shopifySync = shopifyJson ? {
        generated_at: shopifyJson.generated_at,
        apiVersion: shopifyJson.apiVersion,
        corroOrders: shopifyJson.brands?.corro?.orderCount || 0,
        cavaliOrders: shopifyJson.brands?.cavali?.orderCount || 0
      } : null;
    }

    renderCommercial();
    renderBusinessUnits();
    renderKpis();
    renderSheet2Draft();
    renderFinancialSummary();
    renderCommercialCashFlow();
    saveNow();

    const sourceLabel = shopifyJson && connectedJson ? "Shopify + Google Sheets + SKUSavvy" : (shopifyJson ? "Shopify sync" : (connectedJson ? "Google Sheets + SKUSavvy" : "Google Sheets"));
    const msg = `Actuals refreshed ✓ ${sourceLabel} · ${STATE.actuals.corroPeriod || ""}`;
    updateIndicator(msg);
    if (!silent) alert(`Actuals connected from ${sourceLabel}.\nCorro: ${STATE.actuals.corroPeriod}\nCavali: ${STATE.actuals.cavaliPeriod}\n\nShopify sync: ${shopifyJson ? "available" : "not generated yet"}\n\nLoaded sources:\nCorro: ${JSON.stringify(STATE.actuals.sources.corro)}\nCavali: ${JSON.stringify(STATE.actuals.sources.cavali)}\n\nStill needed for the next phase: Klaviyo/email revenue and QuickBooks/ShipStation shipping, packaging and OPEX integration.`);
  } catch (err) {
    console.error(err);
    updateIndicator("Actuals refresh failed");
    if (!silent) alert(`Could not refresh actuals: ${err.message}\n\nIf Shopify sync is enabled, run GitHub Actions and confirm data/shopify_actuals.json is generated.`);
  }
}

function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.body.setAttribute("data-theme", next);
  localStorage.setItem("som_theme_v32", next);
  const icon = document.getElementById("themeIcon");
  const btn = document.getElementById("themeToggle");
  if (icon) icon.textContent = next === "dark" ? "☾" : "☀";
  if (btn) btn.title = next === "dark" ? "Switch to light mode" : "Switch to dark mode";
}

function initThemeToggle() {
  const saved = localStorage.getItem("som_theme_v32") || "light";
  applyTheme(saved);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.addEventListener("click", () => {
    const current = document.body.getAttribute("data-theme") || "light";
    applyTheme(current === "dark" ? "light" : "dark");
  });
}

async function boot() {
  initThemeToggle();
  STATE = await DataService.load();
  applyFutureEditableDefaults();
  renderAll();
  refreshActualsFromSheets({ silent: true });
  initTabs();
  document.getElementById("addGrowthRow").addEventListener("click", addGrowthRow);
  document.getElementById("saveData").addEventListener("click", saveNow);
  window.addEventListener("pagehide", () => {
    if (STATE) saveNow();
  });
  document.getElementById("refreshActuals").addEventListener("click", () => refreshActualsFromSheets());
  document.getElementById("downloadData").addEventListener("click", downloadState);
  document.getElementById("publishScenario").addEventListener("click", publishScenario);
  const loadEasy = document.getElementById("loadEasyNumbers");
  if (loadEasy) loadEasy.addEventListener("click", loadEasyNumberInputs);
  const restoreEasy = document.getElementById("restoreScenarioValues");
  if (restoreEasy) restoreEasy.addEventListener("click", restoreEasyNumberInputs);
  document.getElementById("resetData").addEventListener("click", () => {
    if (confirm("Reset the model to its base values? Your local edits will be lost.")) {
      DataService.reset();
      location.reload();
    }
  });
}

document.addEventListener("DOMContentLoaded", boot);
