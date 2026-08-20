import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const CONVEX_ONLY_IMPORTS = new Set([
  "@convex-dev/auth/react",
  "convex/react",
]);

const PROJECT_ROOT = process.cwd();

function readSource(relativePath: string) {
  return readFileSync(resolve(PROJECT_ROOT, relativePath), "utf8");
}

function staticImports(filePath: string) {
  const source = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  return sourceFile.statements.flatMap((statement) => {
    const hasModuleSpecifier =
      ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement);
    if (!hasModuleSpecifier || !statement.moduleSpecifier) {
      return [];
    }
    return ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [];
  });
}

function resolveLocalImport(fromFile: string, specifier: string) {
  const unresolved = specifier.startsWith("@/")
    ? resolve(PROJECT_ROOT, "src", specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (!unresolved) return null;

  const candidates = extname(unresolved)
    ? [unresolved]
    : [
        `${unresolved}.ts`,
        `${unresolved}.tsx`,
        resolve(unresolved, "index.ts"),
        resolve(unresolved, "index.tsx"),
      ];
  return candidates.find(existsSync) ?? null;
}

function collectStaticGraph(entryPath: string) {
  const entry = resolve(PROJECT_ROOT, entryPath);
  const pending = [entry];
  const visited = new Set<string>();
  const externalImports = new Set<string>();

  while (pending.length > 0) {
    const filePath = pending.pop();
    if (!filePath || visited.has(filePath)) continue;
    visited.add(filePath);

    for (const specifier of staticImports(filePath)) {
      const localImport = resolveLocalImport(filePath, specifier);
      if (localImport) pending.push(localImport);
      else externalImports.add(specifier);
    }
  }

  return {
    externalImports,
    files: [...visited].map((filePath) => relative(PROJECT_ROOT, filePath)),
  };
}

describe("local-only bundle boundary", () => {
  it("keeps Convex dependencies out of the complete static local graph", () => {
    const graph = collectStaticGraph("src/components/ConvexClientProvider.tsx");
    const forbidden = [...graph.externalImports].filter((specifier) =>
      CONVEX_ONLY_IMPORTS.has(specifier),
    );

    expect(forbidden, graph.files.join("\n")).toEqual([]);
  });

  it("loads the configured provider through an async import", () => {
    const source = readSource("src/components/ConvexClientProvider.tsx");

    expect(source).toContain('import("./ConfiguredConvexClientProvider")');
    expect(
      staticImports(resolve(PROJECT_ROOT, "src/components/ConfiguredConvexClientProvider.tsx")),
    ).toEqual(
      expect.arrayContaining(["@convex-dev/auth/react", "convex/react"]),
    );
  });
});
