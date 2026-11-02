"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import type { ClockMode, DemoSettings } from "@/lib/protocol/types";
import { usePlayers } from "@/lib/protocol/react/hooks";
import { useProtocolClient } from "@/lib/protocol/react/provider";
import { useUi } from "@/lib/protocol/react/ui-store";

/** Demo-only controls (never in production): clock, simulation, time travel, reset. */
export function DemoPanel() {
  const open = useUi((s) => s.demoOpen);
  const setOpen = useUi((s) => s.setDemoOpen);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Demo settings</SheetTitle>
          <SheetDescription>Devnet demo controls. These don&apos;t exist in the real product.</SheetDescription>
        </SheetHeader>
        {open ? <DemoPanelBody /> : null}
      </SheetContent>
    </Sheet>
  );
}

function DemoPanelBody() {
  const client = useProtocolClient();
  const qc = useQueryClient();
  const [settings, setSettings] = useState<DemoSettings>(() => client.getDemoSettings());
  const launching = usePlayers({ status: "launching" });
  const [boostId, setBoostId] = useState<string>("");
  const [confirmReset, setConfirmReset] = useState(false);

  const update = (patch: Partial<DemoSettings>) => {
    client.updateDemoSettings(patch);
    setSettings(client.getDemoSettings());
    void qc.invalidateQueries();
  };

  return (
    <div className="flex flex-col gap-5 px-4 pb-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Clock</legend>
        <RadioGroup value={settings.clockMode} onValueChange={(v) => update({ clockMode: v as ClockMode })}>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="demo" id="clock-demo" />
            <Label htmlFor="clock-demo">Demo clock (compressed rounds)</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="calendar" id="clock-cal" />
            <Label htmlFor="clock-cal">Real calendar (fixture windows)</Label>
          </div>
        </RadioGroup>
        <p className="text-xs text-soft">Switching clocks abandons the current round without settling it.</p>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["openSeconds", "Open (s)"],
              ["liveSeconds", "Live (s)"],
              ["freezeSeconds", "Freeze (s)"],
            ] as const
          ).map(([k, label]) => (
            <div key={k} className="flex flex-col gap-1">
              <Label htmlFor={k} className="text-xs">
                {label}
              </Label>
              <Input
                id={k}
                type="number"
                min={3}
                inputMode="numeric"
                defaultValue={settings[k]}
                disabled={settings.clockMode !== "demo"}
                onBlur={(e) => {
                  const v = Math.max(3, Math.round(Number(e.target.value) || settings[k]));
                  update({ [k]: v } as Partial<DemoSettings>);
                }}
              />
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            client.skipPhase();
            useUi.getState().setDemoOpen(false);
          }}
          disabled={settings.clockMode !== "demo"}
        >
          Skip to next phase
        </Button>
      </fieldset>

      <Separator />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Simulation</legend>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="ambient">Other traders (ambient market)</Label>
          <Switch id="ambient" checked={settings.ambientMarket} onCheckedChange={(v) => update({ ambientMarket: v })} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="fail">Simulate network errors (50%)</Label>
          <Switch id="fail" checked={settings.failureRate > 0} onCheckedChange={(v) => update({ failureRate: v ? 0.5 : 0 })} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="latency">Latency</Label>
          <Select value={String(settings.latencyMs)} onValueChange={(v) => update({ latencyMs: Number(v) })}>
            <SelectTrigger id="latency" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">None</SelectItem>
              <SelectItem value="120">120 ms</SelectItem>
              <SelectItem value="800">800 ms</SelectItem>
              <SelectItem value="2500">2.5 s</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </fieldset>

      <Separator />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Launches</legend>
        <div className="flex gap-2">
          <Select value={boostId} onValueChange={setBoostId}>
            <SelectTrigger className="flex-1" aria-label="Launching player">
              <SelectValue placeholder="Launching player" />
            </SelectTrigger>
            <SelectContent>
              {(launching.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} · {Math.round(p.bondProgress * 100)}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={!boostId}
            onClick={() => {
              client.simulateLaunchDemand(boostId, 0.96);
              toast("Simulated fan demand", { description: "Curve filled to ~96%. Your buy can complete the bond." });
              void qc.invalidateQueries();
            }}
          >
            Fill to 96%
          </Button>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            client.launchNextScheduled();
            void qc.invalidateQueries();
          }}
        >
          Launch next 2 scheduled players
        </Button>
      </fieldset>

      <Separator />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Time</legend>
        <p className="text-xs text-soft">Hold-age clock is {settings.timeOffsetDays} days ahead. Only affects hold age and sell tax.</p>
        <Button
          variant="outline"
          onClick={() => {
            client.fastForwardDays(30);
            setSettings(client.getDemoSettings());
            toast("Hold age +30 days (demo)");
            void qc.invalidateQueries();
          }}
        >
          +30 days hold age
        </Button>
      </fieldset>

      <Separator />

      <div className="flex flex-col gap-2">
        {confirmReset ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-down-tint p-4 text-sm">
            <p>Reset the demo? This clears your account, positions and every round.</p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={() => {
                  client.reset();
                  setSettings(client.getDemoSettings());
                  setConfirmReset(false);
                  toast("Demo reset");
                }}
              >
                Reset everything
              </Button>
              <Button variant="ghost" onClick={() => setConfirmReset(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="destructive" onClick={() => setConfirmReset(true)}>
            Reset demo…
          </Button>
        )}
      </div>
    </div>
  );
}
