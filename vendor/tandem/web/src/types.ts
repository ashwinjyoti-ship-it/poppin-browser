export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

export interface Page {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  type: 'page' | 'folder' | 'database' | 'canvas';
  visibility: 'private' | 'shared' | 'public';
  content_md: string | null;
  is_row_page?: number;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface Block {
  id: string;
  page_id: string;
  parent_id: string | null;
  type: string;
  content: string;
  order_index: number;
}

export interface DatabaseProperty {
  id: string;
  database_id: string;
  name: string;
  type: string;
  options: string;
  order_index: number;
}

export interface DatabaseRow {
  id: string;
  database_id: string;
  page_id: string | null;
  page_title?: string;
  properties: string;
  order_index: number;
}

export interface SavedDatabaseView {
  id: string;
  database_id: string;
  name: string;
  view_type: string;
  filters: string;
  sort_config: string;
  order_index: number;
}

export interface RelationRowOption {
  id: string;
  page_id: string | null;
  title: string;
}

export interface Comment {
  id: string;
  page_id: string;
  block_id: string | null;
  user_id: string;
  content: string;
  author_name: string;
  comment_type?: 'discussion' | 'agent_instruction';
  selection_quote?: string | null;
  selection_meta?: string | object | null;
  agent_prompt?: string;
  status?: 'open' | 'resolved';
  created_at: number;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: number;
  page_id: string | null;
  created_at: number;
}

export interface Workspace {
  id: string;
  name: string;
  owner_id: string;
  role: string;
}

export interface Tag {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  created_at?: number;
}

export type Theme = 'light' | 'dark' | 'system';
