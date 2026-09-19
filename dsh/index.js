// dsh-chat-rail - Host half.
//
// The feature is entirely browser-side: the rail reads the conversation
// snapshot through the client runtime's sessions service and scrolls the
// chat viewport through the shell overlay. The Host half therefore only
// exists so the bundle is a well-formed Cordis plugin row (and so a future
// server-side preference can be hung here without changing the composition).
//
// Nothing is registered, so the mounted row is inert on the Host: no
// services, no events, no tools, no routes.

export const name = 'dsh-chat-rail'

/** No Host dependency: an unresolvable service must never leave the row pending. */
export const inject = []

/**
 * Mount the (empty) Host face of the conversation rail.
 * @param ctx - Host Cordis context.
 */
export function apply(ctx) {
  // Reserved for Host-side configuration (rail alignment, dash caps, ...).
  // Intentionally empty: the browser half is self-sufficient.
  void ctx
}
