import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CodeEditor from '../components/CodeEditor.jsx';
import CopyButton from '../components/CopyButton.jsx';
import AnalysisProgress from '../components/AnalysisProgress.jsx';
import Icon from '../components/Icon.jsx';
import { ErrorAlert, Alert } from '../components/Feedback.jsx';
import { api, getErrorMessage } from '../services/api.js';
import { useSessionState } from '../hooks/useSessionState.js';
import { LANGUAGES, ACCEPTED_EXTENSIONS, MAX_CODE_CHARS, languageLabel, guessLanguage } from '../utils/languages.js';
import { readSourceFile } from '../utils/fileUtils.js';
import { SAMPLES } from '../utils/samples.js';
import { countLines } from '../utils/format.js';

export default function NewReviewPage() {
  const navigate = useNavigate();
  const fileInput = useRef(null);
  const [language, setLanguage] = useSessionState('cra.language', 'python');
  const [code, setCode] = useSessionState('cra.code', '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);

  const guessed = useMemo(() => guessLanguage(code), [code]);
  const tooLong = code.length > MAX_CODE_CHARS;
  const canAnalyze = code.trim().length > 0 && !tooLong && !loading;

  async function loadFile(file) {
    setError('');
    setNotice('');
    try {
      const result = await readSourceFile(file);
      setCode(result.code);
      setLanguage(result.language);
      setNotice(`Loaded "${file.name}". Language detected from the file extension: ${languageLabel(result.language)} (you can change it).`);
    } catch (fileError) {
      setError(fileError.message);
    }
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (file) loadFile(file);
    event.target.value = ''; // allow selecting the same file again
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) loadFile(file);
  }

  function loadSample(id) {
    const sample = SAMPLES.find((item) => item.id === id);
    if (!sample) return;
    setCode(sample.code);
    setLanguage(sample.language);
    setError('');
    setNotice(`Loaded sample: ${sample.title}.`);
  }

  function clearEditor() {
    setCode('');
    setError('');
    setNotice('');
  }

  async function analyze() {
    if (!code.trim()) {
      setError('Please enter or upload some code first.');
      return;
    }
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const review = await api.createReview({ language, code });
      navigate(`/reviews/${review.id}`, { state: { review } });
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setLoading(false);
    }
  }

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>New code review</h1>
          <p className="muted">Paste, type or upload your code, choose the language and click <strong>Analyze Code</strong>.</p>
        </div>
      </div>

      <section
        className={`card editor-card${dragging ? ' dragging' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <div className="editor-toolbar">
          <label className="field">
            <span>Programming language</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value)} disabled={loading}>
              {LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>

          <label className="field">
            <span>Load a sample</span>
            <select value="" onChange={(event) => loadSample(event.target.value)} disabled={loading}>
              <option value="" disabled>Choose a sample program…</option>
              {SAMPLES.map((sample) => <option key={sample.id} value={sample.id}>{sample.title}</option>)}
            </select>
          </label>

          <div className="toolbar-actions">
            <CopyButton text={code} />
            <button type="button" className="btn btn-secondary btn-small" onClick={clearEditor} disabled={!code || loading}>
              <Icon name="clear" size={16} /> Clear
            </button>
          </div>
        </div>

        {guessed && guessed !== language && (
          <Alert type="warning" icon="alert">
            This code looks like <strong>{languageLabel(guessed)}</strong>, but <strong>{languageLabel(language)}</strong> is selected.{' '}
            <button type="button" className="link-button" onClick={() => setLanguage(guessed)}>Switch to {languageLabel(guessed)}</button>
          </Alert>
        )}

        <CodeEditor value={code} onChange={setCode} language={language} readOnly={loading} height={480} />

        <div className="editor-footer">
          <span className={tooLong ? 'text-danger' : 'muted'}>
            {countLines(code)} lines · {code.length.toLocaleString()} / {MAX_CODE_CHARS.toLocaleString()} characters
          </span>
          <span className="muted small">You can also drag and drop a file onto the editor.</span>
        </div>

        {notice && <Alert type="info">{notice}</Alert>}
        <ErrorAlert message={error} />
        {tooLong && <ErrorAlert message={`The code is longer than ${MAX_CODE_CHARS.toLocaleString()} characters. Please submit a smaller program.`} />}

        {loading ? <AnalysisProgress /> : (
          <div className="action-row">
            <button type="button" className="btn btn-primary btn-large" onClick={analyze} disabled={!canAnalyze}>
              <Icon name="spark" /> Analyze Code
            </button>
            <button type="button" className="btn btn-secondary btn-large" onClick={() => fileInput.current?.click()}>
              <Icon name="upload" /> Upload Code
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED_EXTENSIONS.join(',')}
              onChange={handleFileChange}
              hidden
            />
            <span className="muted small">Accepted: {ACCEPTED_EXTENSIONS.join(' ')} · max 100 KB</span>
          </div>
        )}
        <p className="muted small">
          Your code is analysed, never executed. The AI review is processed by external AI services, so please do not
          submit passwords, keys or confidential code.
        </p>
      </section>
    </div>
  );
}
