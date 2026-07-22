"""
Google Sheets writer.

Requires:
  GOOGLE_SERVICE_ACCOUNT_JSON   full JSON key of a Google service account (Secret)
  SPREADSHEET_ID                the target Google Sheet's ID, from its URL      (Variable)

Writes two kinds of tabs into the same spreadsheet:
  - "Live"        -> fully overwritten every run. Always reflects the current pull.
  - "<year>"       -> e.g. "2026". Upserted every run: existing rows for that year are
                      kept, new rows are appended, and rows are de-duplicated by
                      (order_id, subscription_id) so re-running never creates duplicates.
                      This is what you download when you want "todo el año X".
"""

import json
import os
import gspread
import pandas as pd
from google.oauth2.service_account import Credentials

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def _clean_cell(value):
    """
    Converts any pandas/numpy value into a JSON-safe string for the Sheets API.
    Handles NaN, None, inf, and any other non-JSON-compliant value by turning
    it into an empty string instead of letting it reach the request as a raw float.
    """
    if pd.isna(value):
        return ""
    return str(value)


def _df_to_values(df: pd.DataFrame):
    """Header row + all data rows, with every cell sanitized."""
    header = df.columns.tolist()
    rows = [[_clean_cell(v) for v in row] for row in df.itertuples(index=False, name=None)]
    return [header] + rows


class SheetsClient:
    def __init__(self, service_account_json: str, spreadsheet_id: str):
        creds_dict = json.loads(service_account_json)
        creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
        self.gc = gspread.authorize(creds)
        self.sh = self.gc.open_by_key(spreadsheet_id)

    def _get_or_create_worksheet(self, title: str, rows=1000, cols=20):
        try:
            return self.sh.worksheet(title)
        except gspread.WorksheetNotFound:
            return self.sh.add_worksheet(title=title, rows=rows, cols=cols)

    def write_live(self, df: pd.DataFrame):
        """Full overwrite of the 'Live' tab with the current pull."""
        ws = self._get_or_create_worksheet("Live")
        ws.clear()
        if df.empty:
            ws.update([["No data"]])
            return
        ws.update(_df_to_values(df))

    def upsert_by_year(self, df: pd.DataFrame, key_cols=("order_id", "subscription_id")):
        """
        Splits df by year (from created_at), and for each year:
          - reads whatever is already in that year's tab
          - merges with the new rows, de-duplicated by key_cols (new data wins)
          - writes the merged result back
        """
        if df.empty or "created_at" not in df.columns:
            return

        df = df.copy()
        df["_year"] = pd.to_datetime(df["created_at"], errors="coerce").dt.year
        df = df.dropna(subset=["_year"])
        df["_year"] = df["_year"].astype(int)

        for year, year_df in df.groupby("_year"):
            year_df = year_df.drop(columns=["_year"])
            tab_name = str(year)
            ws = self._get_or_create_worksheet(tab_name)

            existing_values = ws.get_all_values()
            if existing_values and len(existing_values) > 1:
                existing_df = pd.DataFrame(existing_values[1:], columns=existing_values[0])
            else:
                existing_df = pd.DataFrame(columns=year_df.columns)

            combined = pd.concat([existing_df, year_df.astype(str)], ignore_index=True)
            key_cols_present = [c for c in key_cols if c in combined.columns]
            if key_cols_present:
                combined = combined.drop_duplicates(subset=key_cols_present, keep="last")

            ws.clear()
            ws.update(_df_to_values(combined))
            print(f"  Sheet tab '{tab_name}': {len(combined)} total rows", flush=True)
