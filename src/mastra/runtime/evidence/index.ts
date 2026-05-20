export { dedupEvidence } from './dedup';
export { evidencePath, listEvidence, saveEvidence, saveEvidenceBatch } from './evidence-store';
export { createEvidenceItem } from './evidence.schema';
export type { CreateEvidenceInput, EvidenceItem, EvidenceSourceType } from './evidence.schema';
export { rankEvidence, scoreEvidence } from './rank';
