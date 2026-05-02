import Link from 'next/link';
import { MessageSquare, Shield, Users, Database, Bot, FileText, Clock, History, KeyRound, Github } from 'lucide-react';

const features = [
  { icon: Users, title: 'Multi-Tenant', description: 'Isolated organizations with tenant-scoped data and separate configurations.' },
  { icon: Bot, title: 'AWS Bedrock', description: 'Claude models via Vercel AI SDK with streaming chat completions.' },
  { icon: Database, title: 'RAG Pipeline', description: 'pgvector embeddings for retrieval-augmented generation over your data.' },
  { icon: Shield, title: 'RBAC & Security', description: 'Four predefined roles — Owner, Admin, Member, Viewer — with granular permissions.' },
  { icon: FileText, title: 'Audit Logs', description: 'Complete activity trail with filtering by event type, severity, and date range.' },
  { icon: Clock, title: 'Background Jobs', description: 'pg-boss workers handle embedding generation and conversation summaries.' },
  { icon: KeyRound, title: 'Cognito Auth', description: 'NextAuth with AWS Cognito SSO support and credentials-based login.' },
  { icon: History, title: 'Conversation History', description: 'Persistent chat history with pagination, search, and model selection.' },
];

const stats = [
  { value: '100%', label: 'Free & open source' },
  { value: 'Multi', label: 'Tenant isolation' },
  { value: 'RBAC', label: 'Built-in roles' },
  { value: 'MIT', label: 'Licensed' },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b" role="navigation">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-lg font-bold">Chatbot</span>
          <div className="flex items-center gap-6 text-sm">
            <a href="#features" className="text-muted-foreground hover:text-foreground">Features</a>
            <a href="https://github.com/kartikmanimuthu/chatbot" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
              <Github className="h-4 w-4" />
              <span className="sr-only">GitHub</span>
            </a>
            <Link href="/docs" className="text-muted-foreground hover:text-foreground">Docs</Link>
            <Link href="/login" className="text-muted-foreground hover:text-foreground">Sign in</Link>
            <Link href="/register" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">Get Started</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <span className="inline-block rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">Open Source · MIT License</span>
        <h1 className="mt-6 text-5xl font-extrabold tracking-tight">AI Chatbot Platform</h1>
        <p className="mt-4 text-lg text-muted-foreground">Self-hosted, multi-tenant chatbot powered by AWS Bedrock. Deploy for free, keep full control of your data.</p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/register" className="rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">Deploy Free</Link>
          <a href="https://github.com/kartikmanimuthu/chatbot" target="_blank" rel="noopener noreferrer" className="rounded-md border px-6 py-3 text-sm font-medium hover:bg-secondary">View on GitHub</a>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y bg-secondary/30">
        <div className="mx-auto flex max-w-4xl items-center justify-around px-6 py-6">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-24">
        <h2 className="text-center text-3xl font-bold">Everything you need for AI chat</h2>
        <p className="mt-2 text-center text-muted-foreground">Enterprise-grade features, zero license cost.</p>
        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {features.map((f) => (
            <div key={f.title} className="rounded-lg border p-6">
              <f.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t bg-secondary/30 px-6 py-24">
        <h2 className="text-center text-3xl font-bold">Free forever</h2>
        <p className="mt-2 text-center text-muted-foreground">Self-host and own your data. No usage limits, no vendor lock-in.</p>
        <div className="mx-auto mt-12 grid max-w-4xl gap-6 sm:grid-cols-3">
          <div className="rounded-lg border bg-white p-6">
            <h3 className="font-semibold">Self-Hosted</h3>
            <div className="mt-2 text-3xl font-bold">$0</div>
            <p className="text-sm text-muted-foreground">forever</p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>All features included</li>
              <li>Unlimited users</li>
              <li>Community support</li>
            </ul>
            <a href="https://github.com/kartikmanimuthu/chatbot" className="mt-6 block rounded-md border px-4 py-2 text-center text-sm font-medium hover:bg-secondary">Deploy Now</a>
          </div>
          <div className="rounded-lg border bg-white p-6 opacity-60">
            <h3 className="font-semibold">Cloud Hosted</h3>
            <div className="mt-2 text-lg font-bold text-muted-foreground">Coming soon</div>
            <p className="text-sm text-muted-foreground">Managed hosting</p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>Zero infrastructure</li>
              <li>Automatic updates</li>
              <li>Priority support</li>
            </ul>
          </div>
          <div className="rounded-lg border bg-white p-6 opacity-60">
            <h3 className="font-semibold">Enterprise</h3>
            <div className="mt-2 text-lg font-bold text-muted-foreground">Custom</div>
            <p className="text-sm text-muted-foreground">Dedicated support</p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>SLA guarantees</li>
              <li>Custom integrations</li>
              <li>On-premise option</li>
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h2 className="text-3xl font-bold">Ready to deploy your AI chatbot?</h2>
        <p className="mt-2 text-muted-foreground">Get started in under 5 minutes. Free, open source, and self-hosted.</p>
        <Link href="/register" className="mt-6 inline-block rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">Get started free</Link>
      </section>

      {/* Footer */}
      <footer className="border-t" role="contentinfo">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-sm text-muted-foreground">
          <span>Chatbot · MIT License</span>
          <div className="flex gap-4">
            <Link href="/docs">Docs</Link>
            <Link href="/docs/getting-started">Getting Started</Link>
            <a href="https://github.com/kartikmanimuthu/chatbot" target="_blank" rel="noopener noreferrer">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
