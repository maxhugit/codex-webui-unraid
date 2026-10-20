/** Read every model page from the installed app-server, never a hardcoded catalog. */
import { modelsListModels } from '@/generated/api/sdk.gen';
import type { ModelListResponseDto } from '@/generated/api/types.gen';

export async function loadAdminModels(
  signal?: AbortSignal,
): Promise<ModelListResponseDto> {
  const data: ModelListResponseDto['data'] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const { data: page } = await modelsListModels({
      query: { cursor },
      signal,
      throwOnError: true,
    });
    data.push(...page.data);
    cursor = page.nextCursor ?? undefined;
    if (cursor && seen.has(cursor))
      throw new Error('Model pagination cursor repeated');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return { data, nextCursor: null };
}
