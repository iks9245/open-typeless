/** Version and machine details safe to display in About. Archive paths stay in main. */
export interface DiagnosticsSummary {
  app: {
    version: string;
    electron: string;
    chrome: string;
    node: string;
    packaged: boolean;
    whisperCpp: string | null;
  };
  system: {
    release: string;
    version: string;
    cpu: string;
    totalMemoryGb: number;
    freeDiskGb: number | null;
    locale: string;
  };
}

export interface DiagnosticsExportResult { saved: boolean; fileName: string | null }
