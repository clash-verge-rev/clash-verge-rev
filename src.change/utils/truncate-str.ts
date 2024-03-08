export const truncateStr = (str?: string, prefixLen = 16, maxLen = 56) => {
  if (!str || str.length <= maxLen) return str;
  return (
    str.slice(0, prefixLen) + " ... " + str.slice(-(maxLen - prefixLen - 5))
  );
};
