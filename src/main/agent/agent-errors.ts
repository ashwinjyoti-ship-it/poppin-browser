/** The harness executable could not be found on this machine. */
export class AgentNotInstalledError extends Error {}

/** The harness is installed but has no usable account/credential. */
export class AgentSignedOutError extends Error {}
