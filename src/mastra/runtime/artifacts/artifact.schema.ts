export type ArtifactType =
  | 'daily_digest'
  | 'wiki'
  | 'blog'
  | 'gap_analysis'
  | 'design_doc'
  | 'implementation_plan'
  | 'summary';

export type ArtifactOwnerType = 'goal' | 'task' | 'user' | 'project';
export type ArtifactStatus = 'draft' | 'reviewing' | 'approved' | 'published';

export type Artifact = {
  id: string;
  type: ArtifactType;
  ownerType: ArtifactOwnerType;
  ownerId: string;
  title: string;
  path: string;
  sourceEvidenceIds: string[];
  version: number;
  status: ArtifactStatus;
  createdAt: string;
  updatedAt: string;
};

export type CreateArtifactInput = {
  id?: string;
  type: ArtifactType;
  ownerType: ArtifactOwnerType;
  ownerId: string;
  title: string;
  content: string;
  sourceEvidenceIds?: string[];
  status?: ArtifactStatus;
};

export type UpdateArtifactInput = {
  artifactId: string;
  content: string;
  sourceEvidenceIds?: string[];
  status?: ArtifactStatus;
  title?: string;
};

export type WikiDiffInput = {
  title: string;
  currentContent?: string;
  proposedContent: string;
  sourceEvidenceIds?: string[];
};
