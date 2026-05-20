export type ProfileFacetKind = 'preference' | 'constraint' | 'interest' | 'workflow';
export type ProfileFacetStatus = 'proposed' | 'accepted' | 'rejected';

export type ProfileFacet = {
  id: string;
  kind: ProfileFacetKind;
  key: string;
  value: string;
  confidence: number;
  source: string;
  status: ProfileFacetStatus;
  createdAt: string;
  updatedAt: string;
};

export type CreateProfileFacetInput = {
  id?: string;
  kind?: ProfileFacetKind;
  key: string;
  value: string;
  confidence?: number;
  source: string;
  status?: ProfileFacetStatus;
};

export type FeedbackPreferenceProposalInput = {
  goalId: string;
  runId?: string;
  feedbackText: string;
  source?: string;
};
