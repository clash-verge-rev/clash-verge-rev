/**
 * 流量统计诊断工具
 * 用于帮助开发者和用户诊断流量统计系统的性能和状态
 */

interface IDiagnosticReport {
  timestamp: string
  referenceCount: number
  samplerStats: {
    rawBufferSize: number
    compressedBufferSize: number
    compressionQueueSize: number
    totalMemoryPoints: number
  }
  performance: {
    memoryUsage: number // MB
    lastDataFreshness: boolean
    errorCount: number
  }
  recommendations: string[]
}

// 全局错误计数器
let globalErrorCount = 0

/**
 * 记录错误
 */
export function recordTrafficError(error: Error, component: string) {
  globalErrorCount++
  console.error(
    `[TrafficDiagnostics] ${component} 错误 (#${globalErrorCount}):`,
    error,
  )
}

/**
 * 获取内存使用情况（近似值）
 */
function getMemoryUsage(): number {
  if ('memory' in performance) {
    // @@ts-expect-error - 某些浏览器支持
    const memory = (performance as any).memory
    if (memory && memory.usedJSHeapSize) {
      return memory.usedJSHeapSize / 1024 / 1024 // 转换为MB
    }
  }
  return 0
}

/**
 * 生成诊断报告
 */
export function generateDiagnosticReport(
  referenceCount: number,
  samplerStats: any,
  isDataFresh: boolean,
): IDiagnosticReport {
  const memoryUsage = getMemoryUsage()
  const recommendations: string[] = []

  // 分析引用计数
  if (referenceCount === 0) {
    recommendations.push('✅ 没有组件在使用流量数据，数据收集已暂停')
  } else if (referenceCount > 3) {
    recommendations.push('⚠️ 有较多组件在使用流量数据，考虑优化组件数量')
  }

  // 分析内存使用
  const totalPoints = samplerStats.totalMemoryPoints || 0
  if (totalPoints > 1000) {
    recommendations.push('⚠️ 缓存的数据点过多，可能影响性能')
  } else if (totalPoints < 100) {
    recommendations.push('ℹ️ 数据点较少，这是正常情况')
  }

  // 分析压缩效率
  const compressionRatio =
    samplerStats.rawBufferSize > 0
      ? samplerStats.compressedBufferSize / samplerStats.rawBufferSize
      : 0
  if (compressionRatio > 0.5) {
    recommendations.push('⚠️ 数据压缩效率较低，可能需要调整压缩策略')
  } else if (compressionRatio > 0) {
    recommendations.push('✅ 数据压缩效率良好')
  }

  // 分析数据新鲜度
  if (!isDataFresh) {
    recommendations.push('⚠️ 数据不新鲜，可能存在网络问题或后端异常')
  }

  // 分析错误频率
  if (globalErrorCount > 10) {
    recommendations.push('🚨 错误频率过高，建议检查网络连接和后端服务')
  } else if (globalErrorCount > 0) {
    recommendations.push('ℹ️ 存在少量错误，这在网络波动时是正常的')
  }

  // 内存使用建议
  if (memoryUsage > 100) {
    recommendations.push('⚠️ JavaScript堆内存使用较高，可能影响性能')
  }

  return {
    timestamp: new Date().toISOString(),
    referenceCount,
    samplerStats,
    performance: {
      memoryUsage,
      lastDataFreshness: isDataFresh,
      errorCount: globalErrorCount,
    },
    recommendations,
  }
}

/**
 * 格式化诊断报告为可读字符串
 */
export function formatDiagnosticReport(report: IDiagnosticReport): string {
  return `
🔍 流量统计系统诊断报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 基本信息:
  • 生成时间: ${report.timestamp}
  • 活跃引用: ${report.referenceCount} 个组件
  • 数据新鲜度: ${report.performance.lastDataFreshness ? '✅ 新鲜' : '❌ 过期'}

💾 数据缓存状态:
  • 原始数据点: ${report.samplerStats.rawBufferSize}
  • 压缩数据点: ${report.samplerStats.compressedBufferSize}  
  • 压缩队列: ${report.samplerStats.compressionQueueSize}
  • 总内存点数: ${report.samplerStats.totalMemoryPoints}

⚡ 性能指标:
  • JS堆内存: ${report.performance.memoryUsage.toFixed(2)} MB
  • 累计错误: ${report.performance.errorCount} 次

💡 优化建议:
${report.recommendations.map((rec) => `  ${rec}`).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim()
}

/**
 * 自动诊断并打印报告
 */
export function runTrafficDiagnostics(
  referenceCount: number,
  samplerStats: any,
  isDataFresh: boolean,
): void {
  const report = generateDiagnosticReport(
    referenceCount,
    samplerStats,
    isDataFresh,
  )
  console.log(formatDiagnosticReport(report))
}

/**
 * 重置错误计数器
 */
export function resetErrorCount(): void {
  globalErrorCount = 0
  console.log('[TrafficDiagnostics] 错误计数器已重置')
}

// 导出到全局对象，方便在控制台调试
if (typeof window !== 'undefined') {
  ;(window as any).trafficDiagnostics = {
    generateDiagnosticReport,
    formatDiagnosticReport,
    runTrafficDiagnostics,
    resetErrorCount,
    recordTrafficError,
  }
}
