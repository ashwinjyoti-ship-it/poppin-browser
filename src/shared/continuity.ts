import type { BrowserGroupColor, BrowserSettings } from './browser';
import type { RecipeSnapshot } from './recipes';

/**
 * Phase 14 — local profile + passphrase-sealed continuity packages.
 * Packages never include cookies, credentials, Memory bodies, project paths,
 * window geometry, or Agent Tabs / active-task state.
 */

export const CONTINUITY_PACKAGE_VERSION = 1 as const;
export const CONTINUITY_FILE_EXTENSION = 'poppin-continuity';

export interface ContinuityProfileSnapshot {
  id: string;
  name: string;
  createdAt: string;
}

export interface ContinuitySnapshot {
  /** Null when the user has not created a profile yet (single-machine default). */
  activeProfile: ContinuityProfileSnapshot | null;
  profiles: ContinuityProfileSnapshot[];
  /** Continuity export/import requires an active profile. */
  continuityReady: boolean;
}

export interface ContinuityTabRef {
  url: string;
  pinned: boolean;
  groupId: string | null;
}

export interface ContinuityGroupRef {
  id: string;
  name: string;
  color: BrowserGroupColor;
  collapsed: boolean;
}

export interface ContinuityTabSelectionRef {
  url: string;
  title: string;
}

export interface ContinuityTandemPageRef {
  pageId: string;
  title: string;
}

export interface ContinuityBrowserSessionRef {
  name: string;
  tabs: { url: string; title: string; pinned: boolean }[];
}

export interface ContinuityContextPackRef {
  name: string;
  tabRefs: { url: string; title: string }[];
  documentIds: string[];
  tandemPageIds: string[];
  includeMemory: boolean;
}

export interface ContinuityRecipeRef {
  name: string;
  startUrl: string | null;
  steps: RecipeSnapshot['steps'];
  enabled: boolean;
}

export interface ContinuityMailSkillRef {
  name: string;
  rule: string;
  enabled: boolean;
}

/** Versioned plaintext payload sealed inside a `.poppin-continuity` file. */
export interface ContinuityPayloadV1 {
  version: typeof CONTINUITY_PACKAGE_VERSION;
  exportedAt: string;
  profileName: string;
  browser: {
    tabs: ContinuityTabRef[];
    groups: ContinuityGroupRef[];
    /** Index into `tabs` for the active ordinary tab; remapped on import. */
    activeTabIndex: number;
    settings: BrowserSettings;
  };
  workspace: {
    name: string | null;
    contextPacks: ContinuityContextPackRef[];
    browserSessions: ContinuityBrowserSessionRef[];
    recipes: ContinuityRecipeRef[];
    tabSelections: ContinuityTabSelectionRef[];
    tandemPages: ContinuityTandemPageRef[];
    memorySelected: boolean;
    /** Optional for packages exported before Mail shipped; import treats missing as empty. */
    mailInboxUrl?: string | null;
    mailSkills?: ContinuityMailSkillRef[];
  };
}

export type ContinuityCommand =
  | { type: 'createProfile'; name: string }
  | { type: 'renameProfile'; profileId: string; name: string }
  | { type: 'switchProfile'; profileId: string }
  | { type: 'exportContinuity'; passphrase: string }
  | { type: 'importContinuity'; passphrase: string };

export interface ContinuityCommandResult {
  ok: boolean;
  message?: string;
  /** True when the app will relaunch to apply a profile or import. */
  relaunching?: boolean;
}

/** Deny-list markers used in tests and docs — never appear in sealed payloads. */
export const CONTINUITY_FORBIDDEN_KEYS = [
  'cookies',
  'password',
  'passkey',
  'apiKey',
  'token',
  'taskSpaceId',
  'repositoryPath',
  'window',
  'ciphertext',
  'safeStorage',
] as const;
