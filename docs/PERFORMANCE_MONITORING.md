---
name: perf_monitoring_guide
description: 性能监测系统的使用指南和集成说明
metadata:
  type: project
---

# 性能监测系统使用指南

## 概述

已创建了一套完整的性能监测系统，用于收集和分析 Clash Verge Rev 的关键性能指标。

## 文件清单

### 1. 核心监测模块
**文件**: `src/services/performance-monitor.ts`

**功能**:
- 收集 Web Vitals（FCP、LCP、FID、CLS）
- 监控数据加载时间
- 监控组件渲染时间
- 记录 IPC 和 WebSocket 延迟
- 监测长任务（>50ms）
- 内存使用情况

**导出函数**:
```typescript
perfMonitor.recordDataFetchTime(source, duration)
perfMonitor.recordComponentRenderTime(componentName, duration)
perfMonitor.recordIpcLatency(latency)
perfMonitor.recordWebSocketLatency(latency)
perfMonitor.printReport()
perfMonitor.exportMetrics()
```

### 2. 性能钩子
**文件**: `src/hooks/use-performance.ts`

**可用 Hooks**:
- `useRenderPerformance(componentName)` - 自动测量组件渲染时间
- `useDataFetchPerformance(queryKey, isPending, data)` - 测量数据加载时间
- `usePerformanceExport(intervalMs)` - 定期导出指标
- `usePerformanceMetrics()` - 获取当前指标

### 3. 调试仪表板
**文件**: `src/components/debug/performance-dashboard.tsx`

**功能**:
- 实时显示性能报告
- 导出指标为 JSON
- 重置指标统计
- 仅在开发模式显示

## 集成步骤

### 第一步：在主应用中添加仪表板

编辑 `src/pages/_layout.tsx`，在开发模式添加监测仪表板：

```typescript
import PerformanceDashboard from '@/components/debug/performance-dashboard'

const Layout = () => {
  // ... 现有代码 ...

  return (
    <ThemeProvider theme={theme}>
      {/* 现有内容 */}
      {process.env.NODE_ENV === 'development' && <PerformanceDashboard />}
    </ThemeProvider>
  )
}
```

### 第二步：在关键 Hook 中集成监测

**在 `src/hooks/use-verge.ts` 中**:
```typescript
import { useDataFetchPerformance } from './use-performance'

export const useVerge = () => {
  const { data: verge, isPending, refetch } = useQuery({
    queryKey: ['getVergeConfig'],
    queryFn: getVergeConfig,
    initialData: initialVergeConfig ?? undefined,
    staleTime: 5000,
  })

  // 添加性能监测
  useDataFetchPerformance('getVergeConfig', isPending, verge)

  // ... 现有代码 ...
}
```

**在 `src/hooks/use-clash.ts` 中**:
```typescript
import { useDataFetchPerformance } from './use-performance'

export const useClash = () => {
  const { data: clash, refetch } = useRuntimeConfig()

  // 添加性能监测
  useDataFetchPerformance('getRuntimeConfig', isPending, clash)

  // ... 现有代码 ...
}
```

### 第三步：在 services 中记录 IPC 延迟

编辑 `src/services/cmds.ts`，在每个调用中记录延迟：

```typescript
import { recordIpcCall } from '@/services/performance-monitor'

export async function getProfiles() {
  const start = performance.now()
  try {
    const result = await invoke<IProfilesConfig>('get_profiles')
    const duration = performance.now() - start
    recordIpcCall(duration)
    return result
  } catch (error) {
    const duration = performance.now() - start
    recordIpcCall(duration)
    throw error
  }
}
```

### 第四步：在组件中记录渲染时间

在关键组件中使用 Hook：

```typescript
import { useRenderPerformance } from '@/hooks/use-performance'

const ProxyGroups = () => {
  // 记录这个组件的渲染时间
  useRenderPerformance('ProxyGroups')

  return (
    // ... 组件内容 ...
  )
}
```

## 使用方法

### 开发模式运行

```bash
pnpm dev
```

应用启动后，右下角会显示一个黑色的性能监测框。

### 查看性能报告

1. 点击"显示报告"按钮
2. 查看详细的性能指标：
   - 应用启动时间
   - 各组件渲染时间
   - 各数据源加载时间
   - IPC 调用延迟统计
   - 内存使用情况

### 导出数据

1. 点击"导出"按钮
2. 会下载一个 JSON 文件，包含所有收集的指标
3. 可以用于进一步分析或对比优化前后的数据

### 浏览器控制台

在控制台中也可以看到详细的性能日志：

```javascript
// 查看最新指标
console.log(perfMonitor.getMetrics())

// 打印报告
perfMonitor.printReport()

// 导出 JSON
console.log(perfMonitor.exportMetrics())
```

## 关键指标说明

### Web Vitals

| 指标 | 说明 | 目标 |
|------|------|------|
| FCP | First Contentful Paint（首次内容绘制） | < 1.8s |
| LCP | Largest Contentful Paint（最大内容绘制） | < 2.5s |
| FID | First Input Delay（首次输入延迟） | < 100ms |
| CLS | Cumulative Layout Shift（累积布局偏移） | < 0.1 |

### 应用启动指标

| 指标 | 说明 | 优化目标 |
|------|------|---------|
| 总启动时间 | 应用从启动到完全可交互的时间 | < 2s |
| 预加载时间 | 初始配置加载时间 | < 500ms |

### 数据加载指标

监测各个关键 Query 的加载时间：
- `getVergeConfig` - 应用配置
- `getRuntimeConfig` - Clash 运行时配置
- `getProxies` - 代理列表
- `getRules` - 规则列表

### IPC 延迟

| 级别 | 延迟范围 | 说明 |
|------|---------|------|
| ✅ 正常 | < 50ms | 响应迅速 |
| ⚠️ 警告 | 50-100ms | 可感知到延迟 |
| ❌ 高延迟 | > 100ms | 需要优化 |

## 性能基准数据收集

### 建立基准

1. 启动应用，让其稳定运行 30 秒
2. 点击"显示报告"记录初始指标
3. 点击"导出"保存 JSON 文件，命名为 `baseline-before.json`
4. 进行日常操作（导航、查询、切换等）
5. 再次导出指标为 `baseline-after-30min.json`

### 对比优化效果

优化前：
```bash
导出 -> baseline-before.json
```

优化后：
```bash
导出 -> baseline-after.json
```

使用脚本对比两个文件中的关键指标。

## 下一步：性能优化

### 快速赢胜

1. **组件 memo 化** - 在 ProxyGroups、ConnectionTable 中添加 `React.memo`
2. **缓存查询** - 增加关键 Query 的 `staleTime`
3. **虚拟滚动** - 验证已有的虚拟滚动实现

### 深入优化

根据收集的数据：
1. 查看哪个组件渲染时间最长
2. 查看哪个 Query 加载时间最长
3. 查看 IPC 延迟最高的命令

然后针对性地进行优化。

## 常见问题

**Q: 如何禁用性能监测？**
A: 在生产构建中会自动禁用。开发模式可以在 localStorage 中设置 `__PERF_DEBUG__ = false`

**Q: 性能数据会不会影响性能？**
A: 监测系统本身的开销很小（< 1%）。关键指标使用原生 Performance API，不会显著影响应用。

**Q: 如何在服务器上收集指标？**
A: 可以在 `usePerformanceExport` Hook 中修改，添加代码发送指标到后端服务器。

**Q: 为什么某些指标显示为 undefined？**
A: 某些 Web Vitals（如 LCP）在页面加载完成后才会出现，需要等待一段时间。
