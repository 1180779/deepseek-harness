/** ACP session configuration over one Agent's model selection. */

import type { Context } from '@deepseek-ai/cordis'
import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
  SessionConfigSelectOptions,
  SessionConfigValueId,
} from '@agentclientprotocol/sdk'
import { installModelSelection, type ModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId, type LlmCallConfig, type LlmRuntime } from '@deepseek-ai/dsh-llm'

/** Standard ACP option id carrying the provider/model selection. */
export const MODEL_CONFIG_ID = 'model'
const REASONING_CONFIG_ID = 'reasoning_effort'
// DSH reasoning effort ids are non-empty, so the empty opaque ACP value is a disjoint provider-default choice.
const PROVIDER_DEFAULT_REASONING_VALUE = ''

/**
 * How the `model` select lists its values. `grouped` is the standard
 * presentation; `flat` trades the provider grouping for a single list whose
 * labels carry the provider name, because a client that reads only the flat
 * variant of `SessionConfigSelectOptions` renders no control for groups.
 */
export type ModelOptionPresentation = 'grouped' | 'flat'

/** One value of the superseded `models` session state. */
export interface LegacyModelInfo {
  modelId: SessionConfigValueId
  name: string
  description?: string | null
}

/**
 * The pre-config-option ACP `models` session state, returned only when
 * `legacyModelSelection` is enabled. Its labels always carry the provider name,
 * because the shape has no groups to disambiguate equal model names.
 */
export interface LegacyModelState {
  currentModelId: SessionConfigValueId
  availableModels: LegacyModelInfo[]
}

/** One session configuration publication: standard options and the legacy model list from one catalog pass. */
export interface AcpSessionConfig {
  configOptions: SessionConfigOption[]
  legacy: LegacyModelState | undefined
}

interface ConfigState {
  choices: Map<SessionConfigValueId, ModelSelection>
  options: SessionConfigOption[]
  legacy: LegacyModelState | undefined
}

/** One provider's detached catalog entries, before the presentation folds them. */
interface ProviderCatalog {
  id: string
  name: string
  options: SessionConfigSelectOption[]
}

/** Caller-correctable session configuration failure. */
export class AcpModelConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AcpModelConfigError'
  }
}

/** Project and mutate one Agent's provider/model/reasoning selection through ACP config options. */
export class AcpModelControl {
  /** Scoped selection reference consumed by Agent request assembly. */
  readonly selection: ModelSelectionRef
  private tail = Promise.resolve()
  private selected: ModelSelection | undefined
  private turnSelection: { turn: number; selection: ModelSelection } | undefined
  private hasResolvedState = false

  constructor(
    private readonly llm: LlmRuntime,
    initial: ModelSelection | undefined,
    private readonly presentation: ModelOptionPresentation,
  ) {
    this.selected = initial
    const getCurrent = (): ModelSelection | undefined => this.turnSelection?.selection ?? this.selected
    const setCurrent = (value: ModelSelection | undefined): void => { this.selected = value }
    this.selection = {
      get current() { return getCurrent() },
      set current(value) { setCurrent(value) },
      assembled: undefined,
    }
  }

  /**
   * Install request/prompt consistency listeners in the unpublished Agent scope.
   * @param agentCtx - Agent scope that consumes this selection.
   */
  install(agentCtx: Context): void {
    installModelSelection(agentCtx, this.selection)
  }

  /**
   * Snapshot the selection attached to the next accepted ACP prompt.
   * @returns a detached future selection, or undefined when listeners supply the route.
   */
  snapshot(): ModelSelection | undefined {
    return this.selected === undefined ? undefined : { ...this.selected }
  }

  /**
   * Pin one admitted ACP message's selection for every step in its turn.
   * @param turn - admitted Agent turn.
   * @param selection - exact prompt-admission selection.
   */
  pinTurn(turn: number, selection: ModelSelection): void {
    this.turnSelection = { turn, selection: { ...selection } }
  }

  /**
   * Release only the exact completed turn's routing override.
   * @param turn - completed Agent turn.
   */
  releaseTurn(turn: number): void {
    if (this.turnSelection?.turn === turn) this.turnSelection = undefined
  }

  /**
   * Return the complete session configuration state after prior mutations settle.
   * @param signal - optional catalog and exact-model cancellation.
   * @returns the standard configuration options and the legacy model state.
   */
  sessionConfig(signal?: AbortSignal): Promise<AcpSessionConfig> {
    return this.serialize(async () => {
      const state = await this.state(signal)
      return { configOptions: state.options, legacy: state.legacy }
    })
  }

  /**
   * Set one advertised option and return the complete resulting option state.
   * @param configId - standard option id.
   * @param value - opaque selected value returned by a previous option state.
   * @param signal - optional catalog and exact-model cancellation.
   * @returns all standard options after the serialized mutation.
   */
  set(configId: string, value: unknown, signal?: AbortSignal): Promise<SessionConfigOption[]> {
    return this.serialize(async () => {
      if (typeof value !== 'string') throw new AcpModelConfigError(`${configId} requires a select value`)
      const current = this.selected
      if (current === undefined) throw new AcpModelConfigError('this session has no model selection')
      if (configId === MODEL_CONFIG_ID) {
        const state = await this.state(signal)
        const selected = state.choices.get(value)
        if (selected === undefined) throw new AcpModelConfigError(`unknown model option: ${value}`)
        await this.resolveSelection(selected, signal)
        this.selected = selected
      } else if (configId === REASONING_CONFIG_ID) {
        const info = await this.llm.resolveModelInfo(current.provider, current.model, signal)
        const providerDefault = value === PROVIDER_DEFAULT_REASONING_VALUE
          && info.reasoning?.defaultEffort === undefined
        if (
          info.reasoning === undefined
          || (!providerDefault && !info.reasoning.efforts.some(effort => effort.id === value))
        ) {
          throw new AcpModelConfigError(`unknown reasoning effort for ${current.provider}/${current.model}: ${value}`)
        }
        this.selected = await this.resolveSelection({
          provider: current.provider,
          model: current.model,
          ...providerDefault ? {} : { reasoningEffort: ReasoningEffortId(value) },
        }, signal)
      } else {
        throw new AcpModelConfigError(`unknown session config option: ${configId}`)
      }
      return (await this.state(signal)).options
    })
  }

