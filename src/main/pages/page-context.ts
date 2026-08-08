import type { PageContextSnapshot } from '../../shared/workspace';
import type { DatabasePropertySnapshot, PageDocumentSnapshot, PageJsonValue } from '../../shared/pages';
import { PagesStore } from './pages-store';

export const MAX_PAGE_CONTEXT_CHARACTERS = 60_000;
const SMALL_DATABASE_ROWS = 35;

export function selectedPageContexts(store: PagesStore): PageContextSnapshot[] {
  return store.listSelectedPageIds().flatMap((pageId) => {
    const document = store.getPage(pageId);
    return document ? [pageContext(document)] : [];
  });
}

export function querySelectedDatabase(store: PagesStore, databaseId: string, limit = 50): string {
  if (!store.listSelectedPageIds().includes(databaseId)) throw new Error('Select this database in the Pages pane before querying it.');
  const document = store.getPage(databaseId);
  if (!document?.database) throw new Error('Selected item is not a database.');
  return databaseCsv(document, Math.max(1, Math.min(200, Math.floor(limit))));
}

function pageContext(document: PageDocumentSnapshot): PageContextSnapshot {
  if (document.database) {
    const rows = document.database.rows.length;
    const content = rows <= SMALL_DATABASE_ROWS
      ? databaseCsv(document, SMALL_DATABASE_ROWS)
      : `Database: ${document.page.title}\nRows: ${rows}\nColumns: ${document.database.properties.map((property) => `${property.name} (${property.type})`).join(', ')}\nUse database_query with databaseId ${document.page.id} to retrieve bounded rows.`;
    return { pageId: document.page.id, title: document.page.title, kind: 'database', content, truncated: false, rowCount: rows };
  }
  const openComments = document.comments.filter((comment) => comment.status === 'open');
  const raw = [
    document.blocks.map((block) => blockText(block.content)).filter(Boolean).join('\n\n'),
    ...(openComments.length ? [`\nOPEN SELECTION INSTRUCTIONS\n${openComments.map((comment) => `- commentId ${comment.id}: replace "${comment.selection.quote}" as instructed: ${comment.instruction}`).join('\n')}`] : []),
  ].join('\n');
  return {
    pageId: document.page.id, title: document.page.title, kind: 'page',
    content: raw.slice(0, MAX_PAGE_CONTEXT_CHARACTERS), truncated: raw.length > MAX_PAGE_CONTEXT_CHARACTERS, rowCount: null,
  };
}

function databaseCsv(document: PageDocumentSnapshot, limit: number): string {
  const database = document.database!;
  const properties = database.properties;
  const lines = [csvRow(properties.map((property) => property.name))];
  for (const row of database.rows.slice(0, limit)) {
    lines.push(csvRow(properties.map((property) => displayCell(row.properties[property.id], property))));
  }
  return [`Database: ${document.page.title}`, `Rows shown: ${Math.min(limit, database.rows.length)} of ${database.rows.length}`, '', ...lines].join('\n');
}

function displayCell(value: PageJsonValue | undefined, property: DatabasePropertySnapshot): string {
  if (value === null || value === undefined) return '';
  if (property.type === 'checkbox') return value === true ? 'true' : 'false';
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function csvRow(values: string[]): string {
  return values.map((value) => `"${value.replaceAll('"', '""')}"`).join(',');
}

function blockText(value: PageJsonValue): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.text === 'string') return value.text;
  return '';
}
