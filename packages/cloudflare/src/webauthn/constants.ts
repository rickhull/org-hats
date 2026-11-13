// The ceremony's lifetime, shared by the coordinator that stores the
// challenge expiry and the runtime surface that states the browser timeout.

/** How long a minted ceremony challenge stays usable. The stored expiry is
 * the authority; the browser timeout is the same span offered as a hint. */
export const WEBAUTHN_CEREMONY_LIFETIME_SECONDS = 300;
