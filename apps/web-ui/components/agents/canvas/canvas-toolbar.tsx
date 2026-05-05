'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Save, CheckCircle, Upload, Loader2 } from 'lucide-react';

interface CanvasToolbarProps {
  agentName: string;
  isDirty: boolean;
  isSaving: boolean;
  isValidating: boolean;
  isPublishing: boolean;
  onSave: () => void;
  onValidate: () => void;
  onPublish: () => void;
}

export function CanvasToolbar({
  agentName,
  isDirty,
  isSaving,
  isValidating,
  isPublishing,
  onSave,
  onValidate,
  onPublish,
}: CanvasToolbarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b bg-background shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold truncate max-w-[200px]">{agentName}</span>
        {isDirty && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
            Unsaved
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onValidate}
          disabled={isValidating}
          aria-label="Validate graph"
        >
          {isValidating ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
          )}
          Validate
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onSave}
          disabled={isSaving || !isDirty}
          aria-label="Save graph"
        >
          {isSaving ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5 mr-1.5" />
          )}
          Save
        </Button>

        <Button
          size="sm"
          onClick={onPublish}
          disabled={isPublishing || isDirty}
          aria-label="Publish agent"
        >
          {isPublishing ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5 mr-1.5" />
          )}
          Publish
        </Button>
      </div>
    </div>
  );
}
