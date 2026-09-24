// The sample programs from the /samples folder, bundled as plain text.
import correctPython from '../../../samples/1_correct_python.py?raw';
import pythonIssues from '../../../samples/2_python_logical_issues.py?raw';
import javaIssues from '../../../samples/3_JavaQualityIssues.java?raw';
import cppInefficient from '../../../samples/4_cpp_inefficient.cpp?raw';
import jsPoorPractices from '../../../samples/5_javascript_poor_practices.js?raw';

export const SAMPLES = [
  { id: 'python-correct', title: 'Correct Python program', language: 'python', code: correctPython },
  { id: 'python-logic', title: 'Python with logical issues', language: 'python', code: pythonIssues },
  { id: 'java-quality', title: 'Java with code-quality issues', language: 'java', code: javaIssues },
  { id: 'cpp-inefficient', title: 'C++ with inefficient logic', language: 'cpp', code: cppInefficient },
  { id: 'js-poor', title: 'JavaScript with poor practices', language: 'javascript', code: jsPoorPractices },
];