  /** Keep concurrent client mutations in receive order without wedging after rejection. */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }

  /** Build detached model choices, the dependent reasoning option, and the legacy model state. */
  private async state(signal?: AbortSignal): Promise<ConfigState> {
    const selected = this.selected
    if (selected === undefined) return { choices: new Map(), options: [], legacy: undefined }
    let resolved: ModelSelection
    let routeAvailable = true
    try {
      resolved = await this.resolveSelection(selected, signal)
      this.hasResolvedState = true
    } catch (error: unknown) {
      if (!this.hasResolvedState) throw error
      resolved = selected
      routeAvailable = false
    }
    const choices = new Map<SessionConfigValueId, ModelSelection>()
    const catalog = await Promise.all(this.llm.listProviders().map(async (provider): Promise<ProviderCatalog> => {
      try {
        const models = await this.llm.listModels(provider.id)
        const options = models.map((model) => {
          const value = modelValue(provider.id, model.id)
          choices.set(value, { provider: provider.id, model: model.id })
          return {
            value,
            name: model.name,
            ...model.description === undefined ? {} : { description: model.description },
          }
        })
        return { id: provider.id, name: provider.name, options }
      } catch (_providerCatalogUnavailable) {
        return { id: provider.id, name: provider.name, options: [] }
      }
    }))
    const currentValue = modelValue(resolved.provider, resolved.model)
    if (!choices.has(currentValue)) {
      choices.set(currentValue, { provider: resolved.provider, model: resolved.model })
      let provider = catalog.find(item => item.id === resolved.provider)
      if (provider === undefined) {
        provider = { id: resolved.provider, name: resolved.provider, options: [] }
        catalog.push(provider)
      }
      provider.options.unshift({ value: currentValue, name: resolved.model })
    }
    const served = catalog.flatMap(provider => provider.options.map(option => ({ provider, option })))
    const options: SessionConfigOption[] = [{
      id: MODEL_CONFIG_ID,
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue,
      options: this.modelOptions(catalog, served),
    }]
    const info = routeAvailable
      ? await this.llm.resolveModelInfo(resolved.provider, resolved.model, signal)
      : undefined
    if (info?.reasoning !== undefined) {
      options.push({
        id: REASONING_CONFIG_ID,
        name: 'Reasoning effort',
        category: 'thought_level',
        type: 'select',
        currentValue: resolved.reasoningEffort === undefined
          ? PROVIDER_DEFAULT_REASONING_VALUE
          : String(resolved.reasoningEffort),
        options: [
          ...info.reasoning.defaultEffort === undefined
            ? [{ value: PROVIDER_DEFAULT_REASONING_VALUE, name: 'Provider default' }]
            : [],
          ...info.reasoning.efforts.map(effort => ({
            value: String(effort.id),
            name: effort.name,
            ...effort.description === undefined ? {} : { description: effort.description },
          })),
        ],
      })
    }
    return {
      choices,
      options,
      // Synthesis above guarantees the served catalog holds the current route.
      legacy: {
        currentModelId: currentValue,
        availableModels: served.map(({ provider, option }) => ({
          modelId: option.value,
          name: qualify(provider.name, option.name),
          ...option.description === undefined ? {} : { description: option.description },
        })),
      },
    }
  }

  /**
   * Fold the served catalog into the configured presentation.
   * @param catalog - per-provider entries in catalog order.
   * @param served - the same entries flattened in that order.
   * @returns grouped options, or one flat list whose labels name their provider.
   */
  private modelOptions(
    catalog: readonly ProviderCatalog[],
    served: readonly { provider: ProviderCatalog; option: SessionConfigSelectOption }[],
  ): SessionConfigSelectOptions {
    if (this.presentation === 'flat') {
      return served.map(({ provider, option }) => ({ ...option, name: qualify(provider.name, option.name) }))
    }
    return catalog
      .filter(provider => provider.options.length > 0)
      .map((provider): SessionConfigSelectGroup => ({
        group: provider.id,
        name: provider.name,
        options: provider.options,
      }))
  }

  /** Validate an exact route and retain only Agent-owned selection fields. */
  private async resolveSelection(selection: ModelSelection, signal?: AbortSignal): Promise<ModelSelection> {
    const resolved: LlmCallConfig = await this.llm.resolveCallConfig(selection, signal)
    return {
      provider: resolved.provider,
      model: resolved.model,
      ...resolved.reasoningEffort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort },
    }
  }
}

/** Opaque ACP selector value carrying the full route identity. */
function modelValue(provider: string, model: string): SessionConfigValueId {
  return JSON.stringify([provider, model])
}

/** Name one ungrouped model value after its provider so equal model names stay distinct. */
function qualify(provider: string, model: string): string {
  return `${provider}: ${model}`
}
