/** Renderer-safe catalog and download state. Model IDs are relative names, never paths. */
export interface ModelCatalogEntry {
  key: string;
  fileName: string;
  title: string;
  description: string;
  size: number;
  sha256: string;
  url: string;
  sourcePage: string;
  license: string;
  recommendedFor: 'cantonese' | 'general' | 'light';
  credit?: string;
}

export interface ModelDownloadProgress {
  key: string;
  fileName: string;
  state: 'idle' | 'downloading' | 'verifying' | 'completed' | 'failed' | 'cancelled';
  receivedBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  error: string | null;
}

export interface ModelCatalogState extends ModelCatalogEntry {
  installed: boolean;
  modelId: string | null;
  partialBytes: number;
  active: boolean;
  /** Snapshot lets a newly opened settings panel observe an ongoing download. */
  progress: ModelDownloadProgress | null;
}
