// F-006–F-012: shared analytical query layer for every dashboard workspace.

// All value metrics use line-level SC (System Currency = USD). FC is Foreign

// Currency and is never used as a cross-currency reporting amount.



import { PERIOD_BOUNDS } from './metrics.js';



export const RETURN_DETAIL_COVERAGE_THRESHOLD = 0.95;

export const RETURN_RISK_MIN_SALES_USD = 1000;

// Observed local/system relationship in the supplied snapshot. All ordinary

// USD headers use 89,500 LBP/USD; source-line values reconcile to SC at this

// rate across both document currencies. USD header FC is used directly so

// the single rate-2 return anomaly is not misconverted.

export const LBP_PER_SYSTEM_USD = 89500;



const DIMENSIONS = {

 customer: {

   key: 'h.customer_code',

   label: "COALESCE(c.bp_name, h.customer_name, h.customer_code, '(unknown)')",

 },

 item: {

   key: 'l.item_no',

   label: "COALESCE(i.item_description, l.item_description, l.item_no, '(unknown)')",

 },

 category: {

   key: "COALESCE(i.category, '(missing)')",

   label: "COALESCE(i.category, '(missing)')",

 },

 item_group: {

   key: "COALESCE(i.item_group, '(missing)')",

   label: "COALESCE(i.item_group, '(missing)')",

 },

 warehouse: {

   key: "COALESCE(l.warehouse_code, '(missing)')",

   label: "COALESCE(l.warehouse_code, '(missing)')",

 },

 manager: {

   key: "COALESCE(c.account_manager, '(unassigned)')",

   label: "COALESCE(c.account_manager, '(unassigned)')",

 },

 salesperson: {

   key: "COALESCE(c.sales_employee_name, '(unassigned)')",

   label: "COALESCE(c.sales_employee_name, '(unassigned)')",

 },

 currency: { key: 'h.currency', label: 'h.currency' },

};



function rangeFor(filters, override) {

 if (override && PERIOD_BOUNDS[override]) return PERIOD_BOUNDS[override];

 if (filters.startDate && filters.endDate) return { start: filters.startDate, end: filters.endDate };

 return PERIOD_BOUNDS[filters.period] ?? PERIOD_BOUNDS.both;

}



function headerConditions(filters, transactionType, override, alias = 'h') {

 const range = rangeFor(filters, override);

 const clauses = [`${alias}.transaction_type = ?`, `${alias}.posting_date BETWEEN ? AND ?`];

 const params = [transactionType, range.start, range.end];

 if (!filters.includeCanceled) clauses.push(`${alias}.canceled = 'N'`);

 if (filters.currency && filters.currency !== 'all') {

   clauses.push(`${alias}.currency = ?`);

   params.push(filters.currency);

 }

 if (filters.customer) {

   clauses.push(`${alias}.customer_code = ?`);

   params.push(filters.customer);

 }

 return { clauses, params, range };

}



function lineScope(filters, transactionType, override) {

 const base = headerConditions(filters, transactionType, override);

 const clauses = [...base.clauses];

 const params = [...base.params];

 if (filters.item) {

   clauses.push('l.item_no = ?');

   params.push(filters.item);

 }

 if (filters.category) {

   clauses.push('i.category = ?');

   params.push(filters.category);

 }

 if (filters.warehouse) {

   clauses.push('l.warehouse_code = ?');

   params.push(filters.warehouse);

 }

 if (filters.accountManager) {

   clauses.push('c.account_manager = ?');

   params.push(filters.accountManager);

 }

 if (filters.salesEmployee) {

   clauses.push('c.sales_employee_name = ?');

   params.push(filters.salesEmployee);

 }

 return {

   joins: `JOIN transaction_lines l

             ON l.transaction_type = h.transaction_type AND l.source_document_id = h.source_document_id

           LEFT JOIN customers c ON c.bp_code = h.customer_code

           LEFT JOIN items i ON i.item_no = l.item_no`,

   where: clauses.join(' AND '),

   params,

   range: base.range,

 };

}



