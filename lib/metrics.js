// F-004: the semantic/metrics layer. Queries the canonical model (F-002)

// directly — no re-parsing of the workbook. Every metric here follows the

// resolved currency and cancellation policy (PRODUCT.md section 7, D-002):

//   - Sales/return/net value is always SUM(row_total_sc), labeled USD.

//   - D-015 covered gross profit is row_total_sc minus native COGS converted

//     at 89,500 LBP per SC USD; gross margin uses the same covered population.

//   - Canceled documents are excluded unless filters.includeCanceled is set.



export const PERIOD_BOUNDS = {

 july: { start: '2026-07-01', end: '2026-07-31' },

 august: { start: '2026-08-01', end: '2026-08-31' },

 both: { start: '2026-07-01', end: '2026-08-31' },

};



// D-007: a customer must have sold at least this many units in the filtered

// period to be eligible for the "top customers by return rate" ranking —

// otherwise a single unit sold-and-returned reads as a misleading 100%.

// Placeholder pending business confirmation (see PRODUCT.md section 13).

export const RETURN_RATE_MIN_UNITS_SOLD = 10;



function headerClause(transactionType, filters, periodOverride) {

 const range = PERIOD_BOUNDS[periodOverride ?? filters.period] ?? PERIOD_BOUNDS.both;

 const clauses = ['h.transaction_type = ?', 'h.posting_date BETWEEN ? AND ?'];

 const params = [transactionType, range.start, range.end];

 if (!filters.includeCanceled) clauses.push("h.canceled = 'N'");

 if (filters.currency !== 'all') {

   clauses.push('h.currency = ?');

   params.push(filters.currency);

 }

 return { clause: clauses.join(' AND '), params };

}



function valueAndUnits(db, transactionType, filters, periodOverride) {

 const { clause, params } = headerClause(transactionType, filters, periodOverride);

 const row = db

   .prepare(

     `SELECT COALESCE(SUM(l.row_total_sc), 0) AS value_usd, COALESCE(SUM(l.quantity), 0) AS units

      FROM transaction_headers h

      JOIN transaction_lines l ON l.transaction_type = h.transaction_type AND l.source_document_id = h.source_document_id

      WHERE ${clause}`,

   )

   .get(...params);

 return { valueUsd: row.value_usd, units: row.units };

}



function invoiceCount(db, transactionType, filters, periodOverride) {

 const { clause, params } = headerClause(transactionType, filters, periodOverride);

 return db.prepare(`SELECT COUNT(DISTINCT h.source_document_id) AS c FROM transaction_headers h WHERE ${clause}`).get(...params).c;

}



// D-015 supersedes D-009: row-level reconciliation established that the

// source COGS field is fixed local currency at 89,500 LBP per SC USD.

const LBP_PER_SYSTEM_USD = 89500;



function coveredGrossProfitAndSales(db, filters) {

 const { clause, params } = headerClause('sale', filters);

 const row = db.prepare(

   `SELECT COUNT(*) AS lines,

           SUM(l.total_cogs_value IS NULL) AS missing_cogs,

           COALESCE(SUM(l.row_total_sc), 0) AS sales_sc,

           COALESCE(SUM(l.row_total_sc - l.total_cogs_value / ?), 0) AS gross_profit_sc

    FROM transaction_headers h

    JOIN transaction_lines l

      ON l.transaction_type = h.transaction_type AND l.source_document_id = h.source_document_id

    WHERE ${clause}`,

 ).get(LBP_PER_SYSTEM_USD, ...params);

 return row.lines > 0 && row.missing_cogs === 0

   ? { available: true, grossProfit: row.gross_profit_sc, salesSc: row.sales_sc, currency: 'USD' }

   : { available: false, reason: 'COGS or sales detail is unavailable for the selected population.' };

}



function periodComparison(db, filters, metricFn) {

 const july = metricFn(db, filters, 'july');

 const august = metricFn(db, filters, 'august');

 const absoluteChange = august - july;

 const percentChange = july !== 0 ? (absoluteChange / Math.abs(july)) * 100 : null;

 return { july, august, absoluteChange, percentChange };

}



/** Core Overview KPI cards (PRODUCT.md section 8, exactly the 9 listed). */

