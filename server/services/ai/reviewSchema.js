// The contract between the backend and the AI. The same Zod schema is
//  1. converted to JSON Schema and sent to the AI (structured output), and
//  2. used to validate whatever comes back before it reaches the frontend.
import { z } from 'zod';
import { ISSUE_TYPES, SEVERITIES, CONFIDENCE_LEVELS } from '../../utils/constants.js';

export const aiIssueSchema = z.object({
  title: z.string().describe('Short name of the problem'),
  type: z.enum(ISSUE_TYPES),
  severity: z.enum(SEVERITIES),
  line: z.number().int().nullable().describe('1-based line number, or null if not tied to one line'),
  code: z.string().describe('The problematic code copied from the submission'),
  explanation: z.string().describe('What is wrong'),
  impact: z.string().describe('Why it matters'),
  suggestion: z.string().describe('Recommended fix'),
  confidence: z.enum(CONFIDENCE_LEVELS),
});

export const aiReviewSchema = z.object({
  summary: z.string(),
  logicExplanation: z.string(),
  logicSteps: z.array(z.string()),
  keyComponents: z.array(z.object({
    name: z.string(),
    kind: z.string(),
    description: z.string(),
  })),
  issues: z.array(aiIssueSchema),
  qualityScore: z.number().int().nullable(),
  suggestions: z.array(z.object({
    title: z.string(),
    description: z.string(),
    priority: z.enum(['high', 'medium', 'low']),
  })),
  improvedCode: z.string(),
  improvementExplanation: z.array(z.object({
    change: z.string(),
    original: z.string(),
    improved: z.string(),
    reason: z.string(),
    benefit: z.string(),
  })),
  improvementSummary: z.object({
    performance: z.string(),
    readability: z.string(),
    complexity: z.string(),
    security: z.string(),
  }),
  complexity: z.object({
    originalTime: z.string(),
    originalSpace: z.string(),
    improvedTime: z.string(),
    improvedSpace: z.string(),
    explanation: z.string(),
  }),
  finalSummary: z.string(),
});

// ---- "Fix / Correct Code" and "Improve Code": separate AI operations that
// return the COMPLETE source file plus an explanation of every change.
export const codeChangeSchema = z.object({
  title: z.string().describe('What changed'),
  explanation: z.string().describe('Why it changed'),
  problemSolved: z.string().describe('Which problem the change solves'),
  lines: z.string().describe('Affected line numbers of the original code, e.g. "12-15", or ""'),
});

export const aiCorrectionSchema = z.object({
  action: z.enum(['correct']),
  language: z.string(),
  correctedCode: z.string().min(1).describe('The COMPLETE corrected source file, first line to last line'),
  changes: z.array(codeChangeSchema),
  summary: z.string(),
});

export const aiImprovementSchema = z.object({
  action: z.enum(['improve']),
  language: z.string(),
  improvedCode: z.string().min(1).describe('The COMPLETE improved source file, first line to last line'),
  changes: z.array(codeChangeSchema),
  summary: z.string(),
});
