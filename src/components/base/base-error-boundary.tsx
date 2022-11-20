import { ErrorBoundary, FallbackProps } from "react-error-boundary";

function ErrorFallback({ error }: FallbackProps) {
  return (
    <div role="alert">
      <p>Something went wrong:(</p>
      <pre>{error.message}</pre>
    </div>
  );
}

export const BaseErrorBoundary: React.FC = (props) => {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      {props.children}
    </ErrorBoundary>
  );
};
