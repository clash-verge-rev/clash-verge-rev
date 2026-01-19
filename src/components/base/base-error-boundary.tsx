import { ReactNode } from "react";
import { ErrorBoundary, FallbackProps } from "react-error-boundary";

function ErrorFallback({ error }: FallbackProps) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  return (
    <div role="alert" style={{ padding: 16 }}>
      <h4>Something went wrong:(</h4>

      <pre>{errorMessage}</pre>

      <details title="Error Stack">
        <summary>Error Stack</summary>
        <pre>{errorStack}</pre>
      </details>
    </div>
  );
}

interface Props {
  children?: ReactNode;
}

export const BaseErrorBoundary = ({ children }: Props) => {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>{children}</ErrorBoundary>
  );
};
