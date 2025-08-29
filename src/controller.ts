export type Controller = {
  addPublicBrowserExport: (name: string) => void;
  addPublicCommonExport: (name: string) => void;
  addPublicPreloadExport: (name: string) => void;
  addCommonExport: (name: string) => void;
  addCommonCode: (code: string) => void;
  addCommonRuntimeCode: (code: string) => void;
  addCommonRuntimeExport: (name: string) => void;
  addBrowserCode: (code: string) => void;
  addPreloadCode: (code: string) => void;
  addPreloadImport: (code: string) => void;
  addPreloadBridgeInitializer: (name: string) => void;
  addPreloadBridgeKeyAndType: (module: string, key: string, type: string) => void;
};
