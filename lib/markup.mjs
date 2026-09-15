// Atlassian Document Format (ADF) utilities for Jira REST v3.
//
// This module provides:
//   - ADF validation and type checking
//   - Markdown → ADF conversion (for convenience, but ADF is preferred)
//   - ADF → text conversion (for reading Jira responses)
//   - Confluence storage XHTML conversion
//
// ADF is the primary format — pass ADF objects directly to Jira operations.
// Markdown conversion is available as a fallback for simple cases.

// ---------------------------------------------------------------- ADF types & validation

// Valid ADF top-level node types
const ADF_BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "codeBlock",
  "blockquote",
  "rule",
  "table",
  "mediaSingle",
  "mediaGroup",
  "panel",
  "expand",
  "nestedExpand",
  "taskList",
  "decisionList",
  "bodiedExtension",
  "extension",
  "layoutSection",
  "embedCard",
]);

// Valid ADF inline node types
const ADF_INLINE_TYPES = new Set([
  "text",
  "hardBreak",
  "mention",
  "emoji",
  "inlineCard",
  "date",
  "status",
  "placeholder",
  "inlineExtension",
]);

// Valid ADF mark types
const ADF_MARK_TYPES = new Set([
  "strong",
  "em",
  "code",
  "strike",
  "underline",
  "link",
  "subsup",
  "textColor",
  "backgroundColor",
  "annotation",
]);

/**
 * Check if a value is a valid ADF document.
 * @param {unknown} value - Value to check
 * @returns {boolean} True if value is a valid ADF document
 */
export function isAdf(value) {
  if (!value || typeof value !== "object") return false;
  if (value.type !== "doc") return false;
  if (value.version !== 1) return false;
  if (!Array.isArray(value.content)) return false;
  return true;
}

/**
 * Validate an ADF document structure. Throws on invalid structure.
 * @param {object} adf - ADF document to validate
 * @param {string} [context] - Context for error messages
 * @throws {Error} If ADF structure is invalid
 */
export function validateAdf(adf, context = "ADF document") {
  if (!adf || typeof adf !== "object") {
    throw new Error(`${context}: expected object, got ${typeof adf}`);
  }
  if (adf.type !== "doc") {
    throw new Error(`${context}: root type must be 'doc', got '${adf.type}'`);
  }
  if (adf.version !== 1) {
    throw new Error(`${context}: version must be 1, got ${adf.version}`);
  }
  if (!Array.isArray(adf.content)) {
    throw new Error(`${context}: content must be an array`);
  }
  if (adf.content.length === 0) {
    throw new Error(`${context}: content cannot be empty`);
  }

  // Validate each top-level node
  for (let i = 0; i < adf.content.length; i++) {
    validateAdfNode(adf.content[i], `${context}.content[${i}]`);
  }
}

/**
 * Validate a single ADF node (recursive).
 * @param {object} node - ADF node to validate
 * @param {string} path - Path for error messages
 */
function validateAdfNode(node, path) {
  if (!node || typeof node !== "object") {
    throw new Error(`${path}: expected object, got ${typeof node}`);
  }
  if (typeof node.type !== "string") {
    throw new Error(`${path}: missing or invalid 'type' property`);
  }

  // Check node type is known
  const isBlock = ADF_BLOCK_TYPES.has(node.type);
  const isInline = ADF_INLINE_TYPES.has(node.type);
  const isListItem = ["listItem", "taskItem", "decisionItem"].includes(
    node.type,
  );
  const isTablePart = ["tableRow", "tableHeader", "tableCell"].includes(
    node.type,
  );
  const isLayoutPart = ["layoutColumn"].includes(node.type);
  const isMedia = ["media"].includes(node.type);

  if (
    !isBlock &&
    !isInline &&
    !isListItem &&
    !isTablePart &&
    !isLayoutPart &&
    !isMedia
  ) {
    // Unknown type — warn but don't fail (ADF may have new types)
    console.warn(`${path}: unknown node type '${node.type}'`);
  }

  // Validate text nodes
  if (node.type === "text") {
    if (typeof node.text !== "string") {
      throw new Error(`${path}: text node missing 'text' property`);
    }
    if (node.marks) {
      if (!Array.isArray(node.marks)) {
        throw new Error(`${path}: marks must be an array`);
      }
      for (const mark of node.marks) {
        if (!mark.type || typeof mark.type !== "string") {
          throw new Error(`${path}: mark missing 'type' property`);
        }
        if (!ADF_MARK_TYPES.has(mark.type)) {
          console.warn(`${path}: unknown mark type '${mark.type}'`);
        }
      }
    }
  }

  // Validate child content recursively
  if (node.content) {
    if (!Array.isArray(node.content)) {
      throw new Error(`${path}: content must be an array`);
    }
    for (let i = 0; i < node.content.length; i++) {
      validateAdfNode(node.content[i], `${path}.content[${i}]`);
    }
  }
}

