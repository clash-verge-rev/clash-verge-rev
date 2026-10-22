import { ReactNode } from 'react'
import { ErrorBoundary, FallbackProps } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

function ErrorFallback({ error }: FallbackProps) {
  const { t } = useTranslation()
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorStack = error instanceof Error ? error.stack : undefined

  return (
    <div role="alert" style={{ padding: 16 }}>
      <h4>{t('shared.feedback.errors.unexpected')}</h4>

      <pre>{errorMessage}</pre>

      <details title={t('shared.feedback.errors.stack')}>
        <summary>{t('shared.feedback.errors.stack')}</summary>
        <pre>{errorStack}</pre>
      </details>
    </div>
  )
}

interface Props {
  children?: ReactNode
}

export const BaseErrorBoundary = ({ children }: Props) => {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>{children}</ErrorBoundary>
  )
}
