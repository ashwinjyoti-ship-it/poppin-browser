import type { DatabaseProperty, DatabaseRow } from '../types';

export type FilterOperator =
  | 'eq' | 'neq' | 'contains' | 'not_contains' | 'empty' | 'not_empty'
  | 'before' | 'after' | 'on_or_before' | 'on_or_after'
  | 'today' | 'this_week' | 'this_month'
  | 'past_week' | 'past_month' | 'next_week' | 'next_month'
  | 'gt' | 'lt' | 'gte' | 'lte';

export interface DatabaseFilter {
  propertyId: string;
  operator: FilterOperator;
  value?: string;
  conjunction?: 'and' | 'or'; // conjunction with the PREVIOUS filter; undefined = 'and'
}

export interface DatabaseSort {
  propertyId: string;
  direction: 'asc' | 'desc';
}

export type ViewType = 'table' | 'board' | 'calendar' | 'gallery' | 'list';

export interface SavedDatabaseView {
  id: string;
  database_id: string;
  name: string;
  view_type: ViewType;
  filters: string;
  sort_config: string;
  order_index: number;
}

export type RollupAggregation = 'count' | 'count_values' | 'sum' | 'average' | 'min' | 'max' | 'show_unique';

export interface RollupOptions {
  relationPropertyId: string;
  targetPropertyId: string;
  aggregation: RollupAggregation;
}

export interface RelatedSchemaProperty {
  id: string;
  name: string;
  type: string;
}

export function parseRowProperties(row: DatabaseRow): Record<string, unknown> {
  try {
    return JSON.parse(row.properties || '{}');
  } catch {
    return {};
  }
}

export function getPropValue(row: DatabaseRow, propId: string): unknown {
  return parseRowProperties(row)[propId] ?? '';
}

export function getRowTitle(
  row: DatabaseRow,
  nameProp: DatabaseProperty | undefined,
): string {
  if (row.page_title) return row.page_title;
  if (nameProp) return String(getPropValue(row, nameProp.id) || 'Untitled');
  return 'Untitled';
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return isoDate(new Date());
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function isoWeekBounds(offsetWeeks = 0): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = addDays(now, diffToMon + offsetWeeks * 7);
  return { start: isoDate(mon), end: isoDate(addDays(mon, 6)) };
}

function isoMonthBounds(offsetMonths = 0): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + offsetMonths;
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  return { start: isoDate(first), end: isoDate(last) };
}

function matchFilter(
  row: DatabaseRow,
  filter: DatabaseFilter,
  getValue: (row: DatabaseRow, propId: string) => unknown = getPropValue,
): boolean {
  const raw = getValue(row, filter.propertyId);

  // Normalize checkbox comparisons: filter values "true"/"false" compare as booleans
  if (filter.value === 'true' || filter.value === 'false') {
    const rawBool = parseCheckboxValue(raw);
    const filterBool = filter.value === 'true';
    if (filter.operator === 'eq') return rawBool === filterBool;
    if (filter.operator === 'neq') return rawBool !== filterBool;
  }

  const value = Array.isArray(raw) ? raw.join(',') : String(raw ?? '');

  // Date-specific operators — ISO strings compare lexicographically
  switch (filter.operator) {
    case 'before':
      return value !== '' && value < (filter.value ?? '');
    case 'after':
      return value !== '' && value > (filter.value ?? '');
    case 'on_or_before':
      return value !== '' && value <= (filter.value ?? '');
    case 'on_or_after':
      return value !== '' && value >= (filter.value ?? '');
    case 'today':
      return value !== '' && value === today();
    case 'this_week': {
      const { start, end } = isoWeekBounds(0);
      return value !== '' && value >= start && value <= end;
    }
    case 'this_month': {
      const { start, end } = isoMonthBounds(0);
      return value !== '' && value >= start && value <= end;
    }
    case 'past_week': {
      const t = today();
      return value !== '' && value >= isoDate(addDays(new Date(), -7)) && value <= t;
    }
    case 'past_month': {
      const t = today();
      return value !== '' && value >= isoDate(addDays(new Date(), -30)) && value <= t;
    }
    case 'next_week': {
      const { start, end } = isoWeekBounds(1);
      return value !== '' && value >= start && value <= end;
    }
    case 'next_month': {
      const { start, end } = isoMonthBounds(1);
      return value !== '' && value >= start && value <= end;
    }
    case 'eq':
      return value === (filter.value ?? '');
    case 'neq':
      return value !== (filter.value ?? '');
    case 'contains':
      // For array values (multi-select, relation): exact option match
      if (Array.isArray(raw)) {
        return raw.some((item) => String(item).toLowerCase() === (filter.value ?? '').toLowerCase());
      }
      return value.toLowerCase().includes((filter.value ?? '').toLowerCase());
    case 'not_contains':
      if (Array.isArray(raw)) {
        return !raw.some((item) => String(item).toLowerCase() === (filter.value ?? '').toLowerCase());
      }
      return !value.toLowerCase().includes((filter.value ?? '').toLowerCase());
    case 'empty':
      return value === '' || (Array.isArray(raw) && raw.length === 0);
    case 'not_empty':
      return value !== '' && !(Array.isArray(raw) && raw.length === 0);
    case 'gt': {
      const n = parseFloat(value); const fv = parseFloat(filter.value ?? '');
      return !isNaN(n) && !isNaN(fv) && n > fv;
    }
    case 'lt': {
      const n = parseFloat(value); const fv = parseFloat(filter.value ?? '');
      return !isNaN(n) && !isNaN(fv) && n < fv;
    }
    case 'gte': {
      const n = parseFloat(value); const fv = parseFloat(filter.value ?? '');
      return !isNaN(n) && !isNaN(fv) && n >= fv;
    }
    case 'lte': {
      const n = parseFloat(value); const fv = parseFloat(filter.value ?? '');
      return !isNaN(n) && !isNaN(fv) && n <= fv;
    }
    default:
      return true;
  }
}

