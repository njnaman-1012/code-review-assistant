// Parses source code into a syntax tree using Tree-sitter (the same parser
// family used by GitHub and many editors). Tree-sitter runs here as
// WebAssembly, so no Python/Java/C++ compiler has to be installed and the
// submitted code is NEVER executed - it is only read.
import { createRequire } from 'node:module';
import { Parser, Language } from 'web-tree-sitter';

const require = createRequire(import.meta.url);

const GRAMMAR_FILES = {
  python: 'tree-sitter-wasms/out/tree-sitter-python.wasm',
  java: 'tree-sitter-wasms/out/tree-sitter-java.wasm',
  cpp: 'tree-sitter-wasms/out/tree-sitter-cpp.wasm',
  javascript: 'tree-sitter-wasms/out/tree-sitter-javascript.wasm',
};

let initPromise = null;
const parsers = new Map(); // language -> Parser (created once, reused)

async function getParser(language) {
  if (!GRAMMAR_FILES[language]) {
    throw new Error(`No grammar available for language "${language}"`);
  }
  if (!initPromise) initPromise = Parser.init();
  await initPromise;

  if (!parsers.has(language)) {
    const grammar = await Language.load(require.resolve(GRAMMAR_FILES[language]));
    const parser = new Parser();
    parser.setLanguage(grammar);
    parsers.set(language, parser);
  }
  return parsers.get(language);
}

// Returns a Tree-sitter tree. The caller must call tree.delete() when done,
// because the tree lives in WebAssembly memory.
export async function parseCode(code, language) {
  const parser = await getParser(language);
  return parser.parse(code);
}

// ---------- small tree helpers used by the rules ----------

// Depth-first walk. Return false from the visitor to skip a node's children.
export function walk(node, visitor) {
  if (visitor(node) === false) return;
  for (const child of node.children) walk(child, visitor);
}

export function findAll(root, types) {
  const wanted = new Set(Array.isArray(types) ? types : [types]);
  const found = [];
  walk(root, (node) => {
    if (wanted.has(node.type)) found.push(node);
  });
  return found;
}

export function lineOf(node) {
  return node.startPosition.row + 1;
}

// Tree-sitter creates a new JS object each time a node is accessed, so nodes
// are compared by their numeric id, never with ===.
export function hasAncestor(node, types, stopAt) {
  const wanted = new Set(types);
  let current = node.parent;
  while (current && current.id !== stopAt?.id) {
    if (wanted.has(current.type)) return true;
    current = current.parent;
  }
  return false;
}
