import { useTranslation } from "react-i18next";
import { Cloud } from "../../../../lib/reicon";
import { technicalInputProps } from "../../../../lib/inputBehavior";
import type { CloudStorageOptions, CloudStorageProvider, Connection } from "../../../../types";

/**
 * Cloud Storage Connection fields.
 *
 * One Connection dialog serves S3-compatible object storage and Azure Blob
 * Storage. The provider segmented control swaps the whole field
 * group below it rather than showing every provider's parameters at once, so
 * the common case stays short and a provider switch can never leave an
 * irrelevant field visible. The Rust `normalize_cloud_storage_options` clears
 * the fields that do not belong to the selected provider, so switching
 * provider also cannot persist contradictory parameters.
 *
 * Credentials follow the FTP model: the provider principal (S3 access key id,
 * Azure account name) is the Connection username and the secret (S3 secret
 * access key, Azure account key or SAS token) is the Connection password.
 */
export function CloudStorageFields({
  initialConnection,
  onProviderChange,
  provider,
}: {
  initialConnection?: Connection;
  onProviderChange: (provider: CloudStorageProvider) => void;
  provider: CloudStorageProvider;
}) {
  const { t } = useTranslation();
  const options: CloudStorageOptions | undefined = initialConnection?.cloudStorageOptions;

  return (
    <>
      <label>
        <span>{t("connections.nameOptional")}</span>
        <input
          name="name"
          defaultValue={initialConnection?.name ?? ""}
          placeholder={t("connections.connectionName")}
        />
      </label>
      <fieldset className="connection-session-fields connection-specific-options">
        <legend>{t("connections.cloudStorageOptions")}</legend>
        <div className="connection-specific-options-panel">
          <div className="connection-option-fields">
            <div className="ftp-protocol-row cloud-provider-row">
              <Cloud className="option-glyph" size={17} aria-hidden />
              <span id="cloud-storage-provider-label">
                {t("connections.cloudStorageProvider")}
              </span>
              <input name="cloudProvider" type="hidden" value={provider} />
              <div
                className="ftp-protocol-selector cloud-provider-selector"
                data-cloud-provider={provider}
                role="tablist"
                aria-label={t("connections.cloudStorageProvider")}
                aria-labelledby="cloud-storage-provider-label"
              >
                <button
                  aria-selected={provider === "s3"}
                  className={provider === "s3" ? "active" : ""}
                  onClick={() => onProviderChange("s3")}
                  role="tab"
                  type="button"
                >
                  <span>{t("connections.cloudStorageProviderS3")}</span>
                </button>
                <button
                  aria-selected={provider === "azureBlob"}
                  className={provider === "azureBlob" ? "active" : ""}
                  onClick={() => onProviderChange("azureBlob")}
                  role="tab"
                  type="button"
                >
                  <span>{t("connections.cloudStorageProviderAzure")}</span>
                </button>
              </div>
            </div>

            <label>
              <span>{endpointLabel(t, provider)}*</span>
              <input
                name="host"
                {...technicalInputProps}
                defaultValue={initialConnection?.host ?? ""}
                placeholder={endpointPlaceholder(provider)}
                required
              />
            </label>

            {provider === "s3" ? (
              <>
                <label>
                  <span>{t("connections.cloudStorageBucket")}*</span>
                  <input
                    name="cloudBucket"
                    {...technicalInputProps}
                    defaultValue={options?.bucket ?? ""}
                    placeholder="my-bucket"
                    required
                  />
                </label>
                <label>
                  <span>{t("connections.cloudStorageRegion")}</span>
                  <input
                    name="cloudRegion"
                    {...technicalInputProps}
                    defaultValue={options?.region ?? ""}
                    placeholder="us-east-1"
                  />
                </label>
              </>
            ) : null}

            {provider === "azureBlob" ? (
              <>
                <label>
                  <span>{t("connections.cloudStorageAccount")}*</span>
                  <input
                    name="cloudAccount"
                    {...technicalInputProps}
                    defaultValue={options?.account ?? ""}
                    placeholder="mystorageaccount"
                    required
                  />
                </label>
                <label>
                  <span>{t("connections.cloudStorageContainer")}*</span>
                  <input
                    name="cloudContainer"
                    {...technicalInputProps}
                    defaultValue={options?.container ?? ""}
                    placeholder="documents"
                    required
                  />
                </label>
                <label>
                  <span>{t("connections.cloudStorageAuthMode")}</span>
                  <select
                    name="cloudAuthMode"
                    defaultValue={options?.authMode ?? "key"}
                  >
                    <option value="key">{t("connections.cloudStorageAuthModeKey")}</option>
                    <option value="sas">{t("connections.cloudStorageAuthModeSas")}</option>
                  </select>
                </label>
              </>
            ) : null}
          </div>
        </div>
      </fieldset>

      <div className="connection-auth-fields">
        <label>
          <span>{principalLabel(t, provider)}</span>
          <input
            name="user"
            {...technicalInputProps}
            defaultValue={initialConnection?.user ?? ""}
            placeholder={principalPlaceholder(provider)}
          />
        </label>
        <label>
          <span>{secretLabel(t, provider)}</span>
          <input
            name="password"
            {...technicalInputProps}
            autoComplete="new-password"
            placeholder={
              initialConnection?.hasPassword
                ? t("connections.cloudStorageSecretStored")
                : secretPlaceholder(provider)
            }
            type="password"
          />
        </label>
      </div>
    </>
  );
}

