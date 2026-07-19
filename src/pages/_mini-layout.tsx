import React from 'react'
import { Outlet } from 'react-router'

import { BaseErrorBoundary } from '@/components/base'

const MiniLayout = () => {
  return (
    <div className="mini-layout" style={{ width: '100%', height: '100vh', overflow: 'hidden' }}>
      <BaseErrorBoundary>
        <Outlet />
      </BaseErrorBoundary>
    </div>
  )
}

export default MiniLayout
