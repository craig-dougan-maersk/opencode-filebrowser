import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { transformFileAsync } from "@babel/core";
import solidPreset from "babel-preset-solid";
import typescriptPreset from "@babel/preset-typescript";

const SOURCE_ROOT = "src";
const OUTPUT_ROOT = "dist";

/** Collects every TypeScript source below a directory, in a stable order. */
async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(full)));
    else if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
  return files.sort();
}

function outputPath(source) {
  return join(OUTPUT_ROOT, relative(SOURCE_ROOT, source)).replace(/\.tsx?$/, ".js");
}

/**
 * Rewrites relative module specifiers to carry an explicit `.js` extension.
 * TypeScript sources omit the extension for readability, but the emitted files
 * are loaded as native ES modules, which require a resolvable specifier.
 */
function addRelativeExtensions(code) {
  return code.replace(
    /(\bfrom\s*|\bimport\s*|\bexport\s*\*\s*from\s*)(["'])(\.{1,2}\/[^"']+)(["'])/g,
    (match, prefix, open, specifier, close) =>
      /\.(?:js|mjs|cjs|json|node)$/.test(specifier) ? match : `${prefix}${open}${specifier}.js${close}`,
  );
}

/**
 * Compiles one source file to Solid universal JavaScript. The preset order
 * matters: Solid must see the JSX before TypeScript strips the annotations.
 * Babel infers TSX versus TS from the file extension, so `allExtensions` is
 * deliberately not set.
 */
async function compile(source) {
  const result = await transformFileAsync(source, {
    babelrc: false,
    configFile: false,
    sourceMaps: false,
    presets: [
      [solidPreset, { generate: "universal", moduleName: "@opentui/solid" }],
      [typescriptPreset, {}],
    ],
  });
  if (!result.code) throw new Error(`Babel produced no output for ${source}`);
  return `${addRelativeExtensions(result.code)}\n`;
}

try {
  const sources = await collect(SOURCE_ROOT);
  if (sources.length === 0) throw new Error(`No sources found under ${SOURCE_ROOT}`);
  const compiled = new Map();
  for (const source of sources) compiled.set(outputPath(source), await compile(source));

  if (process.argv.includes("--check")) {
    for (const [target, expected] of compiled) {
      let existing;
      try {
        existing = await readFile(target, "utf8");
      } catch {
        throw new Error(`${target} is missing; run npm run compile and commit the output`);
      }
      if (existing !== expected) {
        throw new Error(`${target} is stale; run npm run compile and commit the output`);
      }
    }
  } else {
    for (const [target, content] of compiled) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
  }
} catch (error) {
  console.error("Build failed:", error);
  process.exitCode = 1;
}
