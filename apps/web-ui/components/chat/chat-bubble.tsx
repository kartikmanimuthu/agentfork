import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import ReactMarkdown from 'react-markdown';

interface ChatBubbleProps {
  role: 'user' | 'assistant';
  content: string;
}

export function ChatBubble({ role, content }: ChatBubbleProps) {
  const isUser = role === 'user';

  return (
    <div className={cn('flex gap-3 p-4', isUser && 'flex-row-reverse')}>
      <Avatar className="h-8 w-8">
        <AvatarFallback className={cn(isUser ? 'bg-primary text-primary-foreground' : 'bg-secondary')}>
          {isUser ? 'U' : 'AI'}
        </AvatarFallback>
      </Avatar>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-4 py-2 text-sm',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <ReactMarkdown className="prose prose-sm dark:prose-invert max-w-none">
            {content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}
