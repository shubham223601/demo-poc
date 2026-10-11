# Data contract



## Source snapshot



- Expected file: `July August sales and returns.xlsx`

- Expected period: 2026-07-01 through 2026-08-31

- Expected sheets: `Customers`, `Items`, `Sales Header 4=DN 86=ND`, `Sales Details`, `Returns Header 5=DC 87=ND`, `Returns Details`

- Raw files are read-only and should be stored outside the application bundle or referenced through configuration.



## Source joins



| From | Field | To | Field |
|---|---|---|---|
| Sales Details | Document Internal ID | Sales Header | Internal Number |
| Returns Details | Document Internal ID | Returns Header | Numerator |
| Sales/Returns Details | Item No. | Items | Item No. |
| Sales/Returns Header | Customer/Vendor Code | Customers | BP Code |



## Required ingestion outputs



- `transaction_headers`
- `transaction_lines`
- `customers`
- `items`
- `data_quality_results`
- `refresh_runs`



The ingestion job must preserve the source row count and source file hash, and must never silently drop rows. Any rejected rows need a reason code and count.



## Discovered column inventory (F-001, run `2026-09-26T18-16-42-374Z__F-001`)



Confirmed against the actual workbook via `src/ingestion/profile-workbook.js`. Row counts match PRODUCT.md's baseline exactly: 2,789 customers, 642 items, 46,292 sales headers, 290,553 sales lines, 11,021 return headers, 26,560 return lines.



| Sheet | Columns as found |

|---|---|
| `Customers` | BP Code, BP Name, Consolidating Business Partner, Group Code, Type of Business, Credit Limit, Sales Employee Code, Sales Employee Name, Category, ConsolidatedBP, ConsolidatedBP_Nam, SubCategory, AccountManager |
| `Items` | Item No., Item Description, Foreign Name, Item Group, Cost Center, Family, Category, Type |
| `Sales Header 4=DN 86=ND` | Internal Number, Document Number, Series, Canceled, Posting Date, Customer/Vendor Code, Customer/Vendor Name, Total Tax, Tax Amount (FC), Discount % for Document, Total Discount, **Total Discount (FC)**, Document Currency, Document Rate, Document Total, **Document Total (FC)**, Paid to Date, **Paid (FC)**, Gross Profit |
| `Sales Details` | #, Document Internal ID, Item No., Item/Service Description, Quantity, Remaining Open Quantity, **Price after Discount**, Price Currency, Currency Rate, Discount % per Row, Row Total, Row Total (FC), Open Amount, Open Amount (FC), Warehouse Code, Unit Price, Row Total (SC), Open Amount (SC), Gross Price after Discount, Costing Code 2, Costing Code 3, Costing Code 4, Costing Code 5, Total COGS Value, UoM Entry, FOC Reason |
| `Returns Header 5=DC 87=ND` | Numerator, Document Number, Series, Canceled, Posting Date, Customer/Vendor Code, Customer/Vendor Name, Total Tax, Tax Amount (FC), Discount % for Document, Total Discount, **Total Discount in FC**, Document Currency, Document Rate, Document Total, **Document Total in FC**, Paid to Date, **Paid in FC**, Gross Profit |
| `Returns Details` | #, Document Internal ID, Item No., Item/Service Description, Quantity, Remaining Open Quantity, **Price** (no "after Discount"), Price Currency, Currency Rate, Discount % per Row, Row Total, Row Total (FC), Open Amount, Open Amount (FC), Warehouse Code, Unit Price, Row Total (SC), Open Amount (SC), Gross Price after Discount, Costing Code 2, Costing Code 3, Costing Code 4, Costing Code 5, Total COGS Value, UoM Entry, FOC Reason |



**Naming discrepancy (bold columns above):** the sales-side and returns-side header/detail sheets use different field names for the same concept (e.g. sales header's `Document Total (FC)` vs. returns header's `Document Total in FC`; sales detail's `Price after Discount` vs. returns detail's plain `Price`). The canonical model must map both source names onto one canonical field per PRODUCT.md section 6; do not assume the names are interchangeable strings when writing ingestion code.



## Data-quality findings from F-001 profiling (see run record for exact counts)



