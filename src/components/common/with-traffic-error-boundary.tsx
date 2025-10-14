import React from "react";
import type { ErrorInfo } from "react";

import {
  TrafficErrorBoundary,
  LightweightTrafficErrorBoundary,
} from "./traffic-error-boundary";

interface WithTrafficErrorBoundaryOptions {
  lightweight?: boolean;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

/**
 * HOC：为任何组件添加流量错误边界
 */
export function withTrafficErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options?: WithTrafficErrorBoundaryOptions,
) {
  const WithErrorBoundaryComponent = (props: P) => {
    const ErrorBoundaryComponent = options?.lightweight
      ? LightweightTrafficErrorBoundary
      : TrafficErrorBoundary;

    return (
      <ErrorBoundaryComponent onError={options?.onError}>
        <WrappedComponent {...props} />
      </ErrorBoundaryComponent>
    );
  };

  WithErrorBoundaryComponent.displayName = `withTrafficErrorBoundary(${WrappedComponent.displayName || WrappedComponent.name})`;

  return WithErrorBoundaryComponent;
}
