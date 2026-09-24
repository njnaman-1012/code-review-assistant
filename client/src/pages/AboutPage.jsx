import { Link } from 'react-router-dom';

const STEPS = [
  ['Submit your code', 'Paste, type or upload a Python, Java, C++ or JavaScript program and choose its language.'],
  ['Automated checks', 'Your code is checked for syntax errors, risky patterns, code smells and complexity. These checks are exact and repeatable.'],
  ['AI review', 'An AI reviewer explains what the code does, points out deeper logical problems and writes an improved version.'],
  ['Verification', 'AI findings are checked against your actual code, and the improved version is run through the automated checks again.'],
  ['Your report', 'Everything is combined into one review that you can revisit in History or download as a report.'],
];

export default function AboutPage() {
  return (
    <div className="container page narrow">
      <h1>About CodeReview AI</h1>
      <p className="lead">
        CodeReview AI reviews your source code like an experienced developer would: it finds problems, explains
        <strong> why</strong> they matter, suggests fixes, and shows you an improved version of your program with
        every change explained.
      </p>

      <section className="card">
        <h2>How a review works</h2>
        <ol className="workflow">
          {STEPS.map(([title, text]) => (
            <li key={title}><strong>{title}</strong><span>{text}</span></li>
          ))}
        </ol>
      </section>

      <section className="card">
        <h2>Automated checks vs AI review</h2>
        <div className="two-col">
          <div>
            <h3>Automated checks</h3>
            <ul className="plain-list">
              <li>Precise rules for common mistakes and bad practices.</li>
              <li>The same code always gives the same result.</li>
              <li>Labelled <em>Static analysis</em> in your results.</li>
            </ul>
          </div>
          <div>
            <h3>AI review</h3>
            <ul className="plain-list">
              <li>Explains the program logic and finds deeper problems.</li>
              <li>Writes improved code and explains every change.</li>
              <li>Labelled <em>AI analysis</em>, with a confidence level - AI can be wrong.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Good to know</h2>
        <ul className="plain-list">
          <li>Your code is analysed but never executed.</li>
          <li>Reviews are suggestions. Always read the explanations and test the improved code before using it.</li>
          <li>Each review can contain up to 20,000 characters (about 800 lines).</li>
          <li>
            <strong>Privacy:</strong> to produce the AI review, your code is processed by external AI services.
            Please do not submit passwords, keys or confidential code.
          </li>
        </ul>
      </section>

      <div className="button-row">
        <Link to="/review/new" className="btn btn-primary">Start a review</Link>
      </div>
    </div>
  );
}
