import {
  AccessTimeOutlined,
  CancelOutlined,
  CheckCircleOutlined,
  HelpOutlined,
  PendingOutlined,
  RefreshRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { Channel, invoke } from '@tauri-apps/api/core'
import { useLockFn } from 'ahooks'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseEmpty, BasePage } from '@/components/base'
import { showNotice } from '@/services/notice-service'

interface UnlockItem {
  name: string
  status: string
  region?: string | null
  check_time?: string | null
}

const UNLOCK_RESULTS_STORAGE_KEY = 'clash_verge_unlock_results'

const STATUS_LABEL_KEYS: Record<string, string> = {
  Pending: 'tests.statuses.test.pending',
  Yes: 'tests.statuses.test.yes',
  No: 'tests.statuses.test.no',
  Failed: 'tests.statuses.test.failed',
  Completed: 'tests.statuses.test.completed',
  'Disallowed ISP': 'tests.statuses.test.disallowedIsp',
  'Originals Only': 'tests.statuses.test.originalsOnly',
  'No (IP Banned By Disney+)': 'tests.statuses.test.noDisney',
  'Unsupported Country/Region': 'tests.statuses.test.unsupportedRegion',
  'Failed (Network Connection)': 'tests.statuses.test.failedNetwork',
}

const normalizeUnlockName = (name: string) => name.trim().toLowerCase()

const getStatusPriority = (status: string) => (status === 'Pending' ? 0 : 1)
const mergeOptionalFields = (preferred: UnlockItem, fallback: UnlockItem) => ({
  ...preferred,
  region: preferred.region ?? fallback.region,
  check_time: preferred.check_time ?? fallback.check_time,
})

const dedupeUnlockItems = (items: UnlockItem[]) => {
  const map = new Map<string, UnlockItem>()

  items.forEach((item) => {
    const key = normalizeUnlockName(item.name)
    const existing = map.get(key)

    if (!existing) {
      map.set(key, item)
      return
    }

    const existingPriority = getStatusPriority(existing.status)
    const itemPriority = getStatusPriority(item.status)

    if (itemPriority > existingPriority) {
      map.set(key, mergeOptionalFields(item, existing))
      return
    }

    if (itemPriority < existingPriority) {
      map.set(key, mergeOptionalFields(existing, item))
      return
    }

    map.set(key, mergeOptionalFields(item, existing))
  })

  return Array.from(map.values())
}