- **FC means Foreign Currency; SC means System Currency (USD).** For LBP-denominated headers, FC is 0 while native `Document Total` is non-zero; USD headers have FC populated. D-015 verified the fixed 89,500 LBP/SC USD relationship: USD header document value uses FC, while LBP header value uses native total divided by 89,500. Line-level SC remains the source for item/category/warehouse value.
- **Sales header-to-detail reconciliation** (native `Document Total` vs. sum of detail `Row Total`) fails tolerance (±0.5%/±0.01) for roughly 42% of sales headers, and ~0.5% of sales headers have zero detail lines.
- **Returns header-to-detail reconciliation** is far worse: only about 48% of return headers (Numerator) have any matching `Returns Details` row at all (verified independently, not a join-key bug); most of the rest have zero lines. Any return-side metric built on detail-level data (item/warehouse breakdowns) will only cover about half of return headers by document count.
- **The returns gap is month-dependent (re-profiled 2026-09-27; D-011/D-015):** July has 5,376 return headers and 5,262 headers with detail (97.9%). August has 5,645 return headers but only one header with details, and it is canceled. August return document value and net document sales remain available from complete converted headers; August line value, units, item/category/warehouse mix, and return rates are unavailable—not zero.
- **Quantity is not a confirmed universal unit (re-profiled 2026-09-27; D-013):** `UoM Entry` has 37 distinct values on sales details and 18 on returns details. Until code labels/conversions are supplied, compare quantity within compatible item/UoM populations or show a source-quantity/UoM breakdown; do not imply a sum across products is pieces/physical units.
- **Additional enrichment profiling (2026-09-27):** `Costing Code 2` is populated on 273,893/290,553 sales lines with 51 codes; `Costing Code 4` is populated on 288,626 lines with three observed labels. `FOC Reason` is blank on every sales and return line. Header discount percentages include negatives/outliers (sales -24.86% to 28.92%; returns -21.69% to 20.07%), so discount insights require validity rules. These fields are cataloged in `docs/INSIGHTS.md` and are not silently assigned business meanings.
- These are exposed as `warn` checks in the run record, not silently corrected. F-002/F-003 must decide how to handle them (e.g., block affected metrics, or report at header level only) rather than guessing a reconciliation formula.



## Canonical model (F-002)



Built by `src/ingestion/build-canonical.js` (`npm run build:canonical`) into an embedded SQLite database at `data/generated/canonical.sqlite` (see D-004; path configurable via `WOODEN_BAKERY_CANONICAL_DB_PATH`). Schema: `src/ingestion/canonical-schema.js`. Row-mapping (including the sales/returns key- and FC-field-name resolution above): `src/ingestion/canonical-mapper.js`.



- Tables: `customers`, `items`, `transaction_headers`, `transaction_lines`, `refresh_runs`, `data_quality_results` — matching the "Required ingestion outputs" list above.
- `transaction_headers`/`transaction_lines` primary keys include `transaction_type`, so sales and returns never collide on document number even though both use numeric source IDs.
- No FOREIGN KEY constraints: orphan rows (found in F-001 profiling) are kept and counted in `data_quality_results`, not rejected.
- Currency policy is resolved for the supplied snapshot (the historical ingestion check remains named `functional_currency_policy`): FC is Foreign Currency, SC is System Currency = USD, and native source/COGS fields reconcile at 89,500 LBP per SC USD under D-015. Line-derived return metrics remain coverage-gated; complete header document value and covered sales gross profit are available at their stated grains.
- Rebuilding is safe and idempotent (`INSERT OR REPLACE`); the database is a regenerable artifact, not a source of truth — the workbook is.



## Data-quality view (F-003)



Built by `src/quality/build-data-quality-report.js` (`npm run quality:report`) into `data/generated/data-quality.html`. Depends only on the canonical database above, not the raw workbook — it opens `canonical.sqlite` read-only.



- Gate logic: `src/quality/gates.js`. Duplicate-key/sheet-discovery checks are read from `data_quality_results` (ingestion-time evidence); everything else (reconciliation, orphans, invalid currency/rate/date, non-positive quantities, cancellation leakage) is recomputed live via SQL against the current canonical tables.
- `metric_trustworthiness` (D-005) is the gate-to-KPI mapping F-004's dashboard must read before rendering a value — see `docs/DECISIONS.md`.
- HTML rendering: `src/dashboard/data-quality-view.js` (no Wooden Bakery brand styling yet — pending PRODUCT.md section 13).