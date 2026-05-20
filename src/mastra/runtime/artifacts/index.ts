export {
  artifactIndexPath,
  buildWikiDiff,
  createArtifact,
  exportArtifactMarkdown,
  ingestArtifactMarkdown,
  listArtifacts,
  updateArtifact,
} from './artifact-store';
export type {
  Artifact,
  ArtifactFrontmatter,
  ArtifactMarkdownIngestResult,
  ArtifactOwnerType,
  ArtifactStatus,
  ArtifactType,
  CreateArtifactInput,
  ExportArtifactMarkdownInput,
  IngestArtifactMarkdownInput,
  UpdateArtifactInput,
  WikiDiffInput,
} from './artifact.schema';
