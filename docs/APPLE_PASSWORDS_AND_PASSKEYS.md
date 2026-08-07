# Apple Passwords and Passkeys in Poppin

## Current decision

Poppin does not read, copy, update, or export credentials from Apple Passwords or iCloud Keychain. It also does not install the Apple iCloud Passwords browser extension.

This boundary is deliberate:

- Apple provides Password AutoFill to third-party browsers through browser extensions.
- Electron does not support arbitrary Chrome Web Store extensions, including Apple's iCloud Passwords extension.
- Reading Keychain password records directly would require broader credential access than a browser should have and would not reproduce Apple's protected AutoFill experience.

The persistent `persist:poppin-browser` Chromium session remains the safe Phase 1 answer for ordinary logins: cookies, site data, and authenticated sessions survive quit and relaunch. A site may still require password re-entry after a password change, security challenge, cookie revocation, or OAuth reauthentication.

## Supported future path

Electron can provide a Touch ID platform authenticator for WebAuthn/passkeys through `app.configureWebAuthn`. This is not an iCloud Passwords integration:

- the app must be signed with an Apple Developer Team identity;
- its entitlements must contain a matching `keychain-access-groups` value;
- the resulting credentials are device-bound to this Mac's Secure Enclave;
- Electron documents that these credentials do not sync through iCloud Keychain;
- Poppin must add a safe account chooser when a site returns multiple credentials.

That work should be planned after signing/notarization is available and tested against a passkey fixture plus Google sign-in. It must never be simulated with password scraping or an embedded credential database.

## Practical recommendation

For the current unsigned MVP, keep the persistent browser session and use Apple Passwords manually when a site legitimately asks for credentials. Diagnose any site that loses a session after a normal app relaunch before adding authentication features. Revisit signed Touch ID passkeys as a focused browser capability, separate from Codex integration.

## Primary references

- [Apple: Use extensions to automatically fill in passwords](https://support.apple.com/en-ie/guide/passwords/mchlf7ac261e/mac)
- [Apple: Use passwords and passkeys across your devices](https://support.apple.com/en-us/120758)
- [Apple: Authenticating people by using passkeys in browser apps](https://developer.apple.com/documentation/authenticationservices/authenticating-people-by-using-passkeys-in-browser-apps)
- [Electron: Supported Chrome extension APIs](https://www.electronjs.org/docs/latest/api/extensions/)
- [Electron: `app.configureWebAuthn`](https://github.com/electron/electron/blob/main/docs/api/app.md)
