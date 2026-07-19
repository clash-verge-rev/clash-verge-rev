import React from 'react'

export const BaseLoading = () => {
  return (
    <div style={{
      position: 'relative',
      display: 'flex',
      height: '100%',
      minHeight: '18px',
      boxSizing: 'border-box',
      alignItems: 'center',
    }}>
      <style>{`
        .loading-dot {
          box-sizing: border-box;
          width: 6px;
          height: 6px;
          margin: 2px;
          border-radius: 100%;
          background: currentColor;
          animation: loading-anim 0.7s infinite linear;
        }
        .loading-dot:nth-child(2) {
          animation-delay: -0.35s;
        }
        .loading-dot:nth-child(3) {
          animation-delay: -0.5s;
        }
        @keyframes loading-anim {
          50% {
            opacity: 0.2;
            transform: scale(0.75);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
      <div className="loading-dot" />
      <div className="loading-dot" />
      <div className="loading-dot" />
    </div>
  )
}
