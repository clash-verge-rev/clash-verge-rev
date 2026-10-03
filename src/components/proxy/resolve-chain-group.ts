export interface MinimalGroup {
  name: string
}

export function resolveActiveChainGroup(
  mode: string,
  preferredGroupName: string | null | undefined,
  availableGroups: readonly MinimalGroup[],
): string | null {
  if (mode !== 'rule' || availableGroups.length === 0) {
    return null
  }

  if (
    preferredGroupName &&
    availableGroups.some((group) => group.name === preferredGroupName)
  ) {
    return preferredGroupName
  }

  return availableGroups[0].name
}
