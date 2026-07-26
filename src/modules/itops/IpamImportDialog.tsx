import { useState } from "react";
import { useTranslation } from "react-i18next";
import Papa from "papaparse";
import { Actions, Btn, DialogShell, Sheet } from "../../app/ui/dialog";
import {
  invokeCommand,
  localFileSize,
  pickAndSaveFile,
  readUtf8File,
  selectIpamImportFile,
} from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import { ItIcon } from "./icons";
import {
  IPAM_IMPORT_SAMPLE_CSV,
  parseIpamImportRows,
  type IpamImportIssue,
  type ParsedIpamImport,
} from "./ipamImportModel";
import { useItOpsStore } from "./state";

function fileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

export function IpamImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const ipam = useItOpsStore((state) => state.ipam);
  const sites = useItOpsStore((state) => state.sites);
  const vlans = useItOpsStore((state) => state.vlans);
  const importIpam = useItOpsStore((state) => state.importIpam);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [selectedName, setSelectedName] = useState("");
  const [parsed, setParsed] = useState<ParsedIpamImport | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const issueText = (issue: IpamImportIssue) =>
    t(`itops.ipam.fileImportIssue.${issue.code}`, issue.values);

  async function chooseFile() {
    const path = await selectIpamImportFile({
      title: t("itops.ipam.fileImportTitle"),
      filterName: t("itops.ipam.fileImportFilter"),
    });
    if (!path) return;

    setLoading(true);
    setParsed(null);
    setSelectedName(fileName(path));
    try {
      const extension = path.split(".").pop()?.toLowerCase();
      let rows: string[][];
      if (extension === "xlsx") {
        const worksheet = await invokeCommand("itops_read_ipam_xlsx", { path });
        rows = worksheet.rows;
      } else if (extension === "csv" || extension === "tsv") {
        if ((await localFileSize(path)) > 50 * 1024 * 1024) {
          throw new Error(t("itops.ipam.fileImportTooLarge"));
        }
        const result = Papa.parse<string[]>(await readUtf8File(path), {
          delimiter: extension === "tsv" ? "\t" : "",
          skipEmptyLines: "greedy",
        });
        if (result.errors.length > 0) {
          throw new Error(t("itops.ipam.fileImportMalformedFile"));
        }
        rows = result.data;
      } else {
        throw new Error(t("itops.ipam.fileImportUnsupportedFile"));
      }
      setParsed(
        parseIpamImportRows(rows, {
          sites,
          vlans,
          prefixes: ipam.prefixes,
          addresses: ipam.addresses,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function saveSample() {
    try {
      const path = await pickAndSaveFile(
        "kkterm-ipam-import-sample.csv",
        new TextEncoder().encode(IPAM_IMPORT_SAMPLE_CSV),
        [{ name: t("itops.ipam.fileImportFilter"), extensions: ["csv"] }],
      );
      if (path) {
        showStatusBarNotice(t("itops.ipam.fileImportSampleSaved"), { tone: "success" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
    }
  }

  async function submit() {
    if (!parsed || parsed.ready === 0) return;
    setBusy(true);
    try {
      const result = await importIpam(parsed.batch);
      const count = result.vlans + result.prefixes + result.addresses;
      showStatusBarNotice(
        t("itops.ipam.fileImportedNotice", {
          count,
          skipped: parsed.skipped + result.skipped,
          errors: parsed.errors,
        }),
        { tone: count > 0 ? "success" : "warning" },
      );
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
      setBusy(false);
    }
  }

  return (
    <DialogShell onBackdrop={onClose} zClassName="itops-page">
      <Sheet
        width={720}
        title={t("itops.ipam.fileImportTitle")}
        ariaLabel={t("itops.ipam.fileImportTitle")}
        footer={
          <Actions
            cancel={<Btn onClick={onClose}>{t("itops.actions.cancel")}</Btn>}
            primary={
              <Btn
                kind="primary"
                disabled={busy || loading || !parsed || parsed.ready === 0}
                onClick={() => void submit()}
              >
                <ItIcon name="download" size={14} />
                {t("itops.ipam.fileImportSubmit", { count: parsed?.ready ?? 0 })}
              </Btn>
            }
          />
        }
      >
        <p className="it-ipam-import-intro">{t("itops.ipam.fileImportIntro")}</p>
        <div className="it-ipam-import-actions">
          <Btn onClick={() => void chooseFile()}>
            <ItIcon name="table" size={14} />
            {loading ? t("common.loading") : t("itops.ipam.fileImportChoose")}
          </Btn>
          <Btn onClick={() => void saveSample()}>
            <ItIcon name="download" size={14} />
            {t("itops.ipam.fileImportSampleAction")}
          </Btn>
          {selectedName ? <span title={selectedName}>{selectedName}</span> : null}
        </div>

        {parsed ? (
          <>
            <p className="it-ipam-import-summary">
              {t("itops.ipam.fileImportSummary", {
                ready: parsed.ready,
                skipped: parsed.skipped,
                errors: parsed.errors,
              })}
            </p>
            {parsed.fileIssue ? (
              <div className="it-ipam-import-file-error">{issueText(parsed.fileIssue)}</div>
            ) : parsed.rows.length > 0 ? (
              <div className="it-ipam-import-preview">
                {parsed.rows.slice(0, 250).map((row) => (
                  <div
                    key={`${row.rowNumber}:${row.kind ?? "unknown"}`}
                    className="it-ipam-import-row"
                    data-state={row.state}
                  >
                    <span>{row.rowNumber}</span>
                    <em>
                      {row.kind === "vlan"
                        ? t("itops.ipam.vlanLabel")
                        : row.kind === "prefix"
                          ? t("itops.ipam.cidrLabel")
                          : row.kind === "address"
                            ? t("itops.ipam.addressLabel")
                            : "—"}
                    </em>
                    <strong>{row.label || "—"}</strong>
                    <small>{row.issue ? issueText(row.issue) : t("itops.ipam.fileImportReady")}</small>
                  </div>
                ))}
                {parsed.rows.length > 250 ? (
                  <p>{t("itops.ipam.fileImportMoreRows", { count: parsed.rows.length - 250 })}</p>
                ) : null}
              </div>
            ) : (
              <div className="it-ipam-import-file-error">
                {t("itops.ipam.fileImportNoRows")}
              </div>
            )}
          </>
        ) : null}
      </Sheet>
    </DialogShell>
  );
}
