import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import type {
  PadAttachmentSnapshot,
  PadBrowserIngestPayload,
  PadCardSubtype,
  PadDropPayload,
  PadObjectKind,
  PadObjectSnapshot,
  PadRecordSnapshot,
  PadTool,
  PoppinPadSnapshot,
} from '../../shared/poppin-pad';

interface PadRow {
  id: string;
  title: string;
  collapsed: number;
  width: number;
  active: number;
  tool: string;
  pending_attachments_json: string;
  updated_at: string;
}

interface ObjectRow {
  id: string;
  pad_id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z_index: number;
  payload_json: string;
  created_at: string;
  updated_at: string;
}

const DRAWING_KINDS = new Set<PadObjectKind>(['stroke', 'arrow', 'rect', 'text', 'sticky']);
const CARD_KIND: PadObjectKind = 'card';

export class PoppinPadStore {
  private readonly database: DatabaseSync;

  constructor(filePath: string) {
    this.database = new DatabaseSync(filePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS poppin_pad (
        id TEXT PRIMARY KEY CHECK (id = 'primary'),
        title TEXT NOT NULL,
        collapsed INTEGER NOT NULL DEFAULT 1 CHECK (collapsed IN (0, 1)),
        width INTEGER NOT NULL DEFAULT 320,
        active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
        tool TEXT NOT NULL DEFAULT 'select',
        pending_attachments_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS poppin_pad_objects (
        id TEXT PRIMARY KEY,
        pad_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        width REAL NOT NULL DEFAULT 0,
        height REAL NOT NULL DEFAULT 0,
        rotation REAL NOT NULL DEFAULT 0,
        z_index INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (pad_id) REFERENCES poppin_pad(id) ON DELETE CASCADE
      ) STRICT;
    `);
    this.ensurePrimaryPad();
  }

  getSnapshot(): PoppinPadSnapshot {
    return {
      pad: this.getPadRecord(),
      objects: this.listObjects(),
      pendingAttachments: this.getPendingAttachments(),
    };
  }

  getPadRecord(): PadRecordSnapshot {
    const row = this.database.prepare("SELECT * FROM poppin_pad WHERE id = 'primary'").get() as unknown as PadRow;
    return this.toPadRecord(row);
  }

  listObjects(): PadObjectSnapshot[] {
    const rows = this.database.prepare(`
      SELECT * FROM poppin_pad_objects WHERE pad_id = 'primary' ORDER BY z_index ASC, created_at ASC
    `).all() as unknown as ObjectRow[];
    return rows.map((row) => this.toObject(row));
  }

  getObject(objectId: string): PadObjectSnapshot | null {
    const row = this.database.prepare('SELECT * FROM poppin_pad_objects WHERE id = ?').get(objectId) as ObjectRow | undefined;
    return row ? this.toObject(row) : null;
  }

  setCollapsed(collapsed: boolean): PadRecordSnapshot {
    return this.updatePad({ collapsed });
  }

  setWidth(width: number): PadRecordSnapshot {
    return this.updatePad({ width: Math.round(width) });
  }

  setActive(active: boolean): PadRecordSnapshot {
    return this.updatePad({ active });
  }

  setTool(tool: PadTool): PadRecordSnapshot {
    return this.updatePad({ tool });
  }

  upsertObject(object: PadObjectSnapshot): PadObjectSnapshot {
    const now = new Date().toISOString();
    const existing = this.getObject(object.id);
    this.database.prepare(`
      INSERT INTO poppin_pad_objects (
        id, pad_id, kind, x, y, width, height, rotation, z_index, payload_json, created_at, updated_at
      ) VALUES (?, 'primary', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        x = excluded.x,
        y = excluded.y,
        width = excluded.width,
        height = excluded.height,
        rotation = excluded.rotation,
        z_index = excluded.z_index,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run(
      object.id,
      object.kind,
      object.x,
      object.y,
      object.width,
      object.height,
      object.rotation,
      object.zIndex,
      JSON.stringify(object.payload),
      existing?.createdAt ?? object.createdAt ?? now,
      now,
    );
    this.touchPad();
    return this.getObject(object.id)!;
  }

  deleteObject(objectId: string): void {
    this.database.prepare('DELETE FROM poppin_pad_objects WHERE id = ?').run(objectId);
    this.removePendingAttachment(objectId);
    this.touchPad();
  }

  clearCanvas(scope: 'all' | 'drawings' | 'cards'): void {
    if (scope === 'all') {
      this.database.prepare("DELETE FROM poppin_pad_objects WHERE pad_id = 'primary'").run();
      this.setPendingAttachments([]);
    } else if (scope === 'drawings') {
      this.database.prepare(`
        DELETE FROM poppin_pad_objects WHERE pad_id = 'primary' AND kind IN ('stroke', 'arrow', 'rect', 'text', 'sticky')
      `).run();
    } else {
      this.database.prepare("DELETE FROM poppin_pad_objects WHERE pad_id = 'primary' AND kind = 'card'").run();
      this.setPendingAttachments(this.getPendingAttachments().filter((item) => this.getObject(item.objectId)));
    }
    this.touchPad();
  }

  ingestDrop(payload: PadDropPayload, x: number, y: number): PadObjectSnapshot {
    const now = new Date().toISOString();
    const id = randomUUID();
    const zIndex = this.nextZIndex();
    if (payload.kind === 'url') {
      const url = payload.url ?? payload.text ?? '';
      return this.upsertObject({
        id,
        kind: 'card',
        x,
        y,
        width: 240,
        height: 120,
        rotation: 0,
        zIndex,
        payload: { title: payload.title ?? url, subtype: 'link', sourceUrl: url, text: url },
        createdAt: now,
        updatedAt: now,
      });
    }
    if (payload.kind === 'html') {
      const text = payload.text ?? stripHtml(payload.html ?? '');
      return this.upsertObject({
        id,
        kind: 'card',
        x,
        y,
        width: 260,
        height: 160,
        rotation: 0,
        zIndex,
        payload: {
          title: payload.title ?? 'Web snippet',
          subtype: inferSubtype(text),
          sourceUrl: payload.url,
          text,
          html: payload.html,
        },
        createdAt: now,
        updatedAt: now,
      });
    }
    if (payload.kind === 'image') {
      return this.upsertObject({
        id,
        kind: 'card',
        x,
        y,
        width: 220,
        height: 180,
        rotation: 0,
        zIndex,
        payload: {
          title: payload.title ?? payload.imageName ?? 'Image',
          subtype: 'image',
          imageDataUrl: payload.imageDataUrl,
          sourceUrl: payload.url,
        },
        createdAt: now,
        updatedAt: now,
      });
    }
    const text = payload.text ?? '';
    return this.upsertObject({
      id,
      kind: 'card',
      x,
      y,
      width: 240,
      height: 140,
      rotation: 0,
      zIndex,
      payload: {
        title: payload.title ?? (truncate(text, 48) || 'Dropped text'),
        subtype: inferSubtype(text),
        sourceUrl: payload.sourceUrl ?? payload.url,
        text,
      },
      createdAt: now,
      updatedAt: now,
    });
  }

  ingestBrowser(payload: PadBrowserIngestPayload): PadObjectSnapshot {
    const x = 80 + (this.listObjects().length % 4) * 28;
    const y = 80 + (this.listObjects().length % 4) * 24;
    if (payload.kind === 'link') {
      return this.ingestDrop({
        kind: 'url',
        url: payload.linkUrl,
        title: payload.text ?? payload.linkUrl,
        sourceUrl: payload.url,
      }, x, y);
    }
    if (payload.kind === 'image') {
      return this.ingestDrop({
        kind: 'image',
        url: payload.url,
        imageDataUrl: payload.srcUrl,
        title: payload.text ?? 'Image',
      }, x, y);
    }
    return this.ingestDrop({
      kind: 'browser-selection',
      text: payload.text,
      sourceUrl: payload.url,
      title: truncate(payload.text ?? 'Selection', 48),
    }, x, y);
  }

  queueAttachment(objectId: string): PadAttachmentSnapshot[] {
    const object = this.getObject(objectId);
    if (!object) return this.getPendingAttachments();
    const pending = this.getPendingAttachments().filter((item) => item.objectId !== objectId);
    pending.push(toAttachment(object));
    this.setPendingAttachments(pending);
    return pending;
  }

  removePendingAttachment(objectId: string): void {
    this.setPendingAttachments(this.getPendingAttachments().filter((item) => item.objectId !== objectId));
  }

  clearAttachments(): void {
    this.setPendingAttachments([]);
  }

  getPendingAttachments(): PadAttachmentSnapshot[] {
    const row = this.database.prepare("SELECT pending_attachments_json FROM poppin_pad WHERE id = 'primary'").get() as { pending_attachments_json: string };
    try {
      const parsed = JSON.parse(row.pending_attachments_json) as PadAttachmentSnapshot[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private setPendingAttachments(attachments: PadAttachmentSnapshot[]): void {
    this.database.prepare(`
      UPDATE poppin_pad SET pending_attachments_json = ?, updated_at = ? WHERE id = 'primary'
    `).run(JSON.stringify(attachments), new Date().toISOString());
  }

  private ensurePrimaryPad(): void {
    const existing = this.database.prepare("SELECT id FROM poppin_pad WHERE id = 'primary'").get();
    if (existing) return;
    this.database.prepare(`
      INSERT INTO poppin_pad (id, title, collapsed, width, active, tool, pending_attachments_json, updated_at)
      VALUES ('primary', 'Poppin Pad', 1, 320, 0, 'select', '[]', ?)
    `).run(new Date().toISOString());
  }

  private updatePad(input: Partial<{ collapsed: boolean; width: number; active: boolean; tool: PadTool }>): PadRecordSnapshot {
    const current = this.getPadRecord();
    const updatedAt = new Date().toISOString();
    this.database.prepare(`
      UPDATE poppin_pad
      SET collapsed = ?, width = ?, active = ?, tool = ?, updated_at = ?
      WHERE id = 'primary'
    `).run(
      (input.collapsed ?? current.collapsed) ? 1 : 0,
      input.width ?? current.width,
      (input.active ?? current.active) ? 1 : 0,
      input.tool ?? current.tool,
      updatedAt,
    );
    return this.getPadRecord();
  }

  private touchPad(): void {
    this.database.prepare("UPDATE poppin_pad SET updated_at = ? WHERE id = 'primary'").run(new Date().toISOString());
  }

  private nextZIndex(): number {
    const row = this.database.prepare(`
      SELECT COALESCE(MAX(z_index), 0) AS max_z FROM poppin_pad_objects WHERE pad_id = 'primary'
    `).get() as { max_z: number };
    return Number(row.max_z) + 1;
  }

  private toPadRecord(row: PadRow): PadRecordSnapshot {
    return {
      id: 'primary',
      title: row.title,
      collapsed: row.collapsed === 1,
      width: row.width,
      active: row.active === 1,
      tool: (row.tool as PadTool) || 'select',
      updatedAt: row.updated_at,
    };
  }

  private toObject(row: ObjectRow): PadObjectSnapshot {
    return {
      id: row.id,
      kind: row.kind as PadObjectKind,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      rotation: row.rotation,
      zIndex: row.z_index,
      payload: JSON.parse(row.payload_json) as PadObjectSnapshot['payload'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function toAttachment(object: PadObjectSnapshot): PadAttachmentSnapshot {
  const cardPayload = object.payload as { title?: string; text?: string };
  const title = object.kind === 'card' ? cardPayload.title ?? 'Card' : object.kind;
  const preview = object.kind === 'card' ? cardPayload.text ?? title : title;
  return { objectId: object.id, kind: object.kind, title, preview: truncate(preview, 120), payload: object.payload };
}

function inferSubtype(text: string): PadCardSubtype {
  const normalized = text.trim();
  if (/^https?:\/\//i.test(normalized)) return 'link';
  if (/^(error|warn|info|debug)/i.test(normalized)) return 'log';
  if (/^(function|class|const|let|var|import|export)/.test(normalized)) return 'code';
  if (/flow|diagram/i.test(normalized)) return 'diagram';
  return 'generic';
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(value: string, length: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= length ? normalized : `${normalized.slice(0, length - 1)}…`;
}

export { DRAWING_KINDS, CARD_KIND };
