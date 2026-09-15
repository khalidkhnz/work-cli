// Markdown conversion for the two Atlassian formats we post into:
//   - ADF   (Atlassian Document Format) for Jira REST v3 comments/descriptions
//   - Confluence storage XHTML for Confluence pages
//
// This covers a deliberately small Markdown subset: headings, paragraphs,
// bullet/ordered lists, fenced code, tables, blockquotes, hr, and the inline
// marks (bold, italic, code, links). That is everything a ticket comment or an
// API-contract doc actually needs.

// ---------------------------------------------------------------- block parse

function parseBlocks(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i++
      continue
    }

    // fenced code
    const fence = line.match(/^```\s*(\S+)?\s*$/)
    if (fence) {
      const lang = fence[1] || null
      const body = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++])
      i++ // closing fence
      blocks.push({ type: 'code', lang, text: body.join('\n') })
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() })
      i++
      continue
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: 'rule' })
      i++
      continue
    }

    // table: header row followed by a separator row
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const rows = []
      rows.push(splitRow(line))
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]))
      blocks.push({ type: 'table', rows })
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const body = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      blocks.push({ type: 'quote', text: body.join(' ').trim() })
      continue
    }

    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/)
    const ordered = line.match(/^(\s*)\d+[.)]\s+(.*)$/)
    if (bullet || ordered) {
      const ordType = ordered ? 'orderedList' : 'bulletList'
      const items = []
      while (i < lines.length) {
        const m = lines[i].match(ordered ? /^(\s*)\d+[.)]\s+(.*)$/ : /^(\s*)[-*+]\s+(.*)$/)
        if (!m) break
        items.push({ indent: Math.floor(m[1].length / 2), text: m[2].trim() })
        i++
        // fold continuation lines into the current item
        while (i < lines.length && lines[i].trim() && !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i])) {
          items[items.length - 1].text += ' ' + lines[i].trim()
          i++
        }
      }
      blocks.push({ type: ordType, items })
      continue
    }

    // paragraph
    const para = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*[-*+]\s|\s*\d+[.)]\s|\s*>)/.test(lines[i])) {
      para.push(lines[i++].trim())
    }
    if (para.length) blocks.push({ type: 'paragraph', text: para.join(' ') })
    else i++
  }

  return blocks
}

function splitRow(line) {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim())
}

// -------------------------------------------------------------- inline parse

// Returns a list of {text, marks:[...]} runs. Order matters: code first, so
// backticked content is never re-scanned for bold/link syntax.
function parseInline(text) {
  const tokens = []
  const re = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(~~[^~]+~~)/
  let rest = text

  while (rest) {
    const m = rest.match(re)
    if (!m) {
      tokens.push({ text: rest, marks: [] })
      break
    }
    if (m.index > 0) tokens.push({ text: rest.slice(0, m.index), marks: [] })
    const tok = m[0]

    if (tok.startsWith('`')) {
      tokens.push({ text: tok.slice(1, -1), marks: ['code'] })
    } else if (tok.startsWith('[')) {
      const link = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
      tokens.push({ text: link[1], marks: ['link'], href: link[2] })
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      tokens.push({ text: tok.slice(2, -2), marks: ['strong'] })
    } else if (tok.startsWith('~~')) {
      tokens.push({ text: tok.slice(2, -2), marks: ['strike'] })
    } else {
      tokens.push({ text: tok.slice(1, -1), marks: ['em'] })
    }
    rest = rest.slice(m.index + tok.length)
  }

  return tokens.filter((t) => t.text !== '')
}

// ------------------------------------------------------------------- to ADF

function adfInline(text) {
  const nodes = parseInline(text).map((t) => {
    const node = { type: 'text', text: t.text }
    const marks = []
    for (const m of t.marks) {
      if (m === 'link') marks.push({ type: 'link', attrs: { href: t.href } })
      else if (m === 'strike') marks.push({ type: 'strike' })
      else marks.push({ type: m })
    }
    if (marks.length) node.marks = marks
    return node
  })
  return nodes.length ? nodes : [{ type: 'text', text: ' ' }]
}

function adfListItems(items) {
  // Flatten one nesting level; deeper nesting is rare in tickets and ADF
  // rejects malformed structures outright, so we keep this conservative.
  return items.map((it) => ({
    type: 'listItem',
    content: [{ type: 'paragraph', content: adfInline(it.text) }],
  }))
}

export function markdownToAdf(md) {
  const content = []

  for (const b of parseBlocks(md)) {
    switch (b.type) {
      case 'heading':
        content.push({ type: 'heading', attrs: { level: b.level }, content: adfInline(b.text) })
        break
      case 'paragraph':
        content.push({ type: 'paragraph', content: adfInline(b.text) })
        break
      case 'code':
        content.push({
          type: 'codeBlock',
          attrs: b.lang ? { language: b.lang } : {},
          content: [{ type: 'text', text: b.text || ' ' }],
        })
        break
      case 'bulletList':
      case 'orderedList':
        content.push({ type: b.type, content: adfListItems(b.items) })
        break
      case 'quote':
        content.push({ type: 'blockquote', content: [{ type: 'paragraph', content: adfInline(b.text) }] })
        break
      case 'rule':
        content.push({ type: 'rule' })
        break
      case 'table':
        content.push({
          type: 'table',
          attrs: { isNumberColumnEnabled: false, layout: 'default' },
          content: b.rows.map((row, idx) => ({
            type: 'tableRow',
            content: row.map((cell) => ({
              type: idx === 0 ? 'tableHeader' : 'tableCell',
              attrs: {},
              content: [{ type: 'paragraph', content: adfInline(cell) }],
            })),
          })),
        })
        break
    }
  }

  if (!content.length) content.push({ type: 'paragraph', content: [{ type: 'text', text: ' ' }] })
  return { type: 'doc', version: 1, content }
}

