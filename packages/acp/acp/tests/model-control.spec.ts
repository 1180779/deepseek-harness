import { describe, expect, it, vi } from 'vitest'
import { ReasoningEffortId, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import { AcpModelControl } from '../src/model-control.ts'

/** Minimal LLM catalog/runtime double for pure standard-option tests. */
function llmRuntime(overrides: Partial<LlmRuntime> = {}): LlmRuntime {
  return {
    listProviders: () => [{ id: 'mock', name: 'Mock' }],
    listModels: () => Promise.resolve([{ provider: 'mock', id: 'mock', name: 'Mock' }]),
    resolveCallConfig: (selection: { provider?: string; model?: string; reasoningEffort?: string }) => Promise.resolve({
      provider: selection.provider ?? 'mock',
      model: selection.model ?? 'mock',
      ...selection.reasoningEffort === undefined
        ? { reasoningEffort: ReasoningEffortId('high') }
        : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) },
    }),
    resolveModelInfo: (provider: string, model: string) => Promise.resolve({
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('low'), name: 'Low', description: 'Less thought.' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
        defaultEffort: ReasoningEffortId('high'),
      },
    }),
    ...overrides,
  } as unknown as LlmRuntime
}

describe('ACP model configuration control', () => {
  it('represents an absent route and validates value types before mutation', async () => {
    const control = new AcpModelControl(llmRuntime(), undefined, 'grouped')

    expect(control.snapshot()).toBeUndefined()
    await expect(control.sessionConfig()).resolves.toEqual({ configOptions: [], legacy: undefined })
    await expect(control.set('model', false)).rejects.toThrow(/requires a select value/)
    await expect(control.set('model', 'missing')).rejects.toThrow(/no model selection/)

    control.selection.current = { provider: 'mock', model: 'mock' }
    expect(control.selection.current).toEqual({ provider: 'mock', model: 'mock' })
  })

  it('synthesizes an unlisted current route and exposes reasoning descriptions', async () => {
    const control = new AcpModelControl(llmRuntime({ listProviders: () => [] }), {
      provider: 'private',
      model: 'unlisted',
    }, 'grouped')

    const { configOptions: options, legacy } = await control.sessionConfig()

    const model = options.find(option => option.id === 'model')
    const reasoning = options.find(option => option.id === 'reasoning_effort')
    expect(model).toMatchObject({
      type: 'select',
      currentValue: '["private","unlisted"]',
      options: [{ group: 'private', name: 'private', options: [{ name: 'unlisted' }] }],
    })
    expect(reasoning).toMatchObject({
      type: 'select',
      currentValue: 'high',
      options: [{ name: 'Low', description: 'Less thought.' }, { name: 'High' }],
    })
    // The legacy shape has no groups, so its one label names the provider.
    expect(legacy).toEqual({
      currentModelId: '["private","unlisted"]',
      availableModels: [{ modelId: '["private","unlisted"]', name: 'private: unlisted' }],
    })

    control.pinTurn(3, { provider: 'turn', model: 'pinned' })
    expect(control.selection.current).toEqual({ provider: 'turn', model: 'pinned' })
    control.releaseTurn(2)
    expect(control.selection.current).toEqual({ provider: 'turn', model: 'pinned' })
    control.releaseTurn(3)
    expect(control.selection.current).toEqual({ provider: 'private', model: 'unlisted' })
  })

  it('keeps the selected route when its provider catalog is temporarily unavailable', async () => {
    const listModels = vi.fn(() => Promise.reject(new Error('catalog unavailable')))
    const control = new AcpModelControl(llmRuntime({ listModels }), { provider: 'mock', model: 'mock' }, 'grouped')

    const { configOptions: options } = await control.sessionConfig()

    expect(listModels).toHaveBeenCalledWith('mock')
    expect(options[0]).toMatchObject({
      type: 'select',
      options: [{ group: 'mock', options: [{ name: 'mock' }] }],
    })
  })

  it('lists one provider-qualified value per model in the flat presentation', async () => {
    const control = new AcpModelControl(llmRuntime({
      listProviders: () => [{ id: 'mock', name: 'Mock' }, { id: 'other', name: 'Other' }],
      listModels: provider => Promise.resolve(provider === 'mock'
        ? [{ provider: 'mock', id: 'shared', name: 'Shared' }, { provider: 'mock', id: 'plain', name: 'Plain' }]
        : [{ provider: 'other', id: 'shared', name: 'Shared' }]),
    }), { provider: 'mock', model: 'shared' }, 'flat')

    const { configOptions: options, legacy } = await control.sessionConfig()

    expect(options[0]).toMatchObject({
      type: 'select',
      currentValue: '["mock","shared"]',
      options: [
        { value: '["mock","shared"]', name: 'Mock: Shared' },
        { value: '["mock","plain"]', name: 'Mock: Plain' },
        { value: '["other","shared"]', name: 'Other: Shared' },
      ],
    })
    expect(legacy).toEqual({
      currentModelId: '["mock","shared"]',
      availableModels: [
        { modelId: '["mock","shared"]', name: 'Mock: Shared' },
        { modelId: '["mock","plain"]', name: 'Mock: Plain' },
        { modelId: '["other","shared"]', name: 'Other: Shared' },
      ],
    })
  })

  it('rejects an unadvertised reasoning effort and accepts a later valid change', async () => {
    const control = new AcpModelControl(llmRuntime(), { provider: 'mock', model: 'mock' }, 'grouped')

    await expect(control.set('reasoning_effort', 'extreme')).rejects.toThrow(/unknown reasoning effort/)
    const options = await control.set('reasoning_effort', 'low')

    expect(options.find(option => option.id === 'reasoning_effort')).toMatchObject({ currentValue: 'low' })
  })

  it('exposes and restores a provider-owned reasoning default', async () => {
    const runtime = llmRuntime({
      resolveCallConfig: (selection: { provider?: string; model?: string; reasoningEffort?: string }) => Promise.resolve({
        provider: selection.provider ?? 'mock',
        model: selection.model ?? 'mock',
        ...selection.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) },
      }),
      resolveModelInfo: (provider: string, model: string) => Promise.resolve({
        provider,
        id: model,
        name: model,
        reasoning: {
          efforts: [
            { id: ReasoningEffortId('low'), name: 'Low' },
            { id: ReasoningEffortId('high'), name: 'High' },
          ],
        },
      }),
    })
    const control = new AcpModelControl(runtime, { provider: 'mock', model: 'mock' }, 'grouped')

    const initial = (await control.sessionConfig()).configOptions
    expect(initial.find(option => option.id === 'reasoning_effort')).toMatchObject({
      currentValue: '',
      options: [{ value: '', name: 'Provider default' }, { value: 'low' }, { value: 'high' }],
    })
    await control.set('reasoning_effort', 'low')
    const restored = await control.set('reasoning_effort', '')

    expect(restored.find(option => option.id === 'reasoning_effort')).toMatchObject({ currentValue: '' })
    expect(control.selection.current).toEqual({ provider: 'mock', model: 'mock' })
  })
})
