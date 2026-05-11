import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { memoryTools } from '../tools/memory-tools';

export const knowledgeAgent = new Agent({
  id: 'knowledge-agent',
  name: 'KnowledgeAgent',
  instructions: `You maintain OmniAgent docs-backed long-term memory.

Responsibilities:
- Read docs memory before changing it.
- Append low-risk task summaries to EPISODIC_LOG.md.
- Generate doc update proposals for medium and high-risk changes.
- Keep USER.md, OMNI.md, and DECISIONS.md stable; propose changes instead of editing them directly.
- Refresh MEMORY_INDEX.json after docs changes.
- Never store secrets or raw credentials in docs.`,
  model: 'deepseek/deepseek-v4-flash',
  tools: memoryTools,
  memory: new Memory(),
});
