// Helpers that understand the shape of Tree-sitter trees for our languages.

// The operator of a binary/comparison node is an unnamed child such as "==".
export function operatorOf(node) {
  const operator = node.children.find((child) => !child.isNamed && child.type !== '(' && child.type !== ')');
  return operator ? operator.type : null;
}

export function functionName(node, language) {
  const nameField = node.childForFieldName('name');

  if (language === 'cpp') {
    let declarator = node.childForFieldName('declarator');
    while (declarator && declarator.type !== 'function_declarator') {
      declarator = declarator.childForFieldName('declarator');
    }
    return declarator?.childForFieldName('declarator')?.text || '(anonymous)';
  }

  if (nameField) return nameField.text;

  // JavaScript: `const add = (a, b) => ...` or `{ key: function () {} }`
  const parent = node.parent;
  if (parent?.type === 'variable_declarator') return parent.childForFieldName('name')?.text || '(anonymous)';
  if (parent?.type === 'pair') return parent.childForFieldName('key')?.text || '(anonymous)';
  if (parent?.type === 'assignment_expression') return parent.childForFieldName('left')?.text || '(anonymous)';
  return '(anonymous)';
}

export function functionBody(node) {
  return node.childForFieldName('body') || node;
}

export function parameterCount(node, language) {
  if (language === 'javascript' && node.childForFieldName('parameter')) return 1; // x => x
  let list = node.childForFieldName('parameters');
  if (language === 'cpp') {
    let declarator = node.childForFieldName('declarator');
    while (declarator && declarator.type !== 'function_declarator') {
      declarator = declarator.childForFieldName('declarator');
    }
    list = declarator?.childForFieldName('parameters');
  }
  if (!list) return 0;

  const params = list.namedChildren.filter((child) => !child.type.includes('comment'));
  // Python methods: `self` / `cls` is not a real parameter.
  if (language === 'python' && params[0]?.type === 'identifier' && ['self', 'cls'].includes(params[0].text)) {
    return params.length - 1;
  }
  return params.length;
}

// True for `else if` - it continues a chain rather than nesting deeper.
export function isElseIf(node) {
  if (node.type !== 'if_statement' || !node.parent) return false;
  const parent = node.parent;
  if (parent.type === 'else_clause') return true;
  if (parent.type === 'if_statement') {
    const alternative = parent.childForFieldName('alternative');
    return alternative?.id === node.id;
  }
  return false;
}

// Returns the source line (1-based) trimmed, for showing "problematic code".
export function lineText(lines, lineNumber) {
  return (lines[lineNumber - 1] ?? '').trim();
}
