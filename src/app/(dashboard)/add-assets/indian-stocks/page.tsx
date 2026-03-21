'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TrendingUp, Upload, Link as LinkIcon, Check, ChevronDown } from 'lucide-react';

const STOCKS = [
  { symbol: 'RELIANCE',  name: 'Reliance Industries Ltd',       exchange: 'NSE', price: 2847.55 },
  { symbol: 'TCS',       name: 'Tata Consultancy Services',     exchange: 'NSE', price: 3912.40 },
  { symbol: 'HDFCBANK',  name: 'HDFC Bank Ltd',                 exchange: 'NSE', price: 1654.20 },
  { symbol: 'INFY',      name: 'Infosys Ltd',                   exchange: 'NSE', price: 1789.85 },
  { symbol: 'WIPRO',     name: 'Wipro Ltd',                     exchange: 'NSE', price: 478.30  },
  { symbol: 'SBIN',      name: 'State Bank of India',           exchange: 'NSE', price: 812.65  },
  { symbol: 'ICICIBANK', name: 'ICICI Bank Ltd',                exchange: 'NSE', price: 1243.50 },
  { symbol: 'BAJFINANCE',name: 'Bajaj Finance Ltd',             exchange: 'NSE', price: 7245.00 },
  { symbol: 'LT',        name: 'Larsen & Toubro Ltd',           exchange: 'NSE', price: 3542.80 },
  { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical Industries', exchange: 'NSE', price: 1678.45 },
];

const BROKERS = [
  { id: 'zerodha', name: 'Zerodha',     color: '#2E8B8B', letter: 'Z' },
  { id: 'groww',   name: 'Groww',       color: '#00D09C', letter: 'G' },
  { id: 'angel',   name: 'Angel One',   color: '#DC2626', letter: 'A' },
  { id: 'icici',   name: 'ICICI Direct',color: '#FF6600', letter: 'I' },
];

const MEMBERS = ['Rajesh Shah', 'Priya Shah', 'Arjun Shah'];

type Stock = typeof STOCKS[number];

export default function IndianStocksPage() {
  const [member, setMember]       = useState('');
  const [broker, setBroker]       = useState('');
  const [query, setQuery]         = useState('');
  const [showDrop, setShowDrop]   = useState(false);
  const [selected, setSelected]   = useState<Stock | null>(null);
  const [exchange, setExchange]   = useState('NSE');
  const [qty, setQty]             = useState('');
  const [buyPrice, setBuyPrice]   = useState('');
  const [buyDate, setBuyDate]     = useState('');
  const [demat, setDemat]         = useState('');
  const [brokerage, setBrokerage] = useState('');
  const [saved, setSaved]         = useState(false);

  const filtered = query.length >= 2
    ? STOCKS.filter((s) =>
        s.symbol.toLowerCase().includes(query.toLowerCase()) ||
        s.name.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 6)
    : [];

  const totalCost = qty && buyPrice ? (parseFloat(qty) * parseFloat(buyPrice)).toFixed(2) : '';
  const currValue = selected && qty  ? (parseFloat(qty) * selected.price).toFixed(2) : '';
  const gainLoss  = currValue && totalCost ? (parseFloat(currValue) - parseFloat(totalCost)).toFixed(2) : '';
  const gainPct   = gainLoss && totalCost  ? ((parseFloat(gainLoss) / parseFloat(totalCost)) * 100).toFixed(2) : '';
  const canCalc   = !!(qty && buyPrice && selected);

  function handleSave() { setSaved(true); setTimeout(() => setSaved(false), 2500); }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(27,42,74,0.08)' }}>
          <TrendingUp className="w-5 h-5" style={{ color: '#1B2A4A' }} />
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold" style={{ color: '#1A1A2E' }}>Indian Stocks</h1>
          <p className="text-xs" style={{ color: '#9CA3AF' }}>Add NSE/BSE equity holdings</p>
        </div>
      </div>

      <Tabs defaultValue="manual">
        <TabsList className="mb-5 w-full" style={{ backgroundColor: '#F7F5F0', border: '1px solid #E8E5DD' }}>
          <TabsTrigger value="manual" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white"><TrendingUp className="w-3.5 h-3.5" />Manual Entry</TabsTrigger>
          <TabsTrigger value="import" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white"><Upload    className="w-3.5 h-3.5" />Import Statement</TabsTrigger>
          <TabsTrigger value="sync"   className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white"><LinkIcon  className="w-3.5 h-3.5" />API Sync</TabsTrigger>
        </TabsList>

        <TabsContent value="manual" className="space-y-4">
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>Step 1 — Account & Broker</p>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Family Member</Label>
                <Select value={member} onValueChange={setMember}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select member" /></SelectTrigger>
                  <SelectContent>{MEMBERS.map((m) => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Broker</Label>
                <div className="grid grid-cols-4 gap-2">
                  {BROKERS.map((b) => (
                    <button key={b.id} onClick={() => setBroker(b.id)}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all"
                      style={{ borderColor: broker === b.id ? b.color : '#E8E5DD', backgroundColor: broker === b.id ? `${b.color}12` : 'white', boxShadow: broker === b.id ? `0 0 0 1px ${b.color}` : 'none' }}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: b.color }}>{b.letter}</div>
                      <span className="text-[10px] font-medium text-center leading-tight" style={{ color: '#6B7280' }}>{b.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Demat Account No.</Label>
                <Input value={demat} onChange={(e) => setDemat(e.target.value)} placeholder="1234567890123456" className="h-9 text-xs" />
              </div>
            </div>
          </div>

          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>Step 2 — Stock Search</p>
            <div className="flex gap-2 mb-3">
              {['NSE','BSE'].map((ex) => (
                <button key={ex} onClick={() => setExchange(ex)}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                  style={{ backgroundColor: exchange === ex ? '#1B2A4A' : 'transparent', color: exchange === ex ? 'white' : '#6B7280', borderColor: exchange === ex ? '#1B2A4A' : '#E8E5DD' }}>
                  {ex}
                </button>
              ))}
            </div>
            <div className="relative">
              <Input value={query} onChange={(e) => { setQuery(e.target.value); setShowDrop(true); setSelected(null); }} onFocus={() => setShowDrop(true)} placeholder="Search symbol or company name..." className="h-9 text-xs pr-8" />
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: '#9CA3AF' }} />
              {showDrop && filtered.length > 0 && (
                <div className="absolute z-50 top-full mt-1 left-0 right-0 rounded-xl border shadow-card-hover overflow-hidden bg-white" style={{ borderColor: '#E8E5DD' }}>
                  {filtered.map((s) => (
                    <button key={s.symbol} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-bg text-left border-b last:border-0" style={{ borderColor: '#F0EDE6' }}
                      onClick={() => { setSelected(s); setQuery(`${s.symbol} — ${s.name}`); setBuyPrice(s.price.toString()); setShowDrop(false); }}>
                      <div>
                        <p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>{s.symbol}</p>
                        <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{s.name} · {s.exchange}</p>
                      </div>
                      <span className="text-xs font-bold" style={{ color: '#1A1A2E' }}>₹{s.price.toLocaleString('en-IN')}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selected && (
              <div className="mt-3 p-3 rounded-xl flex items-center gap-3" style={{ backgroundColor: 'rgba(27,42,74,0.05)', border: '1px solid rgba(27,42,74,0.12)' }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: '#1B2A4A' }}>{selected.symbol.slice(0,2)}</div>
                <div>
                  <p className="text-xs font-semibold" style={{ color: '#1A1A2E' }}>{selected.name}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: '#6B7280' }}>CMP: <strong>₹{selected.price.toLocaleString('en-IN')}</strong> · {selected.exchange}</p>
                </div>
              </div>
            )}
          </div>

          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>Step 3 — Transaction Details</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Quantity (shares)</Label>
                <Input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="100" className="h-9 text-xs" type="number" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Buy Price (₹) {selected && <span className="text-[10px] ml-1" style={{ color: '#C9A84C' }}>CMP: ₹{selected.price}</span>}</Label>
                <Input value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} placeholder="2800.00" className="h-9 text-xs" type="number" step="0.01" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Buy Date</Label>
                <Input value={buyDate} onChange={(e) => setBuyDate(e.target.value)} type="date" className="h-9 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Brokerage (₹)</Label>
                <Input value={brokerage} onChange={(e) => setBrokerage(e.target.value)} placeholder="20.00" className="h-9 text-xs" type="number" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Total Investment (auto)</Label>
                <Input value={totalCost ? `₹${parseFloat(totalCost).toLocaleString('en-IN',{maximumFractionDigits:2})}` : ''} readOnly placeholder="= Qty × Buy Price" className="h-9 text-xs font-semibold" style={{ backgroundColor: totalCost ? 'rgba(27,42,74,0.04)' : '#F7F5F0' }} />
              </div>
            </div>
            {canCalc && (
              <div className="mt-4 p-3 rounded-xl grid grid-cols-4 gap-3" style={{ backgroundColor: 'rgba(27,42,74,0.04)', border: '1px solid rgba(27,42,74,0.08)' }}>
                <div><p className="text-[10px]" style={{ color: '#9CA3AF' }}>Invested</p><p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>₹{parseFloat(totalCost!).toLocaleString('en-IN',{maximumFractionDigits:0})}</p></div>
                <div><p className="text-[10px]" style={{ color: '#9CA3AF' }}>Current</p><p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>₹{parseFloat(currValue!).toLocaleString('en-IN',{maximumFractionDigits:0})}</p></div>
                <div><p className="text-[10px]" style={{ color: '#9CA3AF' }}>Gain/Loss</p><p className="text-xs font-bold" style={{ color: parseFloat(gainLoss!)>=0?'#059669':'#DC2626' }}>{parseFloat(gainLoss!)>=0?'+':'-'}₹{Math.abs(parseFloat(gainLoss!)).toLocaleString('en-IN',{maximumFractionDigits:0})}</p></div>
                <div><p className="text-[10px]" style={{ color: '#9CA3AF' }}>Returns</p><p className="text-xs font-bold" style={{ color: parseFloat(gainPct!)>=0?'#059669':'#DC2626' }}>{parseFloat(gainPct!)>=0?'+':''}{gainPct}%</p></div>
              </div>
            )}
            <div className="flex gap-3 mt-5">
              <Button onClick={handleSave} className="flex-1 h-9 text-xs font-semibold" style={{ backgroundColor: '#C9A84C', color: '#1B2A4A' }}>
                {saved ? <><Check className="w-3.5 h-3.5 mr-1" />Saved!</> : 'Save holding'}
              </Button>
              <Button className="flex-1 h-9 text-xs font-semibold text-white" style={{ backgroundColor: '#1B2A4A' }}>Save &amp; add another</Button>
              <Button variant="outline" className="h-9 text-xs" style={{ borderColor: '#E8E5DD', color: '#6B7280' }}>Cancel</Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="import">
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>Import Broker Statement</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {['Zerodha P&L Report','Groww Statement','Angel One Report','ICICI Direct CAS'].map((fmt) => (
                <div key={fmt} className="p-3 rounded-xl border flex items-center gap-2" style={{ borderColor: '#E8E5DD' }}>
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#C9A84C' }} />
                  <span className="text-xs" style={{ color: '#6B7280' }}>{fmt}</span>
                </div>
              ))}
            </div>
            <label className="flex flex-col items-center justify-center w-full h-36 rounded-xl border-2 border-dashed cursor-pointer hover:bg-bg transition-colors" style={{ borderColor: '#E8E5DD' }}>
              <Upload className="w-7 h-7 mb-2" style={{ color: '#9CA3AF' }} />
              <p className="text-sm font-medium" style={{ color: '#6B7280' }}>Upload statement</p>
              <p className="text-xs mt-1" style={{ color: '#9CA3AF' }}>.xlsx, .csv, .pdf</p>
              <input type="file" className="hidden" accept=".pdf,.csv,.xlsx" />
            </label>
          </div>
        </TabsContent>

        <TabsContent value="sync">
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>Broker API Sync</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { name:'Zerodha Kite', color:'#2E8B8B', letter:'Z', status:'Ready',  statusBg:'rgba(5,150,105,0.1)', statusColor:'#059669' },
                { name:'Angel One',    color:'#DC2626', letter:'A', status:'Ready',  statusBg:'rgba(5,150,105,0.1)', statusColor:'#059669' },
                { name:'Groww',        color:'#00D09C', letter:'G', status:'Soon',   statusBg:'#F5EDD6',             statusColor:'#C9A84C' },
                { name:'ICICI Direct', color:'#FF6600', letter:'I', status:'Soon',   statusBg:'#F5EDD6',             statusColor:'#C9A84C' },
              ].map((api) => (
                <div key={api.name} className="p-4 rounded-xl border" style={{ borderColor: '#E8E5DD' }}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: api.color }}>{api.letter}</div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: api.statusBg, color: api.statusColor }}>{api.status}</span>
                  </div>
                  <p className="text-xs font-semibold mb-3" style={{ color: '#1A1A2E' }}>{api.name}</p>
                  <Button disabled={api.status==='Soon'} className="w-full h-7 text-[11px]" style={{ backgroundColor: api.status==='Ready'?'#1B2A4A':'#F7F5F0', color: api.status==='Ready'?'white':'#9CA3AF' }}>
                    {api.status==='Ready'?'Connect':'Coming Soon'}
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
