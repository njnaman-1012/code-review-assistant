// Tree-sitter node types for each language. Rules and metrics are written
// once and look up the language-specific node names here, which is what
// makes adding a new language mostly a matter of configuration.

export const LANGUAGE_NODES = {
  python: {
    functions: ['function_definition'],
    classes: ['class_definition'],
    comments: ['comment'],
    blocks: ['block'],
    loops: ['for_statement', 'while_statement'],
    // Decision points for cyclomatic complexity (each adds one path).
    decisions: [
      'if_statement', 'elif_clause', 'for_statement', 'while_statement', 'except_clause',
      'conditional_expression', 'boolean_operator', 'for_in_clause', 'if_clause', 'case_clause',
    ],
    // Statements that increase nesting depth.
    nesting: ['if_statement', 'for_statement', 'while_statement', 'try_statement', 'with_statement', 'match_statement'],
    exits: ['return_statement', 'raise_statement', 'break_statement', 'continue_statement'],
  },
  java: {
    functions: ['method_declaration', 'constructor_declaration'],
    classes: ['class_declaration', 'interface_declaration', 'enum_declaration'],
    comments: ['line_comment', 'block_comment'],
    blocks: ['block', 'constructor_body'],
    loops: ['for_statement', 'enhanced_for_statement', 'while_statement', 'do_statement'],
    decisions: [
      'if_statement', 'for_statement', 'enhanced_for_statement', 'while_statement', 'do_statement',
      'catch_clause', 'ternary_expression', 'switch_label',
    ],
    nesting: [
      'if_statement', 'for_statement', 'enhanced_for_statement', 'while_statement', 'do_statement',
      'try_statement', 'switch_expression', 'switch_statement',
    ],
    exits: ['return_statement', 'throw_statement', 'break_statement', 'continue_statement'],
  },
  cpp: {
    functions: ['function_definition'],
    classes: ['class_specifier', 'struct_specifier'],
    comments: ['comment'],
    blocks: ['compound_statement'],
    loops: ['for_statement', 'for_range_loop', 'while_statement', 'do_statement'],
    decisions: [
      'if_statement', 'for_statement', 'for_range_loop', 'while_statement', 'do_statement',
      'catch_clause', 'conditional_expression', 'case_statement',
    ],
    nesting: [
      'if_statement', 'for_statement', 'for_range_loop', 'while_statement', 'do_statement',
      'try_statement', 'switch_statement',
    ],
    exits: ['return_statement', 'throw_statement', 'break_statement', 'continue_statement'],
  },
  javascript: {
    functions: [
      'function_declaration', 'function_expression', 'arrow_function', 'method_definition',
      'generator_function_declaration', 'generator_function',
    ],
    classes: ['class_declaration', 'class'],
    comments: ['comment'],
    blocks: ['statement_block'],
    loops: ['for_statement', 'for_in_statement', 'while_statement', 'do_statement'],
    decisions: [
      'if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement',
      'catch_clause', 'ternary_expression', 'switch_case',
    ],
    nesting: [
      'if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement',
      'try_statement', 'switch_statement',
    ],
    exits: ['return_statement', 'throw_statement', 'break_statement', 'continue_statement'],
  },
};

// Logical operators that add a decision point in C-like languages.
export const LOGICAL_OPERATORS = new Set(['&&', '||', '??', 'and', 'or']);
