import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { omniTeam } from '../lib/team-registry';

export const listTeamMembersTool = createTool({
  id: 'list-team-members',
  description: 'List OmniAgent team members and their responsibilities.',
  inputSchema: z.object({}),
  outputSchema: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      owns: z.array(z.string()),
      entryAgent: z.string(),
    }),
  ),
  execute: async () => omniTeam,
});

export const teamTools = {
  listTeamMembersTool,
};
