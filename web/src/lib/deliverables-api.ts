import type { ProjectResourceSummary } from './projects-api';
export interface DeliverableFile {
  name: string;
  sourcePath: string;
  snapshotPath: string;
  size: number;
  sha256: string;
}
export interface DeliverableVersion {
  id: string;
  number: number;
  note: string;
  files: DeliverableFile[];
  status: 'proposed' | 'validated' | 'rejected';
  reviewer: string | null;
  reviewedAt: number | null;
  createdAt: number;
}
export interface DeliverableDocumentVersion {
  id: string;
  documentId: string;
  number: number;
  fileName: string;
  sourcePath: string;
  snapshotPath: string;
  size: number;
  sha256: string;
  authorPersonId: string | null;
  authorName: string;
  comment: string;
  restoredFromVersionId: string | null;
  createdAt: number;
}
export interface DeliverableDocument {
  id: string;
  deliverableId: string;
  name: string;
  format: string;
  sourcePath: string;
  currentVersionNumber: number;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
  versions: DeliverableDocumentVersion[];
}
export interface Deliverable {
  id: string;
  title: string;
  description: string;
  criteria: string;
  assigneeId: string | null;
  dueAt: number | null;
  status: 'planned' | 'in_progress' | 'review' | 'validated';
  taskIds: string[];
  conversations: Array<{ type: 'agent' | 'simple'; id: string }>;
  version: number;
  validatedVersionId: string | null;
  directory: string;
  versions: DeliverableVersion[];
  documents: DeliverableDocument[];
}
export interface DeliverablesBoard {
  resource: ProjectResourceSummary;
  deliverables: Deliverable[];
  assignees: Array<{ id: string; name: string }>;
  tasks: Array<{ id: string; title: string; resourceId: string }>;
  conversations: Array<{ type: 'agent' | 'simple'; id: string; title: string }>;
}
