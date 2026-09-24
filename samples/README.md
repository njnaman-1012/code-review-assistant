# Sample programs for testing

These programs can be uploaded with **Upload Code** or loaded from the **Load sample** menu on the New Review page.

| File | Language | What it demonstrates |
|------|----------|----------------------|
| `1_correct_python.py` | Python | A clean, correct program. Expect few or no issues and a high quality score. |
| `2_python_logical_issues.py` | Python | Mutable default arguments, division by zero on an empty list, wrong initial maximum, grade boundary bug, bare `except`, shadowed built-in `list`, unused imports. |
| `3_JavaQualityIssues.java` | Java | Strings compared with `==`, off-by-one loop, string concatenation in a loop, empty catch block, public field, naming convention violations, integer division. |
| `4_cpp_inefficient.cpp` | C++ | O(n²) duplicate check, vectors passed by value, off-by-one loop, `new` without `delete`, `std::endl` in a loop, `<bits/stdc++.h>`. |
| `5_javascript_poor_practices.js` | JavaScript | `var`, loose equality `==`, `eval`, duplicate object key, undeclared variable, empty catch, hard-coded key, too many parameters, O(n²) duplicate search. |

Static analysis finds the rule-based problems. The AI review adds logic errors, such as the wrong initial maximum in `find_highest` or integer division in `averageNameLength`, plus the improved code and complexity analysis.
