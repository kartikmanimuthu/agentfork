"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Editor from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateSkill, useUpdateSkill, useSkill } from "@/hooks/use-skills";
import type { SkillDTO } from "@/lib/client-skill-service";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  tier: z.enum(["read-only", "mutation", "approval-gated"]),
  content: z.string().min(1, "Skill content is required"),
  isEnabled: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  skill?: SkillDTO | null;
  cloneFrom?: SkillDTO | null;
  initialDraft?: { name: string; description: string; tier: string; content: string } | null;
  sourceRunId?: string | null;
}

export function SkillFormDialog({ open, onOpenChange, skill, cloneFrom, initialDraft, sourceRunId }: Props) {
  const { resolvedTheme } = useTheme();
  const createSkill = useCreateSkill();
  const updateSkill = useUpdateSkill();
  const isEdit = !!skill;
  // List DTOs omit `content`; fetch the full skill (incl. content) when editing or cloning.
  const { data: fullSkill } = useSkill(skill?.id ?? cloneFrom?.id ?? null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", description: "", tier: "read-only", content: "", isEnabled: true },
  });

  useEffect(() => {
    if (!open) return;
    if (skill) {
      const src = fullSkill ?? skill;
      form.reset({ name: src.name, description: src.description, tier: src.tier as FormValues["tier"], content: src.content ?? "", isEnabled: src.isEnabled });
    } else if (cloneFrom) {
      const src = fullSkill ?? cloneFrom;
      form.reset({ name: `Copy of ${src.name}`, description: src.description, tier: src.tier as FormValues["tier"], content: src.content ?? "", isEnabled: src.isEnabled });
    } else if (initialDraft) {
      form.reset({ name: initialDraft.name, description: initialDraft.description, tier: (["read-only", "mutation", "approval-gated"].includes(initialDraft.tier) ? initialDraft.tier : "read-only") as FormValues["tier"], content: initialDraft.content, isEnabled: true });
    } else {
      form.reset({ name: "", description: "", tier: "read-only", content: "", isEnabled: true });
    }
  }, [open, skill, cloneFrom, fullSkill, initialDraft, form]);

  const onSubmit = async (values: FormValues) => {
    try {
      if (isEdit && skill) {
        await updateSkill.mutateAsync({ id: skill.id, input: values });
        toast.success("Skill updated", { description: values.name });
      } else {
        await createSkill.mutateAsync({ ...values, sourceRunId: sourceRunId ?? null });
        toast.success("Skill created", { description: values.name });
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(isEdit ? "Update failed" : "Create failed", { description: e instanceof Error ? e.message : "Please try again" });
    }
  };

  const submitting = createSkill.isPending || updateSkill.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Skill" : cloneFrom ? "Clone Skill" : "Create Skill"}</DialogTitle>
          <DialogDescription>Skills are available to Claw across every conversation in this tenant.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Name</FormLabel><FormControl><Input placeholder="Cost Analyser" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea rows={2} placeholder="When should the agent use this skill?" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="tier" render={({ field }) => (
              <FormItem><FormLabel>Tier</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="read-only">Read-only</SelectItem>
                    <SelectItem value="mutation">Mutation</SelectItem>
                    <SelectItem value="approval-gated">Approval-gated</SelectItem>
                  </SelectContent>
                </Select><FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="content" render={({ field }) => (
              <FormItem><FormLabel>Skill content (Markdown)</FormLabel>
                <FormControl>
                  <div className="border rounded-md overflow-hidden">
                    <Editor height="320px" defaultLanguage="markdown" value={field.value} onChange={(v) => field.onChange(v ?? "")}
                      theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
                      options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: "on", scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 12, bottom: 12 } }} />
                  </div>
                </FormControl><FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="isEnabled" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-md border p-3 gap-4">
                <div className="space-y-0.5">
                  <FormLabel className="mb-0">{field.value ? "Enabled" : "Disabled"}</FormLabel>
                  <p className="text-xs text-muted-foreground">When enabled, Claw can select this skill for any matching request in this tenant.</p>
                </div>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Enable or disable skill" /></FormControl>
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : isEdit ? "Save changes" : cloneFrom ? "Create clone" : "Create skill"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
