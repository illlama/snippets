/**
 * streamingFetch.ts
 * ---------------------------------------------------------------------------
 * A tiny streaming-response helper for React Native.
 *
 * Consuming an HTTP streaming body (e.g. Server-Sent Events from an LLM) is
 * awkward on React Native: you need the `reactNative: { textStreaming: true }`
 * fetch flag, a manual `ReadableStream` reader loop, and `TextDecoder` chunk
 * decoding. This module hides all of that behind a small fluent event API:
 *
 *     callStream(endpoint, payload, token)
 *       .then(s => s.onRead(line => ...).onDone(() => ...));
 *
 * Correctness notes (the things that bite you in production):
 *   1. Chunks split anywhere — even mid-character and mid-line. We decode with
 *      `{ stream: true }` and buffer until a full `\n`-terminated line exists,
 *      so multi-byte text (한글/emoji) and lines that straddle two chunks are
 *      never corrupted.
 *   2. Reading starts before the caller can attach `.onRead()`. Lines that
 *      arrive first are buffered and flushed on registration, so the first
 *      line is never dropped.
 *   3. The caller can `.cancel()` to abort the read loop on unmount.
 *
 * Requires a fetch/stream polyfill setup on RN, e.g. react-native-fetch-api +
 * web-streams-polyfill + text-encoding.
 * ---------------------------------------------------------------------------
 */

type ReadListener = (line: string) => void;
type DoneListener = () => void;
type ErrorListener = (error: unknown) => void;

export interface StreamHandler {
  onRead(listener: ReadListener): StreamHandler;
  onDone(listener: DoneListener): StreamHandler;
  onError(listener: ErrorListener): StreamHandler;
  /** Aborts the read loop. Safe to call from a cleanup function. */
  cancel(): void;
}

/**
 * Wraps a ReadableStream in a chainable event emitter. Reads chunk by chunk,
 * decodes incrementally, and forwards each complete line to `onRead`.
 */
export const listenStream = (
  stream: ReadableStream<Uint8Array>,
): StreamHandler => {
  let onRead: ReadListener | null = null;
  let onDone: DoneListener | null = null;
  let onError: ErrorListener | null = null;

  // Events that arrive before a listener is attached are buffered here, so the
  // fluent `.onRead()` call that happens *after* this function returns can
  // never miss the first lines.
  const pendingLines: string[] = [];
  let finished = false;
  let failure: { error: unknown } | null = null;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = ''; // carries an incomplete trailing line across chunks
  let cancelled = false;

  const emitLine = (line: string) => {
    if (!onRead) {
      pendingLines.push(line);
      return;
    }
    try {
      onRead(line);
    } catch (e) {
      console.warn('onRead threw for line:', line, e);
    }
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    onDone?.();
  };

  const fail = (error: unknown) => {
    if (failure) return;
    failure = { error };
    onError?.(error);
    finish(); // `onDone` still fires so consumers can run cleanup once.
  };

  const pump = async () => {
    try {
      while (!cancelled) {
        const { done, value } = await reader.read();

        if (done) {
          buffer += decoder.decode(); // flush any buffered multi-byte tail
          const tail = buffer.trim();
          if (tail) emitLine(tail);
          buffer = '';
          finish();
          return;
        }

        buffer += decoder.decode(value, { stream: true });

        // Emit only complete (newline-terminated) lines; keep the remainder.
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line) emitLine(line);
        }
      }
    } catch (error) {
      if (!cancelled) fail(error);
    }
  };

  const handler: StreamHandler = {
    onRead(listener) {
      onRead = listener;
      if (pendingLines.length) {
        const flushed = pendingLines.splice(0);
        for (const line of flushed) emitLine(line);
      }
      return handler;
    },
    onDone(listener) {
      onDone = listener;
      if (finished) listener(); // already done before registration
      return handler;
    },
    onError(listener) {
      onError = listener;
      if (failure) listener(failure.error);
      return handler;
    },
    cancel() {
      cancelled = true;
      reader.cancel().catch(() => {});
    },
  };

  pump();
  return handler;
};

/**
 * POSTs a JSON payload to a streaming endpoint and returns the fluent stream
 * handler. The `reactNative.textStreaming` flag is what enables incremental
 * reads instead of buffering the whole response. Pass an `AbortSignal` to
 * cancel the request itself (e.g. on unmount).
 */
export const callStream = async (
  endpoint: string,
  payload: unknown,
  token: string,
  options?: { signal?: AbortSignal },
): Promise<StreamHandler> => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
    signal: options?.signal,
    // RN-specific flag (react-native-fetch-api) — keep the body as a stream
    // instead of buffering it into a single string.
    reactNative: { textStreaming: true },
  } as RequestInit);

  if (!response.ok) {
    throw new Error(`Stream request failed: ${response.status}`);
  }

  const stream = response.body;
  if (!stream) {
    throw new Error('No response stream received');
  }

  return listenStream(stream);
};

/* ---------------------------------------------------------------------------
 * Usage
 * ---------------------------------------------------------------------------
 * const controller = new AbortController();
 * const handler = await callStream(
 *   'https://api.example.com/chat', { prompt }, token, { signal: controller.signal },
 * );
 * handler
 *   .onRead((line) => {
 *     const json = JSON.parse(line);   // e.g. SSE "data:" payload
 *     appendToken(json.delta);
 *   })
 *   .onError((err) => showError(err))
 *   .onDone(() => setIsStreaming(false));
 *
 * // On unmount: controller.abort(); handler.cancel();
 * ------------------------------------------------------------------------- */