function headerScope(filters, transactionType, override) {

 const base = headerConditions(filters, transactionType, override);

 const clauses = [...base.clauses];

 const params = [...base.params];

 let joins = 'LEFT JOIN customers c ON c.bp_code = h.customer_code';

 if (filters.accountManager) {

   clauses.push('c.account_manager = ?');

   params.push(filters.accountManager);

 }

 if (filters.salesEmployee) {

   clauses.push('c.sales_employee_name = ?');

   params.push(filters.salesEmployee);

 }

 if (filters.item || filters.category || filters.warehouse) {

   const lineClauses = ['fl.transaction_type = h.transaction_type', 'fl.source_document_id = h.source_document_id'];

   if (filters.item) {

     lineClauses.push('fl.item_no = ?');

     params.push(filters.item);

   }

   if (filters.category) {

     lineClauses.push('fi.category = ?');

     params.push(filters.category);

   }

   if (filters.warehouse) {

     lineClauses.push('fl.warehouse_code = ?');

     params.push(filters.warehouse);

   }

   clauses.push(`EXISTS (

     SELECT 1 FROM transaction_lines fl LEFT JOIN items fi ON fi.item_no = fl.item_no

     WHERE ${lineClauses.join(' AND ')}

   )`);

 }

 return { joins, where: clauses.join(' AND '), params, range: base.range };

}



export function getCoverage(db, transactionType, filters, override) {

 const scope = headerScope(filters, transactionType, override);

 const row = db.prepare(

   `SELECT COUNT(DISTINCT h.source_document_id) AS headers,

           COUNT(DISTINCT CASE WHEN EXISTS (

             SELECT 1 FROM transaction_lines dl

             WHERE dl.transaction_type = h.transaction_type AND dl.source_document_id = h.source_document_id

           ) THEN h.source_document_id END) AS covered_headers

    FROM transaction_headers h ${scope.joins}

    WHERE ${scope.where}`,

 ).get(...scope.params);

 const headers = row.headers ?? 0;

 const coveredHeaders = row.covered_headers ?? 0;

 return {

   headers,

   covered_headers: coveredHeaders,

   missing_headers: headers - coveredHeaders,

   coverage: headers > 0 ? coveredHeaders / headers : 1,

   range: scope.range,

 };

}



export function getCoverageByMonth(db, transactionType, filters) {

 return ['july', 'august'].map((period) => ({ period, ...getCoverage(db, transactionType, filters, period) }));

}



export function getLineSummary(db, transactionType, filters, override) {

 const scope = lineScope(filters, transactionType, override);

 const row = db.prepare(

   `SELECT COALESCE(SUM(l.row_total_sc), 0) AS value_usd,

           COALESCE(SUM(l.quantity), 0) AS source_quantity,

           COUNT(*) AS line_count,

           COUNT(DISTINCT h.source_document_id) AS covered_documents,

           COUNT(DISTINCT h.customer_code) AS active_customers,

           COUNT(DISTINCT l.item_no) AS active_items,

           COUNT(DISTINCT l.uom_entry) AS uom_count,

           COUNT(DISTINCT l.warehouse_code) AS warehouse_count

    FROM transaction_headers h ${scope.joins}

    WHERE ${scope.where}`,

 ).get(...scope.params);

 const coverage = getCoverage(db, transactionType, filters, override);

 return { ...row, coverage };

}



export function getHeaderSummary(db, transactionType, filters, override) {

 const scope = headerScope(filters, transactionType, override);

 return db.prepare(

   `SELECT COUNT(DISTINCT h.source_document_id) AS documents,

           COUNT(DISTINCT h.customer_code) AS customers,

           SUM(CASE WHEN h.canceled IN ('Y','C') THEN 1 ELSE 0 END) AS canceled_documents

    FROM transaction_headers h ${scope.joins}

    WHERE ${scope.where}`,

 ).get(...scope.params);

}



