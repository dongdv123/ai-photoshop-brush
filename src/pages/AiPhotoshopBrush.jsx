import React, { useRef, useState, useEffect } from 'react';
import {
  isRunwareConfigured,
  inpaintImage,
  removeImageBackground,
  generateImageWithRunware
} from '../services/runwareService';
import { translateToEnglish } from '../services/translateService';

export default function AiPhotoshopBrush() {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const maskCanvasRef = useRef(null);

  // State for paths (Lasso logic)
  const [paths, setPaths] = useState([]);
  const [currentPath, setCurrentPath] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);

  // History
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [uploadedImagePreview, setUploadedImagePreview] = useState(null);
  const [editInstruction, setEditInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Mask Debug Mode
  const [showMask, setShowMask] = useState(false);
  const [featherRadius, setFeatherRadius] = useState(8);
  const [inpaintStrength, setInpaintStrength] = useState(0.95);
  const [preset, setPreset] = useState('match_lighting'); // 'match_lighting' | 'match_shadows' | 'add_object_only'
  const [addShadow, setAddShadow] = useState(true);
  const [useTextToImage, setUseTextToImage] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Initialize
  useEffect(() => {
    initCanvas(512, 512);
  }, []);

  // Re-render when content changes
  useEffect(() => {
    drawPathsToCanvas();
  }, [paths, currentPath, showMask]);

  function initCanvas(w, h) {
    const canvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!canvas || !maskCanvas) return;

    canvas.width = w;
    canvas.height = h;
    maskCanvas.width = w;
    maskCanvas.height = h;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // Reset state
    setPaths([]);
    setCurrentPath([]);
    setHistory([]);
    setHistoryIndex(-1);
    saveHistory([]);
  }

  function saveHistory(newPaths) {
    const stateToSave = newPaths ? [...newPaths] : [...paths];
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(stateToSave);
    if (newHistory.length > 20) newHistory.shift();
    setHistory(newHistory);
    // Use timeout to avoid render loop
    setTimeout(() => setHistoryIndex(newHistory.length - 1), 0);
  }

  function undo() {
    if (historyIndex > 0) {
      const prevPaths = history[historyIndex - 1];
      setPaths(prevPaths);
      setHistoryIndex(historyIndex - 1);
    } else if (historyIndex === 0) {
      setPaths([]);
      setHistoryIndex(-1);
    }
  }

  function clearMask() {
    setPaths([]);
    saveHistory([]);
  }

  // --- Drawing Logic ---

  function drawPathsToCanvas() {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const ctx = maskCanvas.getContext('2d');
    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);

    // Debug Mode: Show Binary Mask
    if (showMask) {
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

      ctx.fillStyle = 'white';
      paths.forEach(path => {
        if (path.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
        ctx.closePath();
        ctx.fill();
      });
      return;
    }

    // Normal Lasso Mode
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#22c55e'; // Green 500
    ctx.fillStyle = 'rgba(34, 197, 94, 0.4)'; // Stronger green fill (opacity 0.4)

    paths.forEach(path => {
      drawPath(ctx, path, true);
    });

    if (currentPath.length > 0) {
      drawPath(ctx, currentPath, false);
    }
  }

  function drawPath(ctx, path, close) {
    if (path.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }
    if (close) {
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }

  function getPointerPos(e, target) {
    const rect = target.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const scaleX = target.width / rect.width;
    const scaleY = target.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  function startDrawing(e) {
    setIsDrawing(true);
    // Allow multiple selections: Do not clear previous paths
    const pos = getPointerPos(e, maskCanvasRef.current);
    setCurrentPath([pos]);
  }

  function stopDrawing() {
    if (isDrawing) {
      setIsDrawing(false);
      if (currentPath.length > 2) {
        const newPaths = [...paths, currentPath];
        setPaths(newPaths);
        saveHistory(newPaths);
      }
      setCurrentPath([]);
    }
  }

  function drawMove(e) {
    if (!isDrawing) return;
    if (e.touches) e.preventDefault();
    const pos = getPointerPos(e, maskCanvasRef.current);
    setCurrentPath(prev => [...prev, pos]);
  }

  // --- Upload ---

  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Vui lòng chọn file ảnh hợp lệ');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        const maxDim = 1024; // Runware supports up to 2048, but let's stick to 1024 for speed/cost if desired

        // 1. Resize to fit within max constraints
        if (w > maxDim || h > maxDim) {
          const scale = Math.min(maxDim / w, maxDim / h);
          w = w * scale;
          h = h * scale;
        }

        // 2. Snap to Grid (Multiples of 64)
        // Runware requires dimensions to be multiples of 64
        w = Math.floor(w / 64) * 64;
        h = Math.floor(h / 64) * 64;

        // 3. Ensure Minimum Size (128x128)
        w = Math.max(128, w);
        h = Math.max(128, h);

        initCanvas(w, h);
        const ctx = canvasRef.current.getContext('2d');
        // We use destination dimensions (w,h) which creates the resizing effect
        ctx.drawImage(img, 0, 0, w, h);
        setUploadedImagePreview(ev.target.result);
        setError(null);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  // --- Generate ---

  // --- Generate ---

  function getBoundingBox(paths) {
    if (!paths || paths.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    paths.forEach(path => {
      path.forEach(pt => {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      });
    });

    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  async function handleGenerate() {
    if (!uploadedImagePreview) {
      setError('Please upload an image first.');
      return;
    }
    if (!isRunwareConfigured()) {
      setError('Runware API Key missing.');
      return;
    }
    if (paths.length === 0) {
      setError('Please select an area first.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const canvas = canvasRef.current;
      const maskCanvas = maskCanvasRef.current; // Used for dimensions

      // 1. Calculate Bounding Box
      const bbox = getBoundingBox(paths);
      if (!bbox) throw new Error("Could not calculate selection bounds");

      // 2. Add Padding (e.g. 50% or 64px, whichever is larger), clamp to image size
      // We want significant context so the AI matches the style (e.g. stained glass)
      const padding = Math.max(64, Math.floor(Math.max(bbox.width, bbox.height) * 0.5));

      let x = Math.floor(bbox.minX - padding);
      let y = Math.floor(bbox.minY - padding);
      let w = Math.ceil(bbox.width + padding * 2);
      let h = Math.ceil(bbox.height + padding * 2);

      // Clamp to canvas bounds
      x = Math.max(0, x);
      y = Math.max(0, y);
      w = Math.min(canvas.width - x, w);
      h = Math.min(canvas.height - y, h);

      // Ensure square or specific aspect ratio if desired, but flexible is usually fine for inpainting
      // Runware/Flux often likes multiples of 64
      w = Math.floor(w / 8) * 8;
      h = Math.floor(h / 8) * 8;

      if (w < 64 || h < 64) {
        throw new Error("Selection too small for generation");
      }

      console.log('ROI:', { x, y, w, h });

      // 3. Prefer Inpainting on the original image using the user's mask so generated content
      //    matches scene layout, perspective and lighting. Build a binary mask (white=inpaint)
      //    and upload both the full image + mask to Runware's inpaint endpoint.

      // Ensure prompt is strong if short
      let prompt = editInstruction.trim();
      if (!prompt) prompt = "Fill naturally to match surrounding scene";

      // Auto-Translate to English for better AI understanding
      let translatedPrompt = prompt;
      try {
        translatedPrompt = await translateToEnglish(prompt);
      } catch (err) {
        console.warn("Translation failed, using original:", err);
      }

      // Apply automatic "easy-mode" defaults unless user opened Advanced
      const isAdvanced = showAdvanced;
      let effectivePreset = preset;
      if (!isAdvanced) {
        const pLower = prompt.toLowerCase();
        if (pLower.includes('shadow') || pLower.includes('shadows')) effectivePreset = 'match_shadows';
        else effectivePreset = 'match_lighting';
      }
      const effectiveFeather = isAdvanced ? featherRadius : Math.max(2, Math.min(64, Math.floor(Math.max(w, h) * 0.08)));
      // Lower the default strength in easy-mode so the model more closely follows the instruction
      const effectiveStrength = isAdvanced ? inpaintStrength : 0.85; // Increased default strength for more pronounced changes
      const effectiveAddShadow = isAdvanced ? addShadow : (effectivePreset === 'match_shadows' || Math.max(w, h) > Math.max(canvas.width, canvas.height) * 0.12);
        // Build a strict, instruction-centric prompt to improve fidelity.
        // Emphasize exact adherence, limit hallucination, and request preservation of shape/scale/position.
        // Increased emphasis on exact adherence and masked area replacement
        let inpaintPrompt = `Instruction: ${translatedPrompt}. EXACTLY follow this instruction. ONLY replace the masked area. Preserve the object's shape, scale, and position precisely within the selection. Match surrounding lighting, perspective and color seamlessly. Absolutely DO NOT add extra objects, text, logos, people, or unrelated elements.`;
      if (effectivePreset === 'match_shadows') {
        inpaintPrompt += ", include natural soft cast shadow on the ground matching light direction and contact";
      } else if (effectivePreset === 'add_object_only') {
        inpaintPrompt += ", do not alter background, keep textures and lighting intact";
      } else {
        inpaintPrompt += ", match surrounding lighting and color";
      }
      // Comprehensive negative hints to discourage common hallucinations and undesired artifacts
      inpaintPrompt += ", blurry, low quality, distorted, ugly, bad anatomy, deformed, extra limbs, added faces, duplicate, cropped, out of frame, watermark, text, signature, logo, different product, wrong shape, unrealistic, oversaturated, dull, noisy, grain.";

      console.log('Calling inpaint with prompt:', inpaintPrompt, { effectivePreset, effectiveFeather, effectiveStrength, effectiveAddShadow });

      // Create input image (full canvas) and mask (white where selection exists)
      const inputDataUrl = canvas.toDataURL('image/png');
      const inputImage = { mimeType: 'image/png', data: inputDataUrl.split(',')[1] };

      // Build mask: black background, white filled selection(s)
      const maskTemp = document.createElement('canvas');
      maskTemp.width = maskCanvas.width;
      maskTemp.height = maskCanvas.height;
      const mctx = maskTemp.getContext('2d');
      // Fill black (keep)
      mctx.fillStyle = 'black';
      mctx.fillRect(0, 0, maskTemp.width, maskTemp.height);
      // Draw white for selected paths (inpaint area)
      mctx.fillStyle = 'white';
      paths.forEach(path => {
        if (path.length < 2) return;
        mctx.beginPath();
        mctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) mctx.lineTo(path[i].x, path[i].y);
        mctx.closePath();
        mctx.fill();
      });

      const maskDataUrl = maskTemp.toDataURL('image/png');
      const maskImage = { mimeType: 'image/png', data: maskDataUrl.split(',')[1] };

      // If user opted to use Text→Image for the selection, generate an image sized to the bbox
      // and composite it into the selection area. Otherwise, call inpaint endpoint.
      let inpaintImg;
      if (useTextToImage) {
        console.log('Generating standalone image for selection via Text→Image with prompt:', translatedPrompt);
        // Use the original (unpadded) bbox for placement so the generated object sits inside user's selection.
        const innerX = bbox.minX;
        const innerY = bbox.minY;
        const innerW = Math.max(1, Math.floor(bbox.width));
        const innerH = Math.max(1, Math.floor(bbox.height));

        // Runware requires width/height to be integers between 128 and 2048 and multiples of 64.
        const clampToRange = (v) => {
          const ceil64 = Math.ceil(v / 64) * 64;
          return Math.min(2048, Math.max(128, ceil64));
        };
        const genW = clampToRange(innerW);
        const genH = clampToRange(innerH);
        console.log('Text→Image target size (from inner bbox):', { genW, genH, inner: { innerW, innerH }, padded: { w, h } });

        // Generate an image with size based on inner bbox (clamped to Runware rules)
        const genResult = await generateImageWithRunware(translatedPrompt, { width: genW, height: genH });
        const genUrl = `data:${genResult.mimeType};base64,${genResult.data}`;
        const genImg = new Image();
        await new Promise(resolve => {
          genImg.onload = resolve;
          genImg.src = genUrl;
        });

        // Remove background from generated image so only object remains, then draw into inner bbox.
        try {
          const removed = await removeImageBackground({ mimeType: genResult.mimeType, data: genResult.data });
          const removedUrl = `data:${removed.mimeType};base64,${removed.data}`;
          const removedImg = new Image();
          await new Promise(resolve => {
            removedImg.onload = resolve;
            removedImg.src = removedUrl;
          });

          // Draw removed-image scaled to the exact inner bbox (so object sits in selection), leaving transparent background elsewhere
          const tempInpaintLocal = document.createElement('canvas');
          tempInpaintLocal.width = canvas.width;
          tempInpaintLocal.height = canvas.height;
          const tipctx = tempInpaintLocal.getContext('2d');
          tipctx.clearRect(0, 0, tempInpaintLocal.width, tempInpaintLocal.height);
          tipctx.drawImage(removedImg, innerX, innerY, innerW, innerH);
          inpaintImg = new Image();
          await new Promise(resolve => {
            inpaintImg.onload = resolve;
            inpaintImg.src = tempInpaintLocal.toDataURL('image/png');
          });
        } catch (bgErr) {
          console.warn('Background removal failed for generated image, falling back to full generated image:', bgErr);
          // Fallback: draw the full generated image scaled into the inner bbox
          const tempInpaintLocal = document.createElement('canvas');
          tempInpaintLocal.width = canvas.width;
          tempInpaintLocal.height = canvas.height;
          const tipctx = tempInpaintLocal.getContext('2d');
          tipctx.clearRect(0, 0, tempInpaintLocal.width, tempInpaintLocal.height);
          tipctx.drawImage(genImg, innerX, innerY, innerW, innerH);
          inpaintImg = new Image();
          await new Promise(resolve => {
            inpaintImg.onload = resolve;
            inpaintImg.src = tempInpaintLocal.toDataURL('image/png');
          });
        }
      } else {
        // Call inpaint API with canvas-sized output to preserve layout
        let inpaintResult;
        try {
          inpaintResult = await inpaintImage(
            inputImage,
            maskImage,
            inpaintPrompt,
            { width: canvas.width, height: canvas.height, strength: effectiveStrength }
          );
        } catch (inpaintErr) {
          console.error('Inpaint API failed:', inpaintErr);
          setError(inpaintErr.message || String(inpaintErr));
          setLoading(false);
          return;
        }
        // Apply returned full-image inpaint result onto the canvas
        const inpaintUrl = `data:${inpaintResult.mimeType};base64,${inpaintResult.data}`;
        inpaintImg = new Image();
        await new Promise(resolve => {
          inpaintImg.onload = resolve;
          inpaintImg.src = inpaintUrl;
        });
      }

      // Composite: only apply inpainted pixels inside the (possibly feathered) mask.
      // - Use mask alpha as blend factor so blurred edges blend smoothly.
      const origCtx = canvas.getContext('2d');
      // Read original pixels (before applying inpaint)
      const origPixels = origCtx.getImageData(0, 0, canvas.width, canvas.height);

      // Prepare inpaint pixels
      const tempInpaint = document.createElement('canvas');
      tempInpaint.width = canvas.width;
      tempInpaint.height = canvas.height;
      const ipctx = tempInpaint.getContext('2d');
      ipctx.drawImage(inpaintImg, 0, 0, canvas.width, canvas.height);
      const inpaintPixels = ipctx.getImageData(0, 0, canvas.width, canvas.height);

      // Optionally feather the mask to create soft transitions.
      const maskRaw = maskTemp; // already drawn (black background, white selection)
      const maskBlur = document.createElement('canvas');
      maskBlur.width = maskRaw.width;
      maskBlur.height = maskRaw.height;
      const mbctx = maskBlur.getContext('2d');
      // Use canvas filter to blur the raw mask into maskBlur
      mbctx.clearRect(0, 0, maskBlur.width, maskBlur.height);
      mbctx.filter = `blur(${effectiveFeather}px)`;
      mbctx.drawImage(maskRaw, 0, 0);
      // Reset filter for safety
      mbctx.filter = 'none';

      const maskPixels = mbctx.getImageData(0, 0, maskBlur.width, maskBlur.height);

      // Optionally generate a ground shadow before compositing the inpaint result
      if (effectiveAddShadow) {
        try {
          const shadowCanvas = document.createElement('canvas');
          shadowCanvas.width = canvas.width;
          shadowCanvas.height = canvas.height;
          const sctx = shadowCanvas.getContext('2d');
          sctx.clearRect(0, 0, shadowCanvas.width, shadowCanvas.height);

          // Draw the feathered mask as the base for the shadow
          // Scale vertically to simulate perspective (squash) and offset to approximate light direction
          const dy = Math.max(4, Math.floor(bbox.height * 0.05));
          const scaleY = 0.35; // squash factor
          sctx.save();
          sctx.translate(0, dy);
          sctx.scale(1, scaleY);
          // Draw the blurred mask; it will act as shadow alpha
          sctx.drawImage(maskBlur, 0, 0);
          sctx.restore();

          // Convert drawn mask into black shadow using source-in
          sctx.globalCompositeOperation = 'source-in';
          sctx.fillStyle = 'black';
          sctx.fillRect(0, 0, shadowCanvas.width, shadowCanvas.height);
          sctx.globalCompositeOperation = 'source-over';

          // Further blur the shadow for softness
          const finalShadow = document.createElement('canvas');
          finalShadow.width = canvas.width;
          finalShadow.height = canvas.height;
          const fctx = finalShadow.getContext('2d');
          fctx.clearRect(0, 0, finalShadow.width, finalShadow.height);
          fctx.filter = `blur(${Math.max(8, Math.floor(effectiveFeather * 1.5))}px)`;
          fctx.drawImage(shadowCanvas, 0, 0);
          fctx.filter = 'none';

          // Draw shadow onto original canvas (beneath the final object). Use low opacity and multiply blend
          origCtx.save();
          origCtx.globalAlpha = 0.45;
          origCtx.globalCompositeOperation = 'multiply';
          origCtx.drawImage(finalShadow, 0, 0);
          origCtx.globalCompositeOperation = 'source-over';
          origCtx.globalAlpha = 1;
          origCtx.restore();
        } catch (shadowErr) {
          console.warn('Shadow generation failed:', shadowErr);
        }
      }

      // Composite per-pixel using mask alpha as blend weight
      // --- Color matching: sample surrounding original area and shift inpaint colors to better match ---
      try {
        // Compute bounding box ring to sample surrounding colors
        const ring = Math.max(8, Math.floor(effectiveFeather * 0.75));
        const bx = Math.max(0, x - ring);
        const by = Math.max(0, y - ring);
        const bw = Math.min(canvas.width - bx, w + ring * 2);
        const bh = Math.min(canvas.height - by, h + ring * 2);

        // Read original pixels for sampling (we already have origPixels)
        const origData = origPixels.data;
        const mDataLocal = maskPixels.data;
        let origCount = 0;
        let origSumR = 0, origSumG = 0, origSumB = 0;
        let inCount = 0;
        let inSumR = 0, inSumG = 0, inSumB = 0;

        // iterate only over the bbox ring for performance
        for (let yy = by; yy < by + bh; yy++) {
          for (let xx = bx; xx < bx + bw; xx++) {
            const idx = (yy * canvas.width + xx) * 4;
            const ma = mDataLocal[idx + 3] / 255; // mask alpha
            const inAlpha = inpaintPixels.data[idx + 3] / 255; // inpaint alpha
            const r = origData[idx], g = origData[idx + 1], b = origData[idx + 2];
            // treat mostly-transparent (mask alpha < 0.1) as background (sample for matching)
            if (ma < 0.10) {
              origSumR += r; origSumG += g; origSumB += b; origCount++;
            }
            // treat strongly masked AND with visible inpaint alpha as inpainted region (sample inpaint colors)
            const effectiveInMask = ma * inAlpha;
            if (effectiveInMask > 0.6) {
              inSumR += inpaintPixels.data[idx];
              inSumG += inpaintPixels.data[idx + 1];
              inSumB += inpaintPixels.data[idx + 2];
              inCount++;
            }
          }
        }

        if (origCount > 8 && inCount > 8) {
          const avgOrigR = origSumR / origCount;
          const avgOrigG = origSumG / origCount;
          const avgOrigB = origSumB / origCount;
          const avgInR = inSumR / inCount;
          const avgInG = inSumG / inCount;
          const avgInB = inSumB / inCount;

          // Compute per-channel offsets
          const blendCorrection = 0.85; // how strongly to apply color shift (tweakable)
          const offR = (avgOrigR - avgInR) * blendCorrection;
          const offG = (avgOrigG - avgInG) * blendCorrection;
          const offB = (avgOrigB - avgInB) * blendCorrection;

          // Compute luminance scaling to match brightness/contrast of scene
          const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const avgOrigLum = luminance(avgOrigR, avgOrigG, avgOrigB);
          const avgInLum = luminance(avgInR, avgInG, avgInB) || 1;
          // Allow small clamp to avoid extreme scaling
          let lumScale = avgOrigLum / avgInLum;
          lumScale = Math.max(0.75, Math.min(1.25, lumScale));

          // Apply offsets and luminance scaling to inpaintPixels only where mask alpha > 0
          for (let i = 0; i < inpaintPixels.data.length; i += 4) {
            const ma = maskPixels.data[i + 3] / 255;
            if (ma <= 0.01) continue;
            // apply correction proportional to mask alpha to preserve transitions
            const factor = ma;
            // read original inpaint color
            let r = inpaintPixels.data[i];
            let g = inpaintPixels.data[i + 1];
            let b = inpaintPixels.data[i + 2];
            // apply per-channel offset (color balance)
            r = r + offR * factor;
            g = g + offG * factor;
            b = b + offB * factor;
            // apply luminance scaling toward avg scene brightness
            r = r * (1 + (lumScale - 1) * factor);
            g = g * (1 + (lumScale - 1) * factor);
            b = b * (1 + (lumScale - 1) * factor);
            // clamp and write back
            inpaintPixels.data[i] = Math.max(0, Math.min(255, Math.round(r)));
            inpaintPixels.data[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
            inpaintPixels.data[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
          }
          // write back adjusted inpaint pixels into temp canvas for later composite
          ipctx.putImageData(inpaintPixels, 0, 0);
        }
      } catch (cmErr) {
        console.warn('Color-match failed:', cmErr);
      }

      const outData = origPixels.data;
      const inData = inpaintPixels.data;
      const mData = maskPixels.data;
      for (let i = 0; i < outData.length; i += 4) {
        const maskA = mData[i + 3] / 255; // mask alpha (0..1)
        if (maskA <= 0) continue; // keep original pixel
        const inA = inData[i + 3] / 255; // inpaint pixel alpha (0..1)
        const effectiveAlpha = maskA * inA; // only blend where both mask and inpaint contain content
        if (effectiveAlpha <= 0) continue;
        // Blend channels using effectiveAlpha
        outData[i] = Math.round(inData[i] * effectiveAlpha + outData[i] * (1 - effectiveAlpha));
        outData[i + 1] = Math.round(inData[i + 1] * effectiveAlpha + outData[i + 1] * (1 - effectiveAlpha));
        outData[i + 2] = Math.round(inData[i + 2] * effectiveAlpha + outData[i + 2] * (1 - effectiveAlpha));
        // Alpha channel - keep original alpha
      }

      // Put composited pixels back to canvas
      origCtx.putImageData(origPixels, 0, 0);

      // Update preview and clear selection
      const updatedPreview = canvas.toDataURL('image/png');
      setUploadedImagePreview(updatedPreview);
      clearMask();

    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }


  function toggleMaskPreview() {
    setShowMask(!showMask);
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ color: '#2563eb', margin: 0, fontSize: '1.8rem' }}>AI Photoshop Lasso</h1>
        <p style={{ color: '#666', marginTop: 4 }}>
          Select an area to transform. Everything inside the green shape will be changed.
        </p>
      </header>

      {/* Toolbar */}
      <div style={{
        padding: 12,
        marginBottom: 20,
        background: '#f1f5f9',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 16
      }}>
        <input
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          style={{ fontSize: 13 }}
        />

        <div style={{ width: 1, height: 24, background: '#cbd5e1' }} />

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={toggleMaskPreview}
            style={{
              padding: '6px 12px', borderRadius: 6, border: '1px solid #ccc', cursor: 'pointer',
              background: showMask ? '#2563eb' : 'white',
              color: showMask ? 'white' : '#333',
              fontWeight: '500'
            }}
          >
            {showMask ? 'Hide Mask' : 'Preview Mask'}
          </button>
        </div>

        <div style={{ flex: 1 }}></div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={undo}
            disabled={!paths.length}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer' }}
          >
            Undo
          </button>
          <button
            onClick={clearMask}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Main Area */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'start' }}>

        {/* Editor */}
        <div style={{
          flex: '2 1 600px',
          background: '#e2e8f0',
          borderRadius: 8,
          padding: 20,
          minHeight: 500,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          border: '1px solid #cbd5e1'
        }}>
          <div style={{ position: 'relative', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', background: 'white', fontSize: 0 }}>
            <canvas
              ref={canvasRef}
              style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
            />
            <canvas
              ref={maskCanvasRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                touchAction: 'none',
                cursor: showMask ? 'default' : 'crosshair'
              }}
              onMouseDown={!showMask ? startDrawing : undefined}
              onMouseMove={!showMask ? drawMove : undefined}
              onMouseUp={!showMask ? stopDrawing : undefined}
              onMouseLeave={!showMask ? stopDrawing : undefined}
              onTouchStart={!showMask ? startDrawing : undefined}
              onTouchMove={!showMask ? drawMove : undefined}
              onTouchEnd={!showMask ? stopDrawing : undefined}
            />
            {!uploadedImagePreview && (
              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ fontSize: 16, color: '#94a3b8' }}>Upload an image to start</div>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: 'white', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: '600', marginBottom: 8, color: '#334155' }}>
              Instruction
            </label>
            <textarea
              value={editInstruction}
              onChange={(e) => setEditInstruction(e.target.value)}
              placeholder="e.g. A red rose"
              style={{ width: '100%', height: 100, padding: 10, borderRadius: 6, border: '1px solid #cbd5e1', fontFamily: 'inherit', resize: 'vertical' }}
            />
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input id="useTextToImage" type="checkbox" checked={useTextToImage} onChange={(e) => setUseTextToImage(e.target.checked)} />
              <label htmlFor="useTextToImage" style={{ fontSize: 13, color: '#334155' }}>Use Text→Image to generate content for the selection</label>
            </div>
            {/* Simplified UI for most users: hide advanced controls behind toggle */}
            {!showAdvanced && (
              <div style={{ marginTop: 8, fontSize: 13, color: '#475569', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div>Settings are applied automatically for best results.</div>
                <button type="button" onClick={() => setShowAdvanced(true)} style={{ marginLeft: 8, padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer' }}>
                  Advanced
                </button>
              </div>
            )}

            {showAdvanced && (
              <>
                <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ fontSize: 13, color: '#334155', minWidth: 90 }}>Preset</label>
                  <select value={preset} onChange={(e) => setPreset(e.target.value)} style={{ flex: 1, padding: 6, borderRadius: 6 }}>
                    <option value="match_lighting">Match Lighting</option>
                    <option value="match_shadows">Match Shadows & Ground</option>
                    <option value="add_object_only">Add Object Only</option>
                  </select>
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ fontSize: 13, color: '#334155', minWidth: 90 }}>Feather</label>
                  <input type="range" min="0" max="64" value={featherRadius} onChange={(e) => setFeatherRadius(Number(e.target.value))} style={{ flex: 1 }} />
                  <div style={{ width: 42, textAlign: 'right', fontSize: 13 }}>{featherRadius}px</div>
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ fontSize: 13, color: '#334155', minWidth: 90 }}>Strength</label>
                  <input type="range" min="0.1" max="1.0" step="0.05" value={inpaintStrength} onChange={(e) => setInpaintStrength(Number(e.target.value))} style={{ flex: 1 }} />
                  <div style={{ width: 42, textAlign: 'right', fontSize: 13 }}>{inpaintStrength.toFixed(2)}</div>
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ fontSize: 13, color: '#334155', minWidth: 90 }}>Add Shadow</label>
                  <input type="checkbox" checked={addShadow} onChange={(e) => setAddShadow(e.target.checked)} />
                </div>
              </>
            )}
            <button
              onClick={handleGenerate}
              disabled={loading || !uploadedImagePreview}
              style={{
                width: '100%',
                marginTop: 12,
                padding: '12px',
                background: loading ? '#94a3b8' : '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                fontWeight: '600',
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? 'Generating...' : 'Generate Edit'}
            </button>
            {error && <div style={{ marginTop: 12, padding: 8, background: '#fee2e2', color: '#dc2626', borderRadius: 6, fontSize: 13 }}>{error}</div>}
          </div>

        </div>

      </div>
    </div>
  );
}