/**
 * Normalize input to ADF. Accepts:
 *   - ADF object (returned as-is after validation)
 *   - String (converted from Markdown)
 *   - null/undefined (returns empty paragraph)
 *
 * @param {object|string|null} input - Input to normalize
 * @param {object} [options] - Options
 * @param {boolean} [options.validate=true] - Validate ADF structure
 * @param {string} [options.context='input'] - Context for errors
 * @returns {object} Valid ADF document
 */
export function toAdf(input, { validate = true, context = "input" } = {}) {
  // Null/undefined → empty paragraph
  if (input == null || input === "") {
    return {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: " " }] }],
    };
  }

  // String → convert from Markdown
  if (typeof input === "string") {
    return markdownToAdf(input);
  }

  // Object → assume ADF, validate
  if (typeof input === "object") {
    if (validate) {
      validateAdf(input, context);
    }
    return input;
  }

  throw new Error(
    `${context}: expected ADF object or string, got ${typeof input}`,
  );
}

/**
 * Create a simple ADF text paragraph.
 * @param {string} text - Text content
 * @returns {object} ADF document with single paragraph
 */
export function adfText(text) {
  return {
    type: "doc",
    version: 1,
    content: [
      { type: "paragraph", content: [{ type: "text", text: String(text) }] },
    ],
  };
}

/**
 * Create an ADF paragraph with inline formatting.
 * @param {Array<{text: string, marks?: string[]}>} segments - Text segments with optional marks
 * @returns {object} ADF paragraph node
 */
export function adfParagraph(segments) {
  const content = segments.map((seg) => {
    const node = { type: "text", text: seg.text };
    if (seg.marks?.length) {
      node.marks = seg.marks.map((m) => {
        if (typeof m === "string") return { type: m };
        return m; // already a mark object with attrs
      });
    }
    return node;
  });
  return { type: "paragraph", content };
}

/**
 * Create an ADF document from paragraph nodes.
 * @param {Array<object>} blocks - Block nodes (paragraphs, headings, etc.)
 * @returns {object} ADF document
 */
export function adfDoc(blocks) {
  return { type: "doc", version: 1, content: blocks };
}

/**
 * Create an ADF code block.
 * @param {string} code - Code content
 * @param {string} [language] - Language for syntax highlighting
 * @returns {object} ADF codeBlock node
 */
export function adfCodeBlock(code, language) {
  const node = {
    type: "codeBlock",
    content: [{ type: "text", text: code }],
  };
  if (language) {
    node.attrs = { language };
  }
  return node;
}

/**
 * Create an ADF heading.
 * @param {number} level - Heading level (1-6)
 * @param {string} text - Heading text
 * @returns {object} ADF heading node
 */
export function adfHeading(level, text) {
  return {
    type: "heading",
    attrs: { level: Math.max(1, Math.min(6, level)) },
    content: [{ type: "text", text }],
  };
}

/**
 * Create an ADF bullet list.
 * @param {string[]} items - List item texts
 * @returns {object} ADF bulletList node
 */
export function adfBulletList(items) {
  return {
    type: "bulletList",
    content: items.map((text) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    })),
  };
}

/**
 * Create an ADF ordered list.
 * @param {string[]} items - List item texts
 * @returns {object} ADF orderedList node
 */
export function adfOrderedList(items) {
  return {
    type: "orderedList",
    content: items.map((text) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    })),
  };
}

/**
 * Create an ADF table.
 * @param {string[][]} rows - 2D array of cell contents (first row = headers)
 * @returns {object} ADF table node
 */
export function adfTable(rows) {
  return {
    type: "table",
    attrs: { isNumberColumnEnabled: false, layout: "default" },
    content: rows.map((row, idx) => ({
      type: "tableRow",
      content: row.map((cell) => ({
        type: idx === 0 ? "tableHeader" : "tableCell",
        attrs: {},
        content: [
          { type: "paragraph", content: [{ type: "text", text: cell }] },
        ],
      })),
    })),
  };
}

