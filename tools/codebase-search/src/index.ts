import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Project, Node } from "ts-morph";
import { relative } from "node:path";

// The repo root: Claude Code launches MCP servers with cwd = project root.
const ROOT = process.env.ARTIFEX_ROOT ?? process.cwd();

function loadProject(): Project {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  project.addSourceFilesAtPaths([
    `${ROOT}/packages/**/*.ts`,
    `${ROOT}/tools/**/*.ts`,
    `!${ROOT}/**/node_modules/**`,
    `!${ROOT}/**/dist/**`,
    `!${ROOT}/**/*.d.ts`,
  ]);
  return project;
}

function loc(node: Node): string {
  const sf = node.getSourceFile();
  const { line, column } = sf.getLineAndColumnAtPos(node.getStart());
  return `${relative(ROOT, sf.getFilePath()).replace(/\\/g, "/")}:${line}:${column}`;
}

const server = new McpServer({ name: "artifex-codebase-search", version: "0.1.0" });

server.tool(
  "find_symbol",
  "Find declarations of a symbol (class, function, interface, type alias, enum, or top-level const) by exact name across the Artifex monorepo (packages/ and tools/).",
  { name: z.string().describe("exact symbol name to find") },
  async ({ name }: { name: string }) => {
    const project = loadProject();
    const hits: string[] = [];
    for (const sf of project.getSourceFiles()) {
      for (const d of sf.getClasses()) if (d.getName() === name) hits.push(`class     ${name}  ${loc(d)}`);
      for (const d of sf.getFunctions()) if (d.getName() === name) hits.push(`function  ${name}  ${loc(d)}`);
      for (const d of sf.getInterfaces()) if (d.getName() === name) hits.push(`interface ${name}  ${loc(d)}`);
      for (const d of sf.getTypeAliases()) if (d.getName() === name) hits.push(`type      ${name}  ${loc(d)}`);
      for (const d of sf.getEnums()) if (d.getName() === name) hits.push(`enum      ${name}  ${loc(d)}`);
      for (const d of sf.getVariableDeclarations()) if (d.getName() === name) hits.push(`const     ${name}  ${loc(d)}`);
    }
    const text = hits.length
      ? hits.join("\n")
      : `No declaration named "${name}" found under packages/ or tools/. (The codebase may be empty — much of Artifex is still design-stage.)`;
    return { content: [{ type: "text" as const, text }] };
  },
);

server.tool(
  "find_references",
  "Find references/usages of a named symbol across the Artifex monorepo.",
  { name: z.string().describe("exact symbol name to find usages of") },
  async ({ name }: { name: string }) => {
    const project = loadProject();
    const results = new Set<string>();
    for (const sf of project.getSourceFiles()) {
      const decl =
        sf.getClass(name) ??
        sf.getFunction(name) ??
        sf.getInterface(name) ??
        sf.getTypeAlias(name) ??
        sf.getEnum(name) ??
        sf.getVariableDeclaration(name);
      if (!decl) continue;
      for (const refSym of decl.findReferences()) {
        for (const ref of refSym.getReferences()) {
          results.add(loc(ref.getNode()));
        }
      }
    }
    const text = results.size
      ? [...results].sort().join("\n")
      : `No references found for "${name}".`;
    return { content: [{ type: "text" as const, text }] };
  },
);

server.tool(
  "list_exports",
  "List the exported symbols of a source file (path relative to the repo root, e.g. packages/shared-types/src/contract.ts).",
  { file: z.string().describe("path relative to repo root") },
  async ({ file }: { file: string }) => {
    const project = loadProject();
    const sf =
      project.getSourceFile(`${ROOT}/${file}`) ??
      project.getSourceFiles().find((s) => relative(ROOT, s.getFilePath()).replace(/\\/g, "/") === file);
    if (!sf) return { content: [{ type: "text" as const, text: `File not found in project: ${file}` }] };
    const names: string[] = [];
    for (const [n] of sf.getExportedDeclarations()) names.push(n);
    const text = names.length ? [...new Set(names)].sort().join("\n") : `No exports in ${file}.`;
    return { content: [{ type: "text" as const, text }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
