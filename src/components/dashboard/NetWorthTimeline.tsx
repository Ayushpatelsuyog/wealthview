'use client';

import { Card } from '@/components/ui/card';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

// Generate 1Y dummy data
function generateData() {
  const points = [];
  const months = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
  let portfolio = 7200;
  let nifty = 7200;

  for (let i = 0; i < months.length; i++) {
    const portfolioGrowth = 1 + (Math.random() * 0.06 - 0.01);
    const niftyGrowth = 1 + (Math.random() * 0.04 - 0.01);
    portfolio = Math.round(portfolio * portfolioGrowth);
    nifty = Math.round(nifty * niftyGrowth);
    points.push({ month: months[i], portfolio, nifty });
  }
  return points;
}

const data = generateData();

function formatYAxis(value: number): string {
  return `₹${(value / 100).toFixed(1)}Cr`;
}

interface TooltipPayload {
  color: string;
  name: string;
  value: number;
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-medium text-gray-700 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-gray-500">{p.name}:</span>
          <span className="font-medium">₹{(p.value / 100).toFixed(2)}Cr</span>
        </div>
      ))}
    </div>
  );
}

export function NetWorthTimeline() {
  return (
    <Card className="p-5 border-0 shadow-sm bg-white">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">Net Worth Timeline</h3>
          <p className="text-xs text-gray-500 mt-0.5">vs Nifty 50 benchmark</p>
        </div>
        <div className="flex gap-1">
          {['1M', '3M', '6M', '1Y', 'All'].map((period) => (
            <button
              key={period}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                period === '1Y'
                  ? 'text-white'
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
              style={{ backgroundColor: period === '1Y' ? '#1B2A4A' : undefined }}
            >
              {period}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: '#9CA3AF' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatYAxis}
            tick={{ fontSize: 11, fill: '#9CA3AF' }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
            formatter={(value) => value === 'portfolio' ? 'Portfolio' : 'Nifty 50'}
          />
          <Line
            type="monotone"
            dataKey="portfolio"
            stroke="#1B2A4A"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="nifty"
            stroke="#C9A84C"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
