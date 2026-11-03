// Which files of a repository are worth reading to find where feedback points: code, markup and styles (plus the
// config files that wire them up). Dependencies, build output, lockfiles, minified bundles, images, fonts and other
// binaries are dropped, by path, before anything is read.

/** A file over this size is never listed or read (generated code, data dumps, bundles). */
export const MAX_FILE_BYTES = 400 * 1024;
/** A snapshot stops listing after this many files. */
export const MAX_FILES = 20_000;
/** A snapshot held in memory (the GitHub reader) stops after this many bytes of source. */
export const MAX_SNAPSHOT_BYTES = 100 * 1024 * 1024;

/** Folders that hold dependencies, build output or tool state, wherever they sit in the tree. */
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".next", ".expo", ".git", "Pods", "coverage", ".turbo", ".vercel", ".cache", ".yarn",
  ".svelte-kit", ".nuxt", ".output", "__pycache__", ".venv", "venv", "bower_components",
]);

const LOCKFILES = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "Podfile.lock",
  "Gemfile.lock", "Cargo.lock", "composer.lock", "poetry.lock", "Pipfile.lock", "gradle.lockfile", "packages.lock.json",
  "flake.lock", "go.sum", "mix.lock", "pubspec.lock",
]);

const SOURCE_EXT = new Set([
  // code
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "kts", "swift", "m", "mm",
  "h", "hpp", "c", "cc", "cpp", "cs", "php", "dart", "scala", "ex", "exs", "erl", "hs", "clj", "cljs", "lua", "sh",
  "bash", "zsh", "sql", "graphql", "gql", "prisma", "proto", "r", "jl", "elm",
  // markup
  "html", "htm", "xml", "vue", "svelte", "astro", "hbs", "handlebars", "ejs", "erb", "jinja", "j2", "liquid", "njk",
  "pug", "twig", "md", "mdx",
  // styles
  "css", "scss", "sass", "less", "styl", "pcss",
  // config that wires the code up
  "json", "json5", "jsonc", "yaml", "yml", "toml",
]);

/** True for a folder path (relative, "/"-separated) that a listing should not walk into. */
export function isSkippedDir(dir: string): boolean {
  return dir.split("/").some((seg) => SKIP_DIRS.has(seg));
}

/** True for a repository path (relative, "/"-separated) that holds code, markup or styles. */
export function isSourcePath(path: string): boolean {
  const segs = path.split("/");
  const base = segs.pop() ?? "";
  if (!base || segs.some((seg) => SKIP_DIRS.has(seg))) return false;
  if (LOCKFILES.has(base) || /\.lockb?$/i.test(base) || /\.min\.[^.]+$/i.test(base)) return false;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false; // no extension, or a dotfile such as .env
  return SOURCE_EXT.has(base.slice(dot + 1).toLowerCase());
}

/** A NUL byte in the first 8 KB means a binary file, whatever its name says. */
export function looksBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8192).includes(0);
}
