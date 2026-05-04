'use client';

import Link from 'next/link';
import {
  MessageSquare,
  Shield,
  Users,
  Database,
  Bot,
  FileText,
  Clock,
  History,
  KeyRound,
  Code2,
  Zap,
} from 'lucide-react';
import { motion, useInView, useMotionValue, useTransform, animate } from 'framer-motion';
import { useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';

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
  { value: 100, suffix: '%', label: 'Free & open source' },
  { value: 10, suffix: '+', label: 'Tenant isolation' },
  { value: 4, suffix: '', label: 'Built-in roles' },
  { value: 1, suffix: '', label: 'MIT Licensed' },
];

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

function CountUp({ target, suffix }: { target: number; suffix: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => Math.round(v));

  useEffect(() => {
    if (isInView) {
      const controls = animate(count, target, { duration: 1.5, ease: 'easeOut' });
      return controls.stop;
    }
  }, [isInView, target, count]);

  return (
    <span ref={ref}>
      <motion.span>{rounded}</motion.span>
      {suffix}
    </span>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b" role="navigation">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-lg font-bold">Chatbot</span>
          <div className="flex items-center gap-6 text-sm">
            <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors">Features</a>
            <a href="#pricing" className="text-muted-foreground hover:text-foreground transition-colors">Pricing</a>
            <a href="https://github.com/kartikmanimuthu/chatbot" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
              <Code2 className="h-4 w-4" />
              <span className="sr-only">GitHub</span>
            </a>
            <Link href="/docs" className="text-muted-foreground hover:text-foreground transition-colors">Docs</Link>
            <Link href="/login" className="text-muted-foreground hover:text-foreground transition-colors">Sign in</Link>
            <Link href="/register">
              <Button size="sm">Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      <section className="relative mx-auto max-w-4xl px-6 py-24 text-center overflow-hidden">
        <div
          className="absolute inset-0 -z-10 opacity-[0.15]"
          style={{
            backgroundImage: 'radial-gradient(circle, hsl(var(--foreground)) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
        <motion.div
          initial="hidden"
          animate="show"
          variants={container}
          className="relative"
        >
          <motion.span variants={item} className="inline-block rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
            Open Source · MIT License
          </motion.span>

          <motion.h1
            variants={item}
            className="mt-6 text-5xl font-extrabold tracking-tight">
            <span className="bg-gradient-to-r from-primary to-ring bg-clip-text text-transparent">AI Chatbot Platform</span>
          </motion.h1>

          <motion.p variants={item} className="mt-4 text-lg text-muted-foreground">
            Self-hosted, multi-tenant chatbot powered by AWS Bedrock. Deploy for free, keep full control of your data.
          </motion.p>

          <motion.div variants={item} className="mt-8 flex items-center justify-center gap-4">
            <Link href="/register">
              <Button size="lg">Deploy Free</Button>
            </Link>
            <a
              href="https://github.com/kartikmanimuthu/chatbot"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="lg">View on GitHub</Button>
            </a>
          </motion.div>
        </motion.div>
      </section>

      <section className="border-y bg-secondary/30">
        <div className="mx-auto flex max-w-4xl items-center justify-around px-6 py-10">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-3xl font-bold">
                <CountUp target={s.value} suffix={s.suffix} />
              </div>
              <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-6 py-24">
        <div className="text-center">
          <h2 className="text-3xl font-bold">Everything you need for AI chat</h2>
          <p className="mt-2 text-muted-foreground">Enterprise-grade features, zero license cost.</p>
        </div>

        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          variants={container}
          className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4"
        >
          {features.map((f) => (
            <motion.div key={f.title} variants={item}>
              <Card
                className="h-full transition-shadow hover:shadow-md"
              >
                <motion.div
                  whileHover={{ y: -4 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  className="h-full"
                >
                  <CardContent className="pt-6">
                    <div className="inline-flex items-center justify-center rounded-lg bg-primary/10 p-2">
                      <f.icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="mt-3">{f.title}</CardTitle>
                    <CardDescription className="mt-1">{f.description}</CardDescription>
                  </CardContent>
                </motion.div>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </section>

      <section id="pricing" className="border-t bg-secondary/30 px-6 py-24">
        <div className="text-center">
          <h2 className="text-3xl font-bold">Free forever</h2>
          <p className="mt-2 text-muted-foreground">Self-host and own your data. No usage limits, no vendor lock-in.</p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl gap-6 sm:grid-cols-3">
          {[
            {
              title: 'Self-Hosted',
              price: '$0',
              sub: 'forever',
              features: ['All features included', 'Unlimited users', 'Community support'],
              cta: 'Deploy Now',
              ctaHref: 'https://github.com/kartikmanimuthu/chatbot',
              active: true,
            },
            {
              title: 'Cloud Hosted',
              price: 'Coming soon',
              sub: 'Managed hosting',
              features: ['Zero infrastructure', 'Automatic updates', 'Priority support'],
              cta: null,
              ctaHref: null,
              active: false,
            },
            {
              title: 'Enterprise',
              price: 'Custom',
              sub: 'Dedicated support',
              features: ['SLA guarantees', 'Custom integrations', 'On-premise option'],
              cta: null,
              ctaHref: null,
              active: false,
            },
          ].map((tier) => (
            <motion.div
              key={tier.title}
              whileHover={tier.active ? { scale: 1.02 } : undefined}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className={tier.active ? 'relative' : 'opacity-60'}
            >
              {tier.active && (
                <div className="absolute -inset-px rounded-xl bg-gradient-to-r from-primary/40 to-ring/40 blur-sm transition-opacity" />
              )}
              <Card className={`relative h-full ${tier.active ? 'border-primary/30' : ''}`}>
                <CardHeader>
                  <CardTitle>{tier.title}</CardTitle>
                  <div className="mt-2 text-3xl font-bold">{tier.price}</div>
                  <CardDescription>{tier.sub}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {tier.features.map((f) => (
                      <li key={f} className="flex items-center gap-2">
                        <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  {tier.cta && tier.ctaHref && (
                    <a
                      href={tier.ctaHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-6 block"
                    >
                      <Button variant="outline" className="w-full">{tier.cta}</Button>
                    </a>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl font-bold">Ready to deploy your AI chatbot?</h2>
          <p className="mt-2 text-muted-foreground">Get started in under 5 minutes. Free, open source, and self-hosted.</p>
          <Link href="/register" className="mt-6 inline-block">
            <Button size="lg">Get started free</Button>
          </Link>
        </motion.div>
      </section>

      <footer className="border-t" role="contentinfo">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <Separator className="mb-6" />
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Chatbot · MIT License</span>
            <div className="flex gap-4">
              <Link href="/docs" className="hover:text-foreground transition-colors">Docs</Link>
              <Link href="/docs/getting-started" className="hover:text-foreground transition-colors">Getting Started</Link>
              <a href="https://github.com/kartikmanimuthu/chatbot" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">GitHub</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
