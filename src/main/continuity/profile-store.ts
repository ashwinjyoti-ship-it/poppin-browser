import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { ContinuityProfileSnapshot, ContinuitySnapshot } from '../../shared/continuity';

interface ProfileRegistryFile {
  version: 1;
  activeProfileId: string | null;
  profiles: ContinuityProfileSnapshot[];
}

/**
 * Local Poppin profiles for continuity identity. Registry stays at the root of
 * Electron userData; per-profile state lives under `profiles/<id>/`.
 */
export class ProfileStore {
  readonly registryPath: string;
  readonly profilesRoot: string;

  constructor(private readonly userDataPath: string) {
    this.registryPath = path.join(userDataPath, 'poppin-profiles.json');
    this.profilesRoot = path.join(userDataPath, 'profiles');
  }

  async load(): Promise<ProfileRegistryFile> {
    try {
      const value = JSON.parse(await readFile(this.registryPath, 'utf8')) as ProfileRegistryFile;
      if (value?.version !== 1 || !Array.isArray(value.profiles)) return emptyRegistry();
      const profiles = value.profiles.filter(isProfile);
      const activeProfileId = profiles.some((profile) => profile.id === value.activeProfileId)
        ? value.activeProfileId
        : null;
      return { version: 1, activeProfileId, profiles };
    } catch {
      return emptyRegistry();
    }
  }

  async save(registry: ProfileRegistryFile): Promise<void> {
    await mkdir(path.dirname(this.registryPath), { recursive: true });
    const temporaryPath = `${this.registryPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.registryPath);
  }

  getSnapshot(registry: ProfileRegistryFile): ContinuitySnapshot {
    const activeProfile = registry.profiles.find((profile) => profile.id === registry.activeProfileId) ?? null;
    return {
      activeProfile,
      profiles: registry.profiles.map((profile) => ({ ...profile })),
      continuityReady: Boolean(activeProfile),
    };
  }

  /** Directory that owns browser-state.json + poppin.sqlite for the active profile (or legacy root). */
  resolveDataRoot(registry: ProfileRegistryFile): string {
    if (!registry.activeProfileId) return this.userDataPath;
    return path.join(this.profilesRoot, registry.activeProfileId);
  }

  profileDataRoot(profileId: string): string {
    return path.join(this.profilesRoot, profileId);
  }

  async ensureProfileDirectory(profileId: string): Promise<string> {
    const directory = this.profileDataRoot(profileId);
    await mkdir(directory, { recursive: true });
    return directory;
  }

  async createProfile(name: string): Promise<{ registry: ProfileRegistryFile; profile: ContinuityProfileSnapshot }> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Enter a profile name.');
    if (trimmed.length > 64) throw new Error('Profile names must be 64 characters or fewer.');
    const registry = await this.load();
    if (registry.profiles.some((profile) => profile.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error('A profile with that name already exists.');
    }
    const profile: ContinuityProfileSnapshot = {
      id: randomUUID(),
      name: trimmed,
      createdAt: new Date().toISOString(),
    };
    await this.ensureProfileDirectory(profile.id);
    const next: ProfileRegistryFile = {
      version: 1,
      activeProfileId: profile.id,
      profiles: [...registry.profiles, profile],
    };
    await this.save(next);
    return { registry: next, profile };
  }

  async renameProfile(profileId: string, name: string): Promise<ProfileRegistryFile> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Enter a profile name.');
    if (trimmed.length > 64) throw new Error('Profile names must be 64 characters or fewer.');
    const registry = await this.load();
    const index = registry.profiles.findIndex((profile) => profile.id === profileId);
    if (index < 0) throw new Error('That profile was not found.');
    if (registry.profiles.some((profile, i) => i !== index && profile.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error('A profile with that name already exists.');
    }
    const profiles = registry.profiles.map((profile) => (
      profile.id === profileId ? { ...profile, name: trimmed } : profile
    ));
    const next = { ...registry, profiles };
    await this.save(next);
    return next;
  }

  async switchProfile(profileId: string): Promise<ProfileRegistryFile> {
    const registry = await this.load();
    if (!registry.profiles.some((profile) => profile.id === profileId)) {
      throw new Error('That profile was not found.');
    }
    await this.ensureProfileDirectory(profileId);
    const next = { ...registry, activeProfileId: profileId };
    await this.save(next);
    return next;
  }
}

function emptyRegistry(): ProfileRegistryFile {
  return { version: 1, activeProfileId: null, profiles: [] };
}

function isProfile(value: unknown): value is ContinuityProfileSnapshot {
  if (!value || typeof value !== 'object') return false;
  const profile = value as ContinuityProfileSnapshot;
  return typeof profile.id === 'string'
    && typeof profile.name === 'string'
    && profile.name.length > 0
    && typeof profile.createdAt === 'string';
}
