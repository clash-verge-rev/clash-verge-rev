export type SearchMatcherOptions = {
  matchCase?: boolean;
  matchWholeWord?: boolean;
  useRegularExpression?: boolean;
};

export type CompileStringMatcherResult = {
  matcher: (content: string) => boolean;
  isValid: boolean;
};

export const escapeRegex = (value: string) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

export const buildRegex = (pattern: string, flags = "") => {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
};

export const compileStringMatcher = (
  query: string,
  options: SearchMatcherOptions = {},
): CompileStringMatcherResult => {
  if (!query) return { matcher: () => true, isValid: true };

  const matchCase = options.matchCase ?? false;
  const matchWholeWord = options.matchWholeWord ?? false;
  const useRegularExpression = options.useRegularExpression ?? false;
  const flags = matchCase ? "" : "i";

  if (useRegularExpression) {
    const regex = buildRegex(query, flags);
    if (!regex) return { matcher: () => false, isValid: false };
    return { matcher: (content: string) => regex.test(content), isValid: true };
  }

  if (matchWholeWord) {
    const regex = buildRegex(`\\b${escapeRegex(query)}\\b`, flags);
    if (!regex) return { matcher: () => false, isValid: false };
    return { matcher: (content: string) => regex.test(content), isValid: true };
  }

  if (matchCase) {
    return {
      matcher: (content: string) => content.includes(query),
      isValid: true,
    };
  }

  const target = query.toLowerCase();
  return {
    matcher: (content: string) => content.toLowerCase().includes(target),
    isValid: true,
  };
};
