import { FolderGit2, GitBranch, GitFork, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import type { WorkspaceCommand, WorkspaceProjectSnapshot } from '../../shared/workspace';

interface ProjectSectionProps {
  project: WorkspaceProjectSnapshot | null;
  onCommand: (command: WorkspaceCommand) => Promise<string | null>;
}

export function ProjectSection({ project, onCommand }: ProjectSectionProps) {
  const [remote, setRemote] = useState('');
  const [showClone, setShowClone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (command: WorkspaceCommand) => {
    setBusy(true);
    setError('');
    const message = await onCommand(command);
    setError(message ?? '');
    setBusy(false);
  };

  const clone = (event: FormEvent) => {
    event.preventDefault();
    void run({ type: 'cloneRepository', remote });
  };

  return (
    <section className="workspace-section project-section">
      <div className="section-heading"><span>Project</span>{project ? <GitBranch size={13} /> : null}</div>
      {project ? (
        <ConnectedProject key={project.repositoryPath} project={project} busy={busy} onSave={(command) => { void run(command); }} />
      ) : (
        <div className="project-actions">
          <button type="button" onClick={() => void run({ type: 'connectExistingProject' })} disabled={busy}><FolderGit2 size={15} /><span>Connect existing</span></button>
          <button type="button" onClick={() => setShowClone((value) => !value)} disabled={busy}><GitFork size={15} /><span>Clone repository</span></button>
          {showClone ? (
            <form className="clone-form" onSubmit={clone}>
              <input value={remote} onChange={(event) => setRemote(event.target.value)} placeholder="https://github.com/user/repo.git" aria-label="Repository remote" />
              <button type="submit" className="secondary-button" disabled={busy || !remote.trim()}>Choose location and clone</button>
            </form>
          ) : null}
          <button type="button" onClick={() => void run({ type: 'createNewProject' })} disabled={busy}><Plus size={15} /><span>Create new project</span></button>
        </div>
      )}
      {busy ? <span className="project-status">Working with Git…</span> : null}
      {error ? <span className="form-error" role="alert">{error}</span> : null}
    </section>
  );
}

interface ConnectedProjectProps {
  project: WorkspaceProjectSnapshot;
  busy: boolean;
  onSave: (command: Extract<WorkspaceCommand, { type: 'updateProjectSettings' }>) => void;
}

function ConnectedProject({ project, busy, onSave }: ConnectedProjectProps) {
  const [settings, setSettings] = useState({
    installCommand: project.installCommand,
    devCommand: project.devCommand,
    previewUrl: project.previewUrl,
  });
  const save = (event: FormEvent) => {
    event.preventDefault();
    onSave({ type: 'updateProjectSettings', ...settings });
  };

  return (
    <>
      <div className="project-summary">
        <div><FolderGit2 size={15} /><strong>{project.repositoryPath.split('/').pop()}</strong></div>
        <span title={project.repositoryPath}>{project.repositoryPath}</span>
        <dl><dt>Branch</dt><dd>{project.branch}</dd><dt>Remote</dt><dd>{project.remote ?? 'No origin remote'}</dd></dl>
      </div>
      <details className="project-settings-disclosure">
        <summary>Project settings</summary>
        <form className="project-settings" onSubmit={save}>
          <label>Install command<input value={settings.installCommand} placeholder="npm install" onChange={(event) => setSettings((current) => ({ ...current, installCommand: event.target.value }))} /></label>
          <label>Dev command<input value={settings.devCommand} placeholder="npm run dev" onChange={(event) => setSettings((current) => ({ ...current, devCommand: event.target.value }))} /></label>
          <label>Preview URL<input value={settings.previewUrl} placeholder="http://localhost:3000" onChange={(event) => setSettings((current) => ({ ...current, previewUrl: event.target.value }))} /></label>
          <button type="submit" className="secondary-button" disabled={busy}>Save project settings</button>
        </form>
      </details>
    </>
  );
}
