export interface HubBrowserStartRequest {
  containerCode: string;
  isHeadless?: boolean;
  isWebDriverReadOnlyMode?: boolean;
  skipSystemResourceCheck?: boolean;
  containerTabs?: string[];
  args?: string[];
  cdpHide?: boolean;
}

export interface HubBrowserStartResponse {
  msg: string;
  code: number;
  data?: {
    accountId: string | null;
    action: string;
    backgroundPluginId: string;
    browserID: string;
    browserPath: string;
    debuggingPort: number;
    downloadPath: string;
    duplicate: number;
    ip: string;
    isDynamicIp: boolean;
    launcherPage: string;
    proxyTag: string;
    proxyType: string;
    reportPluginId: string;
    runMode: string;
    webdriver: string;
    statusCode: number;
  };
}

export interface HubBrowserStopResponse {
  msg: string;
  code: number;
  data?: {
    action: string;
    statusCode: number;
  };
}

export interface HubBrowserStatusItem {
  containerCode: string;
  status: number; // 0=已开启, 1=开启中, 2=关闭中, 3=已关闭
}

export interface HubAllBrowserStatusResponse {
  msg: string;
  code: number;
  data?: {
    action: string;
    containers: HubBrowserStatusItem[];
    err: string;
    statusCode: string;
  };
}

export interface HubEnvListItem {
  allOpenTime: string;
  asDynamicType: number;
  containerCode: number;
  serialNumber: number;
  containerName: string;
  createTime: string;
  lastCity: string;
  lastCountry: string;
  lastRegion: string;
  lastUsedIp: string;
  openTime: string;
  proxyHost: string;
  proxyPort: number;
  proxyTypeName: string;
  proxyAccount: string;
  proxyPassword: string;
  refreshUrl: string;
  tagName: string;
  tagCode: string;
  ua: string;
}

export interface HubEnvListResponse {
  msg: string;
  code: number;
  data?: {
    list: HubEnvListItem[];
    total: number;
  };
}

export enum HubErrorCode {
  SUCCESS = 0,
  PROXY_INIT_FAILED = 5,
  CORE_START_FAILED = 7,
  CONTAINER_OCCUPIED = 17,
  CANCELLED = 18,
  NOT_OPENABLE = 20,
  IP_TIMEOUT = 21,
  UA_CONVERT_FAILED = 22,
  OPEN_DETAIL_TIMEOUT = 24,
  DISK_INFO_FAILED = 25,
  FREE_VERSION_UNSUPPORTED = 26,
  OPEN_LIMIT_EXCEEDED = 27,
  UNKNOWN_ERROR = -10000,
  LOGIN_FAILED = -10003,
  ENV_NOT_FOUND = -10004,
  PREV_START_IN_PROGRESS = -10005,
  CORE_NOT_FOUND = -10007,
  INSUFFICIENT_RESOURCES = -10008,
  ENV_NOT_FOUND_OR_CLOSED = -10011,
  PLUGIN_ID_EMPTY = -10012,
  ENV_ALREADY_RUNNING = -10013,
  IPC_TIMEOUT = -10014,
  DATA_FETCH_FAILED = -10015,
  CORE_VERSION_TOO_LOW = -10016,
  FIREFOX_UNSUPPORTED = -10017,
  CORE_DOWNLOAD_FAILED = -10018,
}
