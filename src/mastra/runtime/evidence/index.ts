export { dedupEvidence } from './dedup';
export { evidencePath, listEvidence, referenceEvidenceArtifact, saveEvidence, saveEvidenceBatch } from './evidence-store';
export { createEvidenceItem } from './evidence.schema';
export type { CreateEvidenceInput, EvidenceArtifactRef, EvidenceItem, EvidenceSourceType } from './evidence.schema';
export { rankEvidence, scoreEvidence } from './rank';