export function applyFilters(
  rows: DatabaseRow[],
  filters: DatabaseFilter[],
  getValue: (row: DatabaseRow, propId: string) => unknown = getPropValue,
): DatabaseRow[] {
  if (filters.length === 0) return rows;

  // Split flat filter list into AND-groups at each 'or' boundary.
  // A filter with conjunction 'or' starts a new group.
  // Row passes if ANY group passes (all filters in the group must match).
  const groups: DatabaseFilter[][] = [[]];
  for (const f of filters) {
    if (f.conjunction === 'or' && groups[groups.length - 1].length > 0) {
      groups.push([]);
    }
    groups[groups.length - 1].push(f);
  }

  return rows.filter((row) =>
    groups.some((group) => group.every((f) => matchFilter(row, f, getValue))),
  );
}

export function applySort(
  rows: DatabaseRow[],
  sorts: DatabaseSort[],
  properties: DatabaseProperty[],
  getValue: (row: DatabaseRow, propId: string) => unknown = getPropValue,
): DatabaseRow[] {
  if (sorts.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const sort of sorts) {
      const prop = properties.find((p) => p.id === sort.propertyId);
      const av = String(getValue(a, sort.propertyId));
      const bv = String(getValue(b, sort.propertyId));
      let cmp = av.localeCompare(bv, undefined, { numeric: true });
      if (prop?.name.toLowerCase() === 'priority') {
        const order: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
        cmp = (order[av] ?? 99) - (order[bv] ?? 99);
      }
      if (cmp !== 0) return sort.direction === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

export function parseRelationValue(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string' && raw) return [raw];
  return [];
}

export function parseMultiSelectValue(raw: unknown): string[] {
  return parseRelationValue(raw);
}

export function parseCheckboxValue(raw: unknown): boolean {
  return raw === true || raw === 'true' || raw === 1 || raw === '1';
}

export function parseRollupOptions(options: string): Partial<RollupOptions> {
  try {
    const parsed = JSON.parse(options || '{}');
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Partial<RollupOptions>;
    }
  } catch { /* ignore */ }
  return {};
}

export const ROLLUP_AGGREGATIONS: { value: RollupAggregation; label: string }[] = [
  { value: 'count', label: 'Count all' },
  { value: 'count_values', label: 'Count values' },
  { value: 'sum', label: 'Sum' },
  { value: 'average', label: 'Average' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
  { value: 'show_unique', label: 'Show unique' },
];

export function parseRelationOptions(options: string): { relatedDatabaseId?: string } {
  try {
    const parsed = JSON.parse(options || '{}');
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as { relatedDatabaseId?: string };
    }
  } catch { /* ignore */ }
  return {};
}
