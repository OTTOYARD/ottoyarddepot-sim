import React from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: { direction: 'up' | 'down' | 'neutral'; value: number; goodDirection?: 'up' | 'down' };
  sparklineData?: number[];
  variant?: 'default' | 'circular-progress' | 'bar-gauge';
  barColor?: string;
  barValue?: number; // 0-1 for bar-gauge
  className?: string;
}

function CircularProgress({ value, color }: { value: number; color: string }) {
  const r = 20;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(100, Math.max(0, value)) / 100) * circ;
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" className="shrink-0">
      <circle cx="26" cy="26" r={r} fill="none" stroke="hsl(0 0% 100% / 0.1)" strokeWidth="4" />
      <circle
        cx="26"
        cy="26"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 26 26)"
      />
      <text x="26" y="26" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="10" fontFamily="monospace">
        {Math.round(value)}%
      </text>
    </svg>
  );
}

export const StatCard = React.memo(function StatCard({
  label,
  value,
  unit,
  trend,
  sparklineData,
  variant = 'default',
  barColor,
  barValue,
  className = '',
}: StatCardProps) {
  const trendColor =
    trend?.direction === 'neutral'
      ? 'text-otto-gray'
      : trend?.direction === (trend?.goodDirection ?? 'up')
        ? 'text-otto-teal'
        : 'text-otto-red';

  const trendArrow = trend?.direction === 'up' ? '↑' : trend?.direction === 'down' ? '↓' : '→';

  return (
    <div
      className={`bg-otto-dark rounded-lg border border-white/10 p-3 flex flex-col gap-1 ${className}`}
    >
      <span className="text-[10px] text-otto-gray uppercase tracking-wider">{label}</span>

      <div className="flex items-center justify-between gap-2">
        {variant === 'circular-progress' ? (
          <div className="flex items-center gap-2">
            <CircularProgress
              value={typeof value === 'number' ? value : parseFloat(String(value)) || 0}
              color={
                (typeof value === 'number' ? value : 0) >= 95
                  ? '#00B4A6'
                  : (typeof value === 'number' ? value : 0) >= 85
                    ? '#F59E0B'
                    : '#C00000'
              }
            />
            <span className="text-lg font-mono text-white font-bold">
              {typeof value === 'number' ? value.toFixed(1) : value}
              {unit && <span className="text-xs text-otto-gray ml-0.5">{unit}</span>}
            </span>
          </div>
        ) : variant === 'bar-gauge' ? (
          <div className="flex-1">
            <div className="flex justify-between mb-1">
              <span className="text-lg font-mono text-white font-bold">
                {typeof value === 'number' ? (value * 100).toFixed(0) : value}
                <span className="text-xs text-otto-gray ml-0.5">%</span>
              </span>
            </div>
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, (barValue ?? 0) * 100)}%`,
                  backgroundColor: barColor ?? '#00B4A6',
                }}
              />
            </div>
          </div>
        ) : (
          <span className="text-lg font-mono text-white font-bold">
            {typeof value === 'number' ? value.toFixed(1) : value}
            {unit && <span className="text-xs text-otto-gray ml-0.5">{unit}</span>}
          </span>
        )}

        {trend && (
          <span className={`text-xs font-mono ${trendColor}`}>
            {trendArrow} {trend.value.toFixed(1)}%
          </span>
        )}
      </div>

      {sparklineData && sparklineData.length > 1 && (
        <div className="h-6 -mx-1 mt-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparklineData.map((v, i) => ({ v, i }))}>
              <Line
                type="monotone"
                dataKey="v"
                stroke="#00B4A6"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
});
