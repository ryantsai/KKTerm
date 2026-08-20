import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { technicalInputProps } from "../../../../lib/inputBehavior";
import { isMacPlatform, isWindowsPlatform } from "../../../../lib/platform";
import { invokeCommand } from "../../../../lib/tauri";
import type { Connection } from "../../../../types";

const COMMON_SERIAL_SPEEDS = [9600, 19200, 38400, 115200] as const;

// macOS always publishes these callout devices even with no adapter attached,
// and they sort ahead of every real one. Pre-filling a new Connection with the
// alphabetically first port therefore aimed it at the Bluetooth line, which
// opens without error and then stays silent forever (issue #745).
const NON_DEVICE_SERIAL_PORT_PATTERNS = [/bluetooth/i, /debug-console/i, /wlan-debug/i];

export function preferredSerialPort(ports: string[]): string | undefined {
  return ports.find(
    (port) => !NON_DEVICE_SERIAL_PORT_PATTERNS.some((pattern) => pattern.test(port)),
  );
}

function platformDefaultLine(): string {
  if (isWindowsPlatform()) return "COM1";
  if (isMacPlatform()) return "/dev/cu.";
  return "/dev/ttyUSB0";
}

export function SerialConnectionFields({ initialConnection }: { initialConnection?: Connection }) {
  const { t } = useTranslation();
  const listId = useId();
  const speedListId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const speedWrapperRef = useRef<HTMLDivElement>(null);
  const [ports, setPorts] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const initialLine = initialConnection?.serialLine ?? initialConnection?.host ?? platformDefaultLine();
  const [line, setLine] = useState(initialLine);
  const [speed, setSpeed] = useState(String(initialConnection?.serialSpeed ?? 9600));

  const refreshPorts = useCallback(
    (prefill: boolean) => {
      invokeCommand("list_serial_ports")
        .then((detected) => {
          setPorts(detected);
          // Pre-fill the first detected device port only when the user hasn't
          // already provided a line (new connection still showing the platform
          // default). When every detected port is a built-in non-device callout
          // we leave the default in place rather than aiming at one of them.
          const preferred = preferredSerialPort(detected);
          if (prefill && preferred && initialLine === platformDefaultLine()) {
            setLine((current) => (current === platformDefaultLine() ? preferred : current));
          }
        })
        .catch(() => setPorts([]));
    },
    [initialLine],
  );

  useEffect(() => {
    refreshPorts(true);
  }, [refreshPorts]);

  // Close either dropdown on outside click or Escape.
  useEffect(() => {
    if (!open && !speedOpen) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (open && !wrapperRef.current?.contains(target)) setOpen(false);
      if (speedOpen && !speedWrapperRef.current?.contains(target)) setSpeedOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setSpeedOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, speedOpen]);

  const toggleOpen = () => {
    setSpeedOpen(false);
    setOpen((wasOpen) => {
      if (!wasOpen) refreshPorts(false); // re-scan on open to catch hot-plugged devices
      return !wasOpen;
    });
  };

  const selectPort = (port: string) => {
    setLine(port);
    setOpen(false);
  };

  const toggleSpeedOpen = () => {
    setOpen(false);
    setSpeedOpen((wasOpen) => !wasOpen);
  };

  const selectSpeed = (value: number) => {
    setSpeed(String(value));
    setSpeedOpen(false);
  };

  return (
    <>
      <label>
        <span>{t("connections.nameOptional")}</span>
        <input name="name" defaultValue={initialConnection?.name ?? ""} placeholder={t("connections.connectionName")} />
      </label>
      <div className="connection-endpoint-fields">
        <label className="endpoint-host-input">
          <span>{t("connections.line")}*</span>
          <div className={`serial-combobox${open ? " open" : ""}`} ref={wrapperRef}>
            <input
              name="serialLine"
              {...technicalInputProps}
              value={line}
              onChange={(event) => setLine(event.currentTarget.value)}
              placeholder={t("connections.serialLinePlaceholder")}
              required
            />
            <button
              type="button"
              className="serial-combobox-toggle"
              aria-label={t("connections.serialLineDetect")}
              aria-expanded={open}
              aria-controls={listId}
              onClick={toggleOpen}
            >
              <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                <path
                  d="M6 8l4 4 4-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {open && (
              <ul className="serial-combobox-list" id={listId} role="listbox">
                {ports.length === 0 ? (
                  <li className="serial-combobox-empty" aria-disabled="true">
                    {t("connections.serialLineNoneDetected")}
                  </li>
                ) : (
                  ports.map((port) => (
                    <li key={port}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={port === line}
                        className={port === line ? "selected" : ""}
                        onClick={() => selectPort(port)}
                      >
                        {port}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        </label>
        <label className="endpoint-port-input">
          <span>{t("connections.speed")}*</span>
          <div className={`serial-combobox${speedOpen ? " open" : ""}`} ref={speedWrapperRef}>
            <input
              name="serialSpeed"
              {...technicalInputProps}
              value={speed}
              onChange={(event) => setSpeed(event.currentTarget.value)}
              inputMode="numeric"
              min="1"
              step="1"
              type="number"
              placeholder="9600"
              required
            />
            <button
              type="button"
              className="serial-combobox-toggle"
              aria-label={t("connections.speed")}
              aria-expanded={speedOpen}
              aria-controls={speedListId}
              onClick={toggleSpeedOpen}
            >
              <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                <path
                  d="M6 8l4 4 4-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {speedOpen && (
              <ul className="serial-combobox-list" id={speedListId} role="listbox">
                {COMMON_SERIAL_SPEEDS.map((value) => (
                  <li key={value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={String(value) === speed}
                      className={String(value) === speed ? "selected" : ""}
                      onClick={() => selectSpeed(value)}
                    >
                      {value}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </label>
      </div>
    </>
  );
}
