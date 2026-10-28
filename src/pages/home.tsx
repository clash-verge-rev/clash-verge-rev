import { DragDropProvider, KeyboardSensor, PointerSensor } from '@dnd-kit/react'
import {
  DnsOutlined,
  DragIndicatorRounded,
  HelpOutlineRounded,
  HistoryEduOutlined,
  RouterOutlined,
  SettingsOutlined,
  SpeedOutlined,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  Grid,
  type GridProps,
  IconButton,
  Skeleton,
  Tooltip,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import {
  type ReactNode,
  Suspense,
  lazy,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { BasePage, SortableItem } from '@/components/base'
import { ClashModeCard } from '@/components/home/clash-mode-card'
import { CurrentProxyCard } from '@/components/home/current-proxy-card'
import { EnhancedCard } from '@/components/home/enhanced-card'
import { EnhancedTrafficStats } from '@/components/home/enhanced-traffic-stats'
import { HomeProfileCard } from '@/components/home/home-profile-card'
import { ProxyTunCard } from '@/components/home/proxy-tun-card'
import { useProfiles } from '@/hooks/use-profiles'
import { useVerge } from '@/hooks/use-verge'
import { useNavMenuOrder } from '@/pages/_layout/hooks'
import { entry_lightweight_mode } from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'
import { openExternalUrl } from '@/utils/open-external-url'

const preloadTestCard = () =>
  import('@/components/home/test-card').then((module) => ({
    default: module.TestCard,
  }))
const preloadIpInfoCard = () =>
  import('@/components/home/ip-info-card').then((module) => ({
    default: module.IpInfoCard,
  }))
const preloadClashInfoCard = () =>
  import('@/components/home/clash-info-card').then((module) => ({
    default: module.ClashInfoCard,
  }))
const preloadSystemInfoCard = () =>
  import('@/components/home/system-info-card').then((module) => ({
    default: module.SystemInfoCard,
  }))

const LazyTestCard = lazy(preloadTestCard)
const LazyIpInfoCard = lazy(preloadIpInfoCard)
const LazyClashInfoCard = lazy(preloadClashInfoCard)
const LazySystemInfoCard = lazy(preloadSystemInfoCard)

// Used by bootstrap to initiate optional card imports without blocking render.
// eslint-disable-next-line react-refresh/only-export-components
export const preloadHomePageCards = () =>
  Promise.all([
    preloadTestCard().catch(() => {}),
    preloadIpInfoCard().catch(() => {}),
    preloadClashInfoCard().catch(() => {}),
    preloadSystemInfoCard().catch(() => {}),
  ])

// 定义首页卡片设置接口
interface HomeCardsSettings {
  profile: boolean
  proxy: boolean
  network: boolean
  mode: boolean
  traffic: boolean
  info: boolean
  clashinfo: boolean
  systeminfo: boolean
  test: boolean
  ip: boolean
  [key: string]: boolean
}

const DEFAULT_HOME_CARDS: HomeCardsSettings = {
  info: false,
  profile: true,
  proxy: true,
  network: true,
  mode: true,
  traffic: true,
  clashinfo: true,
  systeminfo: true,
  test: true,
  ip: true,
}

const HOME_CARD_KEYS = [
  'profile',
  'proxy',
  'network',
  'mode',
  'traffic',
  'test',
  'ip',
  'clashinfo',
  'systeminfo',
] as const

type HomeCardKey = (typeof HOME_CARD_KEYS)[number]

const CARD_SENSORS = [PointerSensor, KeyboardSensor]

const serializeCardFlags = (cards: HomeCardsSettings) =>
  Object.keys(cards)
    .sort()
    .map((key) => `${key}:${cards[key] ? 1 : 0}`)
    .join('|')

// 首页设置对话框组件接口
interface HomeSettingsDialogProps {
  onClose: () => void
  homeCards: HomeCardsSettings
}

// 首页设置对话框组件
const HomeSettingsDialog = ({
  onClose,
  homeCards,
}: HomeSettingsDialogProps) => {
  const { t } = useTranslation()
  const [cards, setCards] = useState<HomeCardsSettings>(homeCards)
  const [saving, setSaving] = useState(false)
  const { patchVerge } = useVerge()

  const handleToggle = (key: string) => {
    setCards((prev: HomeCardsSettings) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  const handleSave = useLockFn(async () => {
    setSaving(true)
    try {
      await patchVerge({ home_cards: cards })
      onClose()
    } catch (error) {
      showNotice.error(error)
    } finally {
      setSaving(false)
    }
  })

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('home.page.settings.title')}</DialogTitle>
      <DialogContent>
        <FormGroup>
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.profile || false}
                onChange={() => handleToggle('profile')}
              />
            }
            label={t('home.page.settings.cards.profile')}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.proxy || false}
                onChange={() => handleToggle('proxy')}
              />
            }
            label={t('home.page.settings.cards.currentProxy')}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.network || false}
                onChange={() => handleToggle('network')}
              />
            }
            label={t('home.page.settings.cards.network')}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.mode || false}
                onChange={() => handleToggle('mode')}
              />
            }
            label={t('home.page.settings.cards.proxyMode')}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.traffic || false}
                onChange={() => handleToggle('traffic')}
              />
            }
            label={t('home.page.settings.cards.traffic')}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.test || false}
                onChange={() => handleToggle('test')}
              />
            }
            label={t('home.page.settings.cards.tests')}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.ip || false}
                onChange={() => handleToggle('ip')}
              />
            }
            label={t('home.page.settings.cards.ip')}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.clashinfo || false}
                onChange={() => handleToggle('clashinfo')}
              />
            }
            label={t('home.page.settings.cards.clashInfo')}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.systeminfo || false}
                onChange={() => handleToggle('systeminfo')}
              />
            }
            label={t('home.page.settings.cards.systemInfo')}
          />
        </FormGroup>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('shared.actions.cancel')}
        </Button>
        <Button onClick={handleSave} color="primary" loading={saving}>
          {t('shared.actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

const HomePage = () => {
  const { t } = useTranslation()
  const { verge, mutateVerge, patchVerge } = useVerge()
  const { current, mutateProfiles } = useProfiles()

  // 设置弹窗的状态
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 卡片显示状态
  const homeCards = useMemo(
    () => ({
      ...DEFAULT_HOME_CARDS,
      ...(verge?.home_cards as HomeCardsSettings | undefined),
    }),
    [verge?.home_cards],
  )

  // 文档链接函数
  const toGithubDoc = useLockFn(() =>
    openExternalUrl('https://clash-verge-rev.github.io/index.html').catch(
      showNotice.error,
    ),
  )

  // 新增：打开设置弹窗
  const openSettings = useCallback(() => {
    setSettingsOpen(true)
  }, [])

  // Only visible cards take part in sorting; hidden ones keep their place at the end of the stored order.
  const visibleCardItems = useMemo(
    () =>
      HOME_CARD_KEYS.filter((key) => homeCards[key]).map((path) => ({ path })),
    [homeCards],
  )
  // The order lives inside the free-form home_cards config next to the visibility flags.
  const storedCardOrder = (verge?.home_cards as { order?: string[] } | null)
    ?.order
  const withHiddenCards = useCallback(
    (order: string[]) => [
      ...order,
      ...(storedCardOrder ?? HOME_CARD_KEYS).filter(
        (key) => !order.includes(key),
      ),
    ],
    [storedCardOrder],
  )
  const optimisticCardOrder = useCallback(
    (order: string[]) =>
      mutateVerge(
        (prev) =>
          prev
            ? {
                ...prev,
                home_cards: { ...homeCards, order: withHiddenCards(order) },
              }
            : prev,
        false,
      ),
    [homeCards, mutateVerge, withHiddenCards],
  )
  const persistCardOrder = useCallback(
    (order: string[]) =>
      patchVerge({
        home_cards: { ...homeCards, order: withHiddenCards(order) },
      }),
    [homeCards, patchVerge, withHiddenCards],
  )
  const { menuOrder: cardOrder, handleMenuDragEnd: handleCardDragEnd } =
    useNavMenuOrder({
      enabled: true,
      items: visibleCardItems,
      storedOrder: storedCardOrder,
      onOptimisticUpdate: optimisticCardOrder,
      onPersist: persistCardOrder,
    })

  const cards = useMemo<
    Record<HomeCardKey, { node: ReactNode; size?: GridProps['size'] }>
  >(
    () => ({
      profile: {
        node: (
          <HomeProfileCard
            current={current}
            onProfileUpdated={mutateProfiles}
          />
        ),
      },
      proxy: { node: <CurrentProxyCard /> },
      network: { node: <NetworkSettingsCard /> },
      mode: { node: <ClashModeEnhancedCard /> },
      traffic: {
        node: (
          <EnhancedCard
            title={t('home.page.cards.trafficStats')}
            icon={<SpeedOutlined />}
            iconColor="secondary"
          >
            <EnhancedTrafficStats />
          </EnhancedCard>
        ),
        size: 12,
      },
      test: {
        node: (
          <Suspense fallback={<Skeleton variant="rectangular" height={200} />}>
            <LazyTestCard />
          </Suspense>
        ),
      },
      ip: {
        node: (
          <Suspense fallback={<Skeleton variant="rectangular" height={200} />}>
            <LazyIpInfoCard />
          </Suspense>
        ),
      },
      clashinfo: {
        node: (
          <Suspense fallback={<Skeleton variant="rectangular" height={200} />}>
            <LazyClashInfoCard />
          </Suspense>
        ),
      },
      systeminfo: {
        node: (
          <Suspense fallback={<Skeleton variant="rectangular" height={200} />}>
            <LazySystemInfoCard />
          </Suspense>
        ),
      },
    }),
    [current, mutateProfiles, t],
  )

  return (
    <BasePage
      title={t('home.page.title')}
      contentStyle={{ padding: 2 }}
      header={
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Tooltip title={t('home.page.tooltips.lightweightMode')} arrow>
            <IconButton
              onClick={async () =>
                await mutate(() => entry_lightweight_mode(), {
                  id: 'entry-lightweight-mode',
                  errorNotice: false,
                })
              }
              size="small"
              color="inherit"
            >
              <HistoryEduOutlined />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('home.page.tooltips.manual')} arrow>
            <IconButton onClick={toGithubDoc} size="small" color="inherit">
              <HelpOutlineRounded />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('home.page.tooltips.settings')} arrow>
            <IconButton onClick={openSettings} size="small" color="inherit">
              <SettingsOutlined />
            </IconButton>
          </Tooltip>
        </Box>
      }
    >
      <DragDropProvider sensors={CARD_SENSORS} onDragEnd={handleCardDragEnd}>
        <Grid container spacing={1.5} columns={{ xs: 6, sm: 6, md: 12 }}>
          {cardOrder.map((key, index) => (
            <SortableItem key={key} id={key} index={index}>
              {({ ref, handleRef, style }) => (
                <Grid
                  ref={ref}
                  size={cards[key as HomeCardKey].size ?? 6}
                  style={style}
                  sx={{
                    '&:hover > .home-card-handle, & > .home-card-handle:focus-visible':
                      { opacity: 1 },
                  }}
                >
                  {cards[key as HomeCardKey].node}
                  <Box
                    ref={handleRef}
                    className="home-card-handle"
                    role="button"
                    tabIndex={0}
                    aria-label={t('home.page.tooltips.dragCard')}
                    title={t('home.page.tooltips.dragCard')}
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      px: 1.5,
                      lineHeight: 0,
                      color: 'text.secondary',
                      cursor: 'grab',
                      opacity: 0,
                      transition: 'opacity 0.15s',
                    }}
                  >
                    <DragIndicatorRounded
                      sx={{ fontSize: 18, transform: 'rotate(90deg)' }}
                    />
                  </Box>
                </Grid>
              )}
            </SortableItem>
          ))}
        </Grid>
      </DragDropProvider>

      {/* 首页设置弹窗 */}
      {settingsOpen && (
        <HomeSettingsDialog
          key={serializeCardFlags(homeCards)}
          onClose={() => setSettingsOpen(false)}
          homeCards={homeCards}
        />
      )}
    </BasePage>
  )
}

// 增强版网络设置卡片组件
const NetworkSettingsCard = () => {
  const { t } = useTranslation()
  return (
    <EnhancedCard
      title={t('home.page.cards.networkSettings')}
      icon={<DnsOutlined />}
      iconColor="primary"
      action={null}
    >
      <ProxyTunCard />
    </EnhancedCard>
  )
}

// 增强版 Clash 模式卡片组件
const ClashModeEnhancedCard = () => {
  const { t } = useTranslation()
  return (
    <EnhancedCard
      title={t('home.page.cards.proxyMode')}
      icon={<RouterOutlined />}
      iconColor="info"
      action={null}
    >
      <ClashModeCard />
    </EnhancedCard>
  )
}

export default HomePage
