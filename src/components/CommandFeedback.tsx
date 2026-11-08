import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { GEMINI_FEEDBACK_EVENT } from "@/game/SeaScene";

type CommandNotice = Readonly<{
  id: number;
  message: string;
  success: boolean;
}>;

/** Ephemeral, non-blocking confirmation of actual command results from the world scene. */
export function CommandFeedback() {
  const [notice, setNotice] = useState<CommandNotice | null>(null);

  useEffect(() => {
    const onFeedback = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; success?: boolean }>).detail;
      if (!detail?.message) return;
      setNotice(previous => ({
        id: (previous?.id ?? 0) + 1,
        message: detail.message!,
        success: detail.success === true,
      }));
    };
    window.addEventListener(GEMINI_FEEDBACK_EVENT, onFeedback);
    return () => window.removeEventListener(GEMINI_FEEDBACK_EVENT, onFeedback);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = notice.id;
    const timeout = window.setTimeout(() => {
      setNotice(current => current?.id === id ? null : current);
    }, 3800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  return (
    <div className="pointer-events-none absolute left-1/2 top-20 z-20 w-[min(90vw,26rem)] -translate-x-1/2" data-command-feedback>
      {notice && (
        <div key={notice.id} role={notice.success ? "status" : "alert"}
          className={`game-feedback-enter flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-xl backdrop-blur-md ${
            notice.success
              ? "border-emerald-500/60 bg-slate-950/95 text-emerald-100"
              : "border-rose-500/70 bg-slate-950/95 text-rose-100"
          }`}>
          {notice.success
            ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
          <span>{notice.message}</span>
        </div>
      )}
    </div>
  );
}
