/** Shared client instance for screens that do not inject their own. */

import { QueryClient } from './queryClient';

export const defaultQueryClient = new QueryClient();
