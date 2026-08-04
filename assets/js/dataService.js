/**
 * DataService
 * -----------
 * Single data input/output gateway for the model.
 * Current implementation: localStorage for local edits plus
 * data/assumptions.json as the baseline dataset.
 * Future implementation: replace only the internals of load() and save()
 * with Supabase or Firebase calls for multi-user persistence without
 * changing app.js.
 */
const DataService = (() => {
  const STORAGE_KEY = "som_assumptions_v70";
  const LEGACY_KEYS = [
    "som_assumptions_v60",
    "som_assumptions_v40",
    "som_assumptions_v39",
    "som_assumptions_v38",
    "som_assumptions_v37",
    "som_assumptions_v36",
    "som_assumptions_v35",
    "som_assumptions_v34",
    "som_assumptions_v33",
    "som_assumptions_v31",
    "som_assumptions_v30",
    "som_assumptions_v29",
    "som_assumptions_v28",
    "som_assumptions_v27",
    "som_assumptions_v26",
    "som_assumptions_v25",
    "som_assumptions_v24",
    "som_assumptions_v23"
  ];

  async function load() {
    // v61 intentionally starts from the corrected baseline instead of importing
    // stale v60 placeholder forecasts (100 / Editable / Actuals + 10).
    const local = localStorage.getItem(STORAGE_KEY);
    if (local) {
      try { return JSON.parse(local); } catch (e) { localStorage.removeItem(STORAGE_KEY); }
    }
    const res = await fetch("data/assumptions.json?v=170", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load data/assumptions.json");
    return res.json();
  }

  function save(data) {
    const payload = JSON.stringify(data);
    localStorage.setItem(STORAGE_KEY, payload);
    // Read-after-write verification catches browser storage failures instead
    // of showing a false Saved state.
    if (localStorage.getItem(STORAGE_KEY) !== payload) {
      throw new Error("The model could not verify the saved changes in browser storage.");
    }
  }

  function reset() {
    [STORAGE_KEY, ...LEGACY_KEYS].forEach(key => localStorage.removeItem(key));
  }

  return { load, save, reset };
})();
