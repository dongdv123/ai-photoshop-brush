const RUNWARE_API_KEY = import.meta.env.VITE_RUNWARE_API_KEY;
const RUNWARE_ENDPOINT = import.meta.env.VITE_RUNWARE_ENDPOINT || 'https://api.runware.ai/v1/image/inference';

// Default Runware configuration
const DEFAULT_RUNWARE_CONFIG = {
  model: import.meta.env.VITE_RUNWARE_MODEL || 'bfl:2@2',
  width: 512,
  height: 512,
  steps: 28,
  CFGScale: 7.0,
  strength: 0.75,
  outputFormat: 'WEBP'
};
const RUNWARE_API_URL = RUNWARE_ENDPOINT;

/**
 * Helper: mask API key for logging
 */
function maskKey(key) {
  if (!key) return 'Not configured';
  return `${String(key).slice(0, 6)}...${String(key).slice(-4)}`;
}

/**
 * Helper: summarize request body for logs (hide long base64 strings)
 */
function summarizeBody(body) {
  try {
    const copy = JSON.parse(JSON.stringify(body));
    const walk = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (typeof v === 'string' && v.length > 200 && /^(data:)?image\//.test(v)) {
          obj[k] = `${v.slice(0, 80)}...<base64:${Math.round(v.length / 1024)}kb>`;
        } else if (typeof v === 'object') {
          walk(v);
        }
      }
    };
    walk(copy);
    return copy;
  } catch {
    return '[unserializable body]';
  }
}

/**
 * Ensure positivePrompt meets Runware constraints (string 2..3000).
 * Truncate if too long and normalize whitespace.
 */
function sanitizePrompt(input) {
  let s = typeof input === 'string' ? input : String(input || '');
  s = s.replace(/\r\n/g, '\n').replace(/\s{2,}/g, ' ').trim();
  if (s.length === 0) return s;
  if (s.length > 3000) {
    console.warn(`⚠️ positivePrompt too long (${s.length} chars). Truncating to 3000 chars.`);
    s = s.slice(0, 3000);
  }
  return s;
}

/**
 * Check if model is a strict model (Flux Ultra, Flux Fill, P-Image) that rejects common params
 * like steps, CFGScale, negativePrompt.
 */
function isStrictModel(model) {
  const strictModels = [
    'bfl:2@2',        // Flux 1.1 Pro Ultra
    'runware:102@1',  // Flux Fill
    'p-image',        // Pruna P-Image
    'p-image-edit',   // Pruna P-Image-Edit
    'prunaai:2@1'     // Pruna P-Image-Edit (AIR ID)
  ];
  const m = String(model).trim().toLowerCase();
  // Check exact match or if it starts with one of the strict models (e.g. strict versioning)
  return strictModels.some(sm => m === sm || m.startsWith(sm + ':'));
}

/**
 * Supported dimensions for Flux 1.1 Pro Ultra (bfl:2@2)
 */
const FLUX_ULTRA_DIMENSIONS = [
  { w: 3136, h: 1344, label: '21:9' },
  { w: 2752, h: 1536, label: '16:9' },
  { w: 2368, h: 1792, label: '4:3' },
  { w: 2496, h: 1664, label: '3:2' },
  { w: 2048, h: 2048, label: '1:1' },
  { w: 1664, h: 2496, label: '2:3' },
  { w: 1792, h: 2368, label: '3:4' },
  { w: 1536, h: 2752, label: '9:16' },
  { w: 1344, h: 3136, label: '9:21' }
];

/**
 * Helper: Find closest supported dimension for Flux Ultra
 */
function getClosestFluxUltraDimensions(width, height) {
  const targetRatio = width / height;
  let best = FLUX_ULTRA_DIMENSIONS[0];
  let minDiff = Number.MAX_VALUE;

  for (const dim of FLUX_ULTRA_DIMENSIONS) {
    const ratio = dim.w / dim.h;
    const diff = Math.abs(ratio - targetRatio);
    if (diff < minDiff) {
      minDiff = diff;
      best = dim;
    }
  }

  console.log(`📏 Snapping dimensions from ${width}x${height} to ${best.w}x${best.h} (${best.label}) for Flux Ultra`);
  return { width: best.w, height: best.h };
}

