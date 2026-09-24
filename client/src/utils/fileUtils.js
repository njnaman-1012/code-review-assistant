// Reads an uploaded source file in the browser. The file is only read as
// text and placed in the editor - it is never executed or stored as a file.
import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES, MAX_CODE_CHARS, languageFromFilename } from './languages.js';

export async function readSourceFile(file) {
  const language = languageFromFilename(file.name);
  if (!language) {
    throw new Error(`"${file.name}" is not a supported source file. Allowed types: ${ACCEPTED_EXTENSIONS.join(', ')}`);
  }
  if (file.size === 0) {
    throw new Error(`"${file.name}" is empty.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`"${file.name}" is ${(file.size / 1024).toFixed(0)} KB. The maximum file size is ${MAX_FILE_BYTES / 1024} KB.`);
  }

  const code = await file.text();
  if (code.includes('\u0000')) {
    throw new Error(`"${file.name}" looks like a binary file, not source code.`);
  }
  if (code.length > MAX_CODE_CHARS) {
    throw new Error(`"${file.name}" has ${code.length.toLocaleString()} characters. The maximum is ${MAX_CODE_CHARS.toLocaleString()}.`);
  }
  return { code, language };
}

// Triggers a browser download for text content (reports, improved code).
export function downloadTextFile(content, filename, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
