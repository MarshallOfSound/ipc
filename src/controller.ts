export type Controller = {
  addPublicBrowserExport: (name: string) => void;
  addPublicCommonExport: (name: string) => void;
  addPublicRendererExport: (name: string) => void;
  addCommonExport: (name: string) => void;
  addCommonCode: (code: string) => void;
  addBrowserCode: (code: string) => void;
  addRendererCode: (code: string) => void;
  addRendererBridgeInitializer: (name: string) => void;
};
