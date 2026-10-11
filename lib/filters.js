// F-004: parses/normalizes dashboard filter query params. Never throws on bad

// input — unknown/invalid values fall back to defaults so a malformed URL

// degrades gracefully instead of erroring the whole page.



export const PERIODS = ['july', 'august', 'both'];

export const CURRENCIES = ['all', 'USD', 'LBP'];



export const DEFAULT_FILTERS = Object.freeze({

 period: 'both',

 currency: 'all',

 includeCanceled: false,

 startDate: '',

 endDate: '',

 customer: '',

 item: '',

 category: '',

 warehouse: '',

 accountManager: '',

 salesEmployee: '',

});



function clean(value, maxLength = 120) {

 return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

}



function validSnapshotDate(value) {

 const text = clean(value, 10);

 return /^2026-(07|08)-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) ? text : '';

}



export function parseFilters(query = {}) {

 const period = PERIODS.includes(query.period) ? query.period : DEFAULT_FILTERS.period;

 const currency = CURRENCIES.includes(query.currency) ? query.currency : DEFAULT_FILTERS.currency;

 const includeCanceled = query.includeCanceled === 'true' || query.includeCanceled === true;

 let startDate = validSnapshotDate(query.startDate);

 let endDate = validSnapshotDate(query.endDate);

 if (!startDate || !endDate || startDate > endDate) {

   startDate = '';

   endDate = '';

 }

 return {

   period,

   currency,

   includeCanceled,

   startDate,

   endDate,

   customer: clean(query.customer),

   item: clean(query.item),

   category: clean(query.category),

   warehouse: clean(query.warehouse),

   accountManager: clean(query.accountManager),

   salesEmployee: clean(query.salesEmployee),

 };

}



export function filtersToQueryString(filters) {

 const params = new URLSearchParams();

 for (const [key, value] of Object.entries({ ...DEFAULT_FILTERS, ...filters })) {

   if (key === 'includeCanceled') params.set(key, String(Boolean(value)));

   else if (value) params.set(key, String(value));

 }

 return params.toString();

}



export function cancellationLabel(filters) {

 return filters.includeCanceled ? 'Including canceled documents' : 'Excluding canceled documents';

}



export function currencyLabel(filters) {

 return filters.currency === 'all' ? 'All currencies (USD + LBP)' : filters.currency;

}



export function periodLabel(filters) {

 if (filters.startDate && filters.endDate) return `${filters.startDate}–${filters.endDate}`;

 return { july: 'July 2026', august: 'August 2026', both: 'July–August 2026' }[filters.period];

}