'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TrendingUp, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: 'var(--wv-surface-2)' }}>
      {/* Left panel */}
      <div
        className="hidden lg:flex flex-col justify-between w-1/2 p-12"
        style={{ backgroundColor: '#1B2A4A' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: '#C9A84C' }}
          >
            <TrendingUp className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-semibold text-white">WealthView</span>
        </div>

        <div>
          <blockquote className="text-white/80 text-lg leading-relaxed">
            &ldquo;The goal isn&apos;t more money. The goal is living life on your terms.&rdquo;
          </blockquote>
          <p className="mt-4 text-white/50 text-sm">Complete visibility of your family&apos;s wealth</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Assets Tracked', value: '12+' },
            { label: 'Families', value: '500+' },
            { label: 'Avg XIRR', value: '16.8%' },
            { label: 'Net Worth Tracked', value: '₹500Cr+' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg p-4" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <p className="text-2xl font-bold" style={{ color: '#C9A84C' }}>{stat.value}</p>
              <p className="text-white/60 text-sm mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: '#1B2A4A' }}
            >
              <TrendingUp className="w-6 h-6" style={{ color: '#C9A84C' }} />
            </div>
            <span className="text-xl font-semibold" style={{ color: 'var(--wv-text)' }}>WealthView</span>
          </div>

          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--wv-text)' }}>Welcome back</h1>
          <p className="text-gray-500 mb-8">Sign in to your wealth dashboard</p>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" style={{ color: 'var(--wv-text)' }}>Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11 border-gray-200 focus:border-[#C9A84C] focus:ring-[#C9A84C]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" style={{ color: 'var(--wv-text)' }}>Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-11 pr-10 border-gray-200 focus:border-[#C9A84C] focus:ring-[#C9A84C]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 text-white font-medium"
              style={{ backgroundColor: '#1B2A4A' }}
            >
              {isLoading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="font-medium" style={{ color: '#C9A84C' }}>
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
