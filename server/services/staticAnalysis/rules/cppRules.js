// C++-specific checks performed on the syntax tree.
import { findAll, hasAncestor } from '../parser.js';
import { makeIssue, limit, countIdentifierUses } from './ruleUtils.js';

const LOOP_TYPES = ['for_statement', 'for_range_loop', 'while_statement', 'do_statement'];
const HEAVY_TYPES = /\b(vector|string|map|set|unordered_map|unordered_set|list|deque|queue|stack)\b/;

const UNSAFE_FUNCTIONS = {
  gets: { severity: 'CRITICAL', fix: 'Use std::getline(std::cin, text) or fgets(buffer, size, stdin).' },
  strcpy: { severity: 'HIGH', fix: 'Use std::string, or strncpy/strlcpy with the buffer size.' },
  strcat: { severity: 'HIGH', fix: 'Use std::string concatenation (+=).' },
  sprintf: { severity: 'HIGH', fix: 'Use snprintf with the buffer size, or std::ostringstream.' },
  vsprintf: { severity: 'HIGH', fix: 'Use vsnprintf with the buffer size.' },
};

function headerAndNamespaceRules(ctx) {
  const issues = [];
  for (const include of findAll(ctx.root, ['preproc_include'])) {
    if (include.childForFieldName('path')?.text.includes('bits/stdc++.h')) {
      issues.push(makeIssue(ctx, include, {
        ruleId: 'cpp-bits-stdcpp',
        title: 'Non-standard header <bits/stdc++.h>',
        type: 'Coding Standard Issue',
        severity: 'LOW',
        explanation: '<bits/stdc++.h> is a GCC-internal header that includes the entire standard library.',
        impact: 'It is not portable (fails on MSVC/Clang setups) and slows down compilation.',
        suggestion: 'Include only the headers you use, e.g. <iostream>, <vector>, <string>.',
      }));
    }
  }
  for (const using of findAll(ctx.root, ['using_declaration'])) {
    if (/namespace\s+std\b/.test(using.text) && using.parent?.type === 'translation_unit') {
      issues.push(makeIssue(ctx, using, {
        ruleId: 'cpp-using-namespace-std',
        title: '"using namespace std" at file scope',
        type: 'Coding Standard Issue',
        severity: 'LOW',
        explanation: 'This imports every name from the std namespace into the global namespace.',
        impact: 'Names such as count, max or distance can clash with your own identifiers.',
        suggestion: 'Use explicit std:: prefixes, or "using std::cout;" for specific names.',
      }));
    }
  }
  return issues;
}

function unsafeCallRules(ctx) {
  const issues = [];
  for (const call of findAll(ctx.root, ['call_expression'])) {
    const name = call.childForFieldName('function')?.text;
    if (UNSAFE_FUNCTIONS[name]) {
      issues.push(makeIssue(ctx, call, {
        ruleId: `cpp-unsafe-${name}`,
        title: `Unsafe function ${name}()`,
        type: 'Security Issue',
        severity: UNSAFE_FUNCTIONS[name].severity,
        explanation: `${name}() does not check the size of the destination buffer.`,
        impact: 'Long input overflows the buffer, corrupting memory - a classic security vulnerability.',
        suggestion: UNSAFE_FUNCTIONS[name].fix,
      }));
    }
    if (name === 'scanf' && /"[^"]*%s/.test(call.text)) {
      issues.push(makeIssue(ctx, call, {
        ruleId: 'cpp-scanf-string',
        title: 'scanf("%s") without a width limit',
        type: 'Security Issue',
        severity: 'MEDIUM',
        explanation: '%s reads a word of any length into a fixed-size buffer.',
        impact: 'Input longer than the buffer causes a buffer overflow.',
        suggestion: 'Use a width such as %19s, or read into std::string with std::cin.',
      }));
    }
    if (name === 'system' && /"pause"/.test(call.text)) {
      issues.push(makeIssue(ctx, call, {
        ruleId: 'cpp-system-pause',
        title: 'system("pause") is not portable',
        type: 'Coding Standard Issue',
        severity: 'LOW',
        explanation: 'system("pause") runs a Windows shell command.',
        impact: 'It fails on Linux/macOS and starts an extra process.',
        suggestion: 'Use std::cin.get() if you need to wait for a key press.',
      }));
    }
  }
  return limit(issues, 6);
}

