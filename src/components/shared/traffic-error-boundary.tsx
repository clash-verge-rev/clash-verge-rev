import {
  ErrorOutlineRounded,
  RefreshRounded,
  BugReportRounded,
} from '@mui/icons-material'
import { Box, Typography, Button, Alert, Collapse } from '@mui/material'
import React, { Component, ErrorInfo, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  children: ReactNode
  fallbackComponent?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  showDetails: boolean
}

export class TrafficErrorBoundary extends Component<Props, State> {
  private retryCount = 0
  private maxRetries = 3

  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[TrafficErrorBoundary] 捕获到组件错误:', error, errorInfo)

    this.setState({
      error,
      errorInfo,
    })

    if (this.props.onError) {
      this.props.onError(error, errorInfo)
    }

    this.reportError(error, errorInfo)
  }

  private reportError = (error: Error, errorInfo: ErrorInfo) => {
    const errorReport = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    }

    console.error('[TrafficErrorBoundary] 错误报告:', errorReport)
  }

  private handleRetry = () => {
    if (this.retryCount < this.maxRetries) {
      this.retryCount++
      console.log(
        `[TrafficErrorBoundary] 尝试重试 (${this.retryCount}/${this.maxRetries})`,
      )

      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
        showDetails: false,
      })
    } else {
      console.warn('[TrafficErrorBoundary] 已达到最大重试次数')
    }
  }

  private handleRefresh = () => {
    window.location.reload()
  }

  private toggleDetails = () => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }))
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallbackComponent) {
        return this.props.fallbackComponent
      }

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
      )
    }

    return this.props.children
  }
}

interface TrafficErrorFallbackProps {
  error: Error | null
  errorInfo: ErrorInfo | null
  showDetails: boolean
  canRetry: boolean
  retryCount: number
  maxRetries: number
  onRetry: () => void
  onRefresh: () => void
  onToggleDetails: () => void
}

const TrafficErrorFallback: React.FC<TrafficErrorFallbackProps> = ({
  error,
  errorInfo,
  showDetails,
  canRetry,
  retryCount,
  maxRetries,
  onRetry,
  onRefresh,
  onToggleDetails,
}) => {
  const { t } = useTranslation()

  return (
    <Box
      sx={{
        p: 2,
        minHeight: 200,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px dashed',
        borderColor: 'error.main',
        borderRadius: 2,
        bgcolor: 'error.light',
        color: 'error.contrastText',
      }}
    >
      <ErrorOutlineRounded sx={{ fontSize: 48, mb: 2, color: 'error.main' }} />

      <Typography variant="h6" gutterBottom>
        {t('shared.feedback.errors.trafficStats')}
      </Typography>

      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mb: 2, textAlign: 'center' }}
      >
        {t('shared.feedback.errors.trafficStatsDescription')}
      </Typography>

      <Alert severity="error" sx={{ mb: 2, maxWidth: 400 }}>
        <Typography variant="body2">
          <strong>{t('shared.feedback.errors.label')}:</strong>{' '}
          {error instanceof Error
            ? error.message
            : t('shared.feedback.errors.unknown')}
        </Typography>
        {retryCount > 0 && (
          <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
            {t('shared.labels.retryAttempts')}: {retryCount}/{maxRetries}
          </Typography>
        )}
      </Alert>

      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        {canRetry && (
          <Button
            variant="contained"
            color="primary"
            startIcon={<RefreshRounded />}
            onClick={onRetry}
            size="small"
          >
            {t('shared.actions.retry')}
          </Button>
        )}

        <Button variant="outlined" onClick={onRefresh} size="small">
          {t('shared.actions.refreshPage')}
        </Button>

        <Button
          variant="text"
          startIcon={<BugReportRounded />}
          onClick={onToggleDetails}
          size="small"
        >
          {showDetails
            ? t('shared.actions.hideDetails')
            : t('shared.actions.showDetails')}
        </Button>
      </Box>

      <Collapse in={showDetails} sx={{ width: '100%', maxWidth: 600 }}>
        <Box
          sx={{
            p: 2,
            bgcolor: 'background.paper',
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="subtitle2" gutterBottom>
            {t('shared.feedback.errors.details')}:
          </Typography>
          <Typography
            variant="caption"
            component="pre"
            sx={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              color: 'text.secondary',
            }}
          >
            {error?.stack}
          </Typography>

          {errorInfo?.componentStack && (
            <>
              <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
                {t('shared.feedback.errors.componentStack')}:
              </Typography>
              <Typography
                variant="caption"
                component="pre"
                sx={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  color: 'text.secondary',
                }}
              >
                {errorInfo.componentStack}
              </Typography>
            </>
          )}
        </Box>
      </Collapse>
    </Box>
  )
}

export const LightweightTrafficErrorBoundary: React.FC<{
  children: ReactNode
}> = ({ children }) => {
  const { t } = useTranslation()

  return (
    <TrafficErrorBoundary
      fallbackComponent={
        <Box
          sx={{
            p: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 60,
            bgcolor: 'error.light',
            borderRadius: 1,
            color: 'error.contrastText',
          }}
        >
          <ErrorOutlineRounded sx={{ mr: 1, fontSize: 20 }} />
          <Typography variant="caption">
            {t('shared.feedback.errors.trafficUnavailable')}
          </Typography>
        </Box>
      }
    >
      {children}
    </TrafficErrorBoundary>
  )
}