export function getHeaderFinancialSummary(db, transactionType, filters, override) {

 if (filters.item || filters.category || filters.warehouse) {

   return {

     available: false,

     reason: 'Document totals cannot be allocated safely to an item, category, or warehouse filter without complete detail lines.',

   };

 }

 const scope = headerScope(filters, transactionType, override);

 const row = db.prepare(

   `SELECT COUNT(DISTINCT h.source_document_id) AS documents,

           SUM(CASE

             WHEN h.currency = 'USD' THEN h.document_total_fc

             ELSE h.document_total_source / ?

           END) AS document_value_usd,

           SUM(h.gross_profit_source / ?) AS gross_profit_usd,

           SUM(CASE

             WHEN h.currency = 'USD' THEN h.document_total_fc IS NULL

             ELSE h.document_total_source IS NULL

           END) AS missing_document_total,

           SUM(h.gross_profit_source IS NULL) AS missing_gross_profit

    FROM transaction_headers h ${scope.joins}

    WHERE ${scope.where}`,

 ).get(LBP_PER_SYSTEM_USD, LBP_PER_SYSTEM_USD, ...scope.params);

 return {

   available: row.missing_document_total === 0,

   ...row,

   conversion_note: `USD documents use FC directly; LBP document totals are converted at ${LBP_PER_SYSTEM_USD.toLocaleString('en-US')} LBP/USD, the observed SC relationship.`,

 };

}



export function getSalesProfitSummary(db, filters, override) {

 const scope = lineScope(filters, 'sale', override);

 const row = db.prepare(

   `SELECT SUM(l.row_total_sc) AS sales_value_usd,

           SUM(l.total_cogs_value / ?) AS cogs_usd,

           SUM(l.row_total_sc - l.total_cogs_value / ?) AS gross_profit_usd,

           SUM(l.total_cogs_value IS NULL) AS missing_cogs,

           COUNT(*) AS lines

    FROM transaction_headers h ${scope.joins}

    WHERE ${scope.where}`,

 ).get(LBP_PER_SYSTEM_USD, LBP_PER_SYSTEM_USD, ...scope.params);

 return {

   ...row,

   available: row.lines > 0 && row.missing_cogs === 0,

   gross_margin: row.sales_value_usd ? row.gross_profit_usd / row.sales_value_usd : null,

   conversion_note: `COGS is converted from the source local-currency field at ${LBP_PER_SYSTEM_USD.toLocaleString('en-US')} LBP/USD and compared with line-level SC sales.`,

 };

}



export function isReturnDetailAvailable(db, filters, override) {

 const periods = override ? [override] : filters.period === 'both' ? ['july', 'august'] : [filters.period];

 const coverage = periods.map((period) => ({ period, ...getCoverage(db, 'return', filters, period) }));

 const available = coverage.every((c) => c.headers === 0 || c.coverage >= RETURN_DETAIL_COVERAGE_THRESHOLD);

 return {

   available,

   coverage,

   reason: available

     ? ''

     : 'Return detail coverage is below 95% for part of the selected period. Line-level return value, quantity, line-net sales, and dimension insights are unavailable rather than zero. Header document value remains available where document totals are complete.',

 };

}



export function getTrend(db, transactionType, filters, override) {

 const scope = lineScope(filters, transactionType, override);

 return db.prepare(

   `SELECT h.posting_date AS date,

           COALESCE(SUM(l.row_total_sc), 0) AS value_usd,

           COALESCE(SUM(l.quantity), 0) AS source_quantity,

           COUNT(DISTINCT h.source_document_id) AS documents,

           COUNT(DISTINCT h.customer_code) AS customers

    FROM transaction_headers h ${scope.joins}

    WHERE ${scope.where}

    GROUP BY h.posting_date ORDER BY h.posting_date`,

 ).all(...scope.params).map((r) => ({ ...r }));

}



export function getHeaderTrend(db, transactionType, filters, override) {

 const scope = headerScope(filters, transactionType, override);

 return db.prepare(

   `SELECT h.posting_date AS date, COUNT(DISTINCT h.source_document_id) AS documents,

           COUNT(DISTINCT h.customer_code) AS customers

    FROM transaction_headers h ${scope.joins}

    WHERE ${scope.where}

    GROUP BY h.posting_date ORDER BY h.posting_date`,

 ).all(...scope.params).map((r) => ({ ...r }));

}



