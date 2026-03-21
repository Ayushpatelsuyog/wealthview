'use client';

import { useState, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BarChart3, Upload, Link as LinkIcon, Check, ChevronDown } from 'lucide-react';

const MF_LIST = [
  { name: 'Mirae Asset Large Cap Fund',           amfi: '118834', amc: 'Mirae Asset',   category: 'Equity',  nav: 98.54  },
  { name: 'Axis Bluechip Fund',                   amfi: '120503', amc: 'Axis MF',       category: 'Equity',  nav: 54.12  },
  { name: 'Parag Parikh Flexi Cap Fund',          amfi: '122639', amc: 'PPFAS MF',      category: 'Equity',  nav: 72.89  },
  { name: 'SBI Small Cap Fund',                   amfi: '125354', amc: 'SBI MF',        category: 'Equity',  nav: 142.33 },
  { name: 'HDFC Mid-Cap Opportunities Fund',      amfi: '118560', amc: 'HDFC MF',       category: 'Equity',  nav: 119.88 },
  { name: 'Quant ELSS Tax Saver Fund',            amfi: '120586', amc: 'Quant MF',      category: 'ELSS',    nav: 330.21 },
  { name: 'Nippon India ELSS Tax Saver Fund',     amfi: '118668', amc: 'Nippon MF',     category: 'ELSS',    nav: 88.55  },
  { name: 'ICICI Prudential Balanced Advantage',  amfi: '120622', amc: 'ICICI Pru MF',  category: 'Hybrid',  nav: 57.34  },
  { name: 'HDFC Balanced Advantage Fund',         amfi: '100033', amc: 'HDFC MF',       category: 'Hybrid',  nav: 419.72 },
  { name: 'SBI Corporate Bond Fund',              amfi: '128465', amc: 'SBI MF',        category: 'Debt',    nav: 19.88  },
  { name: 'Kotak Corporate Bond Fund',            amfi: '120464', amc: 'Kotak MF',      category: 'Debt',    nav: 3442.55},
  { name: 'Aditya Birla Sun Life Liquid Fund',    amfi: '119364', amc: 'ABSL MF',       category: 'Debt',    nav: 388.21 },
];

const CAT_COLORS: Record<string, { bg: string; text: string }> = {
  Equity: { bg: 'rgba(27,42,74,0.08)',   text: '#1B2A4A' },
  ELSS:   { bg: '#F5EDD6',               text: '#C9A84C' },
  Hybrid: { bg: 'rgba(46,139,139,0.08)', text: '#2E8B8B' },
  Debt:   { bg: 'rgba(5,150,105,0.08)',  text: '#059669' },
};

const BROKERS = [
  { id: 'coin',   name: 'Coin / Zerodha', color: '#2E8B8B', letter: 'C' },
  { id: 'groww',  name: 'Groww',          color: '#00D09C', letter: 'G' },
  { id: 'kuvera', name: 'Kuvera',         color: '#5C6BC0', letter: 'K' },
  { id: 'mfu',    name: 'MFU',            color: '#C9A84C', letter: 'M' },
];

const PORTFOLIOS = ['Long-term Growth', 'Retirement', 'Tax Saving'];
const MEMBERS    = ['Rajesh Shah', 'Priya Shah', 'Arjun Shah'];

type Fund = typeof MF_LIST[number];

