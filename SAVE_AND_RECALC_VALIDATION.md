# Save and Recalculation Validation

- Every editable table input updates the in-memory model while typing.
- Clicking Save commits the active field even if the user did not leave it first.
- Save recalculates KPI Cards, Growth & Margin Engine, Financial Summary, Commercial Cash Flow and Strategic Targets.
- The active Draft/Budget/Forecast/Board scenario is stored separately.
- Refresh Actuals preserves user forecast assumptions and saves the refreshed current/baseline fields.
- Browser storage is verified after every save.
- Page exit triggers a final save.

Persistence scope: browser localStorage for this GitHub Pages version. It persists refreshes and browser restarts on the same browser/profile, but is not shared across devices or users.
