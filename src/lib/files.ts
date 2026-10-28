import { constants } from "node:fs";
import { copyFile, mkdir, open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { looksBinary, SNIFF_BYTES } from "./binary";

/** Reads the leading bytes of a file to decide whether it is text. */
export async function sniffBinary(file: string): Promise<boolean> {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
    return looksBinary(buffer.subarray(0, bytesRead), file);
  } finally {
    await handle.close();
  }
}

export interface ReadTextResult {
  content: string;
  size: number;
  /** True when the file exceeded the inline size limit and was truncated. */
  tooLarge: boolean;
}

/**
 * Reads a text file, truncating at `maxBytes` so a huge file cannot exhaust
 * memory. A truncated read is flagged so the editor opens read-only.
 */
export async function readTextFile(file: string, maxBytes: number): Promise<ReadTextResult> {
  const info = await stat(file);
  if (maxBytes > 0 && info.size > maxBytes) {
    const handle = await open(file, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      return { content: buffer.subarray(0, bytesRead).toString("utf8"), size: info.size, tooLarge: true };
    } finally {
      await handle.close();
    }
  }
  return { content: await readFile(file, "utf8"), size: info.size, tooLarge: false };
}

export async function writeTextFile(file: string, content: string): Promise<void> {
  await writeFile(file, content, "utf8");
}

/** True when a path exists, for either a file or a directory. */
export async function pathExists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}

export async function pathIsDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Copies a file or directory tree. A copy-on-write clone is attempted first and
 * falls back to a byte copy on filesystems that do not support it.
 */
export async function copyEntry(source: string, destination: string): Promise<void> {
  const info = await stat(source);
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const child of await readdir(source)) {
      await copyEntry(path.join(source, child), path.join(destination, child));
    }
    return;
  }
  try {
    await copyFile(source, destination, constants.COPYFILE_FICLONE);
  } catch {
    await copyFile(source, destination);
  }
}

/** `open` on macOS, `xdg-open` elsewhere, `start` on Windows. */
export function systemOpenCommand(file: string): [string, string[]] {
  if (process.platform === "darwin") return ["open", [file]];
  if (process.platform === "win32") return ["cmd", ["/c", "start", "", file]];
  return ["xdg-open", [file]];
}

/** Creates an empty file without truncating an existing one. */
export async function createFile(file: string): Promise<void> {
  const handle = await open(file, "wx");
  await handle.close();
}
