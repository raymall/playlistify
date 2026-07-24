// user_metadata values are provider-controlled and untyped — narrow, don't trust.
export const readDisplayName = (metadata: Record<string, unknown>) =>
  typeof metadata.full_name === 'string'
    ? metadata.full_name
    : typeof metadata.name === 'string'
      ? metadata.name
      : null
