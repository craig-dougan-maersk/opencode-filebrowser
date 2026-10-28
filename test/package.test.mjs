import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseSync } from "@babel/core";
import test from "node:test";

/** Every compiled module the package ships, in the order the build emits them. */
const DIST_FILES = [
  "dist/lib/binary.js",
  "dist/lib/clipboard.js",
  "dist/lib/files.js",
  "dist/lib/fs-tree.js",
  "dist/lib/git.js",
  "dist/lib/icons.js",
  "dist/lib/protect.js",
  "dist/lib/providers.js",
  "dist/lib/settings.js",
  "dist/lib/theme.js",
  "dist/rpc.js",
  "dist/server/index.js",
  "dist/tui.js",
  "dist/ui/chrome.js",
  "dist/ui/editor.js",
  "dist/ui/provider.js",
  "dist/ui/state.js",
  "dist/ui/tree-row.js",
];

async function walkDist(directory = "dist", prefix = "dist") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await walkDist(full, relative)));
    else files.push(relative);
  }
  return files.sort();
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === "object") walk(value, visit);
  }
}

/**
 * Parses compiled JavaScript with no JSX or TypeScript syntax plugins, which
 * rejects either in the output, and reports the external specifiers it imports.
 */
function inspectJavaScript(code) {
  const ast = parseSync(code, { babelrc: false, configFile: false });
  const imports = new Set();
  const relative = [];
  walk(ast, (node) => {
    assert.ok(!node.type?.startsWith("JSX") && !node.type?.startsWith("TS"));
    if (node.type === "ImportDeclaration") imports.add(node.source.value);
    if (node.type === "StringLiteral") {
      assert.ok(!/^react(?:-dom)?(?:\/|$)/.test(node.value), "React import found");
    }
    if (node.type === "Identifier") assert.notEqual(node.name, "React");
  });
  // Relative specifiers must resolve as native ES modules, so they need an extension.
  walk(ast, (node) => {
    if (node.type !== "ImportDeclaration" && node.type !== "ExportAllDeclaration") return;
    const source = node.source?.value;
    if (typeof source !== "string" || !/^\.{1,2}\//.test(source)) return;
    relative.push(source);
    assert.ok(
      /\.(?:js|mjs|cjs|json|node)$/.test(source),
      `relative import without a resolvable extension: ${source}`,
    );
  });
  return { imports, relative };
}

test("the Git package exports committed JavaScript, not TSX", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(manifest.exports["./tui"], "./dist/tui.js");
  assert.equal(manifest.exports["./server"], "./dist/server.js");
  assert.equal(manifest.exports["./rpc"], "./dist/rpc.js");
  for (const file of DIST_FILES) assert.ok((await readFile(file, "utf8")).length > 0, file);
});

test("every committed module parses as plain JavaScript with resolvable imports", async () => {
  for (const file of DIST_FILES) {
    const { relative } = inspectJavaScript(await readFile(file, "utf8"));
    // A relative import must point at a module the package actually ships.
    for (const specifier of relative) {
      const target = join(dirname(file), specifier).replaceAll("\\", "/");
      assert.ok(DIST_FILES.includes(target), `${file} imports unpublished ${target}`);
    }
  }
});

test("the TUI half keeps its host runtimes external", async () => {
  const { imports } = inspectJavaScript(await readFile("dist/tui.js", "utf8"));
  for (const name of ["@opencode/plugin/tui", "solid-js", "@opentui/solid"]) {
    assert.ok(imports.has(name), `Missing external host runtime: ${name}`);
  }
});

test("the server half keeps the plugin host external", async () => {
  const { imports } = inspectJavaScript(await readFile("dist/server/index.js", "utf8"));
  assert.ok(imports.has("@opencode/plugin"), "Missing external host runtime: @opencode/plugin");
  // The TUI renderer must never leak into the server half.
  for (const name of ["@opentui/solid", "@opentui/core", "solid-js"]) {
    assert.ok(!imports.has(name), `Server half must not import ${name}`);
  }
});

