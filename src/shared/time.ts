/**
 * Current time in Unix seconds.
 *
 * matter.js takes epoch-s attributes and fields (forecast start/end, requestedStartTime) as Unix seconds and converts
 * to the Matter epoch (2000-01-01) on the wire, so no conversion is needed in application code.
 */
export const nowUnixS = () => Math.floor(Date.now() / 1000);
