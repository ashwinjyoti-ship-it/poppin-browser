import type {
  PadArrowPayload,
  PadObjectSnapshot,
  PadStrokePayload,
} from '../../../shared/poppin-pad';

export interface PadPoint {
  x: number;
  y: number;
}

export function clientToCanvasPoint(container: HTMLElement, clientX: number, clientY: number): PadPoint {
  const rect = container.getBoundingClientRect();
  return {
    x: clientX - rect.left + container.scrollLeft,
    y: clientY - rect.top + container.scrollTop,
  };
}

export function strokePath(points: PadPoint[]): string {
  if (points.length === 0) return '';
  const first = points[0]!;
  const rest = points.slice(1);
  return `M ${first.x} ${first.y}${rest.map((point) => ` L ${point.x} ${point.y}`).join('')}`;
}

export function padObjectBounds(object: PadObjectSnapshot): { x: number; y: number; width: number; height: number } {
  if (object.kind === 'arrow') {
    const payload = object.payload as PadArrowPayload;
    const x = Math.min(payload.x1, payload.x2);
    const y = Math.min(payload.y1, payload.y2);
    return {
      x,
      y,
      width: Math.max(8, Math.abs(payload.x2 - payload.x1)),
      height: Math.max(8, Math.abs(payload.y2 - payload.y1)),
    };
  }
  if (object.kind === 'stroke') {
    const payload = object.payload as PadStrokePayload;
    if (!payload.points.length) {
      return { x: object.x, y: object.y, width: Math.max(8, object.width), height: Math.max(8, object.height) };
    }
    const xs = payload.points.map((point) => point.x);
    const ys = payload.points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return {
      x,
      y,
      width: Math.max(8, Math.max(...xs) - x),
      height: Math.max(8, Math.max(...ys) - y),
    };
  }
  return {
    x: object.x,
    y: object.y,
    width: Math.max(object.kind === 'text' ? 48 : 8, object.width),
    height: Math.max(object.kind === 'text' ? 24 : 8, object.height),
  };
}

export function hitTestPadObject(object: PadObjectSnapshot, point: PadPoint, padding = 8): boolean {
  const box = padObjectBounds(object);
  return point.x >= box.x - padding
    && point.x <= box.x + box.width + padding
    && point.y >= box.y - padding
    && point.y <= box.y + box.height + padding;
}

export function translatePadObject(object: PadObjectSnapshot, dx: number, dy: number): PadObjectSnapshot {
  const now = new Date().toISOString();
  if (object.kind === 'arrow') {
    const payload = object.payload as PadArrowPayload;
    return {
      ...object,
      x: object.x + dx,
      y: object.y + dy,
      payload: {
        ...payload,
        x1: payload.x1 + dx,
        y1: payload.y1 + dy,
        x2: payload.x2 + dx,
        y2: payload.y2 + dy,
      },
      updatedAt: now,
    };
  }
  if (object.kind === 'stroke') {
    const payload = object.payload as PadStrokePayload;
    return {
      ...object,
      x: object.x + dx,
      y: object.y + dy,
      payload: { ...payload, points: payload.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) },
      updatedAt: now,
    };
  }
  return { ...object, x: object.x + dx, y: object.y + dy, updatedAt: now };
}

export function resizePadObject(object: PadObjectSnapshot, width: number, height: number): PadObjectSnapshot {
  const now = new Date().toISOString();
  const nextWidth = Math.max(24, width);
  const nextHeight = Math.max(24, height);
  if (object.kind === 'arrow' || object.kind === 'stroke') {
    const box = padObjectBounds(object);
    const scaleX = box.width === 0 ? 1 : nextWidth / box.width;
    const scaleY = box.height === 0 ? 1 : nextHeight / box.height;
    const mapPoint = (x: number, y: number) => ({
      x: box.x + (x - box.x) * scaleX,
      y: box.y + (y - box.y) * scaleY,
    });
    if (object.kind === 'arrow') {
      const payload = object.payload as PadArrowPayload;
      const start = mapPoint(payload.x1, payload.y1);
      const end = mapPoint(payload.x2, payload.y2);
      return {
        ...object,
        x: start.x,
        y: start.y,
        width: end.x - start.x,
        height: end.y - start.y,
        payload: { ...payload, x1: start.x, y1: start.y, x2: end.x, y2: end.y },
        updatedAt: now,
      };
    }
    const payload = object.payload as PadStrokePayload;
    return {
      ...object,
      x: box.x,
      y: box.y,
      width: nextWidth,
      height: nextHeight,
      payload: { ...payload, points: payload.points.map((point) => mapPoint(point.x, point.y)) },
      updatedAt: now,
    };
  }
  return { ...object, width: nextWidth, height: nextHeight, updatedAt: now };
}
