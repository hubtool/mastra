import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { HarnessRequestContext } from '@mastra/core/harness';
import type { RequestContext } from '@mastra/core/request-context';
import type { HookManager } from '../hooks';
import type { McpManager } from '../mcp';
import type { stateSchema } from '../schema';
import { createWebSearchTool, createWebExtractTool, hasTavilyKey, requestSandboxAccessTool } from '../tools';

/** Minimal shape for tools passed to createDynamicTools. */
interface ToolLike {
  execute?: (input: unknown, context?: unknown) => Promise<unknown> | unknown;
  [key: string]: unknown;
}

function wrapToolWithHooks(toolName: string, tool: ToolLike, hookManager?: HookManager): ToolLike {
  if (!hookManager || typeof tool?.execute !== 'function') {
    return tool;
  }

  return {
    ...tool,
    async execute(input: unknown, toolContext: unknown) {
      const preResult = await hookManager.runPreToolUse(toolName, input);
      if (!preResult.allowed) {
        return {
          error: preResult.blockReason ?? `Blocked by PreToolUse hook for tool "${toolName}"`,
        };
      }

      let output: unknown;
      let toolError = false;
      try {
        output = await tool.execute(input, toolContext);
        return output;
      } catch (error) {
        toolError = true;
        output = {
          error: error instanceof Error ? error.message : String(error),
        };
        throw error;
      } finally {
        await hookManager.runPostToolUse(toolName, input, output, toolError).catch(() => undefined);
      }
    },
  };
}

/**
 * Extra tools callback signature. When `extraTools` is a function, it receives:
 * - `builtinTools`: The default tools built by mastracode (sandbox, web search, MCP)
 * - `requestContext`: The current request context for accessing harness state
 *
 * If the function returns an object, those tools are MERGED into the built-in set.
 * If the caller wants to REPLACE all tools, it should use `permissionRules.tools`
 * to deny unwanted built-ins and provide replacements via the returned object.
 */
export type ExtraToolsFn = (ctx: {
  builtinTools: Record<string, ToolLike>;
  requestContext: RequestContext;
}) => Record<string, ToolLike>;

export function createDynamicTools(
  mcpManager?: McpManager,
  extraTools?: Record<string, ToolLike> | ExtraToolsFn,
  hookManager?: HookManager,
  disabledTools?: string[],
) {
  return function getDynamicTools({ requestContext }: { requestContext: RequestContext }) {
    const ctx = requestContext.get('harness') as HarnessRequestContext<typeof stateSchema> | undefined;
    const state = ctx?.getState?.();

    const modelId = state?.currentModelId;
    const isAnthropicModel = modelId?.startsWith('anthropic/');
    const isOpenAIModel = modelId?.startsWith('openai/');

    // Filesystem, grep, glob, edit, write, execute_command, and process
    // management tools are now provided by the workspace (see workspace.ts).
    // Only tools without a workspace equivalent remain here.
    const tools: Record<string, ToolLike> = {
      request_access: requestSandboxAccessTool,
    };

    if (hasTavilyKey()) {
      tools.web_search = createWebSearchTool();
      tools.web_extract = createWebExtractTool();
    } else if (isAnthropicModel) {
      const anthropic = createAnthropic({});
      tools.web_search = anthropic.tools.webSearch_20250305();
    } else if (isOpenAIModel) {
      const openai = createOpenAI({});
      tools.web_search = openai.tools.webSearch();
    }

    if (mcpManager) {
      const mcpTools = mcpManager.getTools();
      Object.assign(tools, mcpTools);
    }

    if (extraTools) {
      if (typeof extraTools === 'function') {
        // Pass builtinTools so the caller can inspect/filter/replace them
        const resolved = extraTools({ builtinTools: { ...tools }, requestContext });
        for (const [name, tool] of Object.entries(resolved)) {
          tools[name] = tool;
        }
      } else {
        for (const [name, tool] of Object.entries(extraTools)) {
          if (!(name in tools)) {
            tools[name] = tool;
          }
        }
      }
    }

    // Remove tools explicitly disabled via config so the model never sees them.
    if (disabledTools?.length) {
      for (const toolName of disabledTools) {
        delete tools[toolName];
      }
    }

    // Remove tools that have a per-tool 'deny' policy so the model never sees them.
    const permissionRules = state?.permissionRules;
    if (permissionRules?.tools) {
      for (const [name, policy] of Object.entries(permissionRules.tools)) {
        if (policy === 'deny') {
          delete tools[name];
        }
      }
    }

    for (const [toolName, tool] of Object.entries(tools)) {
      tools[toolName] = wrapToolWithHooks(toolName, tool, hookManager);
    }

    return tools;
  };
}
