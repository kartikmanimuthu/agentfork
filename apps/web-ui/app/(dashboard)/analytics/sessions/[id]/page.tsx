'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Copy, Check, Star, Clock, MessageSquare } from 'lucide-react';
import { useState } from 'react';

const SENTIMENT_COLORS: Record<string, string> = {
  POSITIVE: '#10B981',
  NEGATIVE: '#EF4444',
  NEUTRAL: '#6366F1',
  MIXED: '#F59E0B',
};

export default function SessionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;
  const [copied, setCopied] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics-session', sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/sessions/${sessionId}`);
      if (!res.ok) throw new Error('Failed to fetch session');
      return res.json();
    },
    enabled: !!sessionId,
  });

  const handleCopy = () => {
    navigator.clipboard.writeText(sessionId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-4">
            <Skeleton className="h-48" />
            <Skeleton className="h-64" />
          </div>
          <div className="lg:col-span-2">
            <Skeleton className="h-[600px]" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <Card className="border-destructive/50">
          <CardContent className="py-8 text-center">
            <p className="text-destructive">Failed to load session details.</p>
            <Button variant="outline" className="mt-4" onClick={() => router.back()}>Go Back</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { session, messages, analytics } = data;
  const duration = messages.length >= 2
    ? Math.round((new Date(messages[messages.length - 1].createdAt).getTime() - new Date(messages[0].createdAt).getTime()) / 60000)
    : 0;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/analytics/sessions')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Session Detail</h1>
          <span className="text-sm font-mono text-muted-foreground">{sessionId.slice(0, 12)}...</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy}>
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left column */}
        <div className="lg:col-span-3 space-y-4">
          {/* Metadata */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Session Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant={session.status === 'active' ? 'default' : 'secondary'}>{session.status}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Model</span>
                  <span className="font-mono text-xs">{session.model?.split('.').pop() || session.model}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Messages</span>
                  <span>{session.messageCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Duration</span>
                  <span>{duration > 0 ? `${duration} min` : '<1 min'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span>{new Date(session.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Updated</span>
                  <span>{new Date(session.updatedAt).toLocaleString()}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Feedback */}
          <Card className="border-l-4 border-l-emerald-500">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">User Feedback</CardTitle>
            </CardHeader>
            <CardContent>
              {session.feedbackRating ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Rating:</span>
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className={`h-4 w-4 ${i < session.feedbackRating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />
                      ))}
                    </div>
                    <span className="text-sm text-muted-foreground">({session.feedbackRating}/5)</span>
                  </div>
                  {session.feedbackComment && (
                    <p className="text-sm italic text-muted-foreground">"{session.feedbackComment}"</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No feedback provided.</p>
              )}
            </CardContent>
          </Card>

          {/* AI Analysis */}
          {analytics ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">AI Analysis</CardTitle>
                <CardDescription>Analyzed {new Date(analytics.analyzedAt).toLocaleString()}</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="summary">
                  <TabsList className="mb-4">
                    <TabsTrigger value="summary">Summary</TabsTrigger>
                    <TabsTrigger value="sentiment">Sentiment</TabsTrigger>
                  </TabsList>

                  <TabsContent value="summary" className="space-y-4">
                    {/* Resolution + Confidence */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground mb-1">Resolution</p>
                        <div className="flex items-center gap-2">
                          <div className={`h-3 w-3 rounded-full ${analytics.isResolved ? 'bg-emerald-500' : 'bg-red-500'}`} />
                          <span className="font-medium">{analytics.isResolved ? 'Resolved' : 'Unresolved'}</span>
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground mb-1">Confidence</p>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{Math.round((analytics.confidenceScore || 0) * 100)}%</span>
                          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-blue-500" style={{ width: `${(analytics.confidenceScore || 0) * 100}%` }} />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Emotional Tone */}
                    {analytics.emotionalTone && (
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground mb-2">Emotional Tone</p>
                        <div className="space-y-1.5">
                          {Object.entries(analytics.emotionalTone as Record<string, number>).map(([key, value]) => (
                            <div key={key} className="flex items-center gap-2">
                              <span className="text-xs w-16 capitalize">{key}</span>
                              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                                <div className="h-full rounded-full" style={{
                                  width: `${value * 100}%`,
                                  backgroundColor: key === 'happy' ? '#10B981' : key === 'frustrated' ? '#EF4444' : '#6B7280',
                                }} />
                              </div>
                              <span className="text-xs w-10 text-right">{Math.round(value * 100)}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Summary text */}
                    {analytics.summary && (
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground mb-1">Summary</p>
                        <p className="text-sm">{analytics.summary}</p>
                      </div>
                    )}

                    {analytics.language && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">Language:</span>
                        <Badge variant="outline">{analytics.language.toUpperCase()}</Badge>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="sentiment" className="space-y-4">
                    {/* Overall sentiment */}
                    <div className="p-4 rounded-lg bg-muted/50 flex items-center justify-between">
                      <span className="font-medium">Overall Sentiment</span>
                      <Badge style={{
                        backgroundColor: SENTIMENT_COLORS[analytics.sentiment] || '#6B7280',
                        color: 'white',
                      }}>
                        {analytics.sentiment}
                      </Badge>
                    </div>

                    {/* Score breakdown */}
                    {analytics.sentimentScores && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Score Breakdown</p>
                        {Object.entries(analytics.sentimentScores as Record<string, number>).map(([key, value]) => (
                          <div key={key} className="flex items-center gap-2">
                            <span className="text-sm w-16 capitalize">{key}</span>
                            <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full" style={{
                                width: `${value * 100}%`,
                                backgroundColor: SENTIMENT_COLORS[key.toUpperCase()] || '#6B7280',
                              }} />
                            </div>
                            <span className="text-xs w-12 text-right">{(value * 100).toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <p>No AI analysis available for this session.</p>
                <p className="text-xs mt-1">Analysis runs automatically when a conversation is completed.</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column — Chat Transcript */}
        <div className="lg:col-span-2">
          <Card className="h-fit max-h-[calc(100vh-8rem)] flex flex-col">
            <CardHeader className="pb-3 border-b shrink-0">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Chat Transcript
              </CardTitle>
              <CardDescription>{messages.length} messages</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No messages</p>
              ) : (
                messages.map((msg: any) => (
                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] p-3 rounded-lg text-sm ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium opacity-70">
                          {msg.role === 'user' ? 'User' : 'Assistant'}
                        </span>
                        <span className="text-xs opacity-50">
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
