// A live SSE client for tests: opens /api/activity/stream against a listening server and
// waits for messages that match.
import { ActivityEvent } from '@universe/contracts';

export interface Message {
  id?: string;
  event: string;
  data: string;
}

export async function openStream(baseUrl: string, cookie: string) {
  const abort = new AbortController();
  const res = await fetch(`${baseUrl}/api/activity/stream`, {
    headers: { cookie },
    signal: abort.signal,
  });
  if (!res.body) throw new Error('no body');
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const queue: Message[] = [];
  let buffer = '';

  async function next(match: (m: Message) => boolean, timeoutMs = 2000): Promise<Message> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = queue.findIndex(match);
      if (index >= 0) return queue.splice(index, 1)[0] as Message;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out waiting for an SSE message');
      let timer: NodeJS.Timeout | undefined;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('timed out waiting for an SSE message')),
            remaining,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (chunk.done) throw new Error('stream ended');
      buffer += chunk.value;
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const message: Message = { event: 'message', data: '' };
        for (const line of block.split('\n')) {
          if (line.startsWith('id: ')) message.id = line.slice(4);
          else if (line.startsWith('event: ')) message.event = line.slice(7);
          else if (line.startsWith('data: ')) message.data = line.slice(6);
        }
        if (block.split('\n').some((l) => !l.startsWith(':'))) queue.push(message);
      }
    }
  }
  return { res, next, close: () => abort.abort() };
}

/** An `activity` message of this type (optionally with a payload check). */
export const activityOf =
  (type: string, check: (payload: Record<string, unknown>) => boolean = () => true) =>
  (m: Message) => {
    if (m.event !== 'activity') return false;
    const e = ActivityEvent.parse(JSON.parse(m.data));
    return e.type === type && check(e.payload as Record<string, unknown>);
  };
