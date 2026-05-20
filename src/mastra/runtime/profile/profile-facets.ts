import fs from 'node:fs/promises';
import path from 'node:path';
import { omniRoot } from '../../lib/paths';
import type { CreateProfileFacetInput, FeedbackPreferenceProposalInput, ProfileFacet } from './profile-facet.schema';

export async function proposeProfileFacet(input: CreateProfileFacetInput): Promise<ProfileFacet> {
  const existing = await listProfileFacets();
  const now = new Date().toISOString();
  const facet: ProfileFacet = {
    id: input.id ?? createFacetId(input.key, input.value),
    kind: input.kind ?? 'preference',
    key: input.key,
    value: input.value,
    confidence: input.confidence ?? 0.6,
    source: input.source,
    status: input.status ?? 'proposed',
    createdAt: now,
    updatedAt: now,
  };
  const next = upsertFacet(existing, facet);
  await writeProfileFacets(next);
  return next.find(item => item.id === facet.id)!;
}

export async function proposePreferenceFromFeedback(input: FeedbackPreferenceProposalInput): Promise<ProfileFacet | undefined> {
  const proposal = parsePreference(input.feedbackText);
  if (!proposal) return undefined;
  return proposeProfileFacet({
    ...proposal,
    source: input.source ?? `goal-feedback:${input.goalId}${input.runId ? `:${input.runId}` : ''}`,
    status: 'proposed',
  });
}

export async function listProfileFacets(status?: ProfileFacet['status']): Promise<ProfileFacet[]> {
  try {
    const facets = JSON.parse(await fs.readFile(profileFacetsPath(), 'utf8')) as ProfileFacet[];
    return status ? facets.filter(facet => facet.status === status) : facets;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function acceptProfileFacet(facetId: string): Promise<ProfileFacet> {
  return updateFacetStatus(facetId, 'accepted');
}

export async function rejectProfileFacet(facetId: string): Promise<ProfileFacet> {
  return updateFacetStatus(facetId, 'rejected');
}

export function profileFacetsPath(): string {
  return path.join(omniRoot, 'profile-facets.json');
}

async function updateFacetStatus(facetId: string, status: ProfileFacet['status']): Promise<ProfileFacet> {
  const facets = await listProfileFacets();
  const facet = facets.find(item => item.id === facetId);
  if (!facet) throw new Error(`Profile facet not found: ${facetId}`);
  const updated = { ...facet, status, updatedAt: new Date().toISOString() };
  await writeProfileFacets(facets.map(item => item.id === facetId ? updated : item));
  return updated;
}

function upsertFacet(existing: ProfileFacet[], next: ProfileFacet): ProfileFacet[] {
  const match = existing.find(item => item.id === next.id || (item.key === next.key && item.value === next.value));
  if (!match) return [...existing, next];
  return existing.map(item => item.id === match.id ? {
    ...item,
    confidence: Math.max(item.confidence, next.confidence),
    source: item.source === next.source ? item.source : `${item.source}; ${next.source}`,
    status: item.status === 'accepted' ? 'accepted' : next.status,
    updatedAt: next.updatedAt,
  } : item);
}

async function writeProfileFacets(facets: ProfileFacet[]): Promise<void> {
  const filePath = profileFacetsPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(facets, null, 2)}\n`, 'utf8');
}

function parsePreference(feedbackText: string): Pick<CreateProfileFacetInput, 'kind' | 'key' | 'value' | 'confidence'> | undefined {
  const normalized = feedbackText.toLowerCase();
  if (feedbackText.includes('本地化') || normalized.includes('local-first')) {
    return { kind: 'preference', key: 'solution_style', value: 'local-first', confidence: 0.7 };
  }
  if (feedbackText.includes('token') || feedbackText.includes('成本') || normalized.includes('cost')) {
    return { kind: 'preference', key: 'optimization_focus', value: 'token-cost', confidence: 0.7 };
  }
  if (feedbackText.includes('4+1')) {
    return { kind: 'preference', key: 'design_format', value: '4+1', confidence: 0.75 };
  }
  if (feedbackText.includes('MVP') || feedbackText.includes('先') && feedbackText.includes('扩展')) {
    return { kind: 'preference', key: 'delivery_style', value: 'mvp-first', confidence: 0.65 };
  }
  return undefined;
}

function createFacetId(key: string, value: string): string {
  return `${key}-${value}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'profile-facet';
}