test("the editor provider loader resolves absolute paths and rejects bad exports", async () => {
  const { loadEditorProvider } = await import("../dist/ui/provider.js");
  assert.equal(typeof loadEditorProvider, "function");

  // A module without a callable default export must be rejected with a clear reason.
  const directory = await mkdtemp(join(tmpdir(), "filebrowser-provider-"));
  try {
    const bad = join(directory, "bad.mjs");
    await writeFile(bad, "export default { not: 'a component' };\n");
    await assert.rejects(loadEditorProvider(bad), /does not export an editor component/);

    const good = join(directory, "good.mjs");
    await writeFile(good, "export default function Provider() { return null; }\n");
    assert.equal(typeof (await loadEditorProvider(good)), "function");

    // A relative specifier is not a valid configuration value.
    await assert.rejects(loadEditorProvider("./relative.mjs"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("output validation rejects React JSX transforms and raw TSX", () => {
  assert.throws(() => inspectJavaScript('import React from "react";'));
  assert.throws(() => inspectJavaScript('import { jsx } from "react/jsx-runtime";'));
  assert.throws(() => inspectJavaScript("const panel = <box />;"));
  assert.throws(() => inspectJavaScript("const count: number = 0;"));
  assert.throws(() => inspectJavaScript('import { x } from "./local";'));
});

test("committed output matches the current source and compiler settings", () => {
  execFileSync(process.execPath, ["scripts/build.mjs", "--check"], { stdio: "pipe" });
});

test("committed output covers exactly the modules the source defines", async () => {
  assert.deepEqual(await walkDist(), DIST_FILES);
});

test("root install resolves the reviewed patched Seroval version", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  const installed = JSON.parse(await readFile("node_modules/seroval/package.json", "utf8"));
  assert.equal(manifest.overrides.seroval, "1.6.8");
  const resolutions = Object.entries(lock.packages).filter(([path]) => path.endsWith("node_modules/seroval"));
  assert.equal(resolutions.length, 1);
  assert.equal(resolutions[0][1].version, "1.6.8");
  assert.equal(installed.version, "1.6.8");
});

test("build writes output and rejects stale, missing and invalid source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "filebrowser-build-"));
  const script = fileURLToPath(new URL("../scripts/build.mjs", import.meta.url));
  const run = (...args) => execFileSync(process.execPath, [script, ...args], { cwd: directory, stdio: "pipe" });
  try {
    assert.throws(() => run()); // Missing source must fail, not produce an empty dist.
    await mkdir(join(directory, "src/lib"), { recursive: true });
    await writeFile(join(directory, "src/lib/thing.ts"), await readFile("src/lib/fs-tree.ts"));
    run();
    inspectJavaScript(await readFile(join(directory, "dist/lib/thing.js"), "utf8"));
    run("--check");
    await writeFile(join(directory, "dist/lib/thing.js"), "// stale\n");
    assert.throws(() => run("--check"), /stale; run npm run compile/);
    assert.equal(await readFile(join(directory, "dist/lib/thing.js"), "utf8"), "// stale\n");
    await rm(join(directory, "dist/lib/thing.js"));
    assert.throws(() => run("--check"), /missing; run npm run compile/);
    await writeFile(join(directory, "src/lib/thing.ts"), "const invalid = <");
    assert.throws(() => run());
    await writeFile(join(directory, "src/lib/thing.ts"), "");
    assert.throws(() => run(), /Babel produced no output/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("scripts-disabled package includes compiled exports without build dependencies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "filebrowser-package-"));
  try {
    const packed = JSON.parse(
      execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", directory], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    )[0];
    const paths = packed.files.map((file) => file.path).sort();
    assert.deepEqual(paths, [
      "README.md",
      "package.json",
      "schema/filebrowser.schema.json",
      ...[...DIST_FILES].sort(),
    ].sort());
    // No build inputs, tests or dependencies may leak into the tarball.
    for (const path of paths) {
      assert.ok(!/(?:^|\/)(?:src|test|scripts|node_modules)\//.test(path), `unexpected entry ${path}`);
    }

    const archive = join(directory, packed.filename);
    const extract = (path) => execFileSync("tar", ["-xOf", archive, `package/${path}`], { encoding: "utf8" });
    const manifest = JSON.parse(extract("package.json"));
    assert.equal(manifest.exports["./tui"], "./dist/tui.js");
    assert.deepEqual(manifest.dependencies, { "@opencode/plugin": "latest", "@opencode/theme": "latest" });
    assert.equal(manifest.devDependencies["@babel/core"] === undefined, false);

    for (const file of DIST_FILES) {
      const code = extract(file);
      inspectJavaScript(code);
      const target = join(directory, file.replaceAll("/", "-"));
      await writeFile(target, code);
      execFileSync(process.execPath, ["--check", target], { stdio: "pipe" });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
