import { useQuery } from '@tanstack/react-query';
import { projectsApi } from './projects-api';

export interface Person {
  id: string;
  reference: string;
  name: string;
  email: string | null;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}
export interface Participant {
  personId: string;
  projectId: string;
  assignmentCount: number;
  openAssignmentCount: number;
}
export const peopleKey = ['people'] as const;
export const participantKey = (projectId: string) =>
  ['project-participants', projectId] as const;
export const personLabel = (person: Person) =>
  `${person.name} (${person.reference})`;
export function usePeople() {
  return useQuery({
    queryKey: peopleKey,
    queryFn: () => projectsApi<{ people: Person[] }>('/people'),
    staleTime: 30_000,
  });
}
export function useParticipants(projectId: string) {
  return useQuery({
    queryKey: participantKey(projectId),
    queryFn: () =>
      projectsApi<{ participants: Participant[] }>(
        `/${projectId}/participants`,
      ),
    enabled: !!projectId,
    staleTime: 10_000,
  });
}
