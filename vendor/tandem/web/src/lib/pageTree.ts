import type { Page } from '../types';

/** Row backing pages, design canvases, and inline embedded databases stay out of the sidebar tree. */
export function isSidebarHiddenPage(page: Page, pages: Page[]): boolean {
  if (page.is_row_page) return true;
  if (page.type === 'canvas') return true;
  if (page.type !== 'database' || !page.parent_id) return false;
  const parent = pages.find((p) => p.id === page.parent_id);
  // Inline databases parented under a document host (page or folder) are hidden from sidebar
  return parent?.type === 'page' || parent?.type === 'folder';
}

/** Children for sidebar tree — excludes hidden database row backing pages */
export function getChildren(pages: Page[], parentId: string | null): Page[] {
  return pages.filter((p) => p.parent_id === parentId && !isSidebarHiddenPage(p, pages));
}

export function buildChildrenIndex(pages: Page[]): Map<string | null, Page[]> {
  const index = new Map<string | null, Page[]>();
  for (const page of pages) {
    if (isSidebarHiddenPage(page, pages)) continue;
    const key = page.parent_id;
    const list = index.get(key) ?? [];
    list.push(page);
    index.set(key, list);
  }
  for (const list of index.values()) {
    list.sort((a, b) => a.title.localeCompare(b.title));
  }
  return index;
}

/** Top-level folders — treated as projects in the sidebar */
export function getRootProjects(pages: Page[]): Page[] {
  return getChildren(pages, null).filter((p) => p.type === 'folder');
}

/** Root-level standalone pages and databases — not inside any folder/project */
export function getStandalonePages(pages: Page[]): Page[] {
  return getChildren(pages, null).filter((p) => p.type !== 'folder');
}

/** @deprecated Use getStandalonePages */
export function getInboxPages(pages: Page[]): Page[] {
  return getStandalonePages(pages);
}

export function isProject(page: Page): boolean {
  return page.type === 'folder' && page.parent_id === null;
}

export function isDescendant(pages: Page[], ancestorId: string, nodeId: string): boolean {
  let current = pages.find((p) => p.id === nodeId);
  while (current?.parent_id) {
    if (current.parent_id === ancestorId) return true;
    current = pages.find((p) => p.id === current!.parent_id);
  }
  return false;
}

export function canNestUnder(
  pages: Page[],
  draggedId: string,
  targetParentId: string | null,
  excludeIds: Set<string> = new Set(),
): boolean {
  if (draggedId === targetParentId) return false;
  if (targetParentId && excludeIds.has(targetParentId)) return false;
  if (targetParentId && isDescendant(pages, draggedId, targetParentId)) return false;
  for (const id of excludeIds) {
    if (id !== draggedId && targetParentId && isDescendant(pages, id, targetParentId)) return false;
  }
  return true;
}

export function pageIcon(page: Page): string {
  return page.icon || (
    page.type === 'folder' ? '📁'
      : page.type === 'database' ? '🗄️'
        : page.type === 'canvas' ? '🎨'
          : '📄'
  );
}

export function collectDescendantIds(pages: Page[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  const walk = (parentId: string) => {
    for (const child of getChildren(pages, parentId)) {
      ids.add(child.id);
      walk(child.id);
    }
  };
  walk(rootId);
  return ids;
}
