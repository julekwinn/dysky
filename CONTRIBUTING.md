# Contributing to Dysky

Thanks for helping. Bug reports, ideas and pull requests are all welcome. For anything bigger than a small fix, open an issue first so we can agree on the approach before you spend time on it.

Two rules are not up for debate: **Dysky only reads** (it never writes, moves or deletes anything) and **it makes no network requests**.

## Dev setup

You need Windows 10 (1809 or later) or Windows 11 and:

- [Rust](https://rustup.rs/) stable (MSVC toolchain), plus `rustup component add rustfmt clippy`
- Microsoft C++ Build Tools with the "Desktop development with C++" workload
- [Node.js](https://nodejs.org/) LTS
- WebView2, which ships with Windows 11

```powershell
git clone https://github.com/julekwinn/dysky.git
cd dysky
npm install      # the Tauri CLI
npm run dev      # opens the app; changes in src/ reload the window
```

`npm run build` makes the installer at `src-tauri\target\release\bundle\nsis\Dysky_<version>_x64-setup.exe`.

How the pieces fit together is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tests

```powershell
npm test                                          # both of the below
node --test                                       # chart geometry and formatting (tests/*.test.js)
cargo test --manifest-path src-tauri/Cargo.toml   # scanner and tree queries
```

New logic comes with a test. Keep pure logic (geometry, formatting) in `src/shapes.js`, where `node --test` can check it without a DOM.

## Code style

- **Rust:** `cargo fmt` and `cargo clippy --all-targets -- -D warnings` must be clean (add `--manifest-path src-tauri/Cargo.toml`, or run them inside `src-tauri`). CI checks both.
- **Frontend:** plain HTML, CSS and ES modules. No frameworks, no bundler, no build step, no runtime npm packages.
- **Keep it small.** Before adding code, check whether it needs to exist at all, then whether the codebase, the standard library or the platform already does it ([AGENTS.md](AGENTS.md) has the full ladder). A new dependency needs a good reason, so ask in an issue first.
- Comments in English, and they say *why*, not *what*.
- Never cut corners on input validation, security or accessibility: keyboard use, labels for screen readers, `prefers-reduced-motion`, and both themes.

## Preview in a browser

The UI runs in any browser with sample data, no Rust build needed. Serve the project root and open `/src/index.html`:

```powershell
npx serve .                    # then http://localhost:3000/src/index.html
python -m http.server 8000     # or this: http://localhost:8000/src/index.html
```

Without Tauri, [dev/preview-backend.js](dev/preview-backend.js) answers the same commands as the Rust side from a made-up user "Alex". If you change a command or what it returns, change the preview backend in the same pull request.

## Commit messages

English, in the form `Area: change`, one logical change per commit:

```text
Scan: count cloud-only files as 0
Chart: keep labels inside small bubbles
CI: cache the Rust target folder
```

Common areas: `App`, `Scan`, `Chart`, `List`, `Settings`, `Installer`, `CI`, `Docs`, `README`, `Release`.

## Pull requests

- [ ] `npm test` passes
- [ ] `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` are clean
- [ ] the preview backend still matches the Rust commands
- [ ] UI changes include screenshots in light and dark theme
- [ ] user-facing changes have a line under `Unreleased` in [CHANGELOG.md](CHANGELOG.md)

## Releasing

For maintainers.

1. Move the `Unreleased` entries in [CHANGELOG.md](CHANGELOG.md) under a new `## [X.Y.Z] - YYYY-MM-DD` heading and update the links at the bottom.
2. Bump the version in `package.json` (the single source of truth for the app and Settings → About) and in `src-tauri/Cargo.toml`, and refresh both lock files:
   ```powershell
   npm version X.Y.Z --no-git-tag-version
   cargo check --manifest-path src-tauri/Cargo.toml
   ```
3. Commit as `Release: vX.Y.Z`, push to `main` and wait for CI to pass.
4. Tag and push the tag:
   ```powershell
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
5. The [release workflow](.github/workflows/release.yml) builds the installer and creates a **draft** release "Dysky vX.Y.Z" with it attached. The tag must match the version in `package.json`, or the workflow makes a second release under the version's tag.
6. Download the installer from the draft, try it on a clean user account, then publish the release by hand.