export default function MutualFundsPage() {
  const [member, setMember]         = useState('');
  const [portfolio, setPortfolio]   = useState('Long-term Growth');
  const [broker, setBroker]         = useState('');
  const [query, setQuery]           = useState('');
  const [showDrop, setShowDrop]     = useState(false);
  const [selectedFund, setSelected] = useState<Fund | null>(null);
  const [isSIP, setIsSIP]           = useState(false);
  const [amount, setAmount]         = useState('');
  const [nav, setNav]               = useState('');
  const [folio, setFolio]           = useState('');
  const [plan, setPlan]             = useState('');
  const [sipAmount, setSipAmount]   = useState('');
  const [sipDate, setSipDate]       = useState('');
  const [saved, setSaved]           = useState(false);
  const dropRef                     = useRef<HTMLDivElement>(null);

  const filtered = query.length >= 2
    ? MF_LIST.filter((f) => f.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6)
    : [];

  const units   = amount && nav ? (parseFloat(amount) / parseFloat(nav)).toFixed(3) : '';
  const currVal = selectedFund && units ? (parseFloat(units) * selectedFund.nav).toFixed(2) : '';
  const returns = currVal && amount
    ? ((parseFloat(currVal) - parseFloat(amount)) / parseFloat(amount) * 100).toFixed(2)
    : '';
  const canCalc = !!(amount && nav && selectedFund);

  function handleSave() { setSaved(true); setTimeout(() => setSaved(false), 2500); }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(46,139,139,0.1)' }}>
          <BarChart3 className="w-5 h-5" style={{ color: '#2E8B8B' }} />
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold" style={{ color: '#1A1A2E' }}>Mutual Funds</h1>
          <p className="text-xs" style={{ color: '#9CA3AF' }}>Add and manage your mutual fund holdings</p>
        </div>
      </div>

      <Tabs defaultValue="manual">
        <TabsList className="mb-5 w-full" style={{ backgroundColor: '#F7F5F0', border: '1px solid #E8E5DD' }}>
          <TabsTrigger value="manual"  className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white"><BarChart3 className="w-3.5 h-3.5" />Manual Entry</TabsTrigger>
          <TabsTrigger value="import"  className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white"><Upload   className="w-3.5 h-3.5" />CSV / Statement</TabsTrigger>
          <TabsTrigger value="api"     className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white"><LinkIcon className="w-3.5 h-3.5" />API Fetch</TabsTrigger>
        </TabsList>

        {/* ─── Tab 1: Manual Entry ─── */}
        <TabsContent value="manual" className="space-y-4">

          {/* Step 1 */}
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>Step 1 — Portfolio & Broker</p>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Family Member</Label>
                <Select value={member} onValueChange={setMember}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select member" /></SelectTrigger>
                  <SelectContent>{MEMBERS.map((m) => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Portfolio</Label>
                <div className="flex flex-wrap gap-2">
                  {PORTFOLIOS.map((p) => (
                    <button
                      key={p} onClick={() => setPortfolio(p)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
                      style={{ backgroundColor: portfolio === p ? '#1B2A4A' : 'transparent', color: portfolio === p ? 'white' : '#6B7280', borderColor: portfolio === p ? '#1B2A4A' : '#E8E5DD' }}
                    >{p}</button>
                  ))}
                  <button className="px-3 py-1.5 rounded-lg text-xs font-medium border-dashed border transition-colors" style={{ color: '#C9A84C', borderColor: '#C9A84C' }}>+ New</button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Platform / Broker</Label>
                <div className="grid grid-cols-4 gap-2">
                  {BROKERS.map((b) => (
                    <button
                      key={b.id} onClick={() => setBroker(b.id)}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all"
                      style={{ borderColor: broker === b.id ? b.color : '#E8E5DD', backgroundColor: broker === b.id ? `${b.color}12` : 'white', boxShadow: broker === b.id ? `0 0 0 1px ${b.color}` : 'none' }}
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: b.color }}>{b.letter}</div>
                      <span className="text-[10px] font-medium text-center leading-tight" style={{ color: '#6B7280' }}>{b.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>Step 2 — Fund Search</p>
            <div className="relative" ref={dropRef}>
              <Input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setShowDrop(true); setSelected(null); }}
                onFocus={() => setShowDrop(true)}
                placeholder="Type fund name (min 2 chars)..."
                className="h-9 text-xs pr-8"
              />
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: '#9CA3AF' }} />

              {showDrop && filtered.length > 0 && (
                <div className="absolute z-50 top-full mt-1 left-0 right-0 rounded-xl border shadow-card-hover overflow-hidden bg-white" style={{ borderColor: '#E8E5DD' }}>
                  {filtered.map((f) => {
                    const cc = CAT_COLORS[f.category] ?? { bg: '#f3f4f6', text: '#6B7280' };
                    return (
                      <button
                        key={f.amfi}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-bg text-left border-b last:border-0 transition-colors"
                        style={{ borderColor: '#F0EDE6' }}
                        onClick={() => { setSelected(f); setQuery(f.name); setNav(f.nav.toString()); setShowDrop(false); }}
                      >
                        <div className="min-w-0 flex-1 mr-3">
                          <p className="text-xs font-medium truncate" style={{ color: '#1A1A2E' }}>{f.name}</p>
                          <p className="text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>{f.amc} · AMFI {f.amfi}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: cc.bg, color: cc.text }}>{f.category}</span>
                          <span className="text-xs font-bold" style={{ color: '#1A1A2E' }}>₹{f.nav}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedFund && (
              <div className="mt-3 p-3 rounded-xl flex items-center gap-3" style={{ backgroundColor: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.2)' }}>
                <Check className="w-4 h-4 flex-shrink-0" style={{ color: '#059669' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: '#1A1A2E' }}>{selectedFund.name}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: '#6B7280' }}>
                    Latest NAV: <strong>₹{selectedFund.nav}</strong> · {new Date().toLocaleDateString('en-IN')} · {selectedFund.category}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Step 3 */}
          <div className="wv-card p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>Step 3 — Transaction Details</p>
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: '#6B7280' }}>SIP</span>
                <button
                  onClick={() => setIsSIP(!isSIP)}
                  className="relative w-10 h-5 rounded-full transition-colors"
                  style={{ backgroundColor: isSIP ? '#C9A84C' : '#E8E5DD' }}
                >
                  <div className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform" style={{ transform: isSIP ? 'translateX(22px)' : 'translateX(2px)' }} />
                </button>
                <span className="text-xs font-semibold" style={{ color: isSIP ? '#C9A84C' : '#9CA3AF' }}>{isSIP ? 'ON' : 'OFF'}</span>
              </div>
            </div>

            {isSIP ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>SIP Amount (₹)</Label>
                  <Input value={sipAmount} onChange={(e) => setSipAmount(e.target.value)} placeholder="5000" className="h-9 text-xs" type="number" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>SIP Date</Label>
                  <Select value={sipDate} onValueChange={setSipDate}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select date" /></SelectTrigger>
                    <SelectContent>{['1st','5th','10th','15th','25th'].map((d) => <SelectItem key={d} value={d} className="text-xs">{d} of month</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label className="text-xs" style={{ color: '#6B7280' }}>Start Date</Label><Input type="date" className="h-9 text-xs" /></div>
                <div className="space-y-1.5"><Label className="text-xs" style={{ color: '#6B7280' }}>Instalments Completed</Label><Input placeholder="12" className="h-9 text-xs" type="number" /></div>
                <div className="space-y-1.5"><Label className="text-xs" style={{ color: '#6B7280' }}>Total Units</Label><Input placeholder="Auto-calculated" className="h-9 text-xs" readOnly /></div>
                <div className="space-y-1.5"><Label className="text-xs" style={{ color: '#6B7280' }}>Folio Number</Label><Input value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="123456789" className="h-9 text-xs" /></div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Invested Amount (₹)</Label>
                  <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50000" className="h-9 text-xs" type="number" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>
                    NAV at Purchase {selectedFund && <span className="text-[10px] ml-1" style={{ color: '#C9A84C' }}>Latest: ₹{selectedFund.nav}</span>}
                  </Label>
                  <Input value={nav} onChange={(e) => setNav(e.target.value)} placeholder="54.12" className="h-9 text-xs" type="number" step="0.01" />
                </div>
                <div className="space-y-1.5"><Label className="text-xs" style={{ color: '#6B7280' }}>Purchase Date</Label><Input type="date" className="h-9 text-xs" /></div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Units Allotted (auto)</Label>
                  <Input value={units} readOnly placeholder="= Amount ÷ NAV" className="h-9 text-xs" style={{ backgroundColor: units ? 'rgba(5,150,105,0.04)' : undefined }} />
                </div>
                <div className="space-y-1.5"><Label className="text-xs" style={{ color: '#6B7280' }}>Folio Number</Label><Input value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="123456789" className="h-9 text-xs" /></div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Plan Type</Label>
                  <Select value={plan} onValueChange={setPlan}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select plan" /></SelectTrigger>
                    <SelectContent>{['Direct Growth','Direct IDCW','Regular Growth','Regular IDCW'].map((p) => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Stamp Duty (₹) — 0.005% auto</Label>
                  <Input value={amount ? (parseFloat(amount) * 0.00005).toFixed(2) : ''} readOnly placeholder="0.00" className="h-9 text-xs" style={{ backgroundColor: '#F7F5F0' }} />
                </div>
              </div>
            )}

            {canCalc && (
              <div className="mt-4 p-3 rounded-xl grid grid-cols-4 gap-3" style={{ backgroundColor: 'rgba(27,42,74,0.04)', border: '1px solid rgba(27,42,74,0.08)' }}>
                <div><p className="text-[10px]" style={{ color: '#9CA3AF' }}>Invested</p><p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>₹{parseFloat(amount).toLocaleString('en-IN')}</p></div>
                <div><p className="text-[10px]" style={{ color: '#9CA3AF' }}>Current Value</p><p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>₹{parseFloat(currVal!).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p></div>
                <div><p className="text-[10px]" style={{ color: '#9CA3AF' }}>Returns</p><p className="text-xs font-bold" style={{ color: parseFloat(returns!) >= 0 ? '#059669' : '#DC2626' }}>{parseFloat(returns!) >= 0 ? '+' : ''}{returns}%</p></div>
                <div><p className="text-[10px]" style={{ color: '#9CA3AF' }}>Units</p><p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>{units}</p></div>
              </div>
            )}

            <div className="flex items-center gap-3 mt-5">
              <Button onClick={handleSave} className="flex-1 h-9 text-xs font-semibold" style={{ backgroundColor: '#C9A84C', color: '#1B2A4A' }}>
                {saved ? <><Check className="w-3.5 h-3.5 mr-1" />Saved!</> : 'Save entry'}
              </Button>
              <Button className="flex-1 h-9 text-xs font-semibold text-white" style={{ backgroundColor: '#1B2A4A' }}>
                Save &amp; add another
              </Button>
              <Button variant="outline" className="h-9 text-xs" style={{ borderColor: '#E8E5DD', color: '#6B7280' }}>Cancel</Button>
            </div>
          </div>
        </TabsContent>

        {/* ─── Tab 2: CSV Import ─── */}
        <TabsContent value="import">
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>Import Statement</p>
            <label className="flex flex-col items-center justify-center w-full h-40 rounded-xl border-2 border-dashed cursor-pointer hover:bg-bg transition-colors" style={{ borderColor: '#E8E5DD' }}>
              <Upload className="w-8 h-8 mb-2" style={{ color: '#9CA3AF' }} />
              <p className="text-sm font-medium" style={{ color: '#6B7280' }}>Drop your statement here</p>
              <p className="text-xs mt-1" style={{ color: '#9CA3AF' }}>CAMS PDF, KFintech PDF, .csv, .xlsx</p>
              <input type="file" className="hidden" accept=".pdf,.csv,.xlsx" />
            </label>

            <div className="mt-5 rounded-xl overflow-hidden border" style={{ borderColor: '#E8E5DD' }}>
              <table className="w-full text-xs">
                <thead style={{ backgroundColor: '#F7F5F0' }}>
                  <tr>{['Fund Name','Units','Avg NAV','Invested','Current'].map((h) => <th key={h} className="px-3 py-2.5 text-left font-semibold" style={{ color: '#6B7280' }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {[['Axis Bluechip Fund','850.432','48.20','₹41,000','₹46,037'],['Parag Parikh Flexi Cap','412.100','62.55','₹25,769','₹30,024'],['SBI Small Cap Fund','98.200','95.20','₹9,349','₹13,971']].map((row, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #F0EDE6' }}>
                      {row.map((cell, j) => <td key={j} className="px-3 py-2.5" style={{ color: '#1A1A2E' }}>{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button className="w-full mt-4 h-9 text-xs text-white" style={{ backgroundColor: '#1B2A4A' }}>Import all (3 funds)</Button>
          </div>
        </TabsContent>

        {/* ─── Tab 3: API Fetch ─── */}
        <TabsContent value="api">
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>Connect Platform APIs</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { name: 'MFCentral',       color: '#1B2A4A', letter: 'M', desc: 'Fetch from MFCentral portal',  status: 'Ready', statusBg: 'rgba(5,150,105,0.1)', statusColor: '#059669' },
                { name: 'Kuvera',          color: '#5C6BC0', letter: 'K', desc: 'Import via Kuvera account',    status: 'Ready', statusBg: 'rgba(5,150,105,0.1)', statusColor: '#059669' },
                { name: 'Coin by Zerodha', color: '#2E8B8B', letter: 'C', desc: 'Zerodha Coin integration',     status: 'Soon',  statusBg: '#F5EDD6',             statusColor: '#C9A84C' },
                { name: 'Groww',           color: '#00D09C', letter: 'G', desc: 'Groww mutual funds sync',      status: 'Soon',  statusBg: '#F5EDD6',             statusColor: '#C9A84C' },
              ].map((api) => (
                <div key={api.name} className="p-4 rounded-xl border" style={{ borderColor: '#E8E5DD' }}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: api.color }}>{api.letter}</div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: api.statusBg, color: api.statusColor }}>{api.status}</span>
                  </div>
                  <p className="text-xs font-semibold mb-0.5" style={{ color: '#1A1A2E' }}>{api.name}</p>
                  <p className="text-[11px] mb-3" style={{ color: '#9CA3AF' }}>{api.desc}</p>
                  <Button disabled={api.status === 'Soon'} className="w-full h-7 text-[11px]" style={{ backgroundColor: api.status === 'Ready' ? '#1B2A4A' : '#F7F5F0', color: api.status === 'Ready' ? 'white' : '#9CA3AF' }}>
                    {api.status === 'Ready' ? 'Connect' : 'Coming Soon'}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
