"""Convert Maven Analytics' "CRM Sales Opportunities" dataset into a SalesMesh import file.

Source: https://mavenanalytics.io/data-playground/crm-sales-opportunities (licence: Public Domain).
A fictitious B2B computer-hardware company ("MavenTech"): 8,800 opportunities, 30 sales agents,
Oct 2016 - Dec 2017. It is NOT Kenyan SME data; use it to test and demonstrate SalesMesh.

What this script changes, and why:
  * Dates are shifted forward by one fixed number of days so the latest close lands
    SHIFT_END_GAP_DAYS before today. Every gap between dates (and so every sales cycle) is unchanged.
  * USD amounts are converted to KES at KES_PER_USD.
  * Lost and open deals have no close_value in the source, so they use the product's list price.
  * Stages map Prospecting -> lead, Engaging -> qualified, Won -> won, Lost -> lost.

Usage:
  python convert_maven_crm.py <folder with sales_pipeline.csv and products.csv> [output.csv]
"""
import csv
import sys
from datetime import date, timedelta
from pathlib import Path

KES_PER_USD = 129  # assumed exchange rate; change it to the rate you want to report
SHIFT_END_GAP_DAYS = 7

STAGES = {'Prospecting': 'lead', 'Engaging': 'qualified', 'Won': 'won', 'Lost': 'lost'}
# sales_pipeline.csv spells this product differently from products.csv
PRODUCT_ALIASES = {'GTXPro': 'GTX Pro'}


def main(source_dir, output_path):
    source = Path(source_dir)
    with open(source / 'products.csv', encoding='utf-8') as f:
        list_price = {r['product']: float(r['sales_price']) for r in csv.DictReader(f)}
    with open(source / 'sales_pipeline.csv', encoding='utf-8') as f:
        rows = list(csv.DictReader(f))

    last_date = max(date.fromisoformat(d) for r in rows for d in (r['engage_date'], r['close_date']) if d)
    shift = (date.today() - timedelta(days=SHIFT_END_GAP_DAYS)) - last_date

    def moved(iso):
        return (date.fromisoformat(iso) + shift).isoformat() if iso else ''

    out = []
    for r in rows:
        product = PRODUCT_ALIASES.get(r['product'], r['product'])
        stage = STAGES[r['deal_stage']]
        usd = float(r['close_value']) if stage == 'won' else list_price[product]
        company = r['account'] or ''
        out.append({
            'title': f"{product} - {company or 'New prospect'} ({r['opportunity_id']})",
            'value': round(usd * KES_PER_USD),
            'stage': stage,
            'created_date': moved(r['engage_date']),
            'closed_date': moved(r['close_date']) if stage in ('won', 'lost') else '',
            'company': company,
            'owner': r['sales_agent'],
        })

    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        writer.writeheader()
        writer.writerows(out)

    won = [o for o in out if o['stage'] == 'won']
    print(f'{len(out)} deals written to {output_path}')
    print(f'Dates moved forward {shift.days} days; latest date is now {moved(last_date.isoformat())}')
    print(f'Won: {len(won)} deals, KES {sum(o["value"] for o in won):,}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'maven-crm-deals-kes.csv')
