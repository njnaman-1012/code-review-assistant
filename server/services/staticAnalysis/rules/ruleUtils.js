// Helpers shared by all rule files.
import { lineOf } from '../parser.js';
import { lineText } from '../astUtils.js';

// Every static issue has the same shape as an AI issue, plus a ruleId.
export function makeIssue(ctx, node, fields) {
  const line = typeof node === 'number' ? node : lineOf(node);
  return {
    source: 'static',
    confidence: 'confirmed',
    line,
    code: lineText(ctx.lines, line),
    ...fields,
  };
}

// Stop one noisy rule from flooding the report.
export function limit(issues, max) {
  return issues.slice(0, max);
}

// Names read anywhere inside `scope`, except the declaration node itself.
export function countIdentifierUses(scope, name, declarationNode, identifierTypes = ['identifier']) {
  const types = new Set(identifierTypes);
  let uses = 0;
  const stack = [scope];
  while (stack.length) {
    const node = stack.pop();
    if (types.has(node.type) && node.text === name && node.id !== declarationNode?.id) uses += 1;
    for (let i = 0; i < node.childCount; i += 1) stack.push(node.child(i));
  }
  return uses;
}
