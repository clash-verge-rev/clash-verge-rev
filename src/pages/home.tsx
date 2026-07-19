import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { useProfiles } from '@/hooks/use-profiles'
import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useSystemState } from '@/hooks/use-system-state'
import { useTrafficData } from '@/hooks/use-traffic-data'
import { useVerge } from '@/hooks/use-verge'
import { useThemeMode } from '@/services/states'
import parseTraffic from '@/utils/parse-traffic'

// Custom sleek inline SVG icons
const SettingsIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
)
const SpeedUpIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/></svg>
)
const SpeedDownIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z"/></svg>
)

const HomePage = () => {
  const { t } = useTranslation()
  const mode = useThemeMode()
  const navigate = useNavigate()
  const { verge, patchVerge } = useVerge()
  const { profiles, patchProfiles } = useProfiles()
  const { indicator: systemProxyIndicator, toggleSystemProxy } = useSystemProxyState()
  const { isTunModeAvailable } = useSystemState()

  const { response: { data: traffic } } = useTrafficData({ enabled: true })

  const { enable_tun_mode } = verge ?? {}

  const handleTunToggle = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.checked
    await patchVerge({ enable_tun_mode: value })
  }, [patchVerge])

  const handleSystemProxyToggle = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.checked
    await toggleSystemProxy(value)
  }, [toggleSystemProxy])

  const handleProfileChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const profileUid = e.target.value
    if (profileUid) {
      await patchProfiles({ current: profileUid })
    }
  }, [patchProfiles])

  const speedData = useMemo(() => {
    const [up, upUnit] = parseTraffic(traffic?.up || 0)
    const [down, downUnit] = parseTraffic(traffic?.down || 0)
    return { up, upUnit, down, downUnit }
  }, [traffic])

  return (
    <div className={`mini-container ${mode === 'dark' ? 'theme-dark' : ''}`}>
      {/* Mini Header */}
      <header className="mini-header">
        <div className="mini-logo-container">
          <svg className="mini-logo" viewBox="0 0 24 24" fill="var(--primary-main, #5b5c9d)">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
          </svg>
          <span className="mini-title">Clash Verge Mini</span>
        </div>
        <div className="mini-actions">
          <button 
            className="mini-btn settings-btn" 
            title={t('home.page.tooltips.settings')}
            onClick={() => navigate('/settings')}
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      {/* Speed Card */}
      <div className="mini-speed-card">
        <div className="speed-item">
          <span className="speed-label">
            <SpeedDownIcon /> {t('home:traffic.legends.download' as any) || 'Download'}
          </span>
          <span className="speed-value">{speedData.down} {speedData.downUnit}/s</span>
        </div>
        <div className="speed-item">
          <span className="speed-label">
            <SpeedUpIcon /> {t('home:traffic.legends.upload' as any) || 'Upload'}
          </span>
          <span className="speed-value">{speedData.up} {speedData.upUnit}/s</span>
        </div>
      </div>

      {/* Toggles */}
      <div className="mini-controls">
        <div className="mini-control-row">
          <div className="control-label">
            <span className="control-title">{t('settings.sections.system.toggles.systemProxy') || 'System Proxy'}</span>
            <span className="control-desc">Route device traffic</span>
          </div>
          <label className="mini-switch">
            <input 
              type="checkbox" 
              checked={!!systemProxyIndicator}
              onChange={handleSystemProxyToggle}
            />
            <span className="slider"></span>
          </label>
        </div>

        <div className="mini-control-row" style={{ opacity: isTunModeAvailable ? 1 : 0.5 }}>
          <div className="control-label">
            <span className="control-title">{t('settings.sections.system.toggles.tunMode') || 'TUN Mode'}</span>
            <span className="control-desc">Virtual network interface</span>
          </div>
          <label className="mini-switch">
            <input 
              type="checkbox" 
              checked={!!enable_tun_mode}
              disabled={!isTunModeAvailable}
              onChange={handleTunToggle}
            />
            <span className="slider"></span>
          </label>
        </div>
      </div>

      {/* Profile Card */}
      <div className="mini-profile-card">
        <div className="profile-header">
          <span className="profile-title">{t('profiles.page.title') || 'Profile'}</span>
        </div>
        <div className="profile-select-container">
          <select 
            value={profiles?.current || ''} 
            onChange={handleProfileChange}
          >
            {profiles?.items?.map((item) => (
              <option key={item.uid} value={item.uid}>
                {item.name || item.file || 'Unnamed Profile'}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}

export default HomePage