export function getHeaderValueTrend(db, transactionType, filters, override) {

 const scope = headerScope(filters, transactionType, override);

 if (filters.item || filters.category || filters.warehouse) return [];

 return db.prepare(

   `SELECT h.posting_date AS date,

           SUM(CASE

             WHEN h.currency = 'USD' THEN h.document_total_fc

             ELSE h.document_total_source / ?

           END) AS value_usd,

           COUNT(DISTINCT h.source_document_id) AS documents

    FROM transaction_headers h ${scope.joins}

    WHERE ${scope.where}

    GROUP BY h.posting_date ORDER BY h.posting_date`,

 ).all(LBP_PER_SYSTEM_USD, ...scope.params).map((r) => ({ ...r }));

}



export function getRanking(db, transactionType, filters, dimension, { limit = 15, override } = {}) {

 const config = DIMENSIONS[dimension];

 if (!config) throw new Error(`Unknown ranking dimension: ${dimension}`);

 const scope = lineScope(filters, transactionType, override);

 const rows = db.prepare(

   `SELECT ${config.key} AS key, ${config.label} AS label,

           COALESCE(SUM(l.row_total_sc), 0) AS value_usd,

           SUM(COALESCE(SUM(l.row_total_sc), 0)) OVER () AS total_value_usd,

           COALESCE(SUM(l.total_cogs_value / ${LBP_PER_SYSTEM_USD}), 0) AS cogs_usd,

           COALESCE(SUM(l.row_total_sc - l.total_cogs_value / ${LBP_PER_SYSTEM_USD}), 0) AS gross_profit_usd,

           CASE WHEN SUM(l.row_total_sc) != 0

             THEN SUM(l.row_total_sc - l.total_cogs_value / ${LBP_PER_SYSTEM_USD}) / SUM(l.row_total_sc)

             ELSE NULL END AS gross_margin,

           COALESCE(SUM(l.quantity), 0) AS source_quantity,

           COUNT(DISTINCT h.source_document_id) AS documents,

           COUNT(DISTINCT h.customer_code) AS customers,

           COUNT(DISTINCT l.item_no) AS items,

           COUNT(DISTINCT l.warehouse_code) AS warehouses,

           COUNT(DISTINCT l.uom_entry) AS uom_count,

           GROUP_CONCAT(DISTINCT h.currency) AS currencies,

           COUNT(DISTINCT h.posting_date) AS active_days

    FROM transaction_headers h ${scope.joins}

    WHERE ${scope.where}

    GROUP BY ${config.key}, ${config.label}

    ORDER BY value_usd DESC LIMIT ?`,

 ).all(...scope.params, limit).map((r) => ({ ...r }));

 return rows.map(({ total_value_usd: total, ...row }) => ({

   ...row,

   share: total > 0 ? row.value_usd / total : null,

 }));

}



export function getMonthComparison(db, filters) {

 const july = getLineSummary(db, 'sale', filters, 'july');

 const august = getLineSummary(db, 'sale', filters, 'august');

 const metrics = ['value_usd', 'source_quantity', 'covered_documents', 'active_customers', 'active_items'];

 const result = {};

 for (const metric of metrics) {

   const change = august[metric] - july[metric];

   result[metric] = {

     july: july[metric],

     august: august[metric],

     change,

     percent_change: july[metric] ? change / Math.abs(july[metric]) : null,

   };

 }

 result.average_invoice = {

   july: july.covered_documents ? july.value_usd / july.covered_documents : null,

   august: august.covered_documents ? august.value_usd / august.covered_documents : null,

 };

 result.average_invoice.change = (result.average_invoice.august ?? 0) - (result.average_invoice.july ?? 0);

 result.average_invoice.percent_change = result.average_invoice.july

   ? result.average_invoice.change / Math.abs(result.average_invoice.july)

   : null;

 return result;

}



