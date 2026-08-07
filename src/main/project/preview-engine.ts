import { spawn, type ChildProcess } from 'node:child_process';

export class PreviewEngine {
  private child: ChildProcess | null = null;

  async start(cwd: string, command: string): Promise<void> {
    if (!command.trim() || this.child) return;
    const [executable, ...args] = splitCommand(command);
    if (!executable) throw new Error('Configure a development command first.');
    const child = spawn(executable, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout?.resume();
    child.stderr?.resume();
    this.child = child;
    child.once('exit', () => { if (this.child === child) this.child = null; });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 900);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => {
        if (code && code !== 0) { clearTimeout(timer); reject(new Error(`The preview command stopped with exit code ${code}.`)); }
      });
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = null;
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2_000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

export function splitCommand(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!;
    if (quote) {
      if (character === quote) quote = null;
      else if (character === '\\' && quote === '"' && index + 1 < command.length) current += command[++index]!;
      else current += character;
    } else if (character === '"' || character === "'") quote = character;
    else if (/\s/.test(character)) { if (current) { parts.push(current); current = ''; } }
    else if (character === '\\' && index + 1 < command.length) current += command[++index]!;
    else current += character;
  }
  if (quote) throw new Error('The development command has an unmatched quote.');
  if (current) parts.push(current);
  return parts;
}
