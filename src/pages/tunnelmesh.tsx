import {
  Add,
  DeleteOutlined,
  PlayArrow,
  Refresh,
  Save,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BasePage } from '@/components/base'
import { useVerge } from '@/hooks/use-verge'
import {
  getTunnelmeshConfig,
  getTunnelmeshStatus,
  saveTunnelmeshConfig,
  setTunnelmeshEnabled,
  validateTunnelmeshConfig,
  type TunnelMeshSaveRequest,
  type TunnelMeshTunnelConfig,
} from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'
import { useQuery } from '@/services/query-client'

const emptyTunnel = (): TunnelMeshTunnelConfig => ({
  name: 'tunnel',
  protocol: 'socks5',
  listen: '127.0.0.1:18081',
  agent_id: '',
  auth_mode: 'none',
  allow_remote: false,
})

const TunnelMeshPage = () => {
  const { t } = useTranslation()
  const { verge, patchVerge } = useVerge()
  const { data, isPending, refetch } = useQuery({
    queryKey: ['getTunnelmeshConfig'],
    queryFn: getTunnelmeshConfig,
    staleTime: 3000,
  })
  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['getTunnelmeshStatus'],
    queryFn: getTunnelmeshStatus,
    refetchInterval: 5000,
  })
  const [serverUrl, setServerUrl] = useState('')
  const [token, setToken] = useState('')
  const [tunnels, setTunnels] = useState<TunnelMeshTunnelConfig[]>([])

  useEffect(() => {
    if (!data) return
    // The form draft must be hydrated when the backend snapshot changes.
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setServerUrl(data.client.server_url)
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setTunnels(data.client.tunnels)
  }, [data])

  const request = (): TunnelMeshSaveRequest => ({
    config: {
      mode: data?.mode || 'local',
      client: { server_url: serverUrl, token: '', tunnels },
    },
    token: token || null,
  })

  const save = async () => {
    try {
      await mutate(() => saveTunnelmeshConfig(request()), {
        id: 'save-tunnelmesh-config',
        revalidate: [['getTunnelmeshConfig'], ['getTunnelmeshStatus']],
      })
      setToken('')
      showNotice.success(t('settings.tunnelmesh.messages.saved'))
    } catch (error) {
      showNotice.error(error)
    }
  }

  const validate = async () => {
    try {
      await validateTunnelmeshConfig(request())
      showNotice.success(t('settings.tunnelmesh.messages.valid'))
    } catch (error) {
      showNotice.error(error)
    }
  }

  const toggle = async (enabled: boolean) => {
    try {
      await setTunnelmeshEnabled(enabled)
      await patchVerge({ enable_tunnelmesh: enabled })
      await Promise.all([refetch(), refetchStatus()])
    } catch (error) {
      showNotice.error(error)
    }
  }

  const updateTunnel = (
    index: number,
    patch: Partial<TunnelMeshTunnelConfig>,
  ) => {
    setTunnels((current) =>
      current.map((tunnel, currentIndex) =>
        currentIndex === index ? { ...tunnel, ...patch } : tunnel,
      ),
    )
  }

  return (
    <BasePage
      title={t('settings.tunnelmesh.title')}
      header={
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button startIcon={<Refresh />} onClick={() => void refetch()}>
            {t('settings.tunnelmesh.actions.reload')}
          </Button>
          <Button
            startIcon={<Save />}
            variant="contained"
            onClick={() => void save()}
          >
            {t('settings.tunnelmesh.actions.save')}
          </Button>
        </Box>
      }
    >
      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(verge?.enable_tunnelmesh)}
                    onChange={(event) => void toggle(event.target.checked)}
                  />
                }
                label={t('settings.tunnelmesh.fields.enabled')}
              />
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('settings.tunnelmesh.status', {
                  state: status?.state || 'stopped',
                })}
              </Typography>
              <TextField
                fullWidth
                label={t('settings.tunnelmesh.fields.serverUrl')}
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                margin="dense"
              />
              <TextField
                fullWidth
                label={t('settings.tunnelmesh.fields.token')}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                type="password"
                placeholder={data?.client.token_configured ? '••••••••' : ''}
                margin="dense"
              />
              <Button sx={{ mt: 1 }} onClick={() => void validate()}>
                {t('settings.tunnelmesh.actions.validate')}
              </Button>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Typography variant="h6">
                  {t('settings.tunnelmesh.fields.tunnels')}
                </Typography>
                <Button
                  startIcon={<Add />}
                  onClick={() =>
                    setTunnels((current) => [...current, emptyTunnel()])
                  }
                >
                  {t('settings.tunnelmesh.actions.add')}
                </Button>
              </Box>
              {isPending && (
                <Typography>{t('settings.tunnelmesh.loading')}</Typography>
              )}
              {tunnels.map((tunnel, index) => (
                <Card
                  key={`${tunnel.name}-${tunnel.listen}-${tunnel.protocol}`}
                  variant="outlined"
                  sx={{ mt: 1 }}
                >
                  <CardContent>
                    <Box
                      sx={{ display: 'flex', justifyContent: 'space-between' }}
                    >
                      <Typography variant="subtitle1">
                        {tunnel.name || t('settings.tunnelmesh.fields.tunnel')}
                      </Typography>
                      <IconButton
                        onClick={() =>
                          setTunnels((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <DeleteOutlined />
                      </IconButton>
                    </Box>
                    <Grid container spacing={1}>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          fullWidth
                          label={t('settings.tunnelmesh.fields.name')}
                          value={tunnel.name}
                          onChange={(e) =>
                            updateTunnel(index, { name: e.target.value })
                          }
                          margin="dense"
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          select
                          fullWidth
                          label={t('settings.tunnelmesh.fields.protocol')}
                          value={tunnel.protocol}
                          onChange={(e) =>
                            updateTunnel(index, {
                              protocol: e.target.value,
                              auth_mode:
                                e.target.value === 'http-proxy'
                                  ? 'none'
                                  : tunnel.auth_mode,
                            })
                          }
                          margin="dense"
                        >
                          {['socks5', 'http-proxy', 'tcp', 'udp', 'http'].map(
                            (protocol) => (
                              <MenuItem key={protocol} value={protocol}>
                                {protocol}
                              </MenuItem>
                            ),
                          )}
                        </TextField>
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          fullWidth
                          label={t('settings.tunnelmesh.fields.listen')}
                          value={tunnel.listen}
                          onChange={(e) =>
                            updateTunnel(index, { listen: e.target.value })
                          }
                          margin="dense"
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          fullWidth
                          label={t('settings.tunnelmesh.fields.agentId')}
                          value={tunnel.agent_id}
                          onChange={(e) =>
                            updateTunnel(index, { agent_id: e.target.value })
                          }
                          margin="dense"
                        />
                      </Grid>
                      {['tcp', 'udp', 'http'].includes(tunnel.protocol) && (
                        <>
                          <Grid size={{ xs: 12, sm: 8 }}>
                            <TextField
                              fullWidth
                              label={t('settings.tunnelmesh.fields.targetHost')}
                              value={tunnel.target_host || ''}
                              onChange={(e) =>
                                updateTunnel(index, {
                                  target_host: e.target.value,
                                })
                              }
                              margin="dense"
                            />
                          </Grid>
                          <Grid size={{ xs: 12, sm: 4 }}>
                            <TextField
                              fullWidth
                              type="number"
                              label={t('settings.tunnelmesh.fields.targetPort')}
                              value={tunnel.target_port || ''}
                              onChange={(e) =>
                                updateTunnel(index, {
                                  target_port: Number(e.target.value) || 0,
                                })
                              }
                              margin="dense"
                            />
                          </Grid>
                        </>
                      )}
                      <Grid size={{ xs: 12 }}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={tunnel.allow_remote}
                              onChange={(e) =>
                                updateTunnel(index, {
                                  allow_remote: e.target.checked,
                                })
                              }
                            />
                          }
                          label={t('settings.tunnelmesh.fields.allowRemote')}
                        />
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              ))}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      {status?.last_error && (
        <Typography color="error" sx={{ mt: 2 }}>
          {status.last_error}
        </Typography>
      )}
      <Button
        startIcon={<PlayArrow />}
        sx={{ mt: 2 }}
        onClick={() => void toggle(true)}
      >
        {t('settings.tunnelmesh.actions.apply')}
      </Button>
    </BasePage>
  )
}

export default TunnelMeshPage
