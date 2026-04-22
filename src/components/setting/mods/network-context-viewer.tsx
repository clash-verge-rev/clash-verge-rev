import {
  CheckCircleOutlineRounded,
  HighlightOffRounded,
  RefreshRounded,
} from '@mui/icons-material'
import {
  Box,
  Chip,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listen } from '@tauri-apps/api/event'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getNetworkContext } from 'tauri-plugin-mihomo-api'

import { BaseDialog, type DialogRef } from '@/components/base'

// `tauri-plugin-mihomo-api` 发布的 `NetworkContext` TS binding 仍是旧 shape
// （单 `primaryIface`），而 mihomo kernel 返回的 runtime JSON 是新 shape
// （`interfaces[]`）。在 plugin npm 包同步升级 binding 之前，本文件就地声明
// 新 shape 并对 `data.context` 做 `as unknown as` 的本地重投影；plugin 发布新
// `NetworkContext.d.ts` 后可直接删除 `INetworkContextV2` / `IInterfaceContextV2`。
interface IInterfaceContextV2 {
  name: string
  iface_type?: string
  ssid?: string
  bssid?: string
  gateway_ip?: string
  gateway_mac?: string
  subnets?: string[]
  metered?: boolean | null
}

interface INetworkContextV2 {
  version: number
  interfaces?: IInterfaceContextV2[]
  dns_suffix?: string[]
  ttl?: number | null
}

const NETWORK_CONTEXT_QUERY_KEY = ['getNetworkContext'] as const
const MAX_INTERFACE_ROWS = 8
const CHIP_MAX_WIDTH = 240

/**
 * 虚拟桥 iface 名称正则——与后端 `src-tauri/src/module/netmon/context.rs` 的
 * `VIRTUAL_BRIDGE_RE` 保持一致。匹配到的 iface 会在诊断面板中分到"虚拟接口"
 * 分表，与物理接口分开展示。后端正则改动时务必同步更新此处。
 */
const BRIDGE_NAME_RE = /^(docker|br-|veth|vmnet|vEthernet|virbr|vnic)/

interface IIfaceTableProps {
  title: string
  rows: IInterfaceContextV2[]
  extra: number
  showEmptyRow: boolean
}

/**
 * 统一渲染物理接口 / 虚拟接口两个分表——列相同、头部标题不同。Gateway 单元格
 * 上下两行放 IP / MAC，方便用户一眼读到完整的 gateway 身份；IP 或 MAC 缺失
 * 时各自以 "—" 占位，不影响另一行。"+N more" 溢出提示只在该表实际被截断时
 * 显示；空态（showEmptyRow=true）用于物理表——"没有接口"是诊断有价值的信号,
 * 虚拟表没有就整表不渲染（见 caller）。
 *
 * 组件内部自行调 useTranslation 拿 t——project 的 i18next typed keys 不接
 * 通过 prop 传递 TFunction（TypeScript 无法在 prop 签名里推断所有字面量 key
 * 到 typed selector 的转换）。
 */
const IfaceTable = ({ title, rows, extra, showEmptyRow }: IIfaceTableProps) => {
  const { t } = useTranslation()
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>
              {t('settings.sections.clash.diagnostic.columns.name')}
            </TableCell>
            <TableCell>
              {t('settings.sections.clash.diagnostic.columns.type')}
            </TableCell>
            <TableCell>
              {t('settings.sections.clash.diagnostic.columns.ssid')}
            </TableCell>
            <TableCell>
              {t('settings.sections.clash.diagnostic.columns.gateway')}
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((iface) => (
            <TableRow key={iface.name}>
              <TableCell>{iface.name}</TableCell>
              <TableCell>{iface.iface_type ?? '—'}</TableCell>
              <TableCell>{iface.ssid ?? '—'}</TableCell>
              <TableCell>
                {/* IP (body2) + MAC (caption) 叠两行。Typography 各自 variant
                  自带 lineHeight（body2=1.43 / caption=1.66）足以隔开，
                  Stack 不再叠加 `lineHeight` sx——那会被 Typography 的 class
                  直接覆盖，是无实效的 dead style。 */}
                <Stack spacing={0}>
                  <Typography variant="body2" component="span">
                    {iface.gateway_ip ?? '—'}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    component="span"
                  >
                    {iface.gateway_mac ?? '—'}
                  </Typography>
                </Stack>
              </TableCell>
            </TableRow>
          ))}
          {showEmptyRow && (
            <TableRow>
              <TableCell colSpan={4} align="center">
                <Typography variant="caption" color="text.secondary">
                  —
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {extra > 0 && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 1 }}
        >
          {t('settings.sections.clash.diagnostic.labels.moreIfaces', {
            n: extra,
          })}
        </Typography>
      )}
    </Box>
  )
}

