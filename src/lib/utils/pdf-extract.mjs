#!/usr/bin/env node
/**
 * Standalone PDF text extractor using pdfjs-dist.
 * Called as a child process to avoid Next.js webpack bundling issues.
 *
 * Usage: node pdf-extract.mjs <input.pdf> <output.txt> [password]
 */
import { readFileSync, writeFileSync } from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [,, inputPath, outputPath, password] = process.argv;

if (!inputPath || !outputPath) {
  console.error('Usage: node pdf-extract.mjs <input.pdf> <output.txt> [password]');
  process.exit(1);
}

try {
  const data = new Uint8Array(readFileSync(inputPath));
  const opts = { data };
  if (password) opts.password = password;

  const doc = await getDocument(opts).promise;
  let text = '';

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    text += pageText + '\n';
  }

  writeFileSync(outputPath, text, 'utf-8');
  console.log(`OK:${text.length}:${doc.numPages}`);
  process.exit(0);
} catch (err) {
  console.error(`ERROR:${err.message}`);
  process.exit(1);
}