/**
 * Create an ADF panel (info, note, warning, error, success).
 * @param {string} panelType - Panel type: info, note, warning, error, success
 * @param {string|object} content - Panel content (string or ADF block)
 * @returns {object} ADF panel node
 */
export function adfPanel(panelType, content) {
  const innerContent =
    typeof content === "string"
      ? [{ type: "paragraph", content: [{ type: "text", text: content }] }]
      : [content];

  return {
    type: "panel",
    attrs: { panelType },
    content: innerContent,
  };
}

/**
 * Create an ADF mention.
 * @param {string} accountId - Atlassian account ID
 * @param {string} [displayText] - Display text for the mention
 * @returns {object} ADF mention node
 */
export function adfMention(accountId, displayText) {
  return {
    type: "mention",
    attrs: {
      id: accountId,
      text: displayText || `@${accountId}`,
      accessLevel: "",
    },
  };
}

/**
 * Create an ADF emoji.
 * @param {string} shortName - Emoji short name (e.g., ':smile:')
 * @param {string} [id] - Emoji ID (for custom emojis)
 * @returns {object} ADF emoji node
 */
export function adfEmoji(shortName, id) {
  return {
    type: "emoji",
    attrs: { shortName, id: id || shortName, text: shortName },
  };
}

/**
 * Create an ADF inline card (smart link).
 * @param {string} url - URL to link
 * @returns {object} ADF inlineCard node
 */
export function adfInlineCard(url) {
  return {
    type: "inlineCard",
    attrs: { url },
  };
}

/**
 * Create an ADF status lozenge.
 * @param {string} text - Status text
 * @param {string} color - Color: neutral, purple, blue, red, yellow, green
 * @returns {object} ADF status node
 */
export function adfStatus(text, color = "neutral") {
  return {
    type: "status",
    attrs: {
      text,
      color,
      localId: crypto.randomUUID?.() || Date.now().toString(),
    },
  };
}

/**
 * Create an ADF date node.
 * @param {string|number|Date} date - Date value (ISO string, timestamp, or Date)
 * @returns {object} ADF date node
 */
export function adfDate(date) {
  let timestamp;
  if (date instanceof Date) {
    timestamp = date.getTime();
  } else if (typeof date === "number") {
    timestamp = date;
  } else {
    timestamp = new Date(date).getTime();
  }
  return {
    type: "date",
    attrs: { timestamp },
  };
}

// ---------------------------------------------------------------- block parse

function parseBlocks(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // fenced code
    const fence = line.match(/^```\s*(\S+)?\s*$/);
    if (fence) {
      const lang = fence[1] || null;
      const body = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i]))
        body.push(lines[i++]);
      i++; // closing fence
      blocks.push({ type: "code", lang, text: body.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        text: heading[2].trim(),
      });
      i++;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }

    // table: header row followed by a separator row
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])
    ) {
      const rows = [];
      rows.push(splitRow(line));
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim())
        rows.push(splitRow(lines[i++]));
      blocks.push({ type: "table", rows });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]))
        body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ type: "quote", text: body.join(" ").trim() });
      continue;
    }

    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    const ordered = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
    if (bullet || ordered) {
      const ordType = ordered ? "orderedList" : "bulletList";
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(
          ordered ? /^(\s*)\d+[.)]\s+(.*)$/ : /^(\s*)[-*+]\s+(.*)$/,
        );
        if (!m) break;
        items.push({ indent: Math.floor(m[1].length / 2), text: m[2].trim() });
        i++;
        // fold continuation lines into the current item
        while (
          i < lines.length &&
          lines[i].trim() &&
          !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]) &&
          !/^#{1,6}\s/.test(lines[i])
        ) {
          items[items.length - 1].text += " " + lines[i].trim();
          i++;
        }
      }
      blocks.push({ type: ordType, items });
      continue;
    }

    // paragraph
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|```|\s*[-*+]\s|\s*\d+[.)]\s|\s*>)/.test(lines[i])
    ) {
      para.push(lines[i++].trim());
    }
    if (para.length) blocks.push({ type: "paragraph", text: para.join(" ") });
    else i++;
  }

  return blocks;
}

