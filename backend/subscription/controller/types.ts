import type { ApiSuccessResponse } from '../../services/shared/apiResponse';
import type { SurrogateKeyType } from '../../shared/cache/surrogateKeys';

/** Result returned by cacheable GET endpoint handlers. */
export interface CacheableEndpointResult<T> {
  response: ApiSuccessResponse<T>;
  surrogateKeys: string[];
  cacheTtlSeconds?: number;
  httpStatus?: number;
}

export interface CacheableMutationResult<T> {
  response: ApiSuccessResponse<T>;
  purgeKeys: SurrogateKeyType[];
}
