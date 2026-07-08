import { createOperationLogger } from './logger';

type FetchInput = Parameters<typeof fetch>[0];

export type FetchErrorKind = 'network' | 'timeout' | 'parse' | 'business';

export type RetryOptions = {
  retries?: number;
  delayMs?: number;
};

export type KraFetchOptions = RequestInit & {
  operation?: string;
  timeoutMs?: number;
  retry?: RetryOptions;
};

export class KraFetchError extends Error {
  readonly kind: FetchErrorKind;
  readonly url: string;
  readonly status: number | undefined;

  constructor(
    kind: FetchErrorKind,
    message: string,
    options: { url: string; status?: number; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'KraFetchError';
    this.kind = kind;
    this.url = options.url;
    this.status = options.status;
  }
}

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_IDEMPOTENT_RETRIES = 1;
const retryableStatusCodes = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
};

const requestUrl = (input: FetchInput): string => {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
};

const requestMethod = (input: FetchInput, init: RequestInit): string => {
  if (init.method) {
    return init.method.toUpperCase();
  }
  if (input instanceof Request) {
    return input.method.toUpperCase();
  }
  return 'GET';
};

const isIdempotentMethod = (method: string): boolean => {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
};

export const currentFetchImplementation = (): typeof fetch => globalThis.fetch;

export const formatNetworkError = (error: unknown, context?: string): string => {
  const prefix = context ? `${context}: ` : '';
  if (error instanceof KraFetchError) {
    const status = error.status === undefined ? '' : ` status=${error.status}`;
    return `${prefix}${error.message} [kind=${error.kind} url=${error.url}${status}]`;
  }

  const message = error instanceof Error ? error.message : 'Unknown network error';
  return `${prefix}${message}`;
};

export const logNetworkWarning = (message: string): void => {
  process.stderr.write(`[kra:network] warn ${message}\n`);
};

const createTimeoutSignal = (
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void; didTimeout: () => boolean } => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
    didTimeout: () => timedOut,
  };
};

const mergeSignals = (left: AbortSignal, right: AbortSignal | null | undefined): AbortSignal => {
  if (!right) {
    return left;
  }
  return AbortSignal.any([left, right]);
};

const classifyFetchFailure = (
  error: unknown,
  url: string,
  operation: string,
  timedOut: boolean,
): KraFetchError => {
  if (timedOut) {
    return new KraFetchError('timeout', `${operation} timed out.`, { url, cause: error });
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return new KraFetchError('timeout', `${operation} was aborted.`, { url, cause: error });
  }

  return new KraFetchError('network', `${operation} failed: network error.`, {
    url,
    cause: error,
  });
};

const createBusinessFetchError = (
  message: string,
  options: { url: string; status?: number; cause?: unknown },
): KraFetchError => new KraFetchError('business', message, options);

export const createParseFetchError = (
  message: string,
  options: { url: string; cause?: unknown },
): KraFetchError => new KraFetchError('parse', message, options);

export const assertOkResponse = (response: Response, message: string): void => {
  if (!response.ok) {
    throw createBusinessFetchError(`${message}: ${response.status}`, {
      url: response.url,
      status: response.status,
    });
  }
};

export const fetchResponse = async (
  input: FetchInput,
  options: KraFetchOptions = {},
): Promise<Response> => {
  const {
    operation = 'Network request',
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    retry,
    ...init
  } = options;
  const url = requestUrl(input);
  const method = requestMethod(input, init);
  const retryCount = isIdempotentMethod(method)
    ? (retry?.retries ?? DEFAULT_IDEMPOTENT_RETRIES)
    : 0;
  const retryDelayMs = retry?.delayMs ?? DEFAULT_RETRY_DELAY_MS;
  let lastError: KraFetchError | undefined;

  const logger = createOperationLogger('core.fetch', {
    method,
    url,
    operation,
    timeoutMs,
    retryCount,
  });

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const timeout = createTimeoutSignal(timeoutMs);
    const startedAt = Date.now();
    logger.debug('request.start', { attempt });
    try {
      const response = await currentFetchImplementation()(input, {
        ...init,
        signal: mergeSignals(timeout.signal, init.signal),
      });
      logger.debug('request.response', {
        attempt,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });

      if (attempt < retryCount && retryableStatusCodes.has(response.status)) {
        lastError = createBusinessFetchError(`${operation} failed: ${response.status}`, {
          url,
          status: response.status,
        });
        await response.body?.cancel();
        logger.warn('request.retry', { attempt, status: response.status, retryDelayMs });
        await sleep(retryDelayMs);
        continue;
      }

      logger.debug('request.end', {
        attempt,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      const fetchError = classifyFetchFailure(error, url, operation, timeout.didTimeout());
      logger.warn('request.error', {
        attempt,
        kind: fetchError.kind,
        message: fetchError.message,
        durationMs: Date.now() - startedAt,
      });
      lastError = fetchError;
      if (attempt >= retryCount) {
        throw fetchError;
      }
      logger.warn('request.retry', { attempt, retryDelayMs });
      await sleep(retryDelayMs);
    } finally {
      timeout.dispose();
    }
  }

  throw lastError ?? new KraFetchError('network', `${operation} failed.`, { url });
};

export const readJsonResponse = async <T = unknown>(
  response: Response,
  operation: string,
): Promise<T> => {
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw createParseFetchError(`${operation} failed: invalid JSON response.`, {
      url: response.url,
      cause: error,
    });
  }
};

export const readTextResponse = async (response: Response, operation: string): Promise<string> => {
  try {
    return await response.text();
  } catch (error) {
    throw createParseFetchError(`${operation} failed: invalid text response.`, {
      url: response.url,
      cause: error,
    });
  }
};
