/**
 * Allowlist of text/formatting HTML tags that should be serialized inline
 * (not treated as custom element blocks)
 */
export const VANILLA_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "span",
  "a",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "br",
]);

/**
 * Block-level HTML tags that should be serialized as separate tables
 * (not treated as inline vanilla tags, but also not custom elements)
 */
export const BLOCK_TAGS = new Set([
  "section",
  "div",
  "article",
  "aside",
  "nav",
  "header",
  "footer",
  "main",
]);
