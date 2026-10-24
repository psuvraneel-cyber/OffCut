import type { ClientMeta, Feature, FeatureStatus } from "../../shared/api-types";

export const FEATURE_STATUS_ORDER: Record<FeatureStatus, number> = {
  idea: 0,
  planned: 1,
  building: 2,
  shipped: 3,
};

export interface FeatureRow {
  id: string;
  title: string;
  description: string;
  status: FeatureStatus;
  votes: number;
}

export function toFeature(row: FeatureRow): Feature {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    votes: Number(row.votes),
  };
}

export function serializeMeta(meta: ClientMeta | undefined): string | null {
  return meta ? JSON.stringify(meta) : null;
}

export function retentionCutoffIso(now = Date.now()): string {
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  return new Date(now - ninetyDaysMs).toISOString();
}
