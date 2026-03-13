// These warnings are safe to ignore: they occur when Monaco models or workers are manually disposed.
const ignoredGlobalErrorMessages = [
  "Missing requestHandler or method:",
  "Could not create web worker(s). Falling back to loading web worker code in main thread",
  "Cannot use 'in' operator to search for 'then' in undefined",
];

const isIgnoredMessage = (message: string) =>
  ignoredGlobalErrorMessages.some((snippet) => message.includes(snippet));

export const isIgnoredMonacoWorkerError = (reason: unknown) => {
  const message = String(
    reason instanceof Error ? reason.message : (reason ?? ""),
  );
  return isIgnoredMessage(message);
};

const shouldIgnoreConsoleArgs = (args: unknown[]) =>
  args.some((arg) => {
    const message =
      typeof arg === "string" ? arg : arg instanceof Error ? arg.message : "";
    return isIgnoredMessage(message);
  });

export const patchMonacoWorkerConsole = () => {
  const originalWarn = console.warn;
  const originalError = console.error;

  console.warn = (...args) => {
    if (shouldIgnoreConsoleArgs(args)) return;
    originalWarn(...args);
  };

  console.error = (...args) => {
    if (shouldIgnoreConsoleArgs(args)) return;
    originalError(...args);
  };
};
