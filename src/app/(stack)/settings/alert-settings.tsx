"use client";

import { useState, useTransition } from "react";
import { saveAlerts } from "@/app/actions/profile";

/** Turns "new episodes or chapters" alerts on or off. */
export function AlertSettings({ enabled }: { enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  function toggle() {
    const next = !on;
    setOn(next);
    start(async () => {
      const r = await saveAlerts(next);
      if (!r.ok) setOn(!next);
    });
  }
  return (
    <div className="card card--flush">
      <div className="ch-setting">
        <div>
          <p className="ch-setting__label">New episodes and chapters</p>
          <p className="ch-setting__hint">Tell me when a series, anime or manga I am following grows</p>
        </div>
        <button className="ch-switch" role="switch" aria-checked={on} aria-label="New episodes and chapters" disabled={pending} onClick={toggle} />
      </div>
    </div>
  );
}
