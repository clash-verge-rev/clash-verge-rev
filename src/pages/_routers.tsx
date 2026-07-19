/* eslint-disable react-refresh/only-export-components */
import React, { lazy, Suspense } from 'react'
import { createBrowserRouter, RouteObject } from 'react-router'

import MiniLayout from './_mini-layout'
import { navItems } from './_navigation'
import HomePage from './home'

const Layout = lazy(() => import('./_layout'))

export const router = createBrowserRouter([
  {
    path: '/',
    Component: MiniLayout,
    children: [
      {
        path: '/',
        Component: HomePage,
      },
    ],
  },
  {
    path: '/',
    Component: (props) => (
      <Suspense fallback={<div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>Loading Advanced Settings...</div>}>
        <Layout {...props} />
      </Suspense>
    ),
    children: navItems.filter(item => item.path !== '/').map(
      (item) =>
        ({
          path: item.path,
          Component: item.Component,
        }) as RouteObject,
    ),
  },
])
