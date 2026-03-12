# Contributing

Thank you for taking the time to contribute. This document covers everything you need to get the project running locally and the expectations for submitting changes.

---

## Prerequisites

- Node.js >= 18
- npm >= 9

No other dependencies are required. The project has zero runtime dependencies.

---

## Local Setup

```bash
git clone https://github.com/barissozudogru/portscan-dev.git
cd portscan-dev
npm install
npm run build
```

Run the built CLI directly:

```bash
node dist/cli.js
node dist/cli.js --kill 3000
node dist/cli.js --json
```

Or link it globally during development:

```bash
npm link
portscan-dev
```

---

## Project Structure

```
src/
  cli.ts       Entry point — argument parsing, help text, table rendering
  index.ts     Core logic — port scanning (lsof/ss), process info, kill
  types.ts     Shared TypeScript interfaces
dist/          Compiled output (generated, not committed)
```

---

## Making Changes

1. Fork the repository and create a branch from `main`:
   ```bash
   git checkout -b fix/your-description
   ```

2. Make your changes in `src/`.

3. Build and verify:
   ```bash
   npm run build
   node dist/cli.js
   ```

4. Commit with a clear, concise message:
   ```bash
   git commit -m "Fix lsof parsing when output contains IPv6 addresses"
   ```

5. Open a pull request against `main`.

---

## Commit Style

- Use the imperative mood: "Add", "Fix", "Remove", not "Added" or "Fixes"
- Keep the subject line under 72 characters
- Reference an issue number when applicable: `Fix port deduplication (#12)`

---

## Pull Request Guidelines

- Keep PRs focused on one change. Separate unrelated fixes into separate PRs.
- Include a description of what changed and why.
- If you are fixing a bug, describe how to reproduce it.
- If you are adding a feature, explain the use case.

---

## Reporting Issues

Use the issue templates provided in `.github/ISSUE_TEMPLATE/`. Include your OS, Node.js version, and the exact command and output that demonstrates the problem.

---

## Code Style

The project uses TypeScript with strict mode enabled. Follow the patterns already present in the codebase:

- Explicit return types on exported functions
- No `any` unless unavoidable and commented
- Prefer `const` over `let`
- Keep functions small and focused

There is no autoformatter configured. Match the indentation and style of the file you are editing.

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
