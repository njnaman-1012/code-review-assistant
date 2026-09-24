// Monaco-based code editor (syntax highlighting, line numbers, indentation).
import Editor, { DiffEditor } from '@monaco-editor/react';
import { getLanguage } from '../utils/languages.js';
import { Spinner } from './Feedback.jsx';

const BASE_OPTIONS = {
  fontSize: 14,
  fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  lineNumbers: 'on',
  renderWhitespace: 'selection',
  padding: { top: 12, bottom: 12 },
  smoothScrolling: true,
};

function EditorLoading() {
  return <div className="editor-loading"><Spinner /> Loading editor…</div>;
}

export default function CodeEditor({ value, onChange, language, readOnly = false, height = 460 }) {
  const monacoLanguage = getLanguage(language)?.monaco ?? 'plaintext';
  return (
    <div className="editor-frame">
      <Editor
        height={height}
        language={monacoLanguage}
        value={value}
        onChange={(next) => onChange?.(next ?? '')}
        theme="vs-dark"
        loading={<EditorLoading />}
        options={{
          ...BASE_OPTIONS,
          readOnly,
          tabSize: language === 'javascript' ? 2 : 4,
          insertSpaces: true,
          detectIndentation: false,
          domReadOnly: readOnly,
        }}
      />
    </div>
  );
}

// Read-only viewer whose height follows the number of lines.
export function CodeViewer({ code, language, maxHeight = 640 }) {
  const lines = (code || '').split('\n').length;
  const height = Math.min(Math.max(lines * 20 + 30, 160), maxHeight);
  return <CodeEditor value={code} language={language} readOnly height={height} />;
}

// Side-by-side comparison of original and improved code.
export function DiffViewer({ original, modified, language, sideBySide = true, height = 560 }) {
  const monacoLanguage = getLanguage(language)?.monaco ?? 'plaintext';
  return (
    <div className="editor-frame">
      <DiffEditor
        height={height}
        language={monacoLanguage}
        original={original}
        modified={modified}
        theme="vs-dark"
        loading={<EditorLoading />}
        options={{ ...BASE_OPTIONS, readOnly: true, renderSideBySide: sideBySide, originalEditable: false }}
      />
    </div>
  );
}
