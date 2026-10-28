import path from "node:path";

/** Extensions that are always treated as binary regardless of content. */
const BINARY_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tif", "tiff", "avif", "heic", "pdf", "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "jar", "war", "mp3", "wav", "flac", "ogg", "m4a", "aac", "mp4", "mov", "avi", "mkv", "webm", "woff", "woff2", "ttf", "otf", "eot", "so", "dylib", "dll", "exe", "bin", "o", "a", "class", "wasm", "node", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "sqlite", "db", "mdb", "dat", "pack", "idx"]);

/** Extensions that are text even when they contain unusual bytes. */
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "rst", "log", "csv", "tsv", "json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "properties", "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "kts", "c", "h", "cc", "cpp", "hpp", "cs", "php", "swift", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "html", "htm", "css", "scss", "sass", "less", "vue", "svelte", "astro", "sql", "graphql", "gql", "proto", "tf", "tfvars", "hcl", "lua", "vim", "xml", "svg", "diff", "patch", "gitignore", "dockerignore", "editorconfig", "lock", "sum", "mod", "plist", "gradle", "cmake", "makefile", "dockerfile"]);
export function extensionOf(file) {
  const base = path.basename(file).toLowerCase();
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return base.startsWith(".") ? base.slice(1) : "";
  return base.slice(dot + 1);
}

/**
 * Decides whether a buffer is text: a NUL byte in the leading sample is the
 * strongest signal, then extension lists, then a control-character ratio.
 */
export function looksBinary(sample, file) {
  const extension = extensionOf(file);
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  if (TEXT_EXTENSIONS.has(extension)) return false;
  if (BINARY_EXTENSIONS.has(extension)) return true;
  if (sample.length === 0) return false;
  let control = 0;
  for (const byte of sample) {
    // Allow tab, newline and carriage return; count the rest of C0.
    if (byte < 0x09 || byte > 0x0d && byte < 0x20) control += 1;
  }
  return control / sample.length > 0.1;
}

/** Number of leading bytes read when sniffing a file. */
export const SNIFF_BYTES = 8192;
export function isBinaryExtension(file) {
  return BINARY_EXTENSIONS.has(extensionOf(file));
}
export function isTextExtension(file) {
  return TEXT_EXTENSIONS.has(extensionOf(file));
}