function memoryRules(ctx) {
  const issues = [];
  const news = findAll(ctx.root, ['new_expression']);
  const deletes = findAll(ctx.root, ['delete_expression']);
  if (news.length > deletes.length) {
    issues.push(makeIssue(ctx, news[deletes.length] ?? news[0], {
      ruleId: 'cpp-new-without-delete',
      title: 'Memory allocated with new is not always deleted',
      type: 'Runtime Risk',
      severity: 'MEDIUM',
      explanation: `The code has ${news.length} "new" expression(s) but only ${deletes.length} "delete" expression(s).`,
      impact: 'Memory that is never released causes memory leaks.',
      suggestion: 'Prefer std::vector, std::unique_ptr or std::make_unique so memory is released automatically.',
      confidence: 'likely',
    }));
  }

  const calls = findAll(ctx.root, ['call_expression']).map((call) => call.childForFieldName('function')?.text);
  const allocations = calls.filter((name) => ['malloc', 'calloc', 'realloc'].includes(name)).length;
  const frees = calls.filter((name) => name === 'free').length;
  if (allocations > frees) {
    const first = findAll(ctx.root, ['call_expression']).find((call) => ['malloc', 'calloc'].includes(call.childForFieldName('function')?.text));
    issues.push(makeIssue(ctx, first ?? ctx.root, {
      ruleId: 'cpp-malloc-without-free',
      title: 'malloc/calloc without matching free',
      type: 'Runtime Risk',
      severity: 'MEDIUM',
      explanation: `${allocations} allocation(s) but only ${frees} call(s) to free().`,
      impact: 'Memory leaks.',
      suggestion: 'Free every allocation, or use C++ containers / smart pointers instead of malloc.',
      confidence: 'likely',
    }));
  }
  return issues;
}

function performanceRules(ctx) {
  const issues = [];
  for (const param of findAll(ctx.root, ['parameter_declaration'])) {
    const type = param.childForFieldName('type');
    const declarator = param.childForFieldName('declarator');
    if (type && declarator?.type === 'identifier' && HEAVY_TYPES.test(type.text)) {
      issues.push(makeIssue(ctx, param, {
        ruleId: 'cpp-pass-by-value',
        title: `Large object "${declarator.text}" passed by value`,
        type: 'Performance Issue',
        severity: 'MEDIUM',
        explanation: `"${param.text}" copies the whole ${type.text} every time the function is called.`,
        impact: 'Copying containers is O(n) in time and memory per call.',
        suggestion: `Pass by const reference: "const ${type.text}& ${declarator.text}" (or by reference if it must be modified).`,
      }));
    }
  }

  const endlInLoop = findAll(ctx.root, ['identifier', 'qualified_identifier'])
    .find((node) => (node.text === 'endl' || node.text === 'std::endl') && hasAncestor(node, LOOP_TYPES));
  if (endlInLoop) {
    issues.push(makeIssue(ctx, endlInLoop, {
      ruleId: 'cpp-endl-in-loop',
      title: 'std::endl used inside a loop',
      type: 'Performance Issue',
      severity: 'LOW',
      explanation: 'std::endl writes a newline and also flushes the output buffer every time.',
      impact: 'Flushing on every iteration makes output-heavy loops much slower.',
      suggestion: "Use '\\n' inside loops and flush once at the end if needed.",
    }));
  }

  const casts = findAll(ctx.root, ['cast_expression']);
  if (casts.length) {
    issues.push(makeIssue(ctx, casts[0], {
      ruleId: 'cpp-c-style-cast',
      title: `${casts.length} C-style cast(s)`,
      type: 'Coding Standard Issue',
      severity: 'LOW',
      explanation: 'C-style casts like (int)x can perform any kind of conversion silently.',
      impact: 'Dangerous conversions are hidden and hard to search for.',
      suggestion: 'Use static_cast<T>(x) (or const_cast/reinterpret_cast when really needed).',
    }));
  }
  return limit(issues, 6);
}

function unusedVariableRule(ctx) {
  const issues = [];
  for (const fn of findAll(ctx.root, ['function_definition'])) {
    const body = fn.childForFieldName('body');
    if (!body) continue;
    for (const declaration of findAll(body, ['declaration'])) {
      for (const declarator of declaration.childrenForFieldName('declarator')) {
        const nameNode = declarator.type === 'init_declarator' ? declarator.childForFieldName('declarator') : declarator;
        if (nameNode?.type !== 'identifier') continue;
        if (countIdentifierUses(body, nameNode.text, nameNode) === 0) {
          issues.push(makeIssue(ctx, declaration, {
            ruleId: 'cpp-unused-variable',
            title: `Unused variable "${nameNode.text}"`,
            type: 'Maintainability Issue',
            severity: 'LOW',
            explanation: `"${nameNode.text}" is declared but never used.`,
            impact: 'It adds noise and may indicate unfinished logic.',
            suggestion: `Remove "${nameNode.text}" or use it where intended.`,
          }));
        }
      }
    }
  }
  return limit(issues, 5);
}

export function runCppRules(ctx) {
  return [
    ...unsafeCallRules(ctx),
    ...memoryRules(ctx),
    ...performanceRules(ctx),
    ...unusedVariableRule(ctx),
    ...headerAndNamespaceRules(ctx),
  ];
}
