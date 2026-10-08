"use client";

import { useEffect, useState } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Input } from "./field";

/**
 * In-app replacements for window.prompt, window.confirm and window.alert. They resolve to the same values
 * (text or null, true or false), so a call site only needs an `await`. <AskHost/> renders them.
 */
interface Request {
  id: number;
  kind: "text" | "confirm" | "info";
  message: string;
  title?: string;
  value: string;
  optional: boolean;
  danger: boolean;
  resolve: (v: string | null) => void;
}

let show: ((r: Request) => void) | null = null;
let nextId = 0;

function open(r: Omit<Request, "resolve" | "id">) {
  return new Promise<string | null>((resolve) => {
    if (!show) {
      // Host not mounted (should not happen): fall back to the browser.
      if (r.kind === "info") window.alert(r.message);
      resolve(r.kind === "text" ? window.prompt(r.message, r.value) : r.kind === "info" || window.confirm(r.message) ? "" : null);
      return;
    }
    show({ ...r, id: ++nextId, resolve });
  });
}

/** Asks for a line of text. Null when cancelled. Empty answers are only allowed when the label says "optional" or `optional` is set. */
export function askText(message: string, value?: string | number | null, opts: { optional?: boolean } = {}) {
  return open({ kind: "text", message, value: value == null ? "" : String(value), optional: opts.optional ?? /optional/i.test(message), danger: false });
}

const DESTRUCTIVE = /^(delete|remove|revoke|cancel|dispose|disable|withdraw|forget|turn off|stop)\b/i;

/** Asks a yes/no question. Destructive wording gets a red button. */
export async function askConfirm(message: string, opts: { danger?: boolean } = {}) {
  return (await open({ kind: "confirm", message, value: "", optional: true, danger: opts.danger ?? DESTRUCTIVE.test(message) })) !== null;
}

/** Shows a message with a single OK button. */
export async function tell(message: string, title = "Notice") {
  await open({ kind: "info", message, title, value: "", optional: true, danger: false });
}

export function AskHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  useEffect(() => {
    show = (r) => setQueue((q) => [...q, r]);
    return () => {
      show = null;
    };
  }, []);
  const current = queue[0];
  if (!current) return null;
  return (
    <Ask
      key={current.id}
      req={current}
      onDone={(v) => {
        current.resolve(v);
        setQueue((q) => q.slice(1));
      }}
    />
  );
}

/** One request; keyed so each gets fresh state and focus. */
function Ask({ req, onDone }: { req: Request; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(req.value);
  const answer = value.trim();
  const ok = () => {
    if (req.kind !== "text") onDone("");
    else if (answer || req.optional) onDone(answer);
  };

  return (
    <Dialog
      open
      onClose={() => onDone(null)}
      title={req.kind === "text" ? req.message : req.kind === "confirm" ? "Please confirm" : (req.title ?? "Notice")}
      footer={
        <>
          {req.kind !== "info" && (
            <Button variant="secondary" onClick={() => onDone(null)}>
              {req.kind === "confirm" ? "No" : "Cancel"}
            </Button>
          )}
          <Button variant={req.danger ? "danger" : "primary"} disabled={req.kind === "text" && !answer && !req.optional} onClick={ok}>
            {req.kind === "confirm" ? "Yes" : "OK"}
          </Button>
        </>
      }
    >
      {req.kind !== "text" ? (
        <p className="text-sm">{req.message}</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ok();
          }}
        >
          <Input aria-label={req.message} value={value} onChange={(e) => setValue(e.target.value)} />
        </form>
      )}
    </Dialog>
  );
}
