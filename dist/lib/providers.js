import path from "node:path";
export const BUILTIN_PROVIDERS = new Set(["plaintext", "readonly"]);

/**
 * Converts a settings glob into a matcher over a basename, so `*.md` matches
 * `README.md` and `Makefile` matches exactly.
 */
export function compileMapping(match) {
  const source = match.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  const matcher = new RegExp(`^${source}$`, "i");
  return name => matcher.test(name);
}
export function buildRegistry(defaultProvider, map, providers) {
  return {
    mappings: map.map(entry => ({
      match: entry.match,
      test: compileMapping(entry.match),
      provider: entry.provider
    })),
    providers,
    defaultProvider
  };
}

/**
 * Picks the editor provider for a file. Configured mappings take precedence;
 * an unknown provider id falls through to the default so a typo in settings
 * degrades to the built-in editor instead of failing to open the file.
 */
export function resolveProvider(registry, file) {
  const name = path.basename(file);
  const mapped = registry.mappings.find(entry => entry.test(name))?.provider;
  const candidate = mapped ?? registry.defaultProvider;
  const settings = registry.providers[candidate];
  if (settings) {
    return {
      providerId: candidate,
      module: settings.module,
      options: settings.options
    };
  }
  if (BUILTIN_PROVIDERS.has(candidate)) return {
    providerId: candidate
  };
  return {
    providerId: BUILTIN_PROVIDERS.has(registry.defaultProvider) ? registry.defaultProvider : "plaintext"
  };
}
