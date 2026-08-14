import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Actions, Btn, DialogShell, Field, Sheet, TextInput } from "../../app/ui/dialog";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";

interface SecretPromptRequest {
  requestId: string;
  moduleId: string;
  key: string;
  label: string;
}

interface HostNoticeRequest {
  moduleId: string;
  message: string;
  tone: "info" | "success" | "warning" | "error";
}

interface HostProgressRequest {
  moduleId: string;
  id: string;
  message: string;
  progress: number;
  clear: boolean;
}

interface SecretPromptCancelled {
  requestId: string;
}

export function CustomModuleSecretPrompt() {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const showStatusBarProgress = useWorkspaceStore((state) => state.showStatusBarProgress);
  const updateStatusBarProgress = useWorkspaceStore((state) => state.updateStatusBarProgress);
  const clearStatusBarNotice = useWorkspaceStore((state) => state.clearStatusBarNotice);
  const [queue, setQueue] = useState<SecretPromptRequest[]>([]);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const pendingIdsRef = useRef(new Set<string>());
  const progressIdsRef = useRef(new Map<string, number>());
  const active = queue[0];

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const pendingIds = pendingIdsRef.current;
    const unlistenPromise = listen<SecretPromptRequest>(
      "custom-module-secret-prompt",
      ({ payload }) => {
        pendingIds.add(payload.requestId);
        setQueue((current) => [...current, payload]);
      },
    );
    const cancelledListener = listen<SecretPromptCancelled>(
      "custom-module-secret-prompt-cancelled",
      ({ payload }) => {
        pendingIds.delete(payload.requestId);
        setQueue((current) => current.filter((request) => request.requestId !== payload.requestId));
      },
    );
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
      void cancelledListener.then((unlisten) => unlisten());
      for (const requestId of pendingIds) {
        void invokeCommand("resolve_custom_module_secret_prompt", {
          request: { requestId, secret: null },
        }).catch(() => undefined);
      }
      pendingIds.clear();
    };
  }, []);

  useEffect(() => {
    setSecret("");
  }, [active?.requestId]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const progressIds = progressIdsRef.current;
    const noticeListener = listen<HostNoticeRequest>(
      "custom-module-host-notice",
      ({ payload }) => showStatusBarNotice(payload.message, { tone: payload.tone }),
    );
    const progressListener = listen<HostProgressRequest>(
      "custom-module-host-progress",
      ({ payload }) => {
        const key = `${payload.moduleId}:${payload.id}`;
        const currentId = progressIds.get(key);
        if (payload.clear) {
          if (currentId !== undefined) clearStatusBarNotice(currentId);
          progressIds.delete(key);
          return;
        }
        if (currentId === undefined) {
          progressIds.set(
            key,
            showStatusBarProgress(payload.message, { progress: payload.progress }),
          );
        } else {
          updateStatusBarProgress(currentId, payload.progress);
        }
      },
    );
    return () => {
      void noticeListener.then((unlisten) => unlisten());
      void progressListener.then((unlisten) => unlisten());
      for (const id of progressIds.values()) clearStatusBarNotice(id);
      progressIds.clear();
    };
  }, [clearStatusBarNotice, showStatusBarNotice, showStatusBarProgress, updateStatusBarProgress]);

  async function resolve(value: string | null) {
    if (!active) return;
    try {
      setBusy(true);
      await invokeCommand("resolve_custom_module_secret_prompt", {
        request: { requestId: active.requestId, secret: value },
      });
      pendingIdsRef.current.delete(active.requestId);
      setQueue((current) => current.slice(1));
      setSecret("");
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (secret) void resolve(secret);
  }

  if (!active) return null;

  return (
    <DialogShell>
      <Sheet
        title={t("settings.customModulesSecretTitle")}
        width={440}
        footer={
          <Actions
            primary={
              <Btn
                disabled={busy || !secret}
                kind="primary"
                onClick={() => formRef.current?.requestSubmit()}
              >
                {t("common.save")}
              </Btn>
            }
            cancel={
              <Btn disabled={busy} onClick={() => void resolve(null)}>
                {t("common.cancel")}
              </Btn>
            }
          />
        }
      >
        <form ref={formRef} onSubmit={submit}>
          <p className="field-hint">
            {t("settings.customModulesSecretMessage", { moduleId: active.moduleId })}
          </p>
          <Field label={active.label} req>
            <TextInput
              autoFocus
              autoComplete="off"
              disabled={busy}
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.currentTarget.value)}
            />
          </Field>
        </form>
      </Sheet>
    </DialogShell>
  );
}
