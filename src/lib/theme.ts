import type { RGBA } from "@opentui/core";

/**
 * Colour values accepted by OpenTUI. The host theme hands back RGBA objects,
 * but the adapter also tolerates plain strings so a fallback can be used when
 * a token is missing on an older host.
 */
export type ThemeColor = RGBA | string;

/**
 * The subset of host theme tokens the file browser reads. Every field is
 * required on the adapted result because `adaptTheme` fills the gaps with safe
 * literals, so consumers never have to guard a colour read.
 */
export interface ThemeTokens {
  textBase: ThemeColor;
  textMuted: ThemeColor;
  textFaint: ThemeColor;
  textPrimary: ThemeColor;
  error: ThemeColor;
  warning: ThemeColor;
  success: ThemeColor;
  info: ThemeColor;
  backgroundBase: ThemeColor;
  backgroundRaised: ThemeColor;
  backgroundRaisedHigh: ThemeColor;
  syntaxComment: ThemeColor;
  syntaxKeyword: ThemeColor;
  syntaxString: ThemeColor;
  syntaxNumber: ThemeColor;
  syntaxFunction: ThemeColor;
  syntaxType: ThemeColor;
  syntaxVariable: ThemeColor;
  syntaxOperator: ThemeColor;
  syntaxPunctuation: ThemeColor;
}

/** Fallbacks used whenever the host does not publish a token. */
const FALLBACK: ThemeTokens = {
  textBase: "#d4d4d4",
  textMuted: "#8b949e",
  textFaint: "#6e7681",
  textPrimary: "#58a6ff",
  error: "#ff7b72",
  warning: "#d29922",
  success: "#3fb950",
  info: "#58a6ff",
  backgroundBase: "transparent",
  backgroundRaised: "#161b22",
  backgroundRaisedHigh: "#21262d",
  syntaxComment: "#8b949e",
  syntaxKeyword: "#ff7b72",
  syntaxString: "#a5d6ff",
  syntaxNumber: "#79c0ff",
  syntaxFunction: "#d2a8ff",
  syntaxType: "#ffa657",
  syntaxVariable: "#ffa657",
  syntaxOperator: "#ff7b72",
  syntaxPunctuation: "#8b949e",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads a nested token, returning undefined for any missing link in the path. */
function at(root: unknown, ...path: string[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (!isRecord(node)) return undefined;
    node = node[key];
  }
  return node;
}

/**
 * Accepts a host colour only when it is a string or an RGBA-like object, so an
 * unexpected theme shape degrades to the literal fallback instead of throwing.
 */
function color(value: unknown, fallback: ThemeColor): ThemeColor {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof (value as { toInts?: unknown }).toInts === "function") {
    return value as unknown as RGBA;
  }
  return fallback;
}

/**
 * Builds the adapter over whatever the host exposes. Unknown shapes degrade to
 * literal fallbacks rather than throwing, so a theme refactor cannot break the
 * browser.
 */
export function adaptTheme(theme: unknown): ThemeTokens {
  const pick = (fallback: ThemeColor, ...path: string[]): ThemeColor => color(at(theme, ...path), fallback);
  return {
    textBase: pick(FALLBACK.textBase, "text", "base"),
    textMuted: pick(FALLBACK.textMuted, "text", "muted"),
    textFaint: pick(FALLBACK.textFaint, "text", "faint"),
    textPrimary: pick(FALLBACK.textPrimary, "text", "action", "primary", "base"),
    error: pick(FALLBACK.error, "text", "feedback", "error", "base"),
    warning: pick(FALLBACK.warning, "text", "feedback", "warning", "base"),
    success: pick(FALLBACK.success, "text", "feedback", "success", "base"),
    info: pick(FALLBACK.info, "text", "feedback", "info", "base"),
    backgroundBase: pick(FALLBACK.backgroundBase, "background", "base"),
    backgroundRaised: pick(FALLBACK.backgroundRaised, "background", "raised", "base"),
    backgroundRaisedHigh: pick(FALLBACK.backgroundRaisedHigh, "background", "raised", "high"),
    syntaxComment: pick(FALLBACK.syntaxComment, "syntax", "comment"),
    syntaxKeyword: pick(FALLBACK.syntaxKeyword, "syntax", "keyword"),
    syntaxString: pick(FALLBACK.syntaxString, "syntax", "string"),
    syntaxNumber: pick(FALLBACK.syntaxNumber, "syntax", "number"),
    syntaxFunction: pick(FALLBACK.syntaxFunction, "syntax", "function"),
    syntaxType: pick(FALLBACK.syntaxType, "syntax", "type"),
    syntaxVariable: pick(FALLBACK.syntaxVariable, "syntax", "variable"),
    syntaxOperator: pick(FALLBACK.syntaxOperator, "syntax", "operator"),
    syntaxPunctuation: pick(FALLBACK.syntaxPunctuation, "syntax", "punctuation"),
  };
}

/** Theme tokens used to build the editor's syntax style. */
export function syntaxStyleMap(tokens: ThemeTokens): Record<string, { fg: ThemeColor }> {
  return {
    default: { fg: tokens.textBase },
    comment: { fg: tokens.syntaxComment },
    keyword: { fg: tokens.syntaxKeyword },
    string: { fg: tokens.syntaxString },
    number: { fg: tokens.syntaxNumber },
    function: { fg: tokens.syntaxFunction },
    type: { fg: tokens.syntaxType },
    variable: { fg: tokens.syntaxVariable },
    operator: { fg: tokens.syntaxOperator },
    punctuation: { fg: tokens.syntaxPunctuation },
  };
}
