# Building the Poppin DMG on your Mac

This is the local workflow: clone the repo, ask your local coding agent (Codex,
Claude Code, whichever) to build, and get a `.dmg` you can install.

The DMG maker only runs on macOS. CI builds and validates the `.app`, but the
disk image itself is produced locally.

## 1. Requirements

- macOS (Apple Silicon or Intel)
- Node.js 22
- Xcode Command Line Tools (`xcode-select --install`) — needed for `codesign`

## 2. Clone and install

```bash
git clone https://github.com/ashwinjyoti-ship-it/poppin-browser.git
cd poppin-browser
npm ci
```

## 3. Validate before building

Always green before you package:

```bash
npm run lint
npm run typecheck
npm test
```

## 4. Build the DMG

```bash
npm run make
```

Output lands in `out/make/`:

```
out/make/Poppin Browser-0.1.0-<arch>.dmg
out/make/zip/darwin/<arch>/Poppin Browser-darwin-<arch>-0.1.0.zip
```

### Update the stable local installers in `DMG/`

After a change you want to install locally, overwrite the existing stable
files — do not keep versioned duplicates:

```bash
npm run update:dmg          # host architecture only
npm run update:dmg:all      # arm64 + x64
```

That rebuilds with Electron Forge, `hdiutil`-verifies a temp copy, then
atomically replaces:

```
DMG/Poppin-Browser-arm64.dmg
DMG/Poppin-Browser-x64.dmg
```

Those files stay local (gitignored). Promoting an already-built candidate
without rebuilding:

```bash
node scripts/update-stable-dmgs.mjs --arch=all --skip-build
```

To produce only the unpacked `.app` (faster, useful while iterating):

```bash
npm run package        # → out/Poppin Browser-darwin-<arch>/Poppin Browser.app
```

## 5. Install and first run

Open the DMG and drag **Poppin Browser** to Applications.

The build is **ad-hoc signed** (`osxSign.identity: '-'` in `forge.config.ts`) and
not notarised, so Gatekeeper will warn on first launch. Right-click the app →
**Open** → **Open**, once. After that it launches normally.

If macOS still refuses:

```bash
xattr -dr com.apple.quarantine "/Applications/Poppin Browser.app"
```

## 6. What the app expects at runtime

| Feature | Requirement |
|---|---|
| Codex agent (default) | Codex installed at `/Applications/ChatGPT.app/Contents/Resources/codex`, `/opt/homebrew/bin/codex` or `/usr/local/bin/codex`. Override with `POPPIN_CODEX_PATH`. |
| Codex over ACP (preview) | `codex-acp` on your PATH (`npm i -g @agentclientprotocol/codex-acp`), or set `POPPIN_ACP_AGENT_COMMAND` (and optionally `POPPIN_ACP_AGENT_ARGS`). |
| Tandem World and the Tandem capability | Your Tandem address plus an API key from Tandem → Settings → API keys. Paste both into Poppin Settings → Tandem integration. The key is sealed in the macOS Keychain. |
| GitHub delivery | `gh` CLI, authenticated. |

## 7. Prompt to hand your local agent

> Clone `https://github.com/ashwinjyoti-ship-it/poppin-browser`, run `npm ci`,
> then `npm run lint && npm run typecheck && npm test`, then `npm run make`.
> Report the path of the produced `.dmg` and the output of any failing step.
> Do not change `forge.config.ts` signing settings.

## 8. Troubleshooting

**`npm run make` fails in `appdmg` / `Cannot find module`** — `appdmg` needs
native build tools. Ensure Xcode Command Line Tools are installed, then
`rm -rf node_modules && npm ci`.

**"Poppin Browser is damaged and can't be opened"** — the quarantine attribute
on a downloaded, ad-hoc-signed build. Use the `xattr` command in step 5.

**Codex shows "not installed"** — Poppin looks only at the paths listed above.
Set `POPPIN_CODEX_PATH` to the real binary and use *Reconnect* in the Task pane.

**Blank centre area after opening Tandem World** — Tandem could not be reached.
Check the address in Poppin Settings → Tandem integration; the workspace pane also shows the connection status.
