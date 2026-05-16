'use client';

import { useAgentAliases } from '@/hooks/use-agent-aliases';
import { useAgentVersions } from '@/hooks/use-agent-versions';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function PlaygroundVersionSelector({
  agentId,
  value,
  onChange,
}: {
  agentId: string;
  value: string;
  onChange: (val: string) => void;
}) {
  const { data: aliases } = useAgentAliases(agentId);
  const { data: versions } = useAgentVersions(agentId);

  const options: Array<{ label: string; value: string; group: string }> = [
    { label: 'Latest draft (agent config)', value: 'current', group: 'Default' },
  ];

  aliases?.forEach((a) => {
    options.push({
      label: `${a.name}${a.isDefault ? ' (default)' : ''} → v${a.version.version}`,
      value: `alias:${a.name}`,
      group: 'Aliases',
    });
  });

  versions?.forEach((v) => {
    options.push({
      label: `Version ${v.version} (${v.status})`,
      value: `version:${v.id}`,
      group: 'Versions',
    });
  });

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[240px]">
        <SelectValue placeholder="Select version or alias" />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