/**
 * Helper: Try to extract base64 image from various Runware response shapes
 */
function extractBase64FromRunwareResponse(resp) {
  if (!resp) return null;

  // Common path: resp.data is array of task results
  const list = Array.isArray(resp.data) ? resp.data : Array.isArray(resp) ? resp : null;
  if (list) {
    for (const item of list) {
      // 1) direct imageBase64Data field
      if (item.imageBase64Data) return { base64: item.imageBase64Data };
      // 2) nested image or images field
      if (item.image && typeof item.image === 'object' && (item.image.base64 || item.image.data || item.image.b64)) {
        return { base64: item.image.base64 || item.image.data || item.image.b64 };
      }
      if (item.images && Array.isArray(item.images) && item.images[0]) {
        const i0 = item.images[0];
        if (i0.base64 || i0.data || i0.b64) return { base64: i0.base64 || i0.data || i0.b64 };
      }
      // 3) outputs array (common in other providers)
      if (Array.isArray(item.outputs) && item.outputs[0]) {
        const out = item.outputs[0];
        if (out.b64_json || out.base64 || out.image_base64) return { base64: out.b64_json || out.base64 || out.image_base64 };
      }
    }
  }

  // 4) top-level shapes: resp[0].outputs[0].b64_json
  if (Array.isArray(resp) && resp[0]?.outputs?.[0]) {
    const out = resp[0].outputs[0];
    if (out.b64_json || out.base64) return { base64: out.b64_json || out.base64 };
  }

  // 5) look for any string that looks like base64 image in JSON
  const jsonString = JSON.stringify(resp || {});
  const m = jsonString.match(/([A-Za-z0-9+\/=\-]{100,})/);
  if (m) {
    return { base64: m[1] };
  }

  return null;
}

/**
 * Check if Runware API is configured
 */
export function isRunwareConfigured() {
  return !!RUNWARE_API_KEY;
}

/**
 * Get Runware API information
 */
export function getRunwareAPIInfo() {
  return {
    provider: 'Runware',
    package: 'HTTP REST API',
    apiEndpoint: RUNWARE_API_URL,
    apiKeyConfigured: !!RUNWARE_API_KEY,
    apiKeyPrefix: RUNWARE_API_KEY ? `${String(RUNWARE_API_KEY).slice(0, 10)}...` : 'Chưa cấu hình',
    availableModels: {
      image: [
        { name: 'FLUX.1 Dev', description: 'Chất lượng cao, cân bằng tốc độ', cost: 'Trung bình' },
        { name: 'FLUX.1 Schnell', description: 'Tạo ảnh nhanh', cost: 'Thấp' },
        { name: 'Juggernaut XL', description: 'Ảnh thực tế', cost: 'Trung bình' },
        { name: 'SD XL Base', description: 'Stable Diffusion XL', cost: 'Thấp' },
      ]
    },
    documentation: 'https://docs.runware.ai/'
  };
}

/**
 * Generate UUID v4
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Convert Base64Image to data URL format for Runware
 */
function toDataURL(image) {
  return `data:${image.mimeType};base64,${image.data}`;
}

/**
 * Upload image to Runware and get image UUID
 */
