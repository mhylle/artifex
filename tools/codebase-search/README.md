# @artifex/codebase-search (MCP)

AST codebase-search MCP server over the Artifex TypeScript monorepo — part of the [AI Layer](../../docs/decisions/). Structural symbol/definition/reference search, cheaper and more accurate than grep for "where is X defined / used".

## Setup

```bash
npm install --prefix tools/codebase-search
```

`npm install` also builds (via the `prepare` script). The server is registered for Claude Code in the repo-root [`.mcp.json`](../../.mcp.json) and launches as `node tools/codebase-search/dist/index.js` with cwd = repo root.

## Tools

| Tool | Args | Returns |
|---|---|---|
| `find_symbol` | `name` | Declarations (class/function/interface/type/enum/const) by exact name, as `path:line:col` |
| `find_references` | `name` | Usages of the symbol across the monorepo |
| `list_exports` | `file` (path relative to repo root) | Exported symbol names of that file |

Scope: `packages/**/*.ts` and `tools/**/*.ts` (excludes `node_modules`, `dist`, `*.d.ts`). Most of Artifex is still design-stage, so results grow as code lands.

## Notes

- Rebuild after editing `src/`: `npm run build --prefix tools/codebase-search`.
- Manage dependencies with npm (`npm install <pkg>`) — never hand-edit `package.json`.

## How it stays current

There is **no index and no cache**. Every tool call rebuilds a fresh `ts-morph` `Project`
from disk (see `loadProject()` in `src/index.ts`), so results always reflect the current
files — a new file is found on the next call, a deleted one disappears on the next call, with
no rebuild or restart. The trade-off is a per-call reparse (trivial at this size; revisit with
a cached, file-watched `Project` only if it ever becomes slow on a large tree).

Both this tool and a TypeScript LSP server bottom out at the same TS `LanguageService`; this
is the name-addressed, stateless MCP framing of it. If the repo grows large or goes polyglot
(e.g. the ADR-0002 Python science-loop seam), consider re-backing these same tools with an
LSP-backed engine — the `find_symbol`/`find_references`/`list_exports` surface can stay
unchanged while the backend swaps underneath.

## Known limitations & follow-ups

- **No `tsconfig` wired in yet.** `loadProject()` uses `skipAddingFilesFromTsConfig: true` and
  globs raw `.ts` files — correct while there is no monorepo `tsconfig`. **Follow-up:** once P0
  establishes workspace path aliases (e.g. `@artifex/shared-types`), point `loadProject()` at
  the root `tsconfig` so module resolution understands those aliases; otherwise
  `find_references` may miss cross-package usages that import via an alias.
