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
