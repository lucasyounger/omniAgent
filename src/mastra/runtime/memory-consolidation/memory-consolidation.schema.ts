export type MemoryConsolidationReportInput = {
  facts?: string[];
  preferences?: string[];
  lessons?: string[];
  obsoleteKnowledge?: string[];
  conflicts?: string[];
  suggestedWrites?: string[];
  generatedAt?: string;
};

export type MemoryConsolidationReport = {
  generatedAt: string;
  newFacts: string[];
  newPreferences: string[];
  reusableLessons: string[];
  obsoleteKnowledge: string[];
  conflicts: string[];
  suggestedWrites: string[];
  markdown: string;
};