export function getMovers(db, filters, dimension, limit = 10) {

 const config = DIMENSIONS[dimension];

 if (!config) throw new Error(`Unknown mover dimension: ${dimension}`);

 const scope = lineScope(filters, 'sale', 'both');

 const rows = db.prepare(

   `SELECT ${config.key} AS key, ${config.label} AS label,

           COALESCE(SUM(CASE WHEN h.posting_date < '2026-08-01' THEN l.row_total_sc ELSE 0 END), 0) AS july,

           COALESCE(SUM(CASE WHEN h.posting_date >= '2026-08-01' THEN l.row_total_sc ELSE 0 END), 0) AS august

    FROM transaction_headers h ${scope.joins}

    WHERE ${scope.where}

    GROUP BY ${config.key}, ${config.label}`,

 ).all(...scope.params).map((r) => ({ ...r, change: r.august - r.july }));

 return {

   gains: [...rows].sort((a, b) => b.change - a.change).slice(0, limit),

   declines: [...rows].sort((a, b) => a.change - b.change).slice(0, limit),

 };

}



export function getWeekdayProfile(db, filters) {

 const scope = lineScope(filters, 'sale');

 return db.prepare(

   `WITH daily AS (

      SELECT h.posting_date AS date, CAST(strftime('%w', h.posting_date) AS INTEGER) AS dow,

             SUM(l.row_total_sc) AS value_usd, SUM(l.quantity) AS source_quantity,

             COUNT(DISTINCT h.source_document_id) AS documents

      FROM transaction_headers h ${scope.joins}

      WHERE ${scope.where} GROUP BY h.posting_date

    )

    SELECT dow, AVG(value_usd) AS avg_value_usd, AVG(source_quantity) AS avg_source_quantity,

           AVG(documents) AS avg_documents, COUNT(*) AS observed_days

    FROM daily GROUP BY dow ORDER BY dow`,

 ).all(...scope.params).map((r) => ({ ...r }));

}



export function getInvoiceDistribution(db, filters) {

 const scope = lineScope(filters, 'sale');

 return db.prepare(

   `WITH docs AS (

      SELECT h.source_document_id, SUM(l.row_total_sc) AS value_usd, COUNT(*) AS lines,

             SUM(l.quantity) AS source_quantity

      FROM transaction_headers h ${scope.joins}

      WHERE ${scope.where} GROUP BY h.source_document_id

    ), ranked AS (

      SELECT *, NTILE(4) OVER (ORDER BY value_usd) AS quartile FROM docs

    )

    SELECT quartile, COUNT(*) AS documents, MIN(value_usd) AS min_value,

           AVG(value_usd) AS avg_value, MAX(value_usd) AS max_value,

           AVG(lines) AS avg_lines, AVG(source_quantity) AS avg_source_quantity

    FROM ranked GROUP BY quartile ORDER BY quartile`,

 ).all(...scope.params).map((r) => ({ ...r }));

}



export function getTopInvoices(db, filters, transactionType = 'sale', limit = 25) {

 const scope = lineScope(filters, transactionType);

 return db.prepare(

   `SELECT h.transaction_type, h.source_document_id, h.document_number, h.posting_date,

           h.customer_code, COALESCE(c.bp_name, h.customer_name, h.customer_code) AS customer_name,

           h.currency, h.canceled, SUM(l.row_total_sc) AS value_usd,

           SUM(l.quantity) AS source_quantity, COUNT(*) AS lines,

           COUNT(DISTINCT l.item_no) AS items, COUNT(DISTINCT l.uom_entry) AS uom_count

    FROM transaction_headers h ${scope.joins}

    WHERE ${scope.where}

    GROUP BY h.transaction_type, h.source_document_id

    ORDER BY value_usd DESC LIMIT ?`,

 ).all(...scope.params, limit).map((r) => ({ ...r }));

}



export function getActivitySegments(db, filters) {

 const scope = headerScope(filters, 'sale', 'both');

 return db.prepare(

   `WITH activity AS (

      SELECT h.customer_code,

             MAX(h.posting_date < '2026-08-01') AS july,

             MAX(h.posting_date >= '2026-08-01') AS august

      FROM transaction_headers h ${scope.joins}

      WHERE ${scope.where} GROUP BY h.customer_code

    )

    SELECT SUM(july = 1 AND august = 1) AS active_both,

           SUM(july = 1 AND august = 0) AS july_only,

           SUM(july = 0 AND august = 1) AS august_only

    FROM activity`,

 ).get(...scope.params);

}



