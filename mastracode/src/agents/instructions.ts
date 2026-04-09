import type { HarnessRequestContext } from '@mastra/core/harness';
import type { stateSchema } from '../schema.js';
import { getCurrentGitBranch } from '../utils/project.js';
import type { PromptContext } from './prompts/index.js';
import { buildFullPrompt } from './prompts/index.js';

export function getDynamicInstructions({ requestContext }: { requestContext: { get(key: string): unknown } }) {
  const harnessContext = requestContext.get('harness') as HarnessRequestContext<typeof stateSchema> | undefined;
  const state = harnessContext?.state;
  const modeId = harnessContext?.modeId ?? 'build';
  const projectPath = state?.projectPath ?? process.cwd();

  // Light instructions mode: return a minimal system prompt to save tokens.
  // Callers set state.instructionsMode = "light" before sendMessage to opt in.
  // This skips tool guidance, agent instructions (CLAUDE.md/AGENTS.md), and
  // mode-specific prompts, reducing the system prompt from ~5-8k to ~200 tokens.
  if (state?.instructionsMode === 'light') {
    const projectName = state?.projectName || 'unknown';
    const date = new Date().toISOString().split('T')[0]!;
    return [
      `You are a helpful AI coding assistant for the "${projectName}" project.`,
      `Working directory: ${projectPath}`,
      `Date: ${date}`,
      `Mode: ${modeId}`,
      '',
      'Be concise and helpful. When the user asks for code changes, use the available tools.',
      'For casual conversation, respond naturally without using tools.',
    ].join('\n');
  }

  const promptCtx: PromptContext = {
    projectPath,
    projectName: state?.projectName ?? '',
    gitBranch: getCurrentGitBranch(projectPath) ?? state?.gitBranch,
    platform: process.platform,
    date: new Date().toISOString().split('T')[0]!,
    mode: modeId,
    modelId: state?.currentModelId || undefined,
    activePlan: state?.activePlan ?? null,
    modeId: modeId,
    currentDate: new Date().toISOString().split('T')[0]!,
    workingDir: state?.projectPath ?? process.cwd(),
    state: state,
  };

  return buildFullPrompt(promptCtx);
}
