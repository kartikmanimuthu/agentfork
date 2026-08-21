import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClientSkillService, type SkillInput } from '@/lib/client-skill-service';

const skillKeys = {
  all: ['skills'] as const,
  lists: () => [...skillKeys.all, 'list'] as const,
  list: (all?: boolean) => [...skillKeys.lists(), { all: !!all }] as const,
  details: () => [...skillKeys.all, 'detail'] as const,
  detail: (id: string) => [...skillKeys.details(), id] as const,
};

export function useSkills(all = true) {
  return useQuery({ queryKey: skillKeys.list(all), queryFn: () => ClientSkillService.listSkills(all) });
}

export function useSkill(id: string | null) {
  return useQuery({
    queryKey: skillKeys.detail(id ?? ''),
    queryFn: () => ClientSkillService.getSkill(id as string),
    enabled: !!id,
  });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SkillInput) => ClientSkillService.createSkill(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: skillKeys.all }),
  });
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<SkillInput> }) => ClientSkillService.updateSkill(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: skillKeys.all }),
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ClientSkillService.deleteSkill(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: skillKeys.all }),
  });
}

export function useDistillSkill() {
  return useMutation({ mutationFn: (transcript: string) => ClientSkillService.distill(transcript) });
}
