"use client";

import { useState } from "react";
import Editor from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MarkdownContent } from "@/components/ui/markdown-content";
import { useSkill } from "@/hooks/use-skills";
import type { SkillDTO } from "@/lib/client-skill-service";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  skill?: SkillDTO | null;
  onEdit?: (s: SkillDTO) => void;
}

export function SkillDetailDialog({ open, onOpenChange, skill, onEdit }: Props) {
  const { resolvedTheme } = useTheme();
  const [view, setView] = useState<"preview" | "raw">("preview");
  // List DTOs omit `content`; fetch the full skill (incl. content) for display.
  const { data: fullSkill, isLoading } = useSkill(open ? skill?.id ?? null : null);
  const src = fullSkill ?? skill;
  const content = src?.content ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {src?.name ?? "Skill"}
            {src && <Badge variant="outline">{src.tier}</Badge>}
            {src && <Badge variant={src.source === "system" ? "secondary" : "default"}>{src.source === "system" ? "System" : "User"}</Badge>}
            {src && !src.isEnabled && <Badge variant="outline" className="text-muted-foreground">Disabled</Badge>}
          </DialogTitle>
          <DialogDescription>{src?.description}</DialogDescription>
        </DialogHeader>

        {isLoading && !content ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Skill content</div>
              <Tabs value={view} onValueChange={(v) => setView(v as "preview" | "raw")}>
                <TabsList className="h-8">
                  <TabsTrigger value="preview" className="text-xs">Preview</TabsTrigger>
                  <TabsTrigger value="raw" className="text-xs">Raw</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <Tabs value={view}>
              <TabsContent value="preview" className="mt-0">
                <div className="border rounded-md p-4 h-[420px] overflow-y-auto">
                  {content ? <MarkdownContent content={content} /> : <p className="text-sm text-muted-foreground">No content.</p>}
                </div>
              </TabsContent>
              <TabsContent value="raw" className="mt-0">
                <div className="border rounded-md overflow-hidden">
                  <Editor height="420px" defaultLanguage="markdown" value={content}
                    theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
                    options={{ readOnly: true, domReadOnly: true, minimap: { enabled: false }, fontSize: 13, wordWrap: "on", scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 12, bottom: 12 } }} />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {src && onEdit && (
            <Button type="button" onClick={() => { onOpenChange(false); onEdit(src); }}>Edit</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
