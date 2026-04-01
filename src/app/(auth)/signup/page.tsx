'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TrendingUp, Eye, EyeOff } from 'lucide-react';

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
        emailRedirectTo: `${window.location.origin}/`,
      },
    });

    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }

    setSuccess(true);
    setIsLoading(false);
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--wv-surface-2)' }}>
        <div className="text-center max-w-md p-8">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: '#1B2A4A' }}
          >
            <TrendingUp className="w-8 h-8" style={{ color: '#C9A84C' }} />
          </div>
          <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--wv-text)' }}>Check your email</h2>
          <p className="text-gray-500">
            We&apos;ve sent a confirmation link to <strong>{email}</strong>. Click it to activate your account.
          </p>
          <Link href="/login" className="mt-6 inline-block text-sm font-medium" style={{ color: '#C9A84C' }}>
            Back to login
          </Link>
        </div>
      </div>
    );
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

        <div className="space-y-6">
          {[
            { title: '12+ Asset Classes', desc: 'Track stocks, mutual funds, real estate, gold, crypto and more' },
            { title: 'Family Dashboard', desc: 'View all family members\' portfolios in one place' },
            { title: 'AI Advisory', desc: 'Get personalized recommendations from your wealth advisor' },
          ].map((feature) => (
            <div key={feature.title} className="flex gap-4">
              <div
                className="w-2 h-2 rounded-full mt-2 flex-shrink-0"
                style={{ backgroundColor: '#C9A84C' }}
              />
              <div>
                <p className="text-white font-medium">{feature.title}</p>
                <p className="text-white/60 text-sm">{feature.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-white/30 text-sm">© 2025 WealthView. All rights reserved.</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: '#1B2A4A' }}
            >
              <TrendingUp className="w-6 h-6" style={{ color: '#C9A84C' }} />
            </div>
            <span className="text-xl font-semibold" style={{ color: 'var(--wv-text)' }}>WealthView</span>
          </div>

          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--wv-text)' }}>Create your account</h1>
          <p className="text-gray-500 mb-8">Start tracking your family&apos;s wealth</p>

          <form onSubmit={handleSignup} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name" style={{ color: 'var(--wv-text)' }}>Full name</Label>
              <Input
                id="name"
                type="text"
                placeholder="Rajesh Shah"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" style={{ color: 'var(--wv-text)' }}>Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" style={{ color: 'var(--wv-text)' }}>Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Min. 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="h-11 pr-10"
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
              {isLoading ? 'Creating account...' : 'Create account'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            Already have an account?{' '}
            <Link href="/login" className="font-medium" style={{ color: '#C9A84C' }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
