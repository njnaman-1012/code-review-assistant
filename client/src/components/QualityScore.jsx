import { scoreColor } from '../utils/format.js';

// Circular score indicator drawn with a CSS conic-gradient.
export default function QualityScore({ score, grade, size = 96, label = 'Quality' }) {
  const value = score ?? 0;
  const color = scoreColor(score);
  return (
    <div
      className="score-ring"
      style={{ width: size, height: size, background: `conic-gradient(${color} ${value * 3.6}deg, var(--border) 0deg)` }}
      role="img"
      aria-label={`${label} score ${score ?? 'not available'} out of 100`}
    >
      <div className="score-inner">
        <strong style={{ color }}>{score ?? '–'}</strong>
        <span>{grade ? `Grade ${grade}` : label}</span>
      </div>
    </div>
  );
}
