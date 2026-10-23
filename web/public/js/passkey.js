// The reports id in a passkey. The city has no accounts: "my reports" are
// the reports filed under a 16-character id, and the iPhone app keeps that
// id in iCloud Keychain. A web app cannot reach the Keychain, but a passkey
// can carry 64 bytes in its user handle, and passkeys sync through iCloud
// Keychain, Google Password Manager and other password managers. So the
// app saves the id as the user handle of a passkey for this site, and a
// restore asks the device for any passkey for this site and reads the id back.
//
// The passkey signs nothing that a server checks: it is storage, not a login.
// Nobody else can read it, because only this site's pages can use it and the
// device asks for Face ID, a fingerprint or the device code first.

import { local } from "./lib/store.js";

const ID_RE = /^[0-9a-f]{16}$/;
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

export const passkeysSupported = () => !!(window.PublicKeyCredential && navigator.credentials?.create && window.isSecureContext);

/** True when this id is in a passkey that this device made. */
export const savedToPasskey = (id) => local.get("passkeyFor") === id;

/** Saves `id` in a new passkey. Throws with a message for the person when it does not work. */
export async function saveToPasskey(id) {
  if (!ID_RE.test(id)) throw new Error("This reports id is not valid.");
  try {
    await navigator.credentials.create({ publicKey: {
      challenge: random(32),
      rp: { name: "Switchboard KC", id: location.hostname },
      // The id itself is the user handle. The name tells two saved ids apart in the device's passkey list.
      user: { id: new TextEncoder().encode(id), name: `Reports id ${id.slice(0, 4)}…${id.slice(-4)}`, displayName: "Switchboard KC reports" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "preferred" },
      attestation: "none",
      timeout: 120000,
    } });
  } catch (e) {
    throw new Error(problem(e, "save"));
  }
  local.set("passkeyFor", id);
}

/** Reads a reports id from a passkey that the person picks. Returns the id. */
export async function restoreFromPasskey() {
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey: {
      challenge: random(32), rpId: location.hostname, userVerification: "preferred", timeout: 120000,
    } });
  } catch (e) {
    throw new Error(problem(e, "restore"));
  }
  const handle = cred?.response?.userHandle;
  const id = handle ? new TextDecoder().decode(handle) : "";
  if (!ID_RE.test(id)) throw new Error("That passkey has no Switchboard KC reports id.");
  local.set("passkeyFor", id);
  return id;
}

function problem(e, what) {
  if (e?.name === "NotAllowedError") return what === "save" ? "The passkey was not saved." : "No passkey was picked.";
  if (e?.name === "InvalidStateError") return "This device already has that passkey.";
  if (e?.name === "SecurityError") return "Passkeys do not work on this address.";
  if (e?.name === "NotSupportedError") return "This device cannot make passkeys.";
  return e?.message || "The passkey did not work.";
}
