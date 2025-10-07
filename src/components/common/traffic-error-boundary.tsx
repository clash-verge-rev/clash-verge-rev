import React, { Component, ErrorInfo, ReactNode } from "react";

import {
  TrafficErrorFallback,
  LightweightTrafficErrorBoundary,
} from "./traffic-error-fallback";

interface Props {
  children: ReactNode;
  fallbackComponent?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

/**
 * 流量统计专用错误边界组件
 * 处理图表和流量统计组件的错误，提供优雅的降级体验
 */
export class TrafficErrorBoundary extends Component<Props, State> {
  private retryCount = 0;
  private maxRetries = 3;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // 更新状态以显示降级UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[TrafficErrorBoundary] 捕获到组件错误:", error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });

    // 调用错误回调
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // 发送错误到监控系统（如果有的话）
    this.reportError(error, errorInfo);
  }

  private reportError = (error: Error, errorInfo: ErrorInfo) => {
    // 这里可以集成错误监控服务
    const errorReport = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    };

    console.log("[TrafficErrorBoundary] 错误报告:", errorReport);

    // TODO: 发送到错误监控服务
    // sendErrorReport(errorReport);
  };

  private handleRetry = () => {
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      console.log(
        `[TrafficErrorBoundary] 尝试重试 (${this.retryCount}/${this.maxRetries})`,
      );

      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
        showDetails: false,
      });
    } else {
      console.warn("[TrafficErrorBoundary] 已达到最大重试次数");
    }
  };

  private handleRefresh = () => {
    window.location.reload();
  };

  private toggleDetails = () => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  render() {
    if (this.state.hasError) {
      // 如果提供了自定义降级组件，使用它
      if (this.props.fallbackComponent) {
        return this.props.fallbackComponent;
      }

      // 默认错误UI
      return (
        <TrafficErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          showDetails={this.state.showDetails}
          canRetry={this.retryCount < this.maxRetries}
          retryCount={this.retryCount}
          maxRetries={this.maxRetries}
          onRetry={this.handleRetry}
          onRefresh={this.handleRefresh}
          onToggleDetails={this.toggleDetails}
        />
      );
    }

    return this.props.children;
  }
}

/**
 * HOC：为任何组件添加流量错误边界
 */
export function withTrafficErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options?: {
    lightweight?: boolean;
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
  },
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