function splitRow(line) {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

// -------------------------------------------------------------- inline parse

// Returns a list of {text, marks:[...]} runs. Order matters: code first, so
// backticked content is never re-scanned for bold/link syntax.
function parseInline(text) {
  const tokens = [];
  const re =
    /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(~~[^~]+~~)/;
  let rest = text;

  while (rest) {
    const m = rest.match(re);
    if (!m) {
      tokens.push({ text: rest, marks: [] });
      break;
    }
    if (m.index > 0) tokens.push({ text: rest.slice(0, m.index), marks: [] });
    const tok = m[0];

    if (tok.startsWith("`")) {
      tokens.push({ text: tok.slice(1, -1), marks: ["code"] });
    } else if (tok.startsWith("[")) {
      const link = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      tokens.push({ text: link[1], marks: ["link"], href: link[2] });
    } else if (tok.startsWith("**") || tok.startsWith("__")) {
      tokens.push({ text: tok.slice(2, -2), marks: ["strong"] });
    } else if (tok.startsWith("~~")) {
      tokens.push({ text: tok.slice(2, -2), marks: ["strike"] });
    } else {
      tokens.push({ text: tok.slice(1, -1), marks: ["em"] });
    }
    rest = rest.slice(m.index + tok.length);
  }

  return tokens.filter((t) => t.text !== "");
}

// ------------------------------------------------------------------- to ADF

function adfInline(text) {
  const nodes = parseInline(text).map((t) => {
    const node = { type: "text", text: t.text };
    const marks = [];
    for (const m of t.marks) {
      if (m === "link") marks.push({ type: "link", attrs: { href: t.href } });
      else if (m === "strike") marks.push({ type: "strike" });
      else marks.push({ type: m });
    }
    if (marks.length) node.marks = marks;
    return node;
  });
  return nodes.length ? nodes : [{ type: "text", text: " " }];
}

function adfListItems(items) {
  // Flatten one nesting level; deeper nesting is rare in tickets and ADF
  // rejects malformed structures outright, so we keep this conservative.
  return items.map((it) => ({
    type: "listItem",
    content: [{ type: "paragraph", content: adfInline(it.text) }],
  }));
}

export function markdownToAdf(md) {
  const content = [];

  for (const b of parseBlocks(md)) {
    switch (b.type) {
      case "heading":
        content.push({
          type: "heading",
          attrs: { level: b.level },
          content: adfInline(b.text),
        });
        break;
      case "paragraph":
        content.push({ type: "paragraph", content: adfInline(b.text) });
        break;
      case "code":
        content.push({
          type: "codeBlock",
          attrs: b.lang ? { language: b.lang } : {},
          content: [{ type: "text", text: b.text || " " }],
        });
        break;
      case "bulletList":
      case "orderedList":
        content.push({ type: b.type, content: adfListItems(b.items) });
        break;
      case "quote":
        content.push({
          type: "blockquote",
          content: [{ type: "paragraph", content: adfInline(b.text) }],
        });
        break;
      case "rule":
        content.push({ type: "rule" });
        break;
      case "table":
        content.push({
          type: "table",
          attrs: { isNumberColumnEnabled: false, layout: "default" },
          content: b.rows.map((row, idx) => ({
            type: "tableRow",
            content: row.map((cell) => ({
              type: idx === 0 ? "tableHeader" : "tableCell",
              attrs: {},
              content: [{ type: "paragraph", content: adfInline(cell) }],
            })),
          })),
        });
        break;
    }
  }

  if (!content.length)
    content.push({ type: "paragraph", content: [{ type: "text", text: " " }] });
  return { type: "doc", version: 1, content };
}

// Jira returns descriptions and comments as ADF; render them back to readable text.
export function adfToText(node, depth = 0) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map((n) => adfToText(n, depth)).join("");

  switch (node.type) {
    case "doc":
      return (node.content ?? []).map((n) => adfToText(n, depth)).join("\n");
    case "paragraph":
      return adfToText(node.content, depth) + "\n";
    case "heading":
      return (
        "\n" +
        "#".repeat(node.attrs?.level ?? 1) +
        " " +
        adfToText(node.content, depth) +
        "\n"
      );
    case "text": {
      const marks = (node.marks ?? []).map((m) => m.type);
      let t = node.text ?? "";
      if (marks.includes("code")) t = "`" + t + "`";
      if (marks.includes("strong")) t = "**" + t + "**";
      const link = (node.marks ?? []).find((m) => m.type === "link");
      if (link) t = `[${t}](${link.attrs?.href})`;
      return t;
    }
    case "hardBreak":
      return "\n";
    case "bulletList":
      return (
        (node.content ?? [])
          .map(
            (li) => "  ".repeat(depth) + "- " + adfToText(li, depth + 1).trim(),
          )
          .join("\n") + "\n"
      );
    case "orderedList":
      return (
        (node.content ?? [])
          .map(
            (li, i) =>
              "  ".repeat(depth) +
              `${i + 1}. ` +
              adfToText(li, depth + 1).trim(),
          )
          .join("\n") + "\n"
      );
    case "listItem":
      return adfToText(node.content, depth);
    case "codeBlock":
      return (
        "\n```" +
        (node.attrs?.language ?? "") +
        "\n" +
        adfToText(node.content, depth) +
        "\n```\n"
      );
    case "blockquote":
      return "> " + adfToText(node.content, depth).trim() + "\n";
    case "rule":
      return "\n---\n";
    case "mediaSingle":
    case "mediaGroup":
      return "[attachment]\n";
    case "inlineCard":
      return node.attrs?.url ? `${node.attrs.url} ` : "";
    case "mention":
      return `@${node.attrs?.text ?? node.attrs?.id ?? ""}`;
    case "emoji":
      return node.attrs?.text ?? "";
    case "table":
      return (
        (node.content ?? []).map((r) => adfToText(r, depth)).join("\n") + "\n"
      );
    case "tableRow":
      return (
        "| " +
        (node.content ?? [])
          .map((c) => adfToText(c, depth).trim())
          .join(" | ") +
        " |"
      );
    case "tableHeader":
    case "tableCell":
      return adfToText(node.content, depth);
    default:
      return adfToText(node.content, depth);
  }
}

