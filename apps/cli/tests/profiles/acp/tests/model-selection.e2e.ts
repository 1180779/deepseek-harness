/** Keyless ACP end-to-end over the shipped profile with the superseded model surface enabled. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import {
  launchAcpTestAgent,
  type AgentUnderTest,
  type LaunchedAcpTestAgent,
} from '@deepseek-ai/dsh-session-snapshot'
import { describe, expect, it } from 'vitest'

/**
 * A deployment that opts into `modelOptions: flat` and `legacyModelSelection`
 * must reach a real client through the shipped profile: one flat model list, the
 * superseded `models` state, and a `session/set_model` change that the next turn
 * actually routes through. The model-facing reply names the routed model, so the
 * assertion reads the route rather than the client's own bookkeeping.
 */

const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))
const agent: AgentUnderTest = {
  binScript: join(repoRoot, 'apps/cli/src/bin.ts'),
  libBinScript: join(repoRoot, 'apps/cli/lib/bin.js'),
  configPath: fileURLToPath(new URL('./fixtures/model-selection/cordis.yml', import.meta.url)),
  profile: 'acp',
  tsconfigPath: join(repoRoot, 'tsconfig.json'),
}

describe('superseded ACP model surface', () => {
  it('serves one flat model list and routes a legacy model change', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-acp-model-selection-'))
    let launched: LaunchedAcpTestAgent | undefined
    try {
      launched = launchAcpTestAgent({
        agent,
        cwd,
        env: { DSH_MODEL_SELECTION_ROOT: join(cwd, '.sessions'), DSH_TELEMETRY_DISABLED: '1' },
      })
      await launched.spawned
      await launched.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })

      const created = await launched.client.newSession({ cwd, mcpServers: [] })
      expect(created.configOptions?.find(option => option.id === 'model')).toMatchObject({
        type: 'select',
        currentValue: '["model-selection-fixture","alpha"]',
        options: [
          { value: '["model-selection-fixture","alpha"]', name: 'Model selection fixture: Alpha' },
          {
            value: '["model-selection-fixture","beta"]',
            name: 'Model selection fixture: Beta',
            description: 'Second fixture model.',
          },
        ],
      })
      expect((created as unknown as { models?: unknown }).models).toEqual({
        currentModelId: '["model-selection-fixture","alpha"]',
        availableModels: [
          { modelId: '["model-selection-fixture","alpha"]', name: 'Model selection fixture: Alpha' },
          {
            modelId: '["model-selection-fixture","beta"]',
            name: 'Model selection fixture: Beta',
            description: 'Second fixture model.',
          },
        ],
      })

      await expect(launched.client.setSessionModel({
        sessionId: created.sessionId,
        modelId: '["model-selection-fixture","beta"]',
      })).resolves.toEqual({})
      await expect(launched.client.prompt({
        sessionId: created.sessionId,
        prompt: [{ type: 'text', text: 'report the route' }],
      })).resolves.toEqual({ stopReason: 'end_turn' })

      expect(launched.updates).toContainEqual(expect.objectContaining({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'model=beta' },
      }))

      // The standard option keeps working beside the superseded one.
      const selected = await launched.client.setSessionConfigOption({
        sessionId: created.sessionId,
        configId: 'model',
        value: '["model-selection-fixture","alpha"]',
      })
      expect(selected.configOptions.find(option => option.id === 'model'))
        .toMatchObject({ currentValue: '["model-selection-fixture","alpha"]' })
    } finally {
      await launched?.close()
      await rm(cwd, { recursive: true, force: true })
    }
  }, 30_000)
})
