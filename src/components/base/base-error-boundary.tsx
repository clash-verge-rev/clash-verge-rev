import { ReactNode } from "react";
import { ErrorBoundary, FallbackProps } from "react-error-boundary";

function ErrorFallback({ error }: FallbackProps) {
  return (
    <div role="alert">
      <p>Something went wrong:(</p>
      <pre>{error.message}</pre>
    </div>
  );
}

interface BaseErrorBoundaryProps {
  children?: ReactNode;
}

export const BaseErrorBoundary: React.FC<BaseErrorBoundaryProps> = (props) => {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      {props.children}
    </ErrorBoundary>
  );
};
