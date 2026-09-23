import { describe, expect, it } from 'vitest';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { readCopilotFailure } from '@/lib/copilotError';

describe('Copilot error response', () => {
  it('keeps measured decision counts when Nemotron fails after the query', async () => {
    const response = new Response(JSON.stringify({
      error: 'nemotron HTTP 502: upstream unavailable',
      summary: { total: 80, enacted: 12, overridden: 2 },
    }), { status: 502 });
    expect(await readCopilotFailure(new FunctionsHttpError(response))).toEqual({
      error: 'nemotron HTTP 502: upstream unavailable',
      summary: { total: 80, enacted: 12, overridden: 2 },
    });
  });

  it('preserves the transport error when the server has no JSON body', async () => {
    const result = await readCopilotFailure(new FunctionsHttpError(new Response('', { status: 502 })));
    expect(result).toEqual({ error: 'Edge Function returned a non-2xx status code' });
  });
});
