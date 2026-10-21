import React from 'react';
import { WallpaperId } from '../types/desktop';

interface UbuntuWallpaperProps {
  wallpaperId: WallpaperId;
}

export const UbuntuWallpaper: React.FC<UbuntuWallpaperProps> = ({ wallpaperId }) => {
  if (wallpaperId === 'noble-numbat') {
    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden select-none">
        <svg className="w-full h-full object-cover" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="0 0 1920 1080">
          <defs>
            <linearGradient id="nobleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1E0720" />
              <stop offset="40%" stopColor="#4A154B" />
              <stop offset="75%" stopColor="#6C1D5F" />
              <stop offset="100%" stopColor="#8C2D19" />
            </linearGradient>
            <radialGradient id="nobleGlow" cx="65%" cy="35%" r="60%">
              <stop offset="0%" stopColor="#E95420" stopOpacity="0.45" />
              <stop offset="50%" stopColor="#77216F" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#1E0720" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="1920" height="1080" fill="url(#nobleGrad)" />
          <circle cx="1200" cy="400" r="700" fill="url(#nobleGlow)" />
          {/* Subtle Ubuntu canonical geometric curves */}
          <path d="M-100 800 C400 600, 1000 900, 2020 500 L2020 1180 L-100 1180 Z" fill="#2C001E" opacity="0.35" />
          <path d="M-50 400 C600 200, 1200 650, 2000 300 L2000 1100 L-50 1100 Z" fill="#E95420" opacity="0.08" />
          <path d="M200 -50 C800 300, 1400 100, 2050 400" stroke="#E95420" strokeWidth="1.5" strokeOpacity="0.25" fill="none" />
        </svg>
      </div>
    );
  }

  if (wallpaperId === 'deep-space') {
    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden select-none bg-[#090b10]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/30 via-[#0a0e1a] to-black" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,_rgba(120,40,200,0.15),transparent_60%)]" />
      </div>
    );
  }

  if (wallpaperId === 'matrix-emerald') {
    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden select-none bg-[#051109]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(16,185,129,0.18)_0%,transparent_70%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#040d07_0%,#010503_100%)] opacity-90" />
      </div>
    );
  }

  if (wallpaperId === 'minimal-carbon') {
    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden select-none bg-[#121212]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,#262626_0%,#0f0f0f_100%)]" />
      </div>
    );
  }

  // Default: Canonical Ubuntu Jammy / Noble Aubergine
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden select-none">
      <svg className="w-full h-full object-cover" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="0 0 1920 1080">
        <defs>
          <linearGradient id="jammyGrad" x1="15%" y1="10%" x2="85%" y2="90%">
            <stop offset="0%" stopColor="#77216F" />
            <stop offset="35%" stopColor="#5E2750" />
            <stop offset="70%" stopColor="#2C001E" />
            <stop offset="100%" stopColor="#1a0012" />
          </linearGradient>
          <radialGradient id="jammyOrangeGlow" cx="80%" cy="80%" r="50%">
            <stop offset="0%" stopColor="#E95420" stopOpacity="0.55" />
            <stop offset="60%" stopColor="#77216F" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#2C001E" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1920" height="1080" fill="url(#jammyGrad)" />
        <circle cx="1600" cy="850" r="800" fill="url(#jammyOrangeGlow)" />
        {/* Authentic Ubuntu flowing wave vectors */}
        <path d="M0 600 C500 450, 1100 850, 1920 450 L1920 1080 L0 1080 Z" fill="#1f0115" opacity="0.4" />
        <path d="M0 750 C650 650, 1300 950, 1920 680 L1920 1080 L0 1080 Z" fill="#0d0009" opacity="0.6" />
        <path d="M300 1100 C700 800, 1200 900, 1920 600" stroke="#E95420" strokeWidth="2" strokeOpacity="0.3" fill="none" />
      </svg>
    </div>
  );
};