export function CloudStorageConnectionOptions({
  initialConnection,
  provider,
}: {
  initialConnection?: Connection;
  provider: CloudStorageProvider;
}) {
  const { t } = useTranslation();
  const options = initialConnection?.cloudStorageOptions;

  return (
    <fieldset className="connection-session-fields connection-specific-options">
      <legend>{t("connections.cloudStorageBrowserOptions")}</legend>
      <div className="connection-specific-options-panel">
        <div className="connection-option-fields">
          <label>
            <span>{t("connections.cloudStorageConnectTimeoutSecs")}</span>
            <input
              name="cloudConnectTimeoutSecs"
              defaultValue={options?.connectTimeoutSecs ?? 30}
              inputMode="numeric"
              min="1"
              max="600"
              type="number"
            />
          </label>
          <label className="connection-proxy-row">
            <span>{t("connections.cloudStorageLocalPath")}</span>
            <input
              name="cloudLocalPath"
              {...technicalInputProps}
              defaultValue={options?.localPath ?? ""}
              placeholder={t("connections.cloudStorageLocalPathPlaceholder")}
            />
          </label>
          <label className="connection-proxy-row">
            <span>{t("connections.cloudStorageRemotePath")}</span>
            <input
              name="cloudRemotePath"
              {...technicalInputProps}
              defaultValue={options?.remotePath ?? ""}
              placeholder={t("connections.cloudStorageRemotePathPlaceholder")}
            />
          </label>
        </div>
        <div className="connection-session-fields">
          <label className="connection-session-toggle">
            <span>{t("connections.cloudStorageIgnoreCertErrors")}</span>
            <input
              name="cloudIgnoreCertErrors"
              type="checkbox"
              defaultChecked={options?.ignoreCertErrors ?? false}
            />
          </label>
          {provider === "s3" ? (
            <label className="connection-session-toggle">
              <span>{t("connections.cloudStorageForcePathStyle")}</span>
              <input
                name="cloudForcePathStyle"
                type="checkbox"
                defaultChecked={options?.forcePathStyle ?? false}
              />
            </label>
          ) : null}
        </div>
      </div>
    </fieldset>
  );
}

function endpointLabel(t: (key: string) => string, provider: CloudStorageProvider) {
  return provider === "azureBlob"
    ? t("connections.cloudStorageBlobEndpoint")
    : t("connections.cloudStorageEndpoint");
}

function endpointPlaceholder(provider: CloudStorageProvider) {
  return provider === "azureBlob"
    ? "https://mystorageaccount.blob.core.windows.net"
    : "https://s3.amazonaws.com";
}

function principalLabel(t: (key: string) => string, provider: CloudStorageProvider) {
  return provider === "azureBlob"
    ? t("connections.cloudStorageAccountName")
    : t("connections.cloudStorageAccessKeyId");
}

function principalPlaceholder(provider: CloudStorageProvider) {
  return provider === "azureBlob" ? "mystorageaccount" : "AKIAIOSFODNN7EXAMPLE";
}

function secretLabel(t: (key: string) => string, provider: CloudStorageProvider) {
  return provider === "azureBlob"
    ? t("connections.cloudStorageAccountKeyOrSas")
    : t("connections.cloudStorageSecretAccessKey");
}

function secretPlaceholder(provider: CloudStorageProvider) {
  return provider === "azureBlob"
    ? "account key or sv=…&sig=…"
    : "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
}
