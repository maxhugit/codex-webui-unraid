import { useQuery } from '@tanstack/react-query';
import { projectsApi } from './projects-api';

export interface Person {
  id: string;
  reference: string;
  name: string;
  firstName: string;
  lastName: string;
  phone: string;
  role: 'standard' | 'administrator';
  identityLinked?: boolean;
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
export interface ProjectPersonGroup {
  id: string;
  projectId: string;
  name: string;
  memberIds: string[];
  createdAt: number;
  updatedAt: number;
}
export interface ProjectPeopleConfiguration {
  projectManagerPersonId: string | null;
  groups: ProjectPersonGroup[];
}
export const peopleKey = ['people'] as const;
export const participantKey = (projectId: string) =>
  ['project-participants', projectId] as const;
export const peopleConfigurationKey = (projectId: string) =>
  ['project-people-configuration', projectId] as const;
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
export function useProjectPeopleConfiguration(projectId: string) {
  return useQuery({
    queryKey: peopleConfigurationKey(projectId),
    queryFn: () =>
      projectsApi<ProjectPeopleConfiguration>(
        `/${projectId}/people-configuration`,
      ),
    enabled: !!projectId,
    staleTime: 10_000,
  });
}
