/**
 * 性能监测仪表板 - 显示关键性能指标
 * 仅在开发模式显示
 */
import { useState } from 'react'
import { printPerfReport, perfMonitor } from '@/services/performance-monitor'

const PerformanceDashboard = () => {
  const [isVisible, setIsVisible] = useState(false)
  const [report, setReport] = useState<any>(null)

  const handleShowReport = () => {
    const newReport = printPerfReport()
    setReport(newReport)
    setIsVisible(true)
  }

  const handleExport = () => {
    const metrics = perfMonitor.exportMetrics()
    const blob = new Blob([metrics], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `perf-metrics-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleReset = () => {
    perfMonitor.reset()
    setReport(null)
    console.info('Performance metrics reset')
  }

  if (process.env.NODE_ENV !== 'development' && !window.__PERF_DEBUG__) {
    return null
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 9999,
        backgroundColor: '#1a1a1a',
        color: '#fff',
        borderRadius: '8px',
        padding: '12px',
        fontSize: '12px',
        fontFamily: 'monospace',
        maxWidth: '400px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}
    >
      <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>📊 性能监测</div>

      {!isVisible ? (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={handleShowReport}
            style={{
              padding: '4px 8px',
              backgroundColor: '#0066cc',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
            }}
          >
            显示报告
          </button>
          <button
            onClick={handleExport}
            style={{
              padding: '4px 8px',
              backgroundColor: '#00aa00',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
            }}
          >
            导出
          </button>
          <button
            onClick={handleReset}
            style={{
              padding: '4px 8px',
              backgroundColor: '#aa0000',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
            }}
          >
            重置
          </button>
        </div>
      ) : (
        <div
          style={{
            maxHeight: '300px',
            overflowY: 'auto',
            marginBottom: '8px',
            backgroundColor: '#0a0a0a',
            padding: '8px',
            borderRadius: '4px',
          }}
        >
          {report && (
            <pre
              style={{
                margin: '0',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: '10px',
                lineHeight: '1.4',
              }}
            >
              {JSON.stringify(report, null, 2)}
            </pre>
          )}
        </div>
      )}

      <button
        onClick={() => setIsVisible(!isVisible)}
        style={{
          width: '100%',
          padding: '4px',
          backgroundColor: '#333',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '11px',
        }}
      >
        {isVisible ? '收起' : '详情'}
      </button>
    </div>
  )
}

export default PerformanceDashboard
