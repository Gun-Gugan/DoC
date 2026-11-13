'use strict';
const path = require('path');
const sanitizeHtml = require('sanitize-html');
const mammoth = require('mammoth');
const { marked } = require('marked');

// The editor only produces this subset; anything else is stripped on save and import.
const SANITIZE_OPTIONS = {
  allowedTags: [
    'p', 'br', 'h1', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'span',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    li: ['data-list', 'class'],
    p: ['class'],
    span: ['class'],
    pre: ['class', 'data-language'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Quill encodes nesting depth as ql-indent-N classes.
  allowedClasses: { span: ['ql-ui'], pre: ['ql-syntax'], li: ['ql-indent-*'], p: ['ql-indent-*'] },
};

function sanitize(html) {
  return sanitizeHtml(String(html || ''), SANITIZE_OPTIONS);
}

const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.docx'];
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function textToHtml(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Converts an uploaded file into { title, html }.
 * Throws an Error with .status = 400 for unsupported or unreadable files.
 */
async function fileToDocument(originalName, buffer) {
  const ext = path.extname(originalName || '').toLowerCase();
  const title = path.basename(originalName || 'Imported document', ext).trim().slice(0, 200) || 'Imported document';
  let html;
  if (ext === '.txt') {
    html = textToHtml(buffer.toString('utf8'));
  } else if (ext === '.md') {
    html = marked.parse(buffer.toString('utf8'));
  } else if (ext === '.docx') {
    try {
      const result = await mammoth.convertToHtml({ buffer });
      html = result.value;
    } catch {
      throw Object.assign(new Error('Could not read that .docx file. Is it a valid Word document?'), { status: 400 });
    }
  } else {
    throw Object.assign(
      new Error(`Unsupported file type "${ext || 'unknown'}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`),
      { status: 400 }
    );
  }
  return { title, html: sanitize(html) };
}

module.exports = { sanitize, fileToDocument, SUPPORTED_EXTENSIONS, MAX_UPLOAD_BYTES };
