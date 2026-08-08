import { Download, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { DatabasePropertyType, PageDocumentSnapshot, PageJsonValue, PagesCommand } from '../../shared/pages';

export function NativeDatabaseView({ pageId, revision, onCommand }: {
  pageId: string;
  revision: number;
  onCommand: (command: PagesCommand) => Promise<string | null>;
}) {
  const [document, setDocument] = useState<PageDocumentSnapshot | null>(null);
  const [propertyName, setPropertyName] = useState('');
  const [propertyType, setPropertyType] = useState<DatabasePropertyType>('text');
  const [message, setMessage] = useState('');
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reload = async () => setDocument(await window.poppinPages.getPage(pageId));
  useEffect(() => {
    let mounted = true;
    void window.poppinPages.getPage(pageId).then((next) => { if (mounted) setDocument(next); });
    return () => { mounted = false; };
  }, [pageId, revision]);
  useEffect(() => () => { if (titleTimer.current) clearTimeout(titleTimer.current); }, []);
  if (!document?.database) return <section className="native-stage-empty">Loading database…</section>;
  const database = document.database;

  const updateCell = async (rowId: string, propertyId: string, raw: string) => {
    const row = database.rows.find((candidate) => candidate.id === rowId);
    const property = database.properties.find((candidate) => candidate.id === propertyId);
    if (!row || !property) return;
    let value: PageJsonValue = raw;
    if (property.type === 'number') value = raw === '' ? null : Number(raw);
    if (property.type === 'checkbox') value = raw === 'true';
    const error = await onCommand({ type: 'updateDatabaseRow', rowId, properties: { ...row.properties, [propertyId]: value } });
    setMessage(error ?? 'Saved');
    if (!error) await reload();
  };

  return (
    <section className="native-database-view" aria-label={`Database ${document.page.title}`}>
      <header className="native-document-header">
        <input className="native-title-input" aria-label="Database title" defaultValue={document.page.title} onChange={(event) => {
          const title = event.target.value;
          if (titleTimer.current) clearTimeout(titleTimer.current);
          titleTimer.current = setTimeout(() => { void onCommand({ type: 'renamePage', pageId, title }); }, 450);
        }} onBlur={(event) => { if (titleTimer.current) clearTimeout(titleTimer.current); void onCommand({ type: 'renamePage', pageId, title: event.target.value }); }} />
        <div className="native-document-meta"><span>Local Database · {database.rows.length} rows</span><span className="native-header-actions"><button type="button" onClick={() => { void window.poppinPages.exportPage(pageId, 'xlsx').then((result) => setMessage(result.message ?? 'Exported Excel workbook.')); }}><Download size={12} /> Excel</button>{message ? <em>{message}</em> : null}</span></div>
      </header>
      <div className="database-toolbar">
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!propertyName.trim()) return;
          void onCommand({ type: 'addDatabaseProperty', databaseId: pageId, name: propertyName, propertyType }).then(async (error) => { setMessage(error ?? 'Column added'); if (!error) { setPropertyName(''); await reload(); } });
        }}>
          <input aria-label="New column name" value={propertyName} onChange={(event) => setPropertyName(event.target.value)} placeholder="New column" />
          <select aria-label="New column type" value={propertyType} onChange={(event) => setPropertyType(event.target.value as DatabasePropertyType)}>
            <option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="checkbox">Checkbox</option><option value="select">Select</option>
          </select>
          <button type="submit"><Plus size={13} /> Add column</button>
        </form>
        <select aria-label="Database view" value={String(document.viewState?.state.viewType ?? 'table')} onChange={(event) => { void onCommand({ type: 'saveViewState', pageId, state: { ...document.viewState?.state, viewType: event.target.value } }); }}>
          <option value="table">Table</option><option value="board">Board</option><option value="calendar">Calendar</option>
        </select>
      </div>
      <div className="database-table-wrap">
        <table className="native-database-table">
          <thead><tr>{database.properties.map((property) => <th key={property.id}>{property.name}<small>{property.type.replace('_', ' ')}</small></th>)}<th aria-label="Row actions" /></tr></thead>
          <tbody>
            {database.rows.map((row) => (
              <tr key={row.id}>
                {database.properties.map((property) => (
                  <td key={property.id}>
                    {property.type === 'checkbox' ? <input type="checkbox" aria-label={`${property.name} row ${row.position + 1}`} checked={row.properties[property.id] === true} onChange={(event) => { void updateCell(row.id, property.id, String(event.target.checked)); }} /> : <input key={`${row.updatedAt}:${cellText(row.properties[property.id])}`} aria-label={`${property.name} row ${row.position + 1}`} type={property.type === 'number' ? 'number' : property.type === 'date' ? 'date' : 'text'} defaultValue={cellText(row.properties[property.id])} onBlur={(event) => { void updateCell(row.id, property.id, event.target.value); }} />}
                  </td>
                ))}
                <td><button type="button" aria-label={`Delete row ${row.position + 1}`} onClick={() => { void onCommand({ type: 'deleteDatabaseRow', rowId: row.id }).then(() => reload()); }}><Trash2 size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {database.properties.length === 0 ? <p className="native-empty-copy">Add a column before adding rows.</p> : null}
      </div>
      <button type="button" className="native-add-button" disabled={database.properties.length === 0} onClick={() => { void onCommand({ type: 'addDatabaseRow', databaseId: pageId, properties: {} }).then(() => reload()); }}><Plus size={15} /> Add row</button>
    </section>
  );
}

function cellText(value: PageJsonValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