// Jira returns descriptions and comments as ADF; render them back to readable text.
export function adfToText(node, depth = 0) {
  if (!node) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map((n) => adfToText(n, depth)).join('')

  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map((n) => adfToText(n, depth)).join('\n')
    case 'paragraph':
      return adfToText(node.content, depth) + '\n'
    case 'heading':
      return '\n' + '#'.repeat(node.attrs?.level ?? 1) + ' ' + adfToText(node.content, depth) + '\n'
    case 'text': {
      const marks = (node.marks ?? []).map((m) => m.type)
      let t = node.text ?? ''
      if (marks.includes('code')) t = '`' + t + '`'
      if (marks.includes('strong')) t = '**' + t + '**'
      const link = (node.marks ?? []).find((m) => m.type === 'link')
      if (link) t = `[${t}](${link.attrs?.href})`
      return t
    }
    case 'hardBreak':
      return '\n'
    case 'bulletList':
      return (node.content ?? []).map((li) => '  '.repeat(depth) + '- ' + adfToText(li, depth + 1).trim()).join('\n') + '\n'
    case 'orderedList':
      return (node.content ?? []).map((li, i) => '  '.repeat(depth) + `${i + 1}. ` + adfToText(li, depth + 1).trim()).join('\n') + '\n'
    case 'listItem':
      return adfToText(node.content, depth)
    case 'codeBlock':
      return '\n```' + (node.attrs?.language ?? '') + '\n' + adfToText(node.content, depth) + '\n```\n'
    case 'blockquote':
      return '> ' + adfToText(node.content, depth).trim() + '\n'
    case 'rule':
      return '\n---\n'
    case 'mediaSingle':
    case 'mediaGroup':
      return '[attachment]\n'
    case 'inlineCard':
      return node.attrs?.url ? `${node.attrs.url} ` : ''
    case 'mention':
      return `@${node.attrs?.text ?? node.attrs?.id ?? ''}`
    case 'emoji':
      return node.attrs?.text ?? ''
    case 'table':
      return (node.content ?? []).map((r) => adfToText(r, depth)).join('\n') + '\n'
    case 'tableRow':
      return '| ' + (node.content ?? []).map((c) => adfToText(c, depth).trim()).join(' | ') + ' |'
    case 'tableHeader':
    case 'tableCell':
      return adfToText(node.content, depth)
    default:
      return adfToText(node.content, depth)
  }
}

// -------------------------------------------------- to Confluence storage XML

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function storageInline(text) {
  return parseInline(text)
    .map((t) => {
      const body = esc(t.text)
      if (t.marks.includes('code')) return `<code>${body}</code>`
      if (t.marks.includes('link')) return `<a href="${esc(t.href)}">${body}</a>`
      if (t.marks.includes('strong')) return `<strong>${body}</strong>`
      if (t.marks.includes('em')) return `<em>${body}</em>`
      if (t.marks.includes('strike')) return `<s>${body}</s>`
      return body
    })
    .join('')
}

export function markdownToStorage(md) {
  const out = []

  for (const b of parseBlocks(md)) {
    switch (b.type) {
      case 'heading':
        out.push(`<h${b.level}>${storageInline(b.text)}</h${b.level}>`)
        break
      case 'paragraph':
        out.push(`<p>${storageInline(b.text)}</p>`)
        break
      case 'code':
        // The code macro gives real syntax highlighting in Confluence; a <pre>
        // block would render as flat grey text.
        out.push(
          '<ac:structured-macro ac:name="code">' +
            (b.lang ? `<ac:parameter ac:name="language">${esc(b.lang)}</ac:parameter>` : '') +
            `<ac:plain-text-body><![CDATA[${String(b.text).replace(/]]>/g, ']]]]><![CDATA[>')}]]></ac:plain-text-body>` +
            '</ac:structured-macro>'
        )
        break
      case 'bulletList':
        out.push('<ul>' + b.items.map((i) => `<li>${storageInline(i.text)}</li>`).join('') + '</ul>')
        break
      case 'orderedList':
        out.push('<ol>' + b.items.map((i) => `<li>${storageInline(i.text)}</li>`).join('') + '</ol>')
        break
      case 'quote':
        out.push(`<blockquote><p>${storageInline(b.text)}</p></blockquote>`)
        break
      case 'rule':
        out.push('<hr/>')
        break
      case 'table':
        out.push(
          '<table><tbody>' +
            b.rows
              .map(
                (row, idx) =>
                  '<tr>' +
                  row.map((c) => (idx === 0 ? `<th>${storageInline(c)}</th>` : `<td>${storageInline(c)}</td>`)).join('') +
                  '</tr>'
              )
              .join('') +
            '</tbody></table>'
        )
        break
    }
  }

  return out.join('\n')
}