export function getReturnRisk(db, filters, dimension = 'item', limit = 20) {

 const config = DIMENSIONS[dimension];

 if (!config || !['item', 'customer', 'category', 'warehouse'].includes(dimension)) {

   throw new Error(`Unsupported return-risk dimension: ${dimension}`);

 }

 const sales = lineScope(filters, 'sale', 'july');

 const returns = lineScope(filters, 'return', 'july');

 return db.prepare(

   `WITH sales AS (

      SELECT ${config.key} AS key, ${config.label} AS label,

             SUM(l.row_total_sc) AS sales_usd, SUM(l.quantity) AS sold_quantity,

             COUNT(DISTINCT l.uom_entry) AS sold_uoms

      FROM transaction_headers h ${sales.joins}

      WHERE ${sales.where} GROUP BY ${config.key}, ${config.label}

    ), returns AS (

      SELECT ${config.key} AS key,

             SUM(l.row_total_sc) AS return_usd, SUM(l.quantity) AS returned_quantity,

             COUNT(DISTINCT l.uom_entry) AS return_uoms

      FROM transaction_headers h ${returns.joins}

      WHERE ${returns.where} GROUP BY ${config.key}

    )

    SELECT s.key, s.label, s.sales_usd, COALESCE(r.return_usd, 0) AS return_usd,

           COALESCE(r.return_usd, 0) / s.sales_usd AS return_rate_value,

           s.sold_quantity, COALESCE(r.returned_quantity, 0) AS returned_quantity,

           s.sold_uoms, COALESCE(r.return_uoms, 0) AS return_uoms

    FROM sales s LEFT JOIN returns r ON r.key = s.key

    WHERE s.sales_usd >= ?

    ORDER BY return_rate_value DESC LIMIT ?`,

 ).all(...sales.params, ...returns.params, RETURN_RISK_MIN_SALES_USD, limit).map((r) => ({ ...r }));

}



export function getCustomerDetail(db, filters, customerCode) {

 const scoped = { ...filters, customer: customerCode };

 const julyScoped = { ...scoped, period: 'july', startDate: '', endDate: '' };

 const customer = db.prepare('SELECT * FROM customers WHERE bp_code = ?').get(customerCode);

 return {

   customer: customer ? { ...customer } : null,

   summary: getLineSummary(db, 'sale', scoped),

   profit: getSalesProfitSummary(db, scoped),

   trend: getTrend(db, 'sale', scoped),

   items: getRanking(db, 'sale', scoped, 'item', { limit: 20 }),

   categories: getRanking(db, 'sale', scoped, 'category', { limit: 15 }),

   warehouses: getRanking(db, 'sale', scoped, 'warehouse', { limit: 15 }),

   invoices: getTopInvoices(db, scoped, 'sale', 50),

   july_return_summary: getLineSummary(db, 'return', julyScoped),

   july_return_invoices: getTopInvoices(db, julyScoped, 'return', 25),

   return_availability: isReturnDetailAvailable(db, scoped),

 };

}



export function getItemDetail(db, filters, itemNo) {

 const scoped = { ...filters, item: itemNo };

 const julyScoped = { ...scoped, period: 'july', startDate: '', endDate: '' };

 const item = db.prepare('SELECT * FROM items WHERE item_no = ?').get(itemNo);

 return {

   item: item ? { ...item } : null,

   summary: getLineSummary(db, 'sale', scoped),

   profit: getSalesProfitSummary(db, scoped),

   trend: getTrend(db, 'sale', scoped),

   customers: getRanking(db, 'sale', scoped, 'customer', { limit: 20 }),

   warehouses: getRanking(db, 'sale', scoped, 'warehouse', { limit: 15 }),

   invoices: getTopInvoices(db, scoped, 'sale', 50),

   july_return_summary: getLineSummary(db, 'return', julyScoped),

   july_return_invoices: getTopInvoices(db, julyScoped, 'return', 25),

   return_availability: isReturnDetailAvailable(db, scoped),

 };

}



