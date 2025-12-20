export class Controller {
  private browserCode: string[] = [];
  private browserExports: string[] = [];
  private preloadCode: string[] = [];
  private preloadExports: string[] = [];
  private preloadImports: string[] = [];
  private preloadBridgeInitializers: string[] = [];
  private preloadBridgeKeys: Array<{ module: string; key: string; type: string }> = [];
  private rendererCode: string[] = [];
  private rendererExports: string[] = [];
  private rendererHooksCode: string[] = [];
  private rendererHooksExports: string[] = [];
  private commonCode: string[] = [];
  private commonExports: string[] = [];
  private commonRuntimeCode: string[] = [];
  private commonRuntimeExports: string[] = [];

  addBrowserCode(code: string): void {
    this.browserCode.push(code);
  }

  addBrowserExport(name: string): void {
    this.browserExports.push(name);
  }

  addPreloadCode(code: string): void {
    this.preloadCode.push(code);
  }

  addPreloadExport(name: string): void {
    this.preloadExports.push(name);
  }

  addPreloadImport(code: string): void {
    this.preloadImports.push(code);
  }

  addPreloadBridgeInitializer(name: string): void {
    this.preloadBridgeInitializers.push(name);
  }

  addPreloadBridgeKeyAndType(module: string, key: string, type: string): void {
    this.preloadBridgeKeys.push({ module, key, type });
  }

  addRendererCode(code: string): void {
    this.rendererCode.push(code);
  }

  addRendererExport(name: string): void {
    this.rendererExports.push(name);
  }

  addRendererHooksCode(code: string): void {
    this.rendererHooksCode.push(code);
  }

  addRendererHooksExport(name: string): void {
    this.rendererHooksExports.push(name);
  }

  addCommonCode(code: string): void {
    this.commonCode.push(code);
  }

  addCommonExport(name: string): void {
    this.commonExports.push(name);
  }

  addCommonRuntimeCode(code: string): void {
    this.commonRuntimeCode.push(code);
  }

  addCommonRuntimeExport(name: string): void {
    this.commonRuntimeExports.push(name);
  }

  getBrowserCode(): string[] {
    return this.browserCode;
  }

  getBrowserExports(): string[] {
    return this.browserExports;
  }

  getPreloadCode(): string[] {
    // Deduplicate imports
    const uniqueImports = [...new Set(this.preloadImports)];
    return [...uniqueImports, ...this.preloadCode];
  }

  getPreloadExports(): string[] {
    return this.preloadExports;
  }

  getPreloadBridgeInitializers(): string[] {
    return this.preloadBridgeInitializers;
  }

  getPreloadBridgeKeys(): Array<{ module: string; key: string; type: string }> {
    return this.preloadBridgeKeys;
  }

  getRendererCode(): string[] {
    return this.rendererCode;
  }

  getRendererExports(): string[] {
    return this.rendererExports;
  }

  getRendererHooksCode(): string[] {
    return this.rendererHooksCode;
  }

  getRendererHooksExports(): string[] {
    return this.rendererHooksExports;
  }

  getCommonCode(): string[] {
    return this.commonCode;
  }

  getCommonExports(): string[] {
    return this.commonExports;
  }

  getCommonRuntimeCode(): string[] {
    return this.commonRuntimeCode;
  }

  getCommonRuntimeExports(): string[] {
    return this.commonRuntimeExports;
  }
}
