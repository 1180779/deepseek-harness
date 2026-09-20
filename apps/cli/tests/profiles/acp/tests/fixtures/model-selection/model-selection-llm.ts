/** Keyless two-model adapter for the superseded ACP model-surface conformance test. */

import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** Adapter whose reply names the routed model, so a client can assert the route rather than its own state. */
class ModelSelectionAdapter extends LlmAdapter {
  override providerInfo(provider: string) {
    if (provider !== 'model-selection-fixture') throw new Error(`unknown fixture provider: ${provider}`)
    return { id: provider, name: 'Model selection fixture' }
  }

  override listModels(provider: string) {
    if (provider !== 'model-selection-fixture') return Promise.resolve([])
    return Promise.resolve([
      { provider, id: 'alpha', name: 'Alpha', inputModalities: ['text'] as const },
      { provider, id: 'beta', name: 'Beta', description: 'Second fixture model.', inputModalities: ['text'] as const },
    ])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: ['text'],
      context: { contextWindow: 2_048 },
    })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const text = `model=${options.model}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 3 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'model-selection-llm'
export const inject = ['llm']

/** Register the deterministic model-selection provider. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['model-selection-fixture'], new ModelSelectionAdapter())
}
