import type { ProofOfWork } from './goal-run.schema';

export function mergeProofOfWork(base: ProofOfWork, patch: Partial<ProofOfWork>): ProofOfWork {
  return {
    did: mergeUnique(base.did, patch.did),
    sourcesRead: mergeUnique(base.sourcesRead, patch.sourcesRead),
    artifactsCreated: mergeUnique(base.artifactsCreated, patch.artifactsCreated),
    memoryProposals: mergeUnique(base.memoryProposals, patch.memoryProposals),
    testsRun: mergeUnique(base.testsRun, patch.testsRun),
    risks: mergeUnique(base.risks, patch.risks),
    nextActions: mergeUnique(base.nextActions, patch.nextActions),
  };
}

function mergeUnique(left: string[], right: string[] = []): string[] {
  return [...new Set([...left, ...right])];
}
