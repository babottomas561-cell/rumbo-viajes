#!/usr/bin/env python3
"""Build the compact fuel-price snapshot used by the trip planner."""

from __future__ import annotations

import csv
import io
import json
import re
import statistics
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from openpyxl import load_workbook


ARGENTINA_URL = (
    "https://datos.energia.gob.ar/dataset/1c181390-5045-475e-94dc-410429be4b17/"
    "resource/80ac25de-a44a-4445-9215-090cf55cfda5/download/"
    "precios-en-surtidor-resolucin-3142016.csv"
)
ANP_PAGE = (
    "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/"
    "precos/levantamento-de-precos-de-combustiveis-ultimas-semanas-pesquisadas"
)
OUTPUT = Path(__file__).resolve().parents[1] / "src" / "data" / "fuel-prices.json"


def download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "RumboViajes/1.0"})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def summarize(values: list[float]) -> dict[str, float | int]:
    return {
        "average": round(statistics.fmean(values), 2),
        "median": round(statistics.median(values), 2),
        "min": round(min(values), 2),
        "max": round(max(values), 2),
        "samples": len(values),
    }


def argentina_snapshot() -> dict:
    raw = download(ARGENTINA_URL)
    rows = csv.DictReader(io.StringIO(raw.decode("utf-8-sig", errors="replace")))
    products = {
        "Nafta (súper) entre 92 y 95 Ron": "super",
        "Nafta (premium) de más de 95 Ron": "premium",
        "Gas Oil Grado 2": "diesel_grade_2",
        "Gas Oil Grado 3": "diesel_grade_3",
    }
    records: list[tuple[str, str, str, float, str]] = []
    latest_period = ""
    latest_effective = ""

    for row in rows:
        product = products.get(row.get("producto", ""))
        if not product:
            continue
        try:
            price = float(row["precio"].replace(",", "."))
        except (KeyError, ValueError):
            continue
        if price <= 0:
            continue
        period = row.get("indice_tiempo", "")
        effective = row.get("fecha_vigencia", "")
        province = row.get("provincia", "").strip().title()
        records.append((period, province, product, price, effective))
        latest_period = max(latest_period, period)

    by_product: dict[str, list[float]] = defaultdict(list)
    by_province: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for period, province, product, price, effective in records:
        if period != latest_period:
            continue
        by_product[product].append(price)
        by_province[province][product].append(price)
        latest_effective = max(latest_effective, effective)

    return {
        "currency": "ARS",
        "unit": "liter",
        "period": latest_period,
        "latestEffectiveDate": latest_effective,
        "national": {key: summarize(values) for key, values in sorted(by_product.items())},
        "provinces": {
            province: {key: summarize(values) for key, values in sorted(products_data.items())}
            for province, products_data in sorted(by_province.items())
        },
        "source": {"name": "Secretaría de Energía de Argentina", "url": ARGENTINA_URL},
    }


def latest_anp_url() -> str:
    html = download(ANP_PAGE).decode("utf-8", errors="replace")
    matches = re.findall(r'href="([^"]+resumo_semanal_lpc_[^"]+\.xlsx)"', html, re.I)
    if not matches:
        raise RuntimeError("No se encontró el XLSX semanal de ANP")
    urls = [urllib.request.urljoin(ANP_PAGE, match.replace("&amp;", "&")) for match in matches]
    return max(urls)


def brazil_snapshot() -> dict:
    xlsx_url = latest_anp_url()
    workbook = load_workbook(io.BytesIO(download(xlsx_url)), read_only=True, data_only=True)
    aliases = {
        "GASOLINA COMUM": "regular",
        "GASOLINA ADITIVADA": "additive",
        "ETANOL HIDRATADO": "ethanol",
        "OLEO DIESEL": "diesel",
        "OLEO DIESEL S10": "diesel_s10",
    }

    def rows_for(
        sheet_name: str,
        product_column: int,
        samples_column: int,
        average_column: int,
        min_column: int,
        max_column: int,
        place_column: int | None = None,
    ) -> tuple[dict, str, str]:
        sheet = workbook[sheet_name]
        result: dict = defaultdict(dict) if place_column is not None else {}
        start = end = ""
        for row in sheet.iter_rows(min_row=11, values_only=True):
            product = aliases.get(str(row[product_column]).strip() if row[product_column] else "")
            if not product or row[average_column] is None:
                continue
            start = max(start, row[0].date().isoformat() if hasattr(row[0], "date") else str(row[0]))
            end = max(end, row[1].date().isoformat() if hasattr(row[1], "date") else str(row[1]))
            summary = {
                "average": round(float(row[average_column]), 2),
                "min": round(float(row[min_column]), 2),
                "max": round(float(row[max_column]), 2),
                "samples": int(row[samples_column]),
            }
            if place_column is None:
                result[product] = summary
            else:
                result[str(row[place_column]).strip()][product] = summary
        return dict(result), start, end

    national, start, end = rows_for("BRASIL", 3, 4, 6, 8, 9)
    states, _, _ = rows_for("ESTADOS", 4, 5, 7, 9, 10, place_column=3)
    workbook.close()
    return {
        "currency": "BRL",
        "unit": "liter",
        "period": {"start": start, "end": end},
        "national": national,
        "states": states,
        "source": {"name": "Agência Nacional do Petróleo (ANP)", "url": xlsx_url},
    }


def main() -> None:
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "argentina": argentina_snapshot(),
        "brazil": brazil_snapshot(),
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
