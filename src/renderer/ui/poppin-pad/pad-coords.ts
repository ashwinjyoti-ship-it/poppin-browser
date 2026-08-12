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
