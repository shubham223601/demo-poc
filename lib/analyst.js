// F-013: deterministic local analyst over approved semantic operations.

// No prompts or data leave the process; no arbitrary SQL is accepted.



import {

 getMonthComparison,

 getRanking,

 getReturnRisk,

 getCoverageByMonth,

 getHeaderFinancialSummary,

 getLineSummary,

 getSalesProfitSummary,

 getTrend,

 getTopInvoices,

 LBP_PER_SYSTEM_USD,

 RETURN_RISK_MIN_SALES_USD,

} from './analytics.js';



function escapeHtml(value) {

 return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

}



function usd(value) {

 return `$${Math.round(Number(value) || 0).toLocaleString('en-US')}`;

}



function pct(value) {

 return `${(Number(value) * 100).toFixed(1)}%`;

}



function table(headers, rows) {

 return `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

}



export function answerQuestion(db, question, filters) {

 const q = String(question ?? '').trim();

 const lower = q.toLowerCase();

 if (!q) return null;



 if (lower.includes('august') && lower.includes('return')) {

   const coverage = getCoverageByMonth(db, 'return', filters);

   const august = coverage.find((row) => row.period === 'august');

   const value = getHeaderFinancialSummary(db, 'return', filters, 'august');

   return {

     question: q,

     status: value.available ? 'qualified' : 'blocked',

     title: value.available ? 'August return document value is available' : 'August return document value is unavailable',

     html: value.available

       ? `<p>August return document value is <strong>${usd(value.document_value_usd)}</strong> across <strong>${value.documents.toLocaleString('en-US')}</strong> non-canceled return documents. USD documents use their FC total; LBP documents use the verified ${LBP_PER_SYSTEM_USD.toLocaleString('en-US')} LBP per SC USD relationship.</p><p>Only ${august.covered_headers.toLocaleString('en-US')} August return header has linked detail, and it is canceled. Therefore item, category, warehouse, quantity, and line-level return-rate breakdowns remain unavailable—not zero.</p>`

       : `<p>${escapeHtml(value.reason)}</p>`,

     evidence: 'D-015 · header document totals; D-011 · return detail coverage',

   };

 }



 if (lower.includes('net') && lower.includes('july') && lower.includes('august')) {

   const julySales = getHeaderFinancialSummary(db, 'sale', filters, 'july');

   const augustSales = getHeaderFinancialSummary(db, 'sale', filters, 'august');

   const julyReturns = getHeaderFinancialSummary(db, 'return', filters, 'july');

   const augustReturns = getHeaderFinancialSummary(db, 'return', filters, 'august');

   if (![julySales, augustSales, julyReturns, augustReturns].every((summary) => summary.available)) {

     return {

       question: q,

       status: 'blocked',

       title: 'Net document sales cannot be allocated to these filters',

       html: '<p>Header document totals cannot be assigned safely to an item, category, or warehouse where return detail is incomplete. Remove the line-dimension filter to compare net document sales.</p>',

       evidence: 'D-015 · header-grain allocation rule',

     };

   }

   const julyNet = julySales.document_value_usd - julyReturns.document_value_usd;

   const augustNet = augustSales.document_value_usd - augustReturns.document_value_usd;

   const change = augustNet - julyNet;

   return {

     question: q,

     status: 'qualified',

     title: 'August net document sales compared with July',

     html: `<p>Net document sales were <strong>${usd(augustNet)}</strong> in August versus <strong>${usd(julyNet)}</strong> in July, a change of <strong>${usd(change)}</strong> (${julyNet ? pct(change / Math.abs(julyNet)) : 'percentage unavailable'}).</p><p>This uses complete non-canceled header document totals converted to SC USD. Return detail mix remains unavailable for August.</p>`,

     evidence: 'D-015 · sales document value minus return document value',

   };

 }



 if (lower.includes('gross profit') || lower.includes('gross margin') || lower.includes('profitability')) {

   const profit = getSalesProfitSummary(db, filters);

   return {

     question: q,

     status: profit.available ? 'qualified' : 'blocked',

     title: profit.available ? 'Covered sales gross profit and margin' : 'Gross profit and margin are unavailable',

     html: profit.available

       ? `<p>Covered-line gross profit is <strong>${usd(profit.gross_profit_usd)}</strong> on <strong>${usd(profit.sales_value_usd)}</strong> of SC sales, a gross margin of <strong>${pct(profit.gross_margin)}</strong>. COGS is converted from its fixed local-currency field at 89,500 LBP per SC USD.</p><p>This is descriptive profitability for detail-covered sales. It does not establish why profit changed.</p>`

       : '<p>Sales detail or COGS is unavailable for the selected population.</p>',

     evidence: 'D-015 · row_total_sc minus converted total_cogs_value',

   };

 }



 if (lower.includes('inventory') || lower.includes('forecast') || lower.includes('stockout') || lower.includes('overdue') || lower.includes('why') || lower.includes('cause')) {

   return {

     question: q,

     status: 'blocked',

     title: 'The requested conclusion is not supported by this snapshot',

     html: '<p>The workbook does not contain governed inventory, due-date, reason, forecast, or causal data. Ask for a descriptive sales/return trend, ranking, mix, concentration, contribution, or invoice detail instead.</p>',

     evidence: 'PRODUCT.md non-goals · A-08 guardrails',

   };

 }



 if (lower.includes('return') && lower.includes('coverage')) {

   const rows = getCoverageByMonth(db, 'return', filters);

   return {

     question: q,

     status: 'qualified',

     title: 'Return detail coverage by month',

     html: table(['Month','Headers','With detail','Coverage'], rows.map((row) => `<tr><td>${row.period === 'july' ? 'July 2026' : 'August 2026'}</td><td>${row.headers.toLocaleString('en-US')}</td><td>${row.covered_headers.toLocaleString('en-US')}</td><td>${pct(row.coverage)}</td></tr>`)),

     evidence: 'R-03 · transaction headers with linked detail rows',

   };

 }



 if ((lower.includes('august') && lower.includes('july')) || lower.includes('compare') || lower.includes('change')) {

   const cmp = getMonthComparison(db, filters);

   return {

     question: q,

     status: 'ok',

     title: 'August covered sales compared with July',

     html: `<p>Covered SC sales were <strong>${usd(cmp.value_usd.august)}</strong> in August versus <strong>${usd(cmp.value_usd.july)}</strong> in July: a change of <strong>${usd(cmp.value_usd.change)}</strong> (${cmp.value_usd.percent_change === null ? 'percentage unavailable' : pct(cmp.value_usd.percent_change)}).</p><p>This is a descriptive comparison of System Currency (USD) line value.</p>`,

     evidence: 'S-08 · covered transaction lines grouped by posting month',

   };

 }



 if (lower.includes('return rate') && (lower.includes('item') || lower.includes('product'))) {

   const rows = getReturnRisk(db, { ...filters, period: 'july', startDate: '', endDate: '' }, 'item', 10);

   return {

     question: q,

     status: 'ok',

     title: 'Highest July item return rates by value',

     html: `<p>Eligibility requires at least ${usd(RETURN_RISK_MIN_SALES_USD)} in July SC sales. Results are July-only because August return details are unavailable.</p>${table(['Item','July sales','July returns','Return rate'], rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${usd(row.sales_usd)}</td><td>${usd(row.return_usd)}</td><td>${pct(row.return_rate_value)}</td></tr>`))}`,

     evidence: 'R-11 · July sale/return SC value by item',

   };

 }



 if (lower.includes('trend') || lower.includes('daily')) {

   const rows = getTrend(db, 'sale', filters);

   const total = rows.reduce((sum, row) => sum + row.value_usd, 0);

   const peak = [...rows].sort((a, b) => b.value_usd - a.value_usd)[0];

   return {

     question: q,

     status: 'ok',

     title: 'Daily covered sales trend',

     html: `<p>The selected period contains <strong>${rows.length}</strong> observed sales days and <strong>${usd(total)}</strong> in covered SC sales.${peak ? ` The highest observed day was <strong>${escapeHtml(peak.date)}</strong> at <strong>${usd(peak.value_usd)}</strong>.` : ''}</p>${table(['Date','SC sales','Documents'], rows.slice(-15).map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${usd(row.value_usd)}</td><td>${row.documents.toLocaleString('en-US')}</td></tr>`))}`,

     evidence: 'S-02 · covered sales lines grouped by posting date',

   };

 }



 if (lower.includes('customer')) {

   const rows = getRanking(db, 'sale', filters, 'customer', { limit: 10 });

   const share = rows.reduce((sum, row) => sum + (row.share ?? 0), 0);

   return {

     question: q,

     status: 'ok',

     title: 'Top customers by covered SC sales',

     html: `<p>The top 10 customers represent <strong>${pct(share)}</strong> of selected covered sales.</p>${table(['Customer','Sales','Share','Documents'], rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${usd(row.value_usd)}</td><td>${pct(row.share)}</td><td>${Number(row.documents).toLocaleString('en-US')}</td></tr>`))}`,

     evidence: 'C-02 · covered sales lines joined to customer master',

   };

 }



 if (lower.includes('item') || lower.includes('product')) {

   const rows = getRanking(db, 'sale', filters, 'item', { limit: 10 });

   return {

     question: q,

     status: 'ok',

     title: 'Top items by covered SC sales',

     html: table(['Item','Sales','Share','Customers'], rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${usd(row.value_usd)}</td><td>${pct(row.share)}</td><td>${Number(row.customers).toLocaleString('en-US')}</td></tr>`)),

     evidence: 'I-02 · covered sales lines joined to item master',

   };

 }



 if (lower.includes('category')) {

   const rows = getRanking(db, 'sale', filters, 'category', { limit: 10 });

   return {

     question: q,

     status: 'ok',

     title: 'Sales by item category',

     html: table(['Category','Sales','Share','Customers'], rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${usd(row.value_usd)}</td><td>${pct(row.share)}</td><td>${Number(row.customers).toLocaleString('en-US')}</td></tr>`)),

     evidence: 'I-03 · covered sales lines joined to item category',

   };

 }



 if (lower.includes('warehouse') || lower.includes('branch')) {

   const rows = getRanking(db, 'sale', filters, 'warehouse', { limit: 10 });

   return {

     question: q,

     status: lower.includes('branch') ? 'qualified' : 'ok',

     title: lower.includes('branch') ? 'Warehouse results (not confirmed branches)' : 'Sales by warehouse',

     html: `<p>Warehouse codes are preserved as source codes and are not relabeled as branches.</p>${table(['Warehouse','Sales','Share','Customers'], rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${usd(row.value_usd)}</td><td>${pct(row.share)}</td><td>${Number(row.customers).toLocaleString('en-US')}</td></tr>`))}`,

     evidence: 'W-01 · warehouse_code on covered sales lines',

   };

 }



 if (lower.includes('manager') || lower.includes('sales employee') || lower.includes('salesperson')) {

   const dimension = lower.includes('manager') ? 'manager' : 'salesperson';

   const rows = getRanking(db, 'sale', filters, dimension, { limit: 10 });

   return {

     question: q,

     status: 'qualified',

     title: dimension === 'manager' ? 'Account-manager portfolio attribution' : 'Sales-employee portfolio attribution',

     html: `<p>This is customer-portfolio attribution, not an employee performance score.</p>${table(['Portfolio owner','Sales','Share','Customers'], rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${usd(row.value_usd)}</td><td>${pct(row.share)}</td><td>${Number(row.customers).toLocaleString('en-US')}</td></tr>`))}`,

     evidence: dimension === 'manager' ? 'C-13 · customer master account manager' : 'C-14 · customer master sales employee',

   };

 }



 if (lower.includes('currency')) {

   const rows = getRanking(db, 'sale', filters, 'currency', { limit: 5 });

   return {

     question: q,

     status: 'ok',

     title: 'Document-currency mix with SC values',

     html: `<p>Currency identifies the document class. Values remain System Currency (USD); FC is Foreign Currency.</p>${table(['Document currency','SC sales','Share','Documents'], rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${usd(row.value_usd)}</td><td>${pct(row.share)}</td><td>${Number(row.documents).toLocaleString('en-US')}</td></tr>`))}`,

     evidence: 'S-13 · header currency and line row_total_sc',

   };

 }



 if (lower.includes('invoice') || lower.includes('document')) {

   const rows = getTopInvoices(db, filters, 'sale', 10);

   return {

     question: q,

     status: 'ok',

     title: 'Largest covered sales documents',

     html: table(['Document','Date','Customer','SC sales','Lines'], rows.map((row) => `<tr><td>${escapeHtml(row.document_number ?? row.source_document_id)}</td><td>${escapeHtml(row.posting_date)}</td><td>${escapeHtml(row.customer_name)}</td><td>${usd(row.value_usd)}</td><td>${Number(row.lines).toLocaleString('en-US')}</td></tr>`)),

     evidence: 'S-20 · transaction_type + source_document_id evidence',

   };

 }



 if (lower.includes('sales') || lower.includes('revenue') || lower.includes('summary')) {

   const summary = getLineSummary(db, 'sale', filters);

   return {

     question: q,

     status: 'ok',

     title: 'Covered sales summary',

     html: `<p>Covered SC sales are <strong>${usd(summary.value_usd)}</strong> across <strong>${summary.covered_documents.toLocaleString('en-US')}</strong> documents, <strong>${summary.active_customers.toLocaleString('en-US')}</strong> customers, and <strong>${summary.active_items.toLocaleString('en-US')}</strong> items. Source quantity spans <strong>${summary.uom_count.toLocaleString('en-US')}</strong> UoM codes.</p>`,

     evidence: 'S-01 · covered sales lines under active filters',

   };

 }



 return {

   question: q,

   status: 'qualified',

   title: 'Please make the metric or population more specific',

   html: '<p>Try asking about a sales comparison, top customers, top items, warehouse mix, July return-rate risk, August return coverage, or gross-profit availability.</p>',

   evidence: 'A-01–A-08 supported question families',

 };

}

