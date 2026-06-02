'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, ArrowLeft, RotateCcw, ExternalLink } from 'lucide-react';

const SDK_SCRIPT_URL = '/sdk-assets/smc-chat-widget.esm.js';

interface Widget {
  id: string;
  name: string;
  sdkId: string;
  status: string;
}

function buildMockWebsiteHtml(sdkId: string, origin: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Acme — Customer Support</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
body{font-family:Inter,sans-serif;}
</style>
</head>
<body class="bg-white text-slate-900 antialiased">
<nav class="border-b border-slate-100">
  <div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
    <div class="flex items-center gap-2">
      <div class="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm">A</div>
      <span class="font-bold text-lg tracking-tight">Acme</span>
    </div>
    <div class="hidden md:flex items-center gap-8 text-sm text-slate-600">
      <a href="#" class="hover:text-slate-900 transition-colors">Product</a>
      <a href="#" class="hover:text-slate-900 transition-colors">Pricing</a>
      <a href="#" class="hover:text-slate-900 transition-colors">Docs</a>
      <a href="#" class="hover:text-slate-900 transition-colors">Contact</a>
    </div>
    <div class="flex items-center gap-3">
      <a href="#" class="text-sm font-medium text-slate-600 hover:text-slate-900">Sign in</a>
      <a href="#" class="text-sm font-medium bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors">Get started</a>
    </div>
  </div>
</nav>

<section class="pt-20 pb-24 text-center px-6">
  <div class="max-w-3xl mx-auto">
    <div class="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-sm font-medium mb-8">
      <span class="relative flex h-2 w-2">
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
        <span class="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
      </span>
      Now with AI-powered support
    </div>
    <h1 class="text-5xl font-bold tracking-tight mb-6">Support that scales with you</h1>
    <p class="text-xl text-slate-600 mb-10 leading-relaxed max-w-2xl mx-auto">Deliver exceptional customer experiences with our AI-powered support platform. Available 24/7, personalized for every user.</p>
    <div class="flex items-center justify-center gap-4">
      <a href="#" class="bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-indigo-700 transition-colors shadow-sm">Start free trial</a>
      <a href="#" class="border border-slate-200 px-6 py-3 rounded-lg font-medium hover:bg-slate-50 transition-colors">View demo</a>
    </div>
  </div>
</section>

<section class="py-20 bg-slate-50 border-y border-slate-100">
  <div class="max-w-6xl mx-auto px-6">
    <div class="text-center mb-12">
      <h2 class="text-2xl font-bold mb-3">Everything you need</h2>
      <p class="text-slate-600">Powerful features to supercharge your support workflow</p>
    </div>
    <div class="grid md:grid-cols-3 gap-8">
      <div class="bg-white p-6 rounded-xl border border-slate-100 hover:shadow-md transition-shadow">
        <div class="h-10 w-10 rounded-lg bg-indigo-50 flex items-center justify-center mb-4 text-indigo-600 font-bold text-sm">I</div>
        <h3 class="font-semibold mb-2">Instant responses</h3>
        <p class="text-sm text-slate-600 leading-relaxed">Our AI understands context and delivers accurate answers in seconds, not hours.</p>
      </div>
      <div class="bg-white p-6 rounded-xl border border-slate-100 hover:shadow-md transition-shadow">
        <div class="h-10 w-10 rounded-lg bg-emerald-50 flex items-center justify-center mb-4 text-emerald-600 font-bold text-sm">S</div>
        <h3 class="font-semibold mb-2">Enterprise security</h3>
        <p class="text-sm text-slate-600 leading-relaxed">SOC 2 Type II compliant with end-to-end encryption for all conversations.</p>
      </div>
      <div class="bg-white p-6 rounded-xl border border-slate-100 hover:shadow-md transition-shadow">
        <div class="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center mb-4 text-amber-600 font-bold text-sm">G</div>
        <h3 class="font-semibold mb-2">Global reach</h3>
        <p class="text-sm text-slate-600 leading-relaxed">Support customers in 40+ languages with real-time translation built-in.</p>
      </div>
    </div>
  </div>
</section>

<section class="py-20 px-6">
  <div class="max-w-3xl mx-auto text-center">
    <p class="text-2xl font-medium text-slate-800 mb-6 leading-relaxed">&ldquo;Acme transformed how we handle customer support. Response times dropped by 80% and satisfaction scores are at an all-time high.&rdquo;</p>
    <div class="flex items-center justify-center gap-3">
      <div class="h-10 w-10 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500"></div>
      <div class="text-left">
        <p class="font-medium text-sm">Sarah Chen</p>
        <p class="text-xs text-slate-500">Head of Support, TechCorp</p>
      </div>
    </div>
  </div>
</section>

<section class="py-20 bg-slate-900 text-white px-6">
  <div class="max-w-3xl mx-auto text-center">
    <h2 class="text-3xl font-bold mb-4">Ready to upgrade your support?</h2>
    <p class="text-slate-300 mb-8 text-lg">Join 500+ companies delivering faster, smarter customer support.</p>
    <a href="#" class="inline-block bg-indigo-600 text-white px-8 py-3 rounded-lg font-medium hover:bg-indigo-500 transition-colors">Get started today</a>
  </div>
</section>

<footer class="border-t border-slate-100 py-12 px-6">
  <div class="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
    <div class="flex items-center gap-2">
      <div class="h-6 w-6 rounded bg-slate-900 flex items-center justify-center text-white font-bold text-xs">A</div>
      <span class="font-semibold text-sm">Acme Inc.</span>
    </div>
    <p class="text-xs text-slate-400">&copy; 2026 Acme Inc. All rights reserved.</p>
  </div>
</footer>

<smc-chat-widget sdk-id="${sdkId}" api-url="${origin}" cache-bust="${Date.now()}"></smc-chat-widget>
<script type="module" src="${SDK_SCRIPT_URL}"></script>
</body>
</html>`;
}

export default function SandboxPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const widgetId = searchParams.get('id');

  const [widget, setWidget] = useState<Widget | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iframeHtml, setIframeHtml] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!widgetId) {
      setWidget(null);
      setError(null);
      setIframeHtml('');
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/api/v1/sdk-widgets/${widgetId}`)
      .then(async (r) => {
        if (!r.ok) {
          if (r.status === 404) throw new Error('Widget not found');
          const text = await r.text();
          throw new Error(text || 'Failed to load widget');
        }
        return r.json() as Promise<Widget>;
      })
      .then((data) => {
        setWidget(data);
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        setIframeHtml(buildMockWebsiteHtml(data.sdkId, origin));
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [widgetId]);

  const handleReset = () => {
    if (!widget) return;
    setIframeHtml('');
    setTimeout(() => {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setIframeHtml(buildMockWebsiteHtml(widget.sdkId, origin));
    }, 50);
  };

  return (
    <div className="flex flex-col gap-6 p-6 h-[calc(100vh-4rem)]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Widget Sandbox</h1>
          <p className="text-muted-foreground">Live demonstration on a mock website</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => router.push('/sdks/chat-widget/designer?id=' + (widgetId ?? ''))}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Designer
        </Button>
      </div>

      {!widgetId && (
        <Card>
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <h3 className="text-lg font-semibold mb-2">No Widget Selected</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Select a widget from the designer to preview it in the sandbox.
            </p>
            <Button onClick={() => router.push('/sdks/chat-widget/designer')}>
              Go to Designer
            </Button>
          </CardContent>
        </Card>
      )}

      {widgetId && loading && (
        <div className="space-y-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-[500px] w-full rounded-xl" />
        </div>
      )}

      {widgetId && error && (
        <Card>
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-10 w-10 text-destructive/40 mx-auto mb-3" />
            <h3 className="text-lg font-semibold mb-2">Error Loading Widget</h3>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button onClick={() => router.push('/sdks/chat-widget/designer')}>
              Back to Designer
            </Button>
          </CardContent>
        </Card>
      )}

      {widget && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-wrap">
                  <CardTitle className="text-base">{widget.name}</CardTitle>
                  <Badge variant="outline" className="font-mono text-xs">
                    {widget.sdkId}
                  </Badge>
                  <Badge variant={widget.status === 'active' ? 'default' : 'secondary'}>
                    {widget.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button variant="outline" size="sm" onClick={handleReset}>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Reload
                  </Button>
                  <a
                    href={`/sdks/chat-widget/designer?id=${widget.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center rounded-md text-sm font-medium h-8 px-3 border border-input bg-background hover:bg-accent hover:text-accent-foreground"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Edit in Designer
                  </a>
                </div>
              </div>
            </CardHeader>
          </Card>

          <div className="flex-1 min-h-0 bg-muted/40 rounded-xl border overflow-hidden relative">
            <iframe
              ref={iframeRef}
              srcDoc={iframeHtml}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms"
              title="Widget Sandbox"
            />
          </div>
        </>
      )}
    </div>
  );
}