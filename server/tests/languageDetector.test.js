import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, checkLanguageMatch } from '../services/languageDetector.js';

test('detects each supported language from typical code', () => {
  assert.equal(detectLanguage('def main():\n    print("hi")\n\nif __name__ == "__main__":\n    main()\n').language, 'python');
  assert.equal(detectLanguage('public class Main {\n  public static void main(String[] args) {\n    System.out.println("hi");\n  }\n}').language, 'java');
  assert.equal(detectLanguage('#include <iostream>\nusing namespace std;\nint main() { cout << "hi"; }').language, 'cpp');
  assert.equal(detectLanguage('const greet = (name) => {\n  console.log(`hi ${name}`);\n};').language, 'javascript');
});

test('returns null for text that is not recognisable code', () => {
  assert.equal(detectLanguage('hello world').language, null);
});

test('flags a clear mismatch between selected and detected language', () => {
  const java = 'import java.util.*;\npublic class A { public static void main(String[] args) { System.out.println(1); } }';
  assert.equal(checkLanguageMatch(java, 'python').mismatch, true);
  assert.equal(checkLanguageMatch(java, 'java').mismatch, false);
});
