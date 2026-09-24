import { useState } from 'react';
import Icon from './Icon.jsx';

export default function CopyButton({ text, label = 'Copy', className = 'btn btn-secondary btn-small' }) {
  const [state, setState] = useState('idle'); // idle | copied | failed

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 1800);
  }

  return (
    <button type="button" className={className} onClick={copy} disabled={!text}>
      <Icon name={state === 'copied' ? 'check' : 'copy'} size={16} />
      {state === 'copied' ? 'Copied!' : state === 'failed' ? 'Copy failed' : label}
    </button>
  );
}