export function getKpis(db, filters) {

 const sales = valueAndUnits(db, 'sale', filters);

 const returns = valueAndUnits(db, 'return', filters);

 const salesInvoices = invoiceCount(db, 'sale', filters);

 const returnInvoices = invoiceCount(db, 'return', filters);

 const netSalesUsd = sales.valueUsd - returns.valueUsd;

 const returnRateByValue = sales.valueUsd > 0 ? returns.valueUsd / sales.valueUsd : null;

 const gp = coveredGrossProfitAndSales(db, filters);



 return {

   sales_value_usd: sales.valueUsd,

   returns_value_usd: returns.valueUsd,

   net_sales_value_usd: netSalesUsd,

   sales_invoices: salesInvoices,

   return_invoices: returnInvoices,

   units_sold: sales.units,

   return_rate_by_value: returnRateByValue,

   gross_profit: gp.available ? { available: true, value: gp.grossProfit, currency: gp.currency } : { available: false, reason: gp.reason },

   gross_margin: gp.available

     ? { available: true, value: gp.salesSc > 0 ? gp.grossProfit / gp.salesSc : null, currency: gp.currency }

     : { available: false, reason: gp.reason },

 };

}



/** Daily trend for sales/returns/net, across the filtered period. */

export function getDailyTrend(db, filters) {

 function seriesFor(transactionType) {

   const { clause, params } = headerClause(transactionType, filters);

   return db

     .prepare(

       `SELECT h.posting_date AS date, COALESCE(SUM(l.row_total_sc), 0) AS value

        FROM transaction_headers h

        JOIN transaction_lines l ON l.transaction_type = h.transaction_type AND l.source_document_id = h.source_document_id

        WHERE ${clause}

        GROUP BY h.posting_date

        ORDER BY h.posting_date`,

     )

     .all(...params);

 }



 const sales = new Map(seriesFor('sale').map((r) => [r.date, r.value]));

 const returns = new Map(seriesFor('return').map((r) => [r.date, r.value]));

 const allDates = [...new Set([...sales.keys(), ...returns.keys()])].sort();



 return allDates.map((date) => {

   const s = sales.get(date) ?? 0;

   const r = returns.get(date) ?? 0;

   return { date, sales: s, returns: r, net: s - r };

 });

}



/** July vs August comparison, independent of filters.period (D-002 currency policy still applies). */

export function getJulyVsAugustComparison(db, filters) {

 const salesCmp = periodComparison(db, filters, (d, f, p) => valueAndUnits(d, 'sale', f, p).valueUsd);

 const returnsCmp = periodComparison(db, filters, (d, f, p) => valueAndUnits(d, 'return', f, p).valueUsd);

 const netCmp = {

   july: salesCmp.july - returnsCmp.july,

   august: salesCmp.august - returnsCmp.august,

 };

 netCmp.absoluteChange = netCmp.august - netCmp.july;

 netCmp.percentChange = netCmp.july !== 0 ? (netCmp.absoluteChange / Math.abs(netCmp.july)) * 100 : null;

 return { sales: salesCmp, returns: returnsCmp, net: netCmp };

}



/** Top customers by net sales value (USD), limited to those with sale or return activity in the filtered period. */

export function getTopCustomersByNetSales(db, filters, limit = 10) {

 const saleRows = queryCustomerAggregate(db, 'sale', filters);

 const returnRows = queryCustomerAggregate(db, 'return', filters);

 const merged = mergeCustomerAggregates(saleRows, returnRows);

 return merged

   .map((c) => ({ ...c, net_sales_usd: c.sale_usd - c.return_usd }))

   .sort((a, b) => b.net_sales_usd - a.net_sales_usd)

   .slice(0, limit);

}



/** Top customers by return rate (value), gated by D-007's minimum sold-units threshold. */

export function getTopCustomersByReturnRate(db, filters, limit = 10) {

 const saleRows = queryCustomerAggregate(db, 'sale', filters);

 const returnRows = queryCustomerAggregate(db, 'return', filters);

 const merged = mergeCustomerAggregates(saleRows, returnRows);

 return merged

   .filter((c) => c.sale_units >= RETURN_RATE_MIN_UNITS_SOLD && c.sale_usd > 0)

   .map((c) => ({ ...c, return_rate: c.return_usd / c.sale_usd }))

   .sort((a, b) => b.return_rate - a.return_rate)

   .slice(0, limit);

}



function queryCustomerAggregate(db, transactionType, filters) {

 const { clause, params } = headerClause(transactionType, filters);

 return db

   .prepare(

     `SELECT h.customer_code AS customer_code, c.bp_name AS customer_name,

             COALESCE(SUM(l.row_total_sc), 0) AS value_usd, COALESCE(SUM(l.quantity), 0) AS units

      FROM transaction_headers h

      JOIN transaction_lines l ON l.transaction_type = h.transaction_type AND l.source_document_id = h.source_document_id

      LEFT JOIN customers c ON c.bp_code = h.customer_code

      WHERE ${clause}

      GROUP BY h.customer_code, c.bp_name`,

   )

   .all(...params);

}



