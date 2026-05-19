import { ArrowDownwardRounded, ArrowUpwardRounded } from '@mui/icons-material'
import { Box, Typography, alpha, useTheme } from '@mui/material'
import { useTranslation } from 'react-i18next'

import { useDailyTraffic } from '@/hooks/use-daily-traffic'
import parseTraffic from '@/utils/parse-traffic'

const Cell = ({ sx, ...rest }: any) => (
  <Box component="td" sx={{ py: 1, px: 1, ...sx }} {...rest} />
)

export const DailyTrafficCard = () => {
  const { t } = useTranslation()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const { records, totalDownload, totalUpload } = useDailyTraffic()

  const top4 = records.slice(0, 4)
  const [dV, dU] = parseTraffic(totalDownload)
  const [uV, uU] = parseTraffic(totalUpload)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 总下载/总上传统计行 */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-around',
          px: 2,
          py: 1.5,
          bgcolor: isDark
            ? alpha(theme.palette.common?.white || '#fff', 0.03)
            : alpha(theme.palette.common?.black || '#000', 0.02),
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ArrowDownwardRounded
            fontSize="small"
            color="primary"
            sx={{ opacity: 0.8 }}
          />
          <Typography variant="body2" color="text.secondary">
            {t('home.components.dailyTraffic.totalDownload')}
          </Typography>
          <Typography
            variant="body1"
            color="primary.main"
            sx={{ fontWeight: 'bold' }}
          >
            {dV}
          </Typography>
          <Typography
            variant="body2"
            color="primary.main"
            sx={{ opacity: 0.6 }}
          >
            {dU}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ArrowUpwardRounded
            fontSize="small"
            color="secondary"
            sx={{ opacity: 0.8 }}
          />
          <Typography variant="body2" color="text.secondary">
            {t('home.components.dailyTraffic.totalUpload')}
          </Typography>
          <Typography
            variant="body1"
            color="secondary.main"
            sx={{ fontWeight: 'bold' }}
          >
            {uV}
          </Typography>
          <Typography
            variant="body2"
            color="secondary.main"
            sx={{ opacity: 0.6 }}
          >
            {uU}
          </Typography>
        </Box>
      </Box>

      {/* 表格区域 */}
      {top4.length === 0 ? (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {t('home.components.dailyTraffic.noData')}
          </Typography>
        </Box>
      ) : (
        <Box
          component="table"
          sx={{
            width: '100%',
            borderCollapse: 'collapse',
            '& td:first-of-type': { pl: 2 },
            '& td:last-child': { pr: 2 },
          }}
        >
          {/* 表头 */}
          <Box component="thead">
            <Box component="tr">
              <Cell sx={{ pt: 1.5, pb: 0.5 }}>
                <Typography
                  variant="caption"
                  color="text.disabled"
                  sx={{
                    fontSize: '0.7rem',
                    letterSpacing: 0.5,
                    textTransform: 'uppercase',
                    fontWeight: 600,
                  }}
                >
                  {t('home.components.dailyTraffic.columns.host')}
                </Typography>
              </Cell>
              <Cell sx={{ pt: 1.5, pb: 0.5, textAlign: 'right' }}>
                <Typography
                  variant="caption"
                  color="text.disabled"
                  sx={{
                    fontSize: '0.7rem',
                    letterSpacing: 0.5,
                    textTransform: 'uppercase',
                    fontWeight: 600,
                  }}
                >
                  {t('home.components.dailyTraffic.columns.download')}
                </Typography>
              </Cell>
              <Cell sx={{ pt: 1.5, pb: 0.5, textAlign: 'right', width: 110 }}>
                <Typography
                  variant="caption"
                  color="text.disabled"
                  sx={{
                    fontSize: '0.7rem',
                    letterSpacing: 0.5,
                    textTransform: 'uppercase',
                    fontWeight: 600,
                  }}
                >
                  {t('home.components.dailyTraffic.columns.share')}
                </Typography>
              </Cell>
              <Cell sx={{ pt: 1.5, pb: 0.5, textAlign: 'right', width: 80 }}>
                <Typography
                  variant="caption"
                  color="text.disabled"
                  sx={{
                    fontSize: '0.7rem',
                    letterSpacing: 0.5,
                    textTransform: 'uppercase',
                    fontWeight: 600,
                  }}
                >
                  {t('home.components.dailyTraffic.columns.lastActive')}
                </Typography>
              </Cell>
            </Box>
          </Box>

          {/* 表体 */}
          <Box component="tbody">
            {top4.map((row, i) => {
              const [v, u] = parseTraffic(row.download)
              const ratio =
                totalDownload > 0 ? (row.download / totalDownload) * 100 : 0
              return (
                <Box
                  component="tr"
                  key={row.host}
                  sx={{
                    transition: 'background 0.15s',
                    '&:hover': {
                      bgcolor: isDark
                        ? alpha(theme.palette.common?.white || '#fff', 0.04)
                        : alpha(theme.palette.common?.black || '#000', 0.03),
                    },
                    ...(i === top4.length - 1
                      ? {}
                      : {
                          '& td': {
                            borderBottom: `1px solid ${
                              isDark ? alpha('#fff', 0.06) : alpha('#000', 0.06)
                            }`,
                          },
                        }),
                  }}
                >
                  <Cell
                    sx={{
                      py: 1.2,
                      maxWidth: 120,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily:
                          '"SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace',
                        fontSize: '0.8rem',
                      }}
                    >
                      {row.host}
                    </Typography>
                  </Cell>
                  <Cell sx={{ py: 1.2, textAlign: 'right' }}>
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: 0.3,
                      }}
                    >
                      <Typography
                        variant="body2"
                        color="text.primary"
                        sx={{
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {v}
                      </Typography>
                      <Typography variant="caption" color="text.disabled">
                        {u}
                      </Typography>
                    </Box>
                  </Cell>
                  <Cell sx={{ py: 1.2, textAlign: 'right' }}>
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: 1,
                      }}
                    >
                      <Box
                        sx={{
                          width: 48,
                          height: 4,
                          borderRadius: 2,
                          bgcolor: isDark
                            ? alpha(theme.palette.primary.main, 0.15)
                            : alpha(theme.palette.primary.main, 0.1),
                          overflow: 'hidden',
                          flexShrink: 0,
                        }}
                      >
                        <Box
                          sx={{
                            width: `${Math.min(ratio, 100)}%`,
                            height: '100%',
                            borderRadius: 2,
                            bgcolor:
                              i === 0
                                ? theme.palette.primary.main
                                : i === 1
                                  ? alpha(theme.palette.primary.main, 0.7)
                                  : i === 2
                                    ? alpha(theme.palette.primary.main, 0.5)
                                    : alpha(theme.palette.primary.main, 0.35),
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          minWidth: 30,
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {ratio >= 1 ? Math.round(ratio) + '%' : '<1%'}
                      </Typography>
                    </Box>
                  </Cell>
                  <Cell sx={{ py: 1.2, textAlign: 'right' }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {new Date(row.lastActive).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Typography>
                  </Cell>
                </Box>
              )
            })}
          </Box>
        </Box>
      )}
    </Box>
  )
}