export const NetworkContextViewer = forwardRef<DialogRef>((_, ref) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }))

  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: NETWORK_CONTEXT_QUERY_KEY,
    queryFn: getNetworkContext,
    enabled: open,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 0,
  })

  useEffect(() => {
    if (!open) return
    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey: NETWORK_CONTEXT_QUERY_KEY })
    const unlisten = listen('verge://network-context-updated', invalidate)
    return () => {
      unlisten.then((fn) => fn()).catch(() => {})
    }
  }, [open, queryClient])

  // Runtime guard：plugin 发布的 NetworkContext binding 仍是旧 shape，我们信赖
  // runtime JSON 为新 shape，但通过 `Array.isArray(...interfaces)` 守住最基本的
  // 结构假设。若 mihomo 回滚或返回异常 payload（`data.context` 存在但 shape 不符），
  // 整条新 shape 渲染链路短路：接口表为空、`hasContext` 视为 false、底部显示
  // `noContext` hint。这样用户看到的是一致的"当前没有可识别的网络环境"，不会
  // 出现"勾选 has context 但接口表空"的视觉矛盾。
  //
  // 可选字段也要校验为 string：下方表格把 `iface_type` / `ssid` / `gateway_ip`
  // / `gateway_mac` 直接作为 React child 渲染，若 payload 漂移为 `gateway_mac:
  // {}` / `ssid: 123` 等非 string 值，React 会抛 "Objects are not valid as a
  // React child"。按"所有被渲染字段必须是 string | null | undefined"的契约统
  // 一校验，malformed 时整个 v2Valid=false → interfaces=[] → UI 走 noContext。
  const ctxRaw = data?.context as unknown as INetworkContextV2 | null
  const isOptionalString = (v: unknown): v is string | null | undefined =>
    v == null || typeof v === 'string'
  const v2Valid =
    !!ctxRaw &&
    Array.isArray(ctxRaw.interfaces) &&
    ctxRaw.interfaces.every(
      (iface) =>
        iface !== null &&
        typeof iface === 'object' &&
        typeof iface.name === 'string' &&
        isOptionalString(iface.iface_type) &&
        isOptionalString(iface.ssid) &&
        isOptionalString(iface.gateway_ip) &&
        isOptionalString(iface.gateway_mac),
    )
  const interfaces = v2Valid ? (ctxRaw?.interfaces ?? []) : []
  // 按名称正则分两组：物理接口 + 虚拟桥（docker/br-*/veth/vmnet/vEthernet/virbr/vnic）。
  // 后端默认不上报虚拟桥；用户开了 enable_virtual_iface_reporting 后才会有内容。
  const physicalIfaces = interfaces.filter(
    (iface) => !BRIDGE_NAME_RE.test(iface.name),
  )
  const virtualIfaces = interfaces.filter((iface) =>
    BRIDGE_NAME_RE.test(iface.name),
  )
  const displayedPhysical = physicalIfaces.slice(0, MAX_INTERFACE_ROWS)
  const extraPhysical = physicalIfaces.length - displayedPhysical.length
  const displayedVirtual = virtualIfaces.slice(0, MAX_INTERFACE_ROWS)
  const extraVirtual = virtualIfaces.length - displayedVirtual.length
  // dns_suffix guard 与 interfaces 一致走逐项结构校验：只是 `Array.isArray`
  // 不够——若 plugin binding / kernel payload 漂移，`[null]` / `[{}]` 会在
  // 下方 Chip `label={suffix}` 处触发 React 的 "Objects are not valid as a
  // React child"。严格过滤非 string 元素，malformed 时视同空，让 UI 走 '—'
  // 空态，与 v2Valid 走 noContext hint 的降级一致。
  const dnsSuffix: string[] =
    v2Valid &&
    Array.isArray(ctxRaw?.dns_suffix) &&
    ctxRaw.dns_suffix.every((s): s is string => typeof s === 'string')
      ? ctxRaw.dns_suffix
      : []
  // matched 只在 shape guard 通过时展示——malformed payload 下硬展示 mihomo
  // 返回的 matchedNetwork 会和空接口表形成矛盾。
  const matched = v2Valid ? (data?.matchedNetwork ?? null) : null
  const age =
    typeof data?.ageSeconds === 'number' && Number.isFinite(data.ageSeconds)
      ? Math.max(0, Math.floor(data.ageSeconds))
      : null
  // 绑定到 v2Valid：v2Valid=false 时说明 CVR 无法识别 payload，功能等价于
  // "没收到可用的 context"，UI 走 noContext 分支给出一致反馈。
  const hasContext = v2Valid
  const errMsg =
    error instanceof Error ? error.message : error ? String(error) : null

  const close = () => setOpen(false)
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: NETWORK_CONTEXT_QUERY_KEY })

  return (
    <BaseDialog
      open={open}
      title={t('settings.sections.clash.diagnostic.title')}
      onClose={close}
      onCancel={close}
      disableOk
      cancelBtn={t('shared.actions.close')}
    >
      <Stack
        spacing={2}
        sx={{
          minWidth: 480,
          // 让表格里的 IP/MAC/SSID 等诊断字段可以被用户选中复制出来排查问题；
          // 按钮和 chip 保持 MUI 默认的 user-select: none 不受影响（它们自己
          // 的样式优先级更高）。
          userSelect: 'text',
        }}
      >
        {/* 顶部工具行始终保留——错误态用户仍能点 refresh 自恢复 */}
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          {!errMsg && (
            <>
              <Typography variant="body2" color="text.secondary">
                {t('settings.sections.clash.diagnostic.labels.matched')}:
              </Typography>
              {matched ? (
                <Tooltip title={matched} placement="top" disableInteractive>
                  <Chip
                    size="small"
                    color="success"
                    label={matched}
                    sx={{ maxWidth: CHIP_MAX_WIDTH }}
                  />
                </Tooltip>
              ) : (
                <Chip
                  size="small"
                  color="warning"
                  label={t(
                    'settings.sections.clash.diagnostic.labels.unmatched',
                  )}
                />
              )}
              {age !== null && (
                <Typography variant="caption" color="text.secondary">
                  {t('settings.sections.clash.diagnostic.labels.ageSeconds', {
                    n: age,
                  })}
                </Typography>
              )}
            </>
          )}
          <Box sx={{ flex: 1 }} />
          <IconButton
            size="small"
            disabled={isFetching}
            onClick={refresh}
            aria-label={t('shared.actions.refresh')}
          >
            <RefreshRounded fontSize="small" />
          </IconButton>
        </Stack>

        {errMsg ? (
          <Typography variant="body2" color="error">
            {t('settings.sections.clash.diagnostic.hints.fetchFailed')}
            {': '}
            {errMsg}
          </Typography>
        ) : (
          <>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              {hasContext ? (
                <CheckCircleOutlineRounded color="success" fontSize="small" />
              ) : (
                <HighlightOffRounded color="warning" fontSize="small" />
              )}
              <Typography variant="caption">
                {t('settings.sections.clash.diagnostic.labels.hasContext')}
              </Typography>
            </Stack>

            <IfaceTable
              title={t('settings.sections.clash.diagnostic.labels.interfaces')}
              rows={displayedPhysical}
              extra={extraPhysical}
              showEmptyRow={!isLoading && physicalIfaces.length === 0}
            />

            {/* 虚拟接口表：仅在有数据时才出现。用户默认不开启
                enable_virtual_iface_reporting 时此表常为空且不渲染，避免在
                "普通用户"场景下制造额外的 UI 噪音。 */}
            {virtualIfaces.length > 0 && (
              <IfaceTable
                title={t(
                  'settings.sections.clash.diagnostic.labels.virtualInterfaces',
                )}
                rows={displayedVirtual}
                extra={extraVirtual}
                showEmptyRow={false}
              />
            )}

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('settings.sections.clash.diagnostic.labels.dnsSuffix')}
              </Typography>
              {dnsSuffix.length > 0 ? (
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{ flexWrap: 'wrap', gap: 0.5 }}
                >
                  {dnsSuffix.map((suffix) => (
                    <Chip
                      key={suffix}
                      size="small"
                      variant="outlined"
                      label={suffix}
                      sx={{ maxWidth: CHIP_MAX_WIDTH }}
                    />
                  ))}
                </Stack>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  —
                </Typography>
              )}
            </Box>

            {/* 提示优先级：noContext > unmatched。hasContext=false 必然 matched=null，
                两条同时显示会让用户困惑根因；此时只显示根因更友好。 */}
            {data && !hasContext ? (
              <Typography variant="caption" color="warning.main">
                {t('settings.sections.clash.diagnostic.hints.noContext')}
              </Typography>
            ) : data && !matched ? (
              <Typography variant="caption" color="warning.main">
                {t('settings.sections.clash.diagnostic.hints.unmatched')}
              </Typography>
            ) : null}
          </>
        )}
      </Stack>
    </BaseDialog>
  )
})

NetworkContextViewer.displayName = 'NetworkContextViewer'
