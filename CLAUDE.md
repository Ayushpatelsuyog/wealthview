# WealthView — Project Conventions

## Overview
WealthView is a Family Net Worth Tracker & Wealth Advisory Platform built with Next.js 14 App Router, TypeScript, Tailwind CSS, shadcn/ui, Supabase, and Recharts.

## Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS only — no CSS modules, no styled-components
- **Components**: shadcn/ui (new-york style, slate base)
- **Database & Auth**: Supabase (PostgreSQL + Supabase Auth)
- **State**: Zustand stores in `src/lib/stores/`
- **Charts**: Recharts
- **Icons**: lucide-react

## Architecture Rules

### Server vs Client Components
- Server components by default — avoid `'use client'` unless needed
- Use `'use client'` only for: interactivity, browser APIs, Zustand stores, Recharts
- Data fetching: prefer server components using `src/lib/supabase/server.ts`
- Client-side mutations: use `src/lib/supabase/client.ts`

### File Structure
```
src/
  app/
    (auth)/          # Login, signup — no sidebar
    (dashboard)/     # All authenticated pages with sidebar
    api/             # API route handlers
  components/
    layout/          # Sidebar, Header
    dashboard/       # Dashboard widgets
    forms/           # Asset entry forms
    ui/              # shadcn/ui components (auto-generated)
  lib/
    supabase/        # client.ts, server.ts, middleware.ts
    stores/          # Zustand stores
    types/           # TypeScript interfaces/types
    utils/           # formatters.ts, calculations.ts
  middleware.ts      # Auth redirect logic
supabase/
  schema.sql         # Full DB schema with RLS policies
```

### Naming Conventions
- Files: `PascalCase.tsx` for components, `camelCase.ts` for utilities
- Components: PascalCase functional components
- Types: PascalCase interfaces in `src/lib/types/index.ts`
- Stores: `use<Name>Store` pattern

### Currency & Formatting
- **Default currency**: INR (Indian Rupee)
- Use `formatLargeINR()` for compact display: `₹8.47Cr`, `₹1.25L`
- Use `formatCurrency()` for full display with Intl.NumberFormat
- Always use `en-IN` locale for Indian number formatting

### Brand Colors
- **Navy** `#1B2A4A` — primary brand, sidebar background, CTAs
- **Gold** `#C9A84C` — accents, highlights, active states
- **Off-white** `#F7F5F0` — page background

Use inline styles for brand colors (`style={{ backgroundColor: '#1B2A4A' }}`), not custom Tailwind classes.

### Database
- All tables use `uuid` PKs with `gen_random_uuid()`
- Every table has Row Level Security (RLS) enabled
- All data is scoped to `family_id` — users only access their family's data
- `users` table extends `auth.users` via trigger on signup
- Run `supabase/schema.sql` to initialize the database

### State Management
- Zustand stores for client-side state (auth, wealth data)
- No Redux, no Context API for global state
- Server state: fetch in server components and pass as props

### Error Handling
- Show user-friendly error messages in forms
- Log errors server-side, never expose stack traces to client
- Use Supabase error handling patterns

## Getting Started
1. Copy `.env.local.example` → `.env.local` and fill in Supabase credentials
2. Run `supabase/schema.sql` in your Supabase SQL editor
3. `npm install && npm run dev`
