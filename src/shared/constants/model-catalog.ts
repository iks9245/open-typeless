import type { ModelCatalogEntry } from '../types/model-download';

export const MODEL_CATALOG: readonly ModelCatalogEntry[] = [
  {
    key: 'large-v3-cantonese-q8_0',
    fileName: 'ggml-large-v3-cantonese-q8_0.bin',
    title: '粵語（推薦粵語使用者）',
    description: '直接輸出粵語口語（我們的評估保留了 98% 的口語字）；配合自動偵測語言，普通話和英文也能正確辨識。',
    size: 1656538283,
    sha256: 'ad7a1cd90a6e70937c46c85b8a0aafd225e706e3ed56b10d6815afdd1c2e59cb',
    url: 'https://huggingface.co/kiuckhuang/whisper-large-v3-cantonese-ggml/resolve/fe2b5c4e7f19e2280ee2bb4429613363771b7c5a/whisper-large-v3-cantonese.q8_0.bin',
    sourcePage: 'https://huggingface.co/kiuckhuang/whisper-large-v3-cantonese-ggml',
    license: 'Apache-2.0',
    recommendedFor: 'cantonese',
    credit: '由 kiuckhuang 轉換自 khleeloo/whisper-large-v3-cantonese',
  },
  {
    key: 'large-v3-turbo',
    fileName: 'ggml-large-v3-turbo.bin',
    title: '多語言（推薦）',
    description: '適合一般多語言聽寫，支援自動偵測語言。',
    size: 1624555275,
    sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo.bin',
    sourcePage: 'https://huggingface.co/ggerganov/whisper.cpp',
    license: 'MIT', recommendedFor: 'general',
  },
  {
    key: 'large-v3-turbo-q5_0',
    fileName: 'ggml-large-v3-turbo-q5_0.bin',
    title: '多語言輕量版（記憶體較小的 Mac）',
    description: '較小的量化多語言模型，適合記憶體較小的 Mac。',
    size: 574041195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin',
    sourcePage: 'https://huggingface.co/ggerganov/whisper.cpp',
    license: 'MIT', recommendedFor: 'light',
  },
];
