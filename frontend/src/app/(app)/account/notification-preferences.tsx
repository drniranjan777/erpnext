"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api } from "@/lib/api";

type Channel = "in_app" | "email" | "whatsapp";

interface Preference {
  event: string;
  label: string;
  description: string;
  group: string;
  mandatory: boolean;
  channels: { channel: Channel; available: boolean; enabled: boolean }[];
}

const CHANNELS: { channel: Channel; label: string }[] = [
  { channel: "in_app", label: "In-app" },
  { channel: "email", label: "Email" },
  { channel: "whatsapp", label: "WhatsApp" },
];

const KEY = ["account", "notification-preferences"];

export function NotificationPreferences() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: KEY, queryFn: () => api<Preference[]>("/account/notification-preferences") });
  const save = useMutation({
    mutationFn: (change: { event: string; channel: Channel; enabled: boolean }) =>
      api("/account/notification-preferences", { method: "PUT", body: { changes: [change] } }),
    onMutate: async (change) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Preference[]>(KEY);
      qc.setQueryData<Preference[]>(KEY, (old) =>
        old?.map((p) =>
          p.event === change.event ? { ...p, channels: p.channels.map((c) => (c.channel === change.channel ? { ...c, enabled: change.enabled } : c)) } : p,
        ),
      );
      return { prev };
    },
    onError: (_e, _c, ctx) => ctx?.prev && qc.setQueryData(KEY, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  const groups = [...new Set(prefs.data?.map((p) => p.group) ?? [])];

  return (
    <Card>
      <CardHeader title="Notifications" description="Choose how you hear about things. WhatsApp uses your mobile number from your profile." />
      {prefs.isLoading && <LoadingBlock />}
      {prefs.error && <div className="p-5"><ErrorBlock error={prefs.error} /></div>}
      {save.error && <div className="px-5 pt-4"><Alert>{(save.error as Error).message}</Alert></div>}
      {prefs.data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-2.5 font-medium">Event</th>
                {CHANNELS.map((c) => (
                  <th key={c.channel} className="w-24 px-3 py-2.5 text-center font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g} className="divide-y divide-border">
                <tr>
                  <td colSpan={4} className="bg-surface px-5 pb-1 pt-4 text-xs font-semibold text-muted">
                    {g}
                  </td>
                </tr>
                {prefs.data
                  .filter((p) => p.group === g)
                  .map((p) => (
                    <tr key={p.event}>
                      <td className="px-5 py-3">
                        <p className="flex items-center gap-1.5 font-medium">
                          {p.label}
                          {p.mandatory && <Lock className="size-3 text-muted" aria-label="Always on" />}
                        </p>
                        <p className="text-xs text-muted">{p.description}</p>
                      </td>
                      {p.channels.map((c) => {
                        const locked = p.mandatory && c.enabled;
                        return (
                          <td key={c.channel} className="px-3 py-3 text-center">
                            <input
                              type="checkbox"
                              className="size-4 accent-[var(--primary)] disabled:opacity-40"
                              checked={c.enabled && c.available}
                              disabled={!c.available || locked}
                              title={locked ? "Security alerts can't be turned off" : !c.available ? "Not available yet" : undefined}
                              aria-label={`${p.label}: ${CHANNELS.find((x) => x.channel === c.channel)?.label}`}
                              onChange={(e) => save.mutate({ event: p.event, channel: c.channel, enabled: e.target.checked })}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </Card>
  );
}
