import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { formatDay, formatNumber } from '../lib/format';

const AXIS = { stroke: 'var(--text-muted)', fontSize: 11 };
const PALETTE = ['#6366f1', '#22d3ee', '#f59e0b', '#ec4899', '#10b981', '#a78bfa', '#f97316'];

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-overlay)] px-3 py-2 text-[12px] shadow-lg">
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.dataKey} className="flex items-center gap-2 text-secondary-fg">
          <span className="size-2 rounded-full" style={{ background: entry.color }} />
          {entry.name} : <span className="font-medium text-[var(--text-primary)]">{formatNumber(entry.value)}</span>
        </p>
      ))}
    </div>
  );
}

/** Evolution de l'activite sur une periode. */
export function TimelineChart({
  data, height = 220,
}: { data: Array<{ date: string; generations: number; credits: number }>; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="grad-generations" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="grad-credits" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={formatDay} tickLine={false} axisLine={false} {...AXIS} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} {...AXIS} width={44} />
        <Tooltip content={<ChartTooltip />} labelFormatter={formatDay} />
        <Area type="monotone" dataKey="generations" name="Generations" stroke="#6366f1" strokeWidth={2} fill="url(#grad-generations)" />
        <Area type="monotone" dataKey="credits" name="Credits" stroke="#22d3ee" strokeWidth={2} fill="url(#grad-credits)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Repartition d'usage par modele. */
export function ModelUsageChart({
  data, height = 220, dataKey = 'generations',
}: {
  data: Array<{ modelName: string; generations: number; credits: number }>;
  height?: number;
  dataKey?: 'generations' | 'credits';
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} {...AXIS} />
        <YAxis type="category" dataKey="modelName" tickLine={false} axisLine={false} width={110} {...AXIS} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-hover)' }} />
        <Bar dataKey={dataKey} name={dataKey === 'credits' ? 'Credits' : 'Generations'} radius={[0, 6, 6, 0]} barSize={16}>
          {data.map((entry, index) => (
            <Cell key={entry.modelName} fill={PALETTE[index % PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
