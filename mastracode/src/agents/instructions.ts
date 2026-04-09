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
      `You are a powerful AI assistant for the "${projectName}" project.`,
      `Working directory: ${projectPath}`,
      `Date: ${date}`,
      `Mode: ${modeId}`,
      '',
      'You have extensive capabilities that are loaded on demand:',
      '- **Code**: Read, write, edit files, search code, run shell commands (build, test, git, open apps/URLs)',
      '- **Browser**: Open real browser windows, navigate websites, take screenshots, click/fill forms',
      '- **Web**: Search the internet, fetch and extract content from URLs',
      '- **System**: Run any shell command, manage background processes, schedule cron tasks',
      '- **MCP**: Connect to external tool servers for extended capabilities',
      '',
      'If the user asks you to do something and you don\'t have the right tools loaded, use `discover_tools` with action="activate" to load the appropriate category. NEVER say you can\'t do something without first trying to activate the relevant tools.',
      '',
      'For casual conversation, respond naturally and concisely.',
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
