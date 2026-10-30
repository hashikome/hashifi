import type { AppConfig } from "../config/config.js";
import type { BackendSettings } from "../services/router-provision/context.js";

/** Where routers and guests reach this API, as provisioning needs it. */
export function backendSettings(config: AppConfig): BackendSettings {
  return {
    managementUrl: config.routerManagementUrl,
    portalOrigin: config.portalOrigin,
    listenPort: config.port,
  };
}
