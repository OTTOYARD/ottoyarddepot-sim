import { FunctionsHttpError } from '@supabase/supabase-js';

export interface CopilotSummary {
  total: number; enacted: number; overridden: number;
  by_context?: Record<string, number>;
  by_outcome?: Record<string, number>;
  top_override_rules?: Record<string, number>;
  by_proposal_source?: Record<string, number>;
}

export interface CopilotResult {
  analysis?: string; summary?: CopilotSummary; model?: string; error?: string;
}

export async function readCopilotFailure(error: Error): Promise<CopilotResult> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body: unknown = await error.context.json();
      if (body && typeof body === 'object') {
        const result = body as CopilotResult;
        return { error: typeof result.error === 'string' ? result.error : error.message,
          summary: result.summary };
      }
    } catch { /* Relay returned no JSON body; preserve the transport error. */ }
  }
  return { error: error.message };
}
