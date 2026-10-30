import type { ActivityEvent, PublicUser } from '@universe/contracts';
import { webModules } from '../modules';

/** "Seat accepted." from `rides.seat_accepted`, when nobody wrote a sentence for a type. */
const humanize = (type: string) => {
  const words = (type.split('.')[1] ?? type).replace(/_/g, ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}.`;
};
const message = (payload: unknown) =>
  typeof payload === 'object' &&
  payload !== null &&
  'message' in payload &&
  typeof payload.message === 'string'
    ? payload.message
    : null;

/**
 * An event as a bold actor and a plain-text sentence (rendered as text, never as HTML).
 * The module's own wording wins; otherwise a `message` in the payload; otherwise the type.
 */
export function activityLine(event: ActivityEvent, me: PublicUser): { who: string; text: string } {
  const who = event.actor ? (event.actor.id === me.id ? 'You' : event.actor.name) : '';
  if (event.type === 'platform.announcement') {
    const text = message(event.payload) ?? '';
    return { who, text: who ? `announced: ${text}` : text };
  }
  const own = webModules[event.module]?.activityText?.[event.type];
  if (own) {
    try {
      const text = own(event.payload, event);
      // "accepted you on…" follows the actor's name; "Your ride is leaving." stands alone.
      return { who: /^[a-z]/.test(text) ? who : '', text };
    } catch {
      // A payload the module didn't expect: fall through to the generic wording.
    }
  }
  return { who, text: message(event.payload) ?? humanize(event.type) };
}
