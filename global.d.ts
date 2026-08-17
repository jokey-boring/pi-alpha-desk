// 可选桌面桥接（历史 Electron preload）；浏览器模式下均为 undefined。
interface Window {
  piDesktop?: {
    selectDirectory: () => Promise<string | null>;
    openThemeFolder: () => Promise<string>;
    openThemeDocs: () => Promise<void>;
    showItemInFolder: (fullPath: string) => Promise<boolean>;
    getPathForFile: (file: File) => string;
  };
}