async function uploadImageToRunware(image) {
  if (!RUNWARE_API_KEY) {
    throw new Error('Runware API key chưa được cấu hình. Vui lòng thêm VITE_RUNWARE_API_KEY vào file .env');
  }

  const taskUUID = generateUUID();

  const requestBody = [
    {
      taskType: 'imageUpload',
      taskUUID,
      image: toDataURL(image)
    }
  ];

  console.log('📤 Đang tải ảnh lên Runware...');
  console.log('📡 Request URL:', RUNWARE_API_URL);
  console.log('📡 Request Headers: Authorization:', maskKey(RUNWARE_API_KEY));
  console.log('📡 Request Body (summary):', summarizeBody(requestBody));

  const response = await fetch(RUNWARE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RUNWARE_API_KEY}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Lỗi upload ảnh Runware:', response.status, errorText);
    throw new Error(`Lỗi upload ảnh lên Runware: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log('📤 Response upload (summary):', summarizeBody(data));

  // Find the upload response
  const uploadResult = data.data?.find((item) => item.taskType === 'imageUpload');
  if (!uploadResult?.imageUUID) {
    console.error('❌ Upload response full:', data);
    throw new Error('Không nhận được imageUUID từ Runware (response không chứa imageUUID). Kiểm tra response trong console.');
  }

  console.log('✅ Đã upload ảnh, imageUUID:', uploadResult.imageUUID);
  return uploadResult.imageUUID;
}

/**
 * Generate image using Runware API (text-to-image)
 */
export async function generateImageWithRunware(
  prompt,
  config = {}
) {
  if (!RUNWARE_API_KEY) {
    throw new Error('Runware API key chưa được cấu hình. Vui lòng thêm VITE_RUNWARE_API_KEY vào file .env');
  }

  console.log('🔍 Original prompt:', prompt);
  const sanitizedPrompt = sanitizePrompt(prompt);
  console.log('🧹 Sanitized prompt:', sanitizedPrompt, `(length: ${sanitizedPrompt.length})`);

  if (!sanitizedPrompt || sanitizedPrompt.length < 2) {
    throw new Error('Prompt sau khi xử lý quá ngắn. Vui lòng nhập prompt có ý nghĩa hơn.');
  }

  const finalConfig = { ...DEFAULT_RUNWARE_CONFIG, ...config };
  const taskUUID = generateUUID();

  const requestBody = [
    {
      taskType: import.meta.env.VITE_RUNWARE_TASK_TYPE || 'imageInference',
      taskUUID,
      positivePrompt: sanitizedPrompt,
      ...(isStrictModel(finalConfig.model) ? {} : { negativePrompt: finalConfig.negativePrompt || 'blurry, low quality, distorted, ugly, bad anatomy, watermark, text, logo' }),
      model: finalConfig.model,
      width: finalConfig.model === 'bfl:2@2' ? getClosestFluxUltraDimensions(finalConfig.width, finalConfig.height).width : finalConfig.width,
      height: finalConfig.model === 'bfl:2@2' ? getClosestFluxUltraDimensions(finalConfig.width, finalConfig.height).height : finalConfig.height,
      ...(isStrictModel(finalConfig.model) ? {} : { steps: finalConfig.steps }),
      ...(isStrictModel(finalConfig.model) ? {} : { CFGScale: finalConfig.CFGScale }),
      outputFormat: finalConfig.outputFormat,
      outputType: 'base64Data',
      numberResults: 1,
      // Optional Img2Img params
      ...(config.seedImage ? { seedImage: config.seedImage } : {}),
      ...(config.strength ? { strength: config.strength } : {})
    }
  ];

  console.log(`🎨 Gọi Runware text-to-image API...`);
  console.log(`📋 Model: ${finalConfig.model}, Size: ${finalConfig.width}x${finalConfig.height}`);
  console.log('📡 Request URL:', RUNWARE_API_URL);
  console.log('📡 Request Headers: Authorization:', maskKey(RUNWARE_API_KEY));
  console.log('📡 Request Body (summary):', summarizeBody(requestBody));

  const response = await fetch(RUNWARE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RUNWARE_API_KEY}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Lỗi Runware:', response.status, errorText);
    throw new Error(`Lỗi Runware: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  // Log summary then try to extract image in flexible ways
  console.log('📥 Response Runware (summary):', summarizeBody(data));
  const extracted = extractBase64FromRunwareResponse(data);
  if (!extracted?.base64) {
    console.error('❌ Unable to extract base64 image from response:', data);
    throw new Error('Không nhận được ảnh từ Runware API (không tìm thấy base64). Kiểm tra response trong console.');
  }

  const mimeType = finalConfig.outputFormat === 'PNG' ? 'image/png' :
    finalConfig.outputFormat === 'JPEG' ? 'image/jpeg' : 'image/webp';

  return {
    mimeType,
    data: extracted.base64
  };
}

/**
 * Generate image using Runware API with reference image (image-to-image)
 */
export async function generateImageFromReference(
  prompt,
  referenceImage,
  config = {}
) {
  if (!RUNWARE_API_KEY) {
    throw new Error('Runware API key chưa được cấu hình. Vui lòng thêm VITE_RUNWARE_API_KEY vào file .env');
  }

  const finalConfig = { ...DEFAULT_RUNWARE_CONFIG, ...config };
  const taskUUID = generateUUID();

  // First upload the reference image
  const seedImageUUID = await uploadImageToRunware(referenceImage);

  const requestBody = [
    {
      taskType: import.meta.env.VITE_RUNWARE_TASK_TYPE || 'imageInference',
      taskUUID,
      positivePrompt: sanitizePrompt(prompt),
      ...(isStrictModel(finalConfig.model) ? {} : { negativePrompt: 'blurry, low quality, distorted, ugly, bad anatomy, watermark, text, logo, different product, wrong shape' }),
      model: finalConfig.model,
      width: finalConfig.model === 'bfl:2@2' ? getClosestFluxUltraDimensions(finalConfig.width, finalConfig.height).width : finalConfig.width,
      height: finalConfig.model === 'bfl:2@2' ? getClosestFluxUltraDimensions(finalConfig.width, finalConfig.height).height : finalConfig.height,
      ...(isStrictModel(finalConfig.model) ? {} : { steps: finalConfig.steps }),
      ...(isStrictModel(finalConfig.model) ? {} : { CFGScale: finalConfig.CFGScale }),
      outputFormat: finalConfig.outputFormat,
      outputType: 'base64Data',
      numberResults: 1,
      // Image-to-image parameters
      seedImage: seedImageUUID,
      strength: finalConfig.strength // How much to transform (0 = no change, 1 = complete change)
    }
  ];

  console.log(`🎨 Gọi Runware image-to-image API...`);
  console.log(`📋 Model: ${finalConfig.model}, Strength: ${finalConfig.strength}`);
  console.log(`📋 Size: ${finalConfig.width}x${finalConfig.height}, Steps: ${finalConfig.steps}`);
  console.log('📡 Request URL:', RUNWARE_API_URL);
  console.log('📡 Request Headers: Authorization:', maskKey(RUNWARE_API_KEY));
  console.log('📡 Request Body (summary):', summarizeBody(requestBody));

  const response = await fetch(RUNWARE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RUNWARE_API_KEY}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Lỗi Runware img2img:', response.status, errorText);
    throw new Error(`Lỗi Runware: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log('📥 Response Runware img2img (summary):', summarizeBody(data));
  const extracted = extractBase64FromRunwareResponse(data);
  if (!extracted?.base64) {
    console.error('❌ Unable to extract base64 image from img2img response:', data);
    throw new Error('Không nhận được ảnh từ Runware API (không tìm thấy base64). Kiểm tra response trong console.');
  }

  const mimeType = finalConfig.outputFormat === 'PNG' ? 'image/png' :
    finalConfig.outputFormat === 'JPEG' ? 'image/jpeg' : 'image/webp';

  return {
    mimeType,
    data: extracted.base64
  };
}

/**
 * Generate product image with Runware (wrapper for the hook)
 * Uses image-to-image if reference images provided, otherwise text-to-image
 */
export async function generateProductImageWithRunware(
  prompt,
  referenceImages,
  config = {}
) {
  if (referenceImages.length > 0) {
    // Use the first reference image for img2img
    // For multiple references, we use the primary (first) one
    return generateImageFromReference(prompt, referenceImages[0], config);
  } else {
    // Text-to-image if no reference
    return generateImageWithRunware(prompt, config);
  }
}

/**
 * Remove background from image using Runware API
 */
export async function removeImageBackground(
  image,
  config = {}
) {
  if (!RUNWARE_API_KEY) {
    throw new Error('Runware API key chưa được cấu hình. Vui lòng thêm VITE_RUNWARE_API_KEY vào file .env');
  }

  // First upload the image to get a UUID, then remove background
  console.log('📤 Uploading image for background removal...');
  const imageUUID = await uploadImageToRunware(image);

  const taskUUID = generateUUID();

  const requestBody = [
    {
      taskType: 'imageBackgroundRemoval',
      taskUUID,
      inputImage: imageUUID, // Use uploaded image UUID
      outputFormat: 'PNG', // PNG for transparent background
      outputType: 'base64Data'
    }
  ];

  console.log('🎭 Removing background from uploaded image...');
  console.log('📡 Request URL:', RUNWARE_API_URL);
  console.log('📡 Request Headers: Authorization:', maskKey(RUNWARE_API_KEY));
  console.log('📡 Request Body (summary):', summarizeBody(requestBody));

  const response = await fetch(RUNWARE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RUNWARE_API_KEY}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Lỗi remove background Runware:', response.status, errorText);
    throw new Error(`Lỗi tách nền Runware: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log('📥 Response remove background (summary):', summarizeBody(data));
  const extracted = extractBase64FromRunwareResponse(data);
  if (!extracted?.base64) {
    console.error('❌ Unable to extract base64 image from remove background response:', data);
    throw new Error('Không nhận được ảnh từ Runware API (không tìm thấy base64). Kiểm tra response trong console.');
  }

  return {
    mimeType: 'image/png', // PNG for transparency
    data: extracted.base64
  };
}

/**
 * Complete background replacement workflow:
 * 1. Remove background from original image
 * 2. Generate new image with the subject on new background
 */
export async function replaceImageBackground(
  originalImage,
  backgroundPrompt,
  config = {}
) {
  console.log('🔄 Starting background replacement workflow...');

  // Step 1: Remove background
  console.log('🎭 Step 1: Removing background...');
  const subjectOnly = await removeImageBackground(originalImage);
  console.log('✅ Background removed successfully');

  // Step 2: Generate new image with subject on new background
  console.log('🎨 Step 2: Adding new background...');
  const finalImage = await generateImageFromReference(
    `subject with transparent background on ${backgroundPrompt}`,
    subjectOnly,
    { ...config, strength: 0.9 } // High strength to replace the transparent background
  );

  console.log('✅ Background replacement completed');
  return finalImage;
}

/**
 * Inpaint image using Runware API with mask
 * @param {Object} inputImage - { mimeType, data } - original image
 * @param {Object} maskImage - { mimeType, data } - mask (white = inpaint area, black = keep)
 * @param {string} prompt - text prompt for inpainting
 * @param {Object} config - optional config
 */
export async function inpaintImage(
  inputImage,
  maskImage,
  prompt,
  config = {}
) {
  if (!RUNWARE_API_KEY) {
    throw new Error('Runware API key chưa được cấu hình. Vui lòng thêm VITE_RUNWARE_API_KEY vào file .env');
  }

  console.log('🎨 Starting inpainting workflow...');

  // Upload input image
  console.log('📤 Uploading input image...');
  const inputImageUUID = await uploadImageToRunware(inputImage);

  // Upload mask image
  console.log('📤 Uploading mask image...');
  const maskImageUUID = await uploadImageToRunware(maskImage);

  const finalConfig = { ...DEFAULT_RUNWARE_CONFIG, ...config };
  const taskUUID = generateUUID();

  const requestBody = [
    {
      taskType: import.meta.env.VITE_RUNWARE_TASK_TYPE || 'imageInference',
      taskUUID,
      positivePrompt: sanitizePrompt(prompt),
      // Flux Fill (runware:102@1) supports standard params, unlike bfl:2@2
      model: finalConfig.model === 'bfl:2@2' ? 'runware:102@1' : finalConfig.model,
      width: finalConfig.model === 'bfl:2@2' ? getClosestFluxUltraDimensions(finalConfig.width, finalConfig.height).width : finalConfig.width,
      height: finalConfig.model === 'bfl:2@2' ? getClosestFluxUltraDimensions(finalConfig.width, finalConfig.height).height : finalConfig.height,
      ...(isStrictModel(finalConfig.model === 'bfl:2@2' ? 'runware:102@1' : finalConfig.model) ? {} : { steps: finalConfig.steps }),
      ...(isStrictModel(finalConfig.model === 'bfl:2@2' ? 'runware:102@1' : finalConfig.model) ? {} : { CFGScale: finalConfig.CFGScale }),
      outputFormat: finalConfig.outputFormat,
      outputType: 'base64Data',
      numberResults: 1,
      numberResults: 1,
      // P-Image-Edit (prunaai:2@1) requirement:
      // - Gateway rejected 'referenceImages'.
      // - Backend demands 'inputs.referenceImages'.
      // - SOLUTION: Pass 'inputs' object directly to bypass Gateway mapping/aliasing issues.
      ...(['prunaai:2@1', 'p-image-edit'].includes(finalConfig.model)
        ? {
          inputs: {
            referenceImages: [inputImageUUID]
          }
        }
        : { seedImage: inputImageUUID, maskImage: maskImageUUID }
      ),
      // Flux Fill needs maskImage, but Pruna throws unsupportedParameter for it.
      // So we bundle maskImage with seedImage logic above.
      // Flux Fill (runware:102@1) and P-Image-Edit (prunaai:2@1) do NOT support strength.
      // Reverting to strict check or specific exclusion list.
      ...(['runware:102@1', 'prunaai:2@1', 'p-image-edit'].includes(finalConfig.model) ? {} : { strength: finalConfig.strength || 0.95 })
    }
  ];

  console.log('🎨 Calling Runware inpainting API...');
  console.log('📋 Model:', finalConfig.model, 'Size:', `${finalConfig.width}x${finalConfig.height}`);
  console.log('📡 Request URL:', RUNWARE_API_URL);
  console.log('📡 Request Headers: Authorization:', maskKey(RUNWARE_API_KEY));
  console.log('📡 Request Body (summary):', summarizeBody(requestBody));

  const response = await fetch(RUNWARE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RUNWARE_API_KEY}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Lỗi Runware inpainting:', response.status, errorText);
    throw new Error(`Lỗi Runware inpainting: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log('📥 Response Runware inpainting (summary):', summarizeBody(data));
  const extracted = extractBase64FromRunwareResponse(data);
  if (!extracted?.base64) {
    console.error('❌ Unable to extract base64 image from inpainting response:', data);
    throw new Error('Không nhận được ảnh từ Runware API (không tìm thấy base64). Kiểm tra response trong console.');
  }

  const mimeType = finalConfig.outputFormat === 'PNG' ? 'image/png' :
    finalConfig.outputFormat === 'JPEG' ? 'image/jpeg' : 'image/webp';

  console.log('✅ Inpainting completed successfully');
  return {
    mimeType,
    data: extracted.base64
  };
}

/**
 * Log Runware API configuration
 */
export function logRunwareConfiguration() {
  const info = getRunwareAPIInfo();
  console.group('🔍 Runware API Configuration');
  console.log('Provider:', info.provider);
  console.log('Package:', info.package);
  console.log('API Endpoint:', info.apiEndpoint);
  console.log('API Key:', info.apiKeyConfigured ? `✅ Configured (${info.apiKeyPrefix})` : '❌ Not configured');
  console.log('Available Models:', info.availableModels);
  console.log('Documentation:', info.documentation);
  console.groupEnd();
  return info;
}
