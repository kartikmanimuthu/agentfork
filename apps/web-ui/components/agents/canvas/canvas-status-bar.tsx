'use client';

import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { ValidationError } from '@chatbot/agent-studio';

interface CanvasStatusBarProps {
  nodeCount: number;
  edgeCount: number;
  validationErrors: ValidationError[] | null;
}

export function CanvasStatusBar({ nodeCount, edgeCount, validationErrors }: CanvasStatusBarProps) {
  const hasErrors = validationErrors !== null && validationErrors.length > 0;
  const isValid = validationErrors !== null && validationErrors.length === 0;

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 border-t bg-muted/30 text-xs text-muted-foreground shrink-0">
      <span>{nodeCount} node{nodeCount !== 1 ? 's' : ''}</span>
      <span>{edgeCount} edge{edgeCount !== 1 ? 's' : ''}</span>

      {isValid && (
        <span className="flex items-center gap-1 text-green-600 ml-auto">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Valid
        </span>
      )}

      {hasErrors && (
        <span className="flex items-center gap-1 text-destructive ml-auto">
          <AlertCircle className="h-3.5 w-3.5" />
          {validationErrors!.length} error{validationErrors!.length !== 1 ? 's' : ''}
          {validationErrors!.length > 0 && (
            <span className="ml-1 truncate max-w-[300px]" title={validationErrors![0].message}>
              — {validationErrors![0].message}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
