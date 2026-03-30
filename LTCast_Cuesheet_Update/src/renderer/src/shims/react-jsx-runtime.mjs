// ESM shim for react/jsx-runtime and react/jsx-dev-runtime
// Provides static named exports that Rollup 4 can tree-shake correctly.
// Uses React.createElement to avoid depending on the CJS jsx-runtime bundles.
import React from 'react'

export const Fragment = React.Fragment

export function jsx(type, props, key) {
  const p = key !== undefined ? { ...props, key } : props
  return React.createElement(type, p)
}

export const jsxs = jsx

// Dev runtime (extra source-location params are ignored)
export const jsxDEV = jsx