export function getInvoiceDetail(db, transactionType, sourceDocumentId) {

 const header = db.prepare(

   `SELECT h.*, c.bp_name, c.category AS customer_category, c.subcategory,

           c.sales_employee_name, c.account_manager

    FROM transaction_headers h LEFT JOIN customers c ON c.bp_code = h.customer_code

    WHERE h.transaction_type = ? AND h.source_document_id = ?`,

 ).get(transactionType, sourceDocumentId);

 const lines = db.prepare(

   `SELECT l.*, i.category, i.item_group, i.family, i.type

    FROM transaction_lines l LEFT JOIN items i ON i.item_no = l.item_no

    WHERE l.transaction_type = ? AND l.source_document_id = ?

    ORDER BY l.line_number`,

 ).all(transactionType, sourceDocumentId).map((r) => ({ ...r }));

 return { header: header ? { ...header } : null, lines };

}



export function getFilterOptions(db) {

 const values = (sql, key, label = key) => db.prepare(sql).all().map((r) => ({ value: r[key], label: r[label] ?? r[key] }));

 return {

   customers: values("SELECT bp_code, bp_name FROM customers ORDER BY bp_name", 'bp_code', 'bp_name'),

   items: values("SELECT item_no, item_description FROM items ORDER BY item_description", 'item_no', 'item_description'),

   categories: values("SELECT DISTINCT category FROM items WHERE category IS NOT NULL AND trim(category) != '' ORDER BY category", 'category'),

   warehouses: values("SELECT DISTINCT warehouse_code FROM transaction_lines WHERE warehouse_code IS NOT NULL ORDER BY warehouse_code", 'warehouse_code'),

   managers: values("SELECT DISTINCT account_manager FROM customers WHERE account_manager IS NOT NULL AND trim(account_manager) != '' ORDER BY account_manager", 'account_manager'),

   salespeople: values("SELECT DISTINCT sales_employee_name FROM customers WHERE sales_employee_name IS NOT NULL AND trim(sales_employee_name) != '' ORDER BY sales_employee_name", 'sales_employee_name'),

 };

}



export function getOverviewAnalytics(db, filters) {

 const sales = getLineSummary(db, 'sale', filters);

 const salesHeaders = getHeaderSummary(db, 'sale', filters);

 const returnHeaders = getHeaderSummary(db, 'return', filters);

 const salesDocumentFinancials = getHeaderFinancialSummary(db, 'sale', filters);

 const returnDocumentFinancials = getHeaderFinancialSummary(db, 'return', filters);

 const salesProfit = getSalesProfitSummary(db, filters);

 const returnAvailability = isReturnDetailAvailable(db, filters);

 const returns = returnAvailability.available ? getLineSummary(db, 'return', filters) : null;

 return {

   sales,

   sales_headers: salesHeaders,

   sales_document_financials: salesDocumentFinancials,

   sales_profit: salesProfit,

   return_headers: returnHeaders,

   return_document_financials: returnDocumentFinancials,

   returns,

   return_availability: returnAvailability,

   net_sales_usd: returns ? sales.value_usd - returns.value_usd : null,

   net_document_sales_usd: salesDocumentFinancials.available && returnDocumentFinancials.available

     ? salesDocumentFinancials.document_value_usd - returnDocumentFinancials.document_value_usd

     : null,

   sales_trend: getTrend(db, 'sale', filters),

   month_comparison: getMonthComparison(db, filters),

   customer_ranking: getRanking(db, 'sale', filters, 'customer', { limit: 10 }),

   item_ranking: getRanking(db, 'sale', filters, 'item', { limit: 10 }),

   category_mix: getRanking(db, 'sale', filters, 'category', { limit: 10 }),

   warehouse_mix: getRanking(db, 'sale', filters, 'warehouse', { limit: 10 }),

   currency_mix: getRanking(db, 'sale', filters, 'currency', { limit: 5 }),

   customer_movers: getMovers(db, filters, 'customer', 5),

   item_movers: getMovers(db, filters, 'item', 5),

 };

}