const UnlockPage = () => {
  const { t } = useTranslation()
  const theme = useTheme()

  const [unlockItems, setUnlockItems] = useState<UnlockItem[]>([])
  const [isCheckingAll, setIsCheckingAll] = useState(false)
  const [loadingItems, setLoadingItems] = useState<string[]>([])

  const saveResultsToStorage = (items: UnlockItem[]) => {
    try {
      localStorage.setItem(UNLOCK_RESULTS_STORAGE_KEY, JSON.stringify(items))
    } catch (err) {
      console.error('Failed to save results to storage:', err)
    }
  }

  useEffect(() => {
    let storedItems: UnlockItem[] = []
    try {
      const itemsJson = localStorage.getItem(UNLOCK_RESULTS_STORAGE_KEY)
      if (itemsJson) {
        storedItems = dedupeUnlockItems(JSON.parse(itemsJson) as UnlockItem[])
      }
    } catch (err) {
      console.error('Failed to load results from storage:', err)
    }

    void (async () => {
      try {
        const defaultItems = await invoke<UnlockItem[]>('get_unlock_items')
        const existingMap = new Map(
          storedItems.map((item) => [normalizeUnlockName(item.name), item]),
        )
        const mergedItems = defaultItems.map((item) => {
          const matchedItem = existingMap.get(normalizeUnlockName(item.name))
          return matchedItem ? { ...matchedItem, name: item.name } : item
        })

        setUnlockItems(mergedItems.sort((a, b) => a.name.localeCompare(b.name)))
      } catch (err: any) {
        console.error('Failed to get unlock items:', err)
      }
    })()
  }, [])

  // 执行全部项目检测
  const checkAllMedia = useLockFn(async () => {
    const onComplete = new Channel<UnlockItem>((result) => {
      setUnlockItems((items) =>
        items.map((item) => (item.name === result.name ? result : item)),
      )
      setLoadingItems((items) => items.filter((name) => name !== result.name))
    })

    try {
      setIsCheckingAll(true)
      setLoadingItems(unlockItems.map((item) => item.name))
      const result = await invoke<UnlockItem[]>('check_media_unlock', {
        onComplete,
      })
      const sortedItems = result.sort((a, b) => a.name.localeCompare(b.name))

      setUnlockItems(sortedItems)
      saveResultsToStorage(sortedItems)
    } catch (err: any) {
      showNotice.error('tests.unlock.page.messages.detectionTimeout', err)
      console.error('Failed to check media unlock:', err)
    } finally {
      setLoadingItems([])
      setIsCheckingAll(false)
    }
  })

  // 检测单个流媒体服务
  const checkSingleMedia = useLockFn(async (name: string) => {
    setLoadingItems([name])
    try {
      const result = await invoke<UnlockItem>('check_media_unlock_item', {
        name,
      })
      const updatedItems = unlockItems.map((item) =>
        item.name === name ? result : item,
      )

      setUnlockItems(updatedItems)
      saveResultsToStorage(updatedItems)
    } catch (err: any) {
      showNotice.error(
        'tests.unlock.page.messages.detectionFailedWithName',
        { name },
        err,
      )
      console.error(`Failed to check ${name}:`, err)
    } finally {
      setLoadingItems([])
    }
  })

  // 状态颜色
  const getStatusColor = (status: string) => {
    if (status === 'Pending') return 'default'
    if (status === 'Yes') return 'success'
    if (status === 'No') return 'error'
    if (status === 'Soon') return 'warning'
    if (status.includes('Failed')) return 'error'
    if (status === 'Completed') return 'info'
    if (
      status === 'Disallowed ISP' ||
      status === 'Blocked' ||
      status === 'Unsupported Country/Region'
    ) {
      return 'error'
    }
    return 'default'
  }

  // 状态图标
  const getStatusIcon = (status: string) => {
    if (status === 'Pending') return <PendingOutlined />
    if (status === 'Yes') return <CheckCircleOutlined />
    if (status === 'No') return <CancelOutlined />
    if (status === 'Soon') return <AccessTimeOutlined />
    return <HelpOutlined />
  }

  // 边框色
  const getStatusBorderColor = (status: string) => {
    if (status === 'Yes') return theme.palette.success.main
    if (status === 'No') return theme.palette.error.main
    if (status === 'Soon') return theme.palette.warning.main
    if (status.includes('Failed')) return theme.palette.error.main
    if (status === 'Completed') return theme.palette.info.main
    return theme.palette.divider
  }

  const isDark = theme.palette.mode === 'dark'

  return (
    <BasePage
      title={t('tests.unlock.page.title')}
      header={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button
            variant="contained"
            size="small"
            disabled={
              unlockItems.length === 0 ||
              isCheckingAll ||
              loadingItems.length > 0
            }
            onClick={checkAllMedia}
            startIcon={
              isCheckingAll ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <RefreshRounded />
              )
            }
          >
            {isCheckingAll
              ? t('tests.unlock.page.actions.testing')
              : t('tests.page.actions.testAll')}
          </Button>
        </Box>
      }
    >
      {unlockItems.length === 0 ? (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '50%',
          }}
        >
          <BaseEmpty textKey="tests.unlock.page.empty" />
        </Box>
      ) : (
        <Grid container spacing={1.5} columns={{ xs: 1, sm: 2, md: 3 }}>
          {unlockItems.map((item) => (
            <Grid size={1} key={item.name}>
              <Card
                variant="outlined"
                sx={{
                  height: '100%',
                  borderRadius: 2,
                  borderLeft: `4px solid ${getStatusBorderColor(item.status)}`,
                  backgroundColor: isDark ? '#282a36' : '#ffffff',
                  position: 'relative',
                  overflow: 'hidden',
                  '&:hover': {
                    backgroundColor: isDark
                      ? alpha(theme.palette.primary.dark, 0.05)
                      : alpha(theme.palette.primary.light, 0.05),
                  },
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <Box sx={{ p: 1.3, flex: 1 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Typography
                      variant="subtitle1"
                      sx={{
                        fontWeight: 600,
                        fontSize: '1rem',
                        color: 'text.primary',
                      }}
                    >
                      {item.name}
                    </Typography>
                    <Tooltip title={t('tests.components.item.actions.test')}>
                      <span>
                        <Button
                          size="small"
                          variant="outlined"
                          color="primary"
                          disabled={loadingItems.length > 0 || isCheckingAll}
                          sx={{
                            minWidth: '32px',
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                          }}
                          onClick={() => checkSingleMedia(item.name)}
                        >
                          <RefreshRounded
                            sx={{
                              animation: loadingItems.includes(item.name)
                                ? 'spin 1s linear infinite'
                                : 'none',
                              '@keyframes spin': {
                                '0%': { transform: 'rotate(0deg)' },
                                '100%': { transform: 'rotate(360deg)' },
                              },
                            }}
                          />
                        </Button>
                      </span>
                    </Tooltip>
                  </Box>

                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 1,
                    }}
                  >
                    <Chip
                      label={t(STATUS_LABEL_KEYS[item.status] ?? item.status)}
                      color={getStatusColor(item.status)}
                      size="small"
                      icon={getStatusIcon(item.status)}
                      sx={{
                        fontWeight:
                          item.status === 'Pending' ? 'normal' : 'bold',
                      }}
                    />

                    {item.region && (
                      <Chip
                        label={item.region}
                        size="small"
                        variant="outlined"
                        color="info"
                      />
                    )}
                  </Box>
                </Box>

                <Divider
                  sx={{
                    borderStyle: 'dashed',
                    borderColor: alpha(theme.palette.divider, 0.2),
                    mx: 1,
                  }}
                />

                <Box sx={{ px: 1.5, py: 0.2 }}>
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      color: 'text.secondary',
                      fontSize: '0.7rem',
                      textAlign: 'right',
                    }}
                  >
                    {item.check_time || '-- --'}
                  </Typography>
                </Box>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </BasePage>
  )
}

export default UnlockPage
