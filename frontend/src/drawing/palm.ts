/**
 * Palm rejection, kept pure so the rules can be tested without a canvas.
 *
 * The pencil is active from the moment it touches down until a short grace
 * period after it lifts. Touches inside that window belong to the hand holding
 * the pencil, never to navigation.
 */

export interface PalmGuard {
  /** The user's setting; when off, every touch is navigation. */
  palmRejection: boolean;
  /** True between pencil down and pen up. */
  penDown: boolean;
  /** Milliseconds since the pencil last lifted; negative when it never has. */
  sincePenUp: number;
  /** True while a pencil-driven session owns the page. */
  penSession: boolean;
}

/** A hand that lands this soon after the pencil lifts is still the same hand. */
export const PALM_GRACE_MS = 350;

const PEN_SESSIONS = new Set(['draw', 'shape', 'erase', 'lasso', 'move', 'resize']);

/** Sessions started by the pencil, which a stray touch must never interrupt. */
export function isPenSession(kind: string): boolean {
  return PEN_SESSIONS.has(kind);
}

export function shouldRejectTouch(guard: PalmGuard): boolean {
  if (!guard.palmRejection) return false;
  if (guard.penDown) return true;
  if (guard.penSession) return true;
  return guard.sincePenUp >= 0 && guard.sincePenUp < PALM_GRACE_MS;
}