export function getSalesAnalytics(db, filters) {

 return {

   summary: getLineSummary(db, 'sale', filters),

   headers: getHeaderSummary(db, 'sale', filters),

   document_financials: getHeaderFinancialSummary(db, 'sale', filters),

   profit: getSalesProfitSummary(db, filters),

   trend: getTrend(db, 'sale', filters),

   comparison: getMonthComparison(db, filters),

   weekday: getWeekdayProfile(db, filters),

   customers: getRanking(db, 'sale', filters, 'customer', { limit: 25 }),

   items: getRanking(db, 'sale', filters, 'item', { limit: 25 }),

   categories: getRanking(db, 'sale', filters, 'category', { limit: 25 }),

   item_groups: getRanking(db, 'sale', filters, 'item_group', { limit: 20 }),

   warehouses: getRanking(db, 'sale', filters, 'warehouse', { limit: 25 }),

   managers: getRanking(db, 'sale', filters, 'manager', { limit: 25 }),

   salespeople: getRanking(db, 'sale', filters, 'salesperson', { limit: 50 }),

   currencies: getRanking(db, 'sale', filters, 'currency', { limit: 5 }),

   customer_movers: getMovers(db, filters, 'customer', 10),

   item_movers: getMovers(db, filters, 'item', 10),

   warehouse_movers: getMovers(db, filters, 'warehouse', 10),

   invoice_distribution: getInvoiceDistribution(db, filters),

   top_invoices: getTopInvoices(db, filters, 'sale', 25),

 };

}



export function getReturnsAnalytics(db, filters) {

 const availability = isReturnDetailAvailable(db, filters);

 const julyFilters = { ...filters, period: 'july', startDate: '', endDate: '' };

 return {

   headers: getHeaderSummary(db, 'return', filters),

   document_financials: getHeaderFinancialSummary(db, 'return', filters),

   july_document_financials: getHeaderFinancialSummary(db, 'return', filters, 'july'),

   august_document_financials: getHeaderFinancialSummary(db, 'return', filters, 'august'),

   header_trend: getHeaderTrend(db, 'return', filters),

   header_value_trend: getHeaderValueTrend(db, 'return', filters),

   coverage: getCoverageByMonth(db, 'return', filters),

   availability,

   covered_period_label: 'July 2026',

   july_summary: getLineSummary(db, 'return', julyFilters),

   july_trend: getTrend(db, 'return', julyFilters),

   customers: getRanking(db, 'return', julyFilters, 'customer', { limit: 25 }),

   items: getRanking(db, 'return', julyFilters, 'item', { limit: 25 }),

   categories: getRanking(db, 'return', julyFilters, 'category', { limit: 20 }),

   warehouses: getRanking(db, 'return', julyFilters, 'warehouse', { limit: 20 }),

   item_risk: getReturnRisk(db, julyFilters, 'item', 25),

   customer_risk: getReturnRisk(db, julyFilters, 'customer', 25),

   invoices: getTopInvoices(db, julyFilters, 'return', 25),

 };

}



export function getCustomersAnalytics(db, filters) {

 return {

   summary: getLineSummary(db, 'sale', filters),

   profit: getSalesProfitSummary(db, filters),

   ranking: getRanking(db, 'sale', filters, 'customer', { limit: 50 }),

   movers: getMovers(db, filters, 'customer', 20),

   activity: getActivitySegments(db, filters),

   managers: getRanking(db, 'sale', filters, 'manager', { limit: 30 }),

   salespeople: getRanking(db, 'sale', filters, 'salesperson', { limit: 60 }),

 };

}



export function getItemsAnalytics(db, filters) {

 return {

   summary: getLineSummary(db, 'sale', filters),

   profit: getSalesProfitSummary(db, filters),

   items: getRanking(db, 'sale', filters, 'item', { limit: 50 }),

   categories: getRanking(db, 'sale', filters, 'category', { limit: 30 }),

   item_groups: getRanking(db, 'sale', filters, 'item_group', { limit: 20 }),

   warehouses: getRanking(db, 'sale', filters, 'warehouse', { limit: 50 }),

   item_movers: getMovers(db, filters, 'item', 20),

   category_movers: getMovers(db, filters, 'category', 15),

   warehouse_movers: getMovers(db, filters, 'warehouse', 15),

 };

}

