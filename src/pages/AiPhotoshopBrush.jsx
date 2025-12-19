import React, { useRef, useState, useEffect } from 'react';
import {
  isRunwareConfigured,
  inpaintImage,
  generateImageWithRunware,
  removeImageBackground,
} from '../services/runwareService';

export default function AiPhotoshopBrush() {
  const canvasRef = useRef(null);
  const maskCanvasRef = useRef(null);
  const fileInputRef = useRef(null);

  // State for paths (Lasso logic)
  const [paths, setPaths] = useState([]);
  const [currentPath, setCurrentPath] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);

  // History for undo
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [uploadedImage, setUploadedImage] = useState(null);
  const [resultImage, setResultImage] = useState(null);
  const [editInstruction, setEditInstruction] = useState('');
  // Generated prompt preview (shown to user before sending to inpaint)
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [generatedMask, setGeneratedMask] = useState(null);
  const [invertMask, setInvertMask] = useState(false);
  // Custom strength for manual control (default 0.75 for balanced edit)
  const [customStrength, setCustomStrength] = useState(0.75);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [processingTime, setProcessingTime] = useState(null);

  // Initialize canvas
  useEffect(() => {
    initCanvas(512, 512);
  }, []);

  // Re-render paths
  useEffect(() => {
    drawPathsToCanvas();
  }, [paths, currentPath]);

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

  function drawPathsToCanvas() {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const ctx = maskCanvas.getContext('2d');
    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);

    // Red selection color (matching screenshot)
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ef4444'; // red-500
    ctx.fillStyle = 'rgba(239, 68, 68, 0.3)'; // red fill with opacity

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

  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        const maxDim = 1024;

        if (w > maxDim || h > maxDim) {
          const scale = Math.min(maxDim / w, maxDim / h);
          w = w * scale;
          h = h * scale;
        }

        w = Math.floor(w / 64) * 64;
        h = Math.floor(h / 64) * 64;
        w = Math.max(128, w);
        h = Math.max(128, h);

        initCanvas(w, h);
        const ctx = canvasRef.current.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        setUploadedImage(ev.target.result);
        setResultImage(null);
        setError(null);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

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
    if (!uploadedImage) {
      setError('Please upload an image first.');
      return;
    }
    if (!isRunwareConfigured()) {
      setError('Runware API Key missing.');
      return;
    }
    if (paths.length === 0) {
      setError('Please draw a selection area first.');
      return;
    }
    if (!editInstruction.trim()) {
      setError('Please enter an instruction.');
      return;
    }

    setLoading(true);
    setError(null);
    const startTime = Date.now();

    try {
      const canvas = canvasRef.current;
      const maskCanvas = maskCanvasRef.current;

      const bbox = getBoundingBox(paths);
      if (!bbox) throw new Error("Could not calculate selection bounds");

      const prompt = editInstruction.trim();

      // Calculate position of selection for spatial context (3x3 grid)
      const centerX = (bbox.minX + bbox.maxX) / 2;
      const centerY = (bbox.minY + bbox.maxY) / 2;
      const relativeX = centerX / canvas.width;
      const relativeY = centerY / canvas.height;

      // 1. Determine position description (3x3 grid) and translate to Vietnamese
      let posH = relativeX < 0.35 ? "left" : relativeX > 0.65 ? "right" : "center";
      let posV = relativeY < 0.35 ? "top" : relativeY > 0.65 ? "bottom" : "middle";
      const viPosH = posH === "left" ? "trái" : posH === "right" ? "phải" : "trung tâm";
      const viPosV = posV === "top" ? "trên" : posV === "bottom" ? "dưới" : "trung tâm";
      const positionDesc = (viPosV === "trung tâm" && viPosH === "trung tâm") ? "trung tâm" : `${viPosV} ${viPosH}`;

      // 2. Calculate size description based on area percentage coverage (Vietnamese)
      const areaPercent = ((bbox.width * bbox.height) / (canvas.width * canvas.height)) * 100;
      let sizeDesc = "cỡ vừa";
      if (areaPercent < 1) sizeDesc = "rất nhỏ";
      else if (areaPercent < 5) sizeDesc = "nhỏ";
      else if (areaPercent > 40) sizeDesc = "rất lớn";
      else if (areaPercent > 20) sizeDesc = "lớn";

      // 3. Complete prompt in Vietnamese: Position + Size + Instruction
      const enhancedPrompt = `Ở khu vực ${positionDesc}, ${prompt} ${sizeDesc}, được vẽ chân thực, phù hợp với ánh sáng và phong cách xung quanh.`;

      // Set generated prompt into state so UI can show it for preview/debugging
      setGeneratedPrompt(enhancedPrompt);
      console.log("🚀 Final Enhanced Prompt:", enhancedPrompt);
      console.log(`📊 Stats: Position=${positionDesc}, Size=${sizeDesc} (${areaPercent.toFixed(1)}% area)`);

      console.log(`🎨 Generating with strength: ${customStrength}`);

      // Prepare Input Image
      const inputDataUrl = canvas.toDataURL('image/png');
      const inputImage = { mimeType: 'image/png', data: inputDataUrl.split(',')[1] };

      // Prepare Mask with SMART DILATION ("Smart Selection")
      const smartMaskCanvas = document.createElement('canvas');
      smartMaskCanvas.width = canvas.width;
      smartMaskCanvas.height = canvas.height;
      const mctx = smartMaskCanvas.getContext('2d');

      // 0. Initialize with BLACK background
      mctx.fillStyle = 'black';
      mctx.fillRect(0, 0, smartMaskCanvas.width, smartMaskCanvas.height);

      // 1. Draw paths with DILATION (Thicker strokes)
      mctx.lineCap = 'round';
      mctx.lineJoin = 'round';
      mctx.lineWidth = 25; // Dilation: expands selection to connect dashes
      mctx.fillStyle = 'white';
      mctx.strokeStyle = 'white';

      paths.forEach(path => {
        if (path.length < 2) return;
        mctx.beginPath();
        mctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) mctx.lineTo(path[i].x, path[i].y);
        mctx.stroke();
        mctx.closePath();
        mctx.fill();
      });

      let maskDataUrl = smartMaskCanvas.toDataURL('image/png');
      // Optionally invert mask before sending (if user toggles)
      if (invertMask) {
        const invCanvas = document.createElement('canvas');
        invCanvas.width = smartMaskCanvas.width;
        invCanvas.height = smartMaskCanvas.height;
        const ictx = invCanvas.getContext('2d');
        ictx.drawImage(smartMaskCanvas, 0, 0);
        const imgData = ictx.getImageData(0, 0, invCanvas.width, invCanvas.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          data[i] = 255 - data[i];
          data[i+1] = 255 - data[i+1];
          data[i+2] = 255 - data[i+2];
        }
        ictx.putImageData(imgData, 0, 0);
        maskDataUrl = invCanvas.toDataURL('image/png');
      }
      const maskImage = { mimeType: 'image/png', data: maskDataUrl.split(',')[1] };

      // Set preview mask for UI
      setGeneratedMask(maskDataUrl);

      // Call Runware Inpainting
      const inpaintResult = await inpaintImage(
        inputImage,
        maskImage,
        enhancedPrompt,
        {
          width: canvas.width,
          height: canvas.height,
          strength: customStrength,
          steps: 20
        }
      );

      const inpaintUrl = `data:${inpaintResult.mimeType};base64,${inpaintResult.data}`;
      const inpaintImg = new Image();
      await new Promise(resolve => {
        inpaintImg.onload = resolve;
        inpaintImg.src = inpaintUrl;
      });

      // Show AI result directly in the "Edited Image" panel
      setResultImage(inpaintUrl);

      // Clear selection paths to reset canvas to original state
      setPaths([]);
      setCurrentPath([]);

      const endTime = Date.now();
      setProcessingTime(((endTime - startTime) / 1000).toFixed(1));

    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
      padding: '40px 20px',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>

        {/* Main Grid: 2 panels */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>

          {/* Left Panel: Draw or Upload */}
          <div>
            <h3 style={{ color: 'white', fontSize: 16, marginBottom: 12, fontWeight: 600 }}>Draw or Upload an Image</h3>
            <div style={{
              background: '#2d2a4a',
              borderRadius: 16,
              padding: 16,
              border: '1px solid rgba(255,255,255,0.1)'
            }}>
              <div style={{ position: 'relative', background: '#1a1730', borderRadius: 12, overflow: 'hidden', fontSize: 0 }}>
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
                    cursor: 'crosshair'
                  }}
                  onMouseDown={startDrawing}
                  onMouseMove={drawMove}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={drawMove}
                  onTouchEnd={stopDrawing}
                />
                {!uploadedImage && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                    color: 'rgba(255,255,255,0.4)',
                    fontSize: 14
                  }}>
                    Upload an image to start
                  </div>
                )}
              </div>

              {/* Icon buttons below canvas */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16 }}>
                <button
                  onClick={undo}
                  disabled={!paths.length}
                  title="Undo"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    border: 'none',
                    background: 'rgba(255,255,255,0.1)',
                    color: 'white',
                    cursor: paths.length ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 18,
                    opacity: paths.length ? 1 : 0.5
                  }}
                >
                  ↶
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  title="Upload Image"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    border: 'none',
                    background: 'rgba(255,255,255,0.1)',
                    color: 'white',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 18
                  }}
                >
                  ↑
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
                <button
                  onClick={clearMask}
                  title="Clear Selection"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    border: 'none',
                    background: 'rgba(255,255,255,0.1)',
                    color: 'white',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 18
                  }}
                >
                  🗑
                </button>
              </div>
            </div>
          </div>

          {/* Right Panel: Edited Image */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ color: 'white', fontSize: 16, fontWeight: 600, margin: 0 }}>Edited Image</h3>
              {processingTime && (
                <div style={{ color: '#a78bfa', fontSize: 13, fontWeight: 600 }}>
                  {processingTime}s
                </div>
              )}
            </div>
            <div style={{
              background: '#2d2a4a',
              borderRadius: 16,
              padding: 16,
              border: '1px solid rgba(255,255,255,0.1)',
              position: 'relative'
            }}>
              {resultImage ? (
                <>
                  <img
                    src={resultImage}
                    alt="Result"
                    style={{
                      width: '100%',
                      height: 'auto',
                      display: 'block',
                      borderRadius: 12
                    }}
                  />
                  <button
                    onClick={() => setResultImage(null)}
                    style={{
                      position: 'absolute',
                      top: 24,
                      right: 24,
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      border: 'none',
                      background: 'rgba(0,0,0,0.7)',
                      color: 'white',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 16,
                      fontWeight: 'bold'
                    }}
                  >
                    ×
                  </button>
                </>
              ) : (
                <div style={{
                  background: '#1a1730',
                  borderRadius: 12,
                  minHeight: 400,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'rgba(255,255,255,0.4)',
                  fontSize: 14
                }}>
                  Result will appear here
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Edit Instruction + Generate Button */}
        <div style={{
          background: '#2d2a4a',
          borderRadius: 16,
          padding: 24,
          border: '1px solid rgba(255,255,255,0.1)'
        }}>
          <label style={{ display: 'block', color: 'white', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
            Edit Instruction
          </label>
          <input
            type="text"
            value={editInstruction}
            onChange={(e) => setEditInstruction(e.target.value)}
            placeholder="e.g. một quyển sách dày màu đỏ"
            style={{
              width: '100%',
              padding: '14px 16px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.2)',
              background: '#1a1730',
              color: 'white',
              fontSize: 15,
              fontFamily: 'inherit',
              marginBottom: 12
            }}
          />
          
          {/* Prompt preview for debugging and user confirmation */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', color: 'white', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Prompt Preview
            </label>
            <textarea
              value={generatedPrompt}
              readOnly
              rows={3}
              placeholder="Generated prompt will appear here before sending..."
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.08)',
                background: '#151226',
                color: 'rgba(255,255,255,0.85)',
                fontSize: 13,
                fontFamily: 'inherit',
                resize: 'vertical'
              }}
            />
          </div>
          
          {/* Mask preview and invert toggle */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ color: 'white', fontSize: 13, fontWeight: 600 }}>Mask Preview</label>
              <label style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
                <input type="checkbox" checked={invertMask} onChange={(e) => setInvertMask(e.target.checked)} /> Invert
              </label>
            </div>
            <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)', background: '#0f0d18' }}>
              {generatedMask ? (
                <img src={generatedMask} alt="Mask preview" style={{ width: '100%', display: 'block' }} />
              ) : (
                <div style={{ padding: 12, color: 'rgba(255,255,255,0.35)' }}>Mask will appear here after generating.</div>
              )}
            </div>
          </div>


          <button
            onClick={handleGenerate}
            disabled={loading || !uploadedImage || !editInstruction.trim() || paths.length === 0}
            style={{
              width: '100%',
              padding: '16px',
              borderRadius: 10,
              border: 'none',
              background: loading ? 'rgba(139, 92, 246, 0.5)' : 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
              color: 'white',
              fontSize: 16,
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'all 0.2s',
              boxShadow: '0 4px 12px rgba(124, 58, 237, 0.3)'
            }}
          >
            {loading ? (
              <>
                <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⚙</span>
                Processing...
              </>
            ) : (
              <>▶ GENERATE</>
            )}
          </button>

          {error && (
            <div style={{
              marginTop: 16,
              padding: 12,
              background: 'rgba(239, 68, 68, 0.2)',
              color: '#fca5a5',
              borderRadius: 8,
              fontSize: 13,
              border: '1px solid rgba(239, 68, 68, 0.3)'
            }}>
              {error}
            </div>
          )}
        </div>

      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
