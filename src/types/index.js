export const Base64Image = {
  mimeType: String,
  data: String, // Base64 string without data:image/... prefix
};

export const AnalysisResult = {
  analysis: {
    sketch: String,
    dimensions: Object,
    materials: Object,
  },
  seo: {
    titles: Array,
    tags: Array,
  },
};

export const ImagePlan = {
  angle: String,
  background: String,
  description: String,
};

export const Task = {
  id: String,
  userId: String,
  productName: String,
  productDescription: String,
  inputImages: Array,
  analysis: AnalysisResult,
  generatedImages: Array,
  createdAt: Date,
  vibe: String,
};

export const ErrorType = ['RATE_LIMIT', 'QUOTA_EXCEEDED', 'NETWORK_ERROR', 'UNKNOWN'];

export const GeminiModel = ['flash', 'pro', 'auto'];

export const QualityMode = ['professional', 'fast', 'simple'];

// Image generation provider
export const ImageProvider = ['gemini', 'runware'];

export const ModelSettings = {
  analysisModel: String,
  imageModel: String,
  useCache: Boolean,
};

// Runware API configuration
export const RunwareConfig = {
  model: String,
  width: Number,
  height: Number,
  steps: Number,
  CFGScale: Number,
  strength: Number, // For img2img, 0-1
  outputFormat: String, // 'WEBP' | 'PNG' | 'JPEG'
};

export const DEFAULT_RUNWARE_CONFIG = {
  model: 'runware:100@1', // FLUX.1 Dev
  width: 1024,
  height: 1024,
  steps: 28,
  CFGScale: 3.5,
  strength: 0.75,
  outputFormat: 'WEBP'
};

// Runware models available
export const RUNWARE_MODELS = [
  { id: 'runware:100@1', name: 'FLUX.1 Dev', description: 'High quality, balanced speed' },
  { id: 'runware:101@1', name: 'FLUX.1 Schnell', description: 'Fast generation' },
  { id: 'civitai:133005@782002', name: 'Juggernaut XL', description: 'Photorealistic' },
  { id: 'civitai:101055@128078', name: 'SD XL Base', description: 'Stable Diffusion XL' },
];
