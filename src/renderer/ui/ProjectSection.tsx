import { ChevronDown, ChevronRight, FolderGit2, FolderOpen, GitBranch, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { isGitRemote } from '../../shared/project-source';
import type { WorkspaceCommand, WorkspaceProjectSnapshot } from '../../shared/workspace';

interface ProjectSectionProps {
  project: WorkspaceProjectSnapshot | null;
  onCommand: (command: WorkspaceCommand) => Promise<string | null>;
}

export function ProjectSection({ project, onCommand }: ProjectSectionProps) {
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const run = async (command: WorkspaceCommand) => {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const message = await onCommand(command);
      setError(message ?? '');
      if (!message && command.type === 'addProject') {
        setSource('');
        setStatus('Project connected. Ready for Code.');
      }
      if (!message && command.type === 'updateProjectSettings') setStatus('Saved.');
    } finally {
      setBusy(false);
    }
  };

  const addProject = (event: FormEvent) => {
    event.preventDefault();
    void run({ type: 'addProject', source });
  };

  return (
    <section className="workspace-section project-section">
      <div className="section-heading"><span>Project</span>{project ? <GitBranch size={13} /> : null}</div>
      {project ? (
        <ConnectedProject
          key={`${project.repositoryPath}|${project.installCommand}|${project.devCommand}|${project.previewUrl}`}
          project={project}
          busy={busy}
          onSave={(command) => { void run(command); }}
        />
      ) : (
        <form className="project-add-form" onSubmit={addProject}>
          <p className="project-add-copy">Add a local folder or paste a Git repository URL.</p>
          <label className="project-add-field">
            <span className="sr-only">Project folder or Git URL</span>
            <input
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="~/code/app or https://github.com/user/repo.git"
              aria-label="Project folder or Git URL"
              disabled={busy}
            />
          </label>
          <div className="project-add-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => void run({ type: 'chooseProjectFolder' })}
              disabled={busy}
            >
              <FolderOpen size={15} />
              <span>Choose folder</span>
            </button>
            <button type="submit" disabled={busy || !source.trim()}>
              <Plus size={15} />
              <span>{isGitRemote(source) ? 'Clone repository' : 'Add project'}</span>
            </button>
          </div>
        </form>
      )}
      {busy ? <span className="project-status">Working with Git…</span> : null}
      {status ? <span className="project-status" role="status">{status}</span> : null}
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
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const save = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onSave({ type: 'updateProjectSettings', ...settings });
  };

  return (
    <>
      <div className="project-summary">
        <div><FolderGit2 size={15} /><strong>{project.repositoryPath.split('/').pop()}</strong></div>
        <span title={project.repositoryPath}>{project.repositoryPath}</span>
        <dl><dt>Branch</dt><dd>{project.branch}</dd><dt>Remote</dt><dd>{project.remote ?? 'No origin remote'}</dd></dl>
        <p className="project-ready">Ready for Code. Poppin will work in this folder.</p>
      </div>
      <div className="project-settings-disclosure">
        <button
          type="button"
          className="project-settings-toggle"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          How to run this project
        </button>
        {advancedOpen ? (
          <form className="project-settings" onSubmit={save}>
            <p className="project-settings-copy">Optional. Poppin fills these from the project when it can.</p>
            <label>
              Install dependencies
              <input
                value={settings.installCommand}
                placeholder="Usually detected automatically"
                onChange={(event) => setSettings((current) => ({ ...current, installCommand: event.target.value }))}
              />
            </label>
            <label>
              Start the local app
              <input
                value={settings.devCommand}
                placeholder="Usually detected automatically"
                onChange={(event) => setSettings((current) => ({ ...current, devCommand: event.target.value }))}
              />
            </label>
            <label>
              Preview address
              <input
                value={settings.previewUrl}
                placeholder="http://localhost:3000"
                onChange={(event) => setSettings((current) => ({ ...current, previewUrl: event.target.value }))}
              />
            </label>
            <button type="submit" className="secondary-button" disabled={busy}>Save run settings</button>
          </form>
        ) : null}
      </div>
    </>
  );
}