// -------------------------------------------------- to Confluence storage XML

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function storageInline(text) {
  return parseInline(text)
    .map((t) => {
      const body = esc(t.text);
      if (t.marks.includes("code")) return `<code>${body}</code>`;
      if (t.marks.includes("link"))
        return `<a href="${esc(t.href)}">${body}</a>`;
      if (t.marks.includes("strong")) return `<strong>${body}</strong>`;
      if (t.marks.includes("em")) return `<em>${body}</em>`;
      if (t.marks.includes("strike")) return `<s>${body}</s>`;
      return body;
    })
    .join("");
}

export function markdownToStorage(md) {
  const out = [];

  for (const b of parseBlocks(md)) {
    switch (b.type) {
      case "heading":
        out.push(`<h${b.level}>${storageInline(b.text)}</h${b.level}>`);
        break;
      case "paragraph":
        out.push(`<p>${storageInline(b.text)}</p>`);
        break;
      case "code":
        // The code macro gives real syntax highlighting in Confluence; a <pre>
        // block would render as flat grey text.
        out.push(
          '<ac:structured-macro ac:name="code">' +
            (b.lang
              ? `<ac:parameter ac:name="language">${esc(b.lang)}</ac:parameter>`
              : "") +
            `<ac:plain-text-body><![CDATA[${String(b.text).replace(/]]>/g, "]]]]><![CDATA[>")}]]></ac:plain-text-body>` +
            "</ac:structured-macro>",
        );
        break;
      case "bulletList":
        out.push(
          "<ul>" +
            b.items.map((i) => `<li>${storageInline(i.text)}</li>`).join("") +
            "</ul>",
        );
        break;
      case "orderedList":
        out.push(
          "<ol>" +
            b.items.map((i) => `<li>${storageInline(i.text)}</li>`).join("") +
            "</ol>",
        );
        break;
      case "quote":
        out.push(`<blockquote><p>${storageInline(b.text)}</p></blockquote>`);
        break;
      case "rule":
        out.push("<hr/>");
        break;
      case "table":
        out.push(
          "<table><tbody>" +
            b.rows
              .map(
                (row, idx) =>
                  "<tr>" +
                  row
                    .map((c) =>
                      idx === 0
                        ? `<th>${storageInline(c)}</th>`
                        : `<td>${storageInline(c)}</td>`,
                    )
                    .join("") +
                  "</tr>",
              )
              .join("") +
            "</tbody></table>",
        );
        break;
    }
  }

  return out.join("\n");
}
