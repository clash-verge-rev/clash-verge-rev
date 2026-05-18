/**
 * 懒加载组件优化工具库
 *
 * 策略:
 * - 对大型库使用动态导入（Monaco Editor）
 * - 对路由组件使用 React.lazy
 * - 实现加载状态和错误处理
 * - 使用 Suspense 显示加载指示器
 */

import React, { ComponentType, Suspense, lazy } from 'react'

/**
 * 动态导入 React 组件
 *
 * 使用方法:
 * ```typescript
 * const LazyComponent = dynamicImport(() => import('./Component'))
 * ```
 */
export function dynamicImport<P extends object = object>(
  importFn: () => Promise<any>,
): ComponentType<P> {
  return lazy(() =>
    importFn().then((module) => ({
      default: module.default || module,
    }))
  )
}

/**
 * 带加载状态的懒加载包装
 *
 * 使用方法:
 * ```typescript
 * const SafeLazyComponent = withLazyLoading(
 *   () => import('./Component'),
 *   <LoadingSpinner />
 * )
 * ```
 */
export function withLazyLoading<P extends object = object>(
  importFn: () => Promise<any>,
  fallback?: React.ReactNode,
): ComponentType<P> {
  const Component = lazy(() =>
    importFn().then((module) => ({
      default: module.default || module,
    }))
  )

  return (props: P) => (
    <Suspense fallback={fallback || <div>Loading...</div>}>
      <Component {...props} />
    </Suspense>
  )
}

/**
 * 预加载组件（在后台加载，但不立即渲染）
 *
 * 使用方法:
 * ```typescript
 * // 在用户可能需要前提前加载
 * preloadComponent(() => import('./ExpensiveComponent'))
 * ```
 */
export function preloadComponent(
  importFn: () => Promise<any>,
): Promise<void> {
  return importFn().then(() => {
    console.debug('[LazyLoad] Component preloaded')
  })
}

/**
 * 条件懒加载 - 根据条件决定是否加载
 *
 * 使用方法:
 * ```typescript
 * const LazyComponent = conditionalLazy(
 *   () => showAdvancedFeatures,
 *   () => import('./AdvancedFeature')
 * )
 * ```
 */
export function conditionalLazy<P extends object>(
  condition: boolean | (() => boolean),
  importFn: () => Promise<{ default: ComponentType<P> }>,
): ComponentType<P> | null {
  const shouldLoad = typeof condition === 'function' ? condition() : condition

  if (!shouldLoad) {
    return null
  }

  return lazy(importFn)
}

/**
 * 批量预加载组件
 *
 * 使用方法:
 * ```typescript
 * preloadComponents([
 *   () => import('./Component1'),
 *   () => import('./Component2'),
 *   () => import('./Component3'),
 * ])
 * ```
 */
export async function preloadComponents(
  importFns: Array<() => Promise<any>>,
): Promise<void[]> {
  const results = await Promise.allSettled(importFns.map((fn) => fn()))

  const successes = results.filter((r) => r.status === 'fulfilled').length
  const failures = results.filter((r) => r.status === 'rejected').length

  console.debug(
    `[LazyLoad] Preloaded ${successes} components, ${failures} failed`,
  )

  return results.map(() => undefined)
}

/**
 * 监测代码分割的大小
 *
 * 使用方法:
 * ```typescript
 * const LazyComponent = trackChunkSize(
 *   'MonacoEditor',
 *   () => import('./components/MonacoEditor')
 * )
 * ```
 */
export function trackChunkSize<P extends object>(
  chunkName: string,
  importFn: () => Promise<{ default: ComponentType<P> }>,
): ComponentType<P> {
  console.debug(`[ChunkSize] Loading chunk: ${chunkName}`)

  return lazy(async () => {
    const startTime = performance.now()
    const result = await importFn()
    const duration = performance.now() - startTime

    console.debug(
      `[ChunkSize] Chunk loaded: ${chunkName} (${duration.toFixed(0)}ms)`,
    )

    return result
  })
}

// ============ 预定义的懒加载组件 ============

/**
 * 懒加载 Monaco Editor
 *
 * 说明: Monaco Editor 是一个大型库 (~2MB)，
 * 不应该在应用启动时加载
 */
export const LazyMonacoEditor = dynamicImport(() =>
  import('@/components/base/monaco-editor'),
)

/**
 * 懒加载设置面板的高级选项
 */
export const LazySettingsAdvanced = dynamicImport(() =>
  import('@/components/setting/setting-verge-advanced'),
)

/**
 * 懒加载测试功能
 */
export const LazyTestBox = dynamicImport(() =>
  import('@/components/test/test-box'),
)

// ============ 路由组件懒加载 ============

/**
 * 为路由组件启用代码分割
 *
 * 使用方法:
 * ```typescript
 * import { createBrowserRouter } from 'react-router-dom'
 * import { createLazyRouteComponent } from '@/utils/lazy-load'
 *
 * const routes = [
 *   {
 *     path: '/profiles',
 *     Component: createLazyRouteComponent(() => import('../pages/profiles')),
 *   },
 * ]
 * ```
 */
export function createLazyRouteComponent(
  importFn: () => Promise<{ default: ComponentType<any> }>,
): ComponentType<any> {
  return withLazyLoading(importFn, <div>加载中...</div>)
}
