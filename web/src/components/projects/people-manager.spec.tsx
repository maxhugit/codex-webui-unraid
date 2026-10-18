import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PeopleManager } from './people-manager';

const api = vi.hoisted(() => vi.fn().mockResolvedValue({ person: {} }));
vi.mock('@/lib/projects-api', () => ({ projectsApi: api }));
vi.mock('@/lib/people-api', () => ({
  usePeople: () => ({ data: { people: [] }, isPending: false }),
  useParticipants: () => ({ data: { participants: [] }, isPending: false }),
  peopleKey: ['people'],
  personLabel: (p: { name: string }) => p.name,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
beforeEach(() => api.mockClear());
afterEach(cleanup);

it('requires first name, last name, email and phone, computes full name, and defaults to standard', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PeopleManager />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'New person' }));
  for (const name of [/^First name/, /^Last name/, /^Email/, /^Phone number/]) {
    expect((screen.getByLabelText(name) as HTMLInputElement).required).toBe(
      true,
    );
  }
  const fullName = screen.getByLabelText('Full name') as HTMLInputElement;
  expect(fullName.readOnly).toBe(true);
  fireEvent.change(screen.getByLabelText(/^Manual reference/), {
    target: { value: 'TEST' },
  });
  fireEvent.change(screen.getByLabelText(/^First name/), {
    target: { value: 'Alice' },
  });
  fireEvent.change(screen.getByLabelText(/^Last name/), {
    target: { value: 'Test' },
  });
  fireEvent.change(screen.getByLabelText(/^Email/), {
    target: { value: 'alice@example.com' },
  });
  fireEvent.change(screen.getByLabelText(/^Phone number/), {
    target: { value: '0600000000' },
  });
  expect(fullName.value).toBe('Alice Test');
  expect(
    (screen.getByLabelText(/^Platform role/) as HTMLSelectElement).value,
  ).toBe('standard');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api).toHaveBeenCalled());
  expect(JSON.parse(api.mock.calls[0][1].body)).toMatchObject({
    firstName: 'Alice',
    lastName: 'Test',
    email: 'alice@example.com',
    phone: '0600000000',
    role: 'standard',
  });
});