function mergeCustomerAggregates(saleRows, returnRows) {

 const byCustomer = new Map();

 for (const r of saleRows) {

   byCustomer.set(r.customer_code, {

     customer_code: r.customer_code,

     customer_name: r.customer_name,

     sale_usd: r.value_usd,

     sale_units: r.units,

     return_usd: 0,

     return_units: 0,

   });

 }

 for (const r of returnRows) {

   const existing = byCustomer.get(r.customer_code) ?? {

     customer_code: r.customer_code,

     customer_name: r.customer_name,

     sale_usd: 0,

     sale_units: 0,

     return_usd: 0,

     return_units: 0,

   };

   existing.return_usd = r.value_usd;

   existing.return_units = r.units;

   byCustomer.set(r.customer_code, existing);

 }

 return [...byCustomer.values()];

}



/** Top items by net sales value (USD). */

export function getTopItemsByNetSales(db, filters, limit = 10) {

 const saleRows = queryItemAggregate(db, 'sale', filters);

 const returnRows = queryItemAggregate(db, 'return', filters);

 const merged = mergeItemAggregates(saleRows, returnRows);

 return merged

   .map((i) => ({ ...i, net_sales_usd: i.sale_usd - i.return_usd }))

   .sort((a, b) => b.net_sales_usd - a.net_sales_usd)

   .slice(0, limit);

}



/** Top items by covered SC gross profit under D-015. */

export function getTopItemsByGrossProfit(db, filters, limit = 10) {

 const { clause, params } = headerClause('sale', filters);

 const items = db.prepare(

   `SELECT l.item_no, i.item_description,

           SUM(l.row_total_sc - l.total_cogs_value / ?) AS gross_profit_usd

    FROM transaction_headers h

    JOIN transaction_lines l

      ON l.transaction_type = h.transaction_type AND l.source_document_id = h.source_document_id

    LEFT JOIN items i ON i.item_no = l.item_no

    WHERE ${clause} AND l.total_cogs_value IS NOT NULL

    GROUP BY l.item_no, i.item_description

    ORDER BY gross_profit_usd DESC LIMIT ?`,

 ).all(LBP_PER_SYSTEM_USD, ...params, limit);

 return { available: true, currency: 'USD', items: items.map((row) => ({ ...row })) };

}



function queryItemAggregate(db, transactionType, filters) {

 const { clause, params } = headerClause(transactionType, filters);

 return db

   .prepare(

     `SELECT l.item_no AS item_no, i.item_description AS item_description,

             COALESCE(SUM(l.row_total_sc), 0) AS value_usd, COALESCE(SUM(l.quantity), 0) AS units

      FROM transaction_headers h

      JOIN transaction_lines l ON l.transaction_type = h.transaction_type AND l.source_document_id = h.source_document_id

      LEFT JOIN items i ON i.item_no = l.item_no

      WHERE ${clause}

      GROUP BY l.item_no, i.item_description`,

   )

   .all(...params);

}



function mergeItemAggregates(saleRows, returnRows) {

 const byItem = new Map();

 for (const r of saleRows) {

   byItem.set(r.item_no, { item_no: r.item_no, item_description: r.item_description, sale_usd: r.value_usd, sale_units: r.units, return_usd: 0, return_units: 0 });

 }

 for (const r of returnRows) {

   const existing = byItem.get(r.item_no) ?? { item_no: r.item_no, item_description: r.item_description, sale_usd: 0, sale_units: 0, return_usd: 0, return_units: 0 };

   existing.return_usd = r.value_usd;

   existing.return_units = r.units;

   byItem.set(r.item_no, existing);

 }

 return [...byItem.values()];

}



/** Assembles everything the Overview page needs in one call. */

export function getOverview(db, filters) {

 return {

   filters,

   kpis: getKpis(db, filters),

   daily_trend: getDailyTrend(db, filters),

   july_vs_august: getJulyVsAugustComparison(db, filters),

   top_customers_by_net_sales: getTopCustomersByNetSales(db, filters),

   top_customers_by_return_rate: getTopCustomersByReturnRate(db, filters),

   top_items_by_net_sales: getTopItemsByNetSales(db, filters),

   top_items_by_gross_profit: getTopItemsByGrossProfit(db, filters),

 };

}