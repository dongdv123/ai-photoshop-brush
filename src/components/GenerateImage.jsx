import React, { useState } from 'react';
import { generateImageWithRunware, generateImageFromReference, replaceImageBackground, removeImageBackground, isRunwareConfigured } from '../services/runwareService';

export default function GenerateImage() {
  const [prompt, setPrompt] = useState('');
  const [referenceImage, setReferenceImage] = useState(null);
  const [referenceImagePreview, setReferenceImagePreview] = useState(null);
  const [removeBackgroundFirst, setRemoveBackgroundFirst] = useState(true);
  const [strength, setStrength] = useState(0.75);
  const [imageSrc, setImageSrc] = useState(null);
  const [transparentImageSrc, setTransparentImageSrc] = useState(null); // Store transparent image
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('replace'); // 'remove' or 'replace'

  // Handle file upload
  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Vui lòng chọn file ảnh hợp lệ');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('File ảnh không được vượt quá 10MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target.result.split(',')[1]; // Remove data:image/... prefix
      const mimeType = file.type;

      setReferenceImage({ mimeType, data: base64 });
      setReferenceImagePreview(event.target.result); // Full data URL for preview
      setError(null); // Clear any previous errors
    };
    reader.readAsDataURL(file);
  }

  // Remove reference image
  function removeReferenceImage() {
    setReferenceImage(null);
    setReferenceImagePreview(null);
    setTransparentImageSrc(null);
  }

  // Remove background only (no new background)
  async function removeBackgroundOnly() {
    if (!referenceImage) return;

    if (!isRunwareConfigured()) {
      setError('Runware API key chưa được cấu hình. Vui lòng thêm VITE_RUNWARE_API_KEY vào file .env');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log('🎭 Removing background only...');
      const transparentImage = await removeImageBackground(referenceImage);
      const transparentDataUrl = `data:${transparentImage.mimeType};base64,${transparentImage.data}`;
      setTransparentImageSrc(transparentDataUrl);
      console.log('✅ Background removed successfully');
    } catch (err) {
      console.error('❌ Background removal failed:', err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (!referenceImage) {
      setError('Vui lòng upload ảnh trước');
      return;
    }

    if (mode === 'replace' && !prompt.trim()) {
      setError('Vui lòng nhập prompt cho background mới');
      return;
    }

    if (mode === 'replace' && prompt.trim().length < 2) {
      setError('Prompt phải có ít nhất 2 ký tự');
      return;
    }

    if (!isRunwareConfigured()) {
      setError('Runware API key chưa được cấu hình. Vui lòng thêm VITE_RUNWARE_API_KEY vào file .env');
      return;
    }

    setLoading(true);
    setError(null);
    setImageSrc(null);

    try {
      if (mode === 'remove') {
        // Background removal only
        console.log('🎭 Starting background removal...');
        const transparentImage = await removeImageBackground(referenceImage);
        const transparentDataUrl = `data:${transparentImage.mimeType};base64,${transparentImage.data}`;
        setTransparentImageSrc(transparentDataUrl);
        console.log('✅ Background removed successfully');
      } else {
        // Background replacement
        console.log('🚀 Starting background replacement with prompt:', prompt);

        let imageResult;
        if (removeBackgroundFirst) {
          // Background replacement workflow: remove bg + add new bg
          console.log('🔄 Using background replacement workflow');
          imageResult = await replaceImageBackground(referenceImage, prompt.trim());
        } else {
          // Traditional image-to-image generation
          console.log('🎨 Using image-to-image generation with strength:', strength);
          imageResult = await generateImageFromReference(prompt.trim(), referenceImage, { strength });
        }

        // Convert base64 result to data URL
        const dataUrl = `data:${imageResult.mimeType};base64,${imageResult.data}`;
        setImageSrc(dataUrl);
        console.log('✅ Background replaced successfully');
      }
    } catch (err) {
      console.error('❌ Processing failed:', err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    if (!imageSrc) return;
    const a = document.createElement('a');
    a.href = imageSrc;
    a.download = 'runware-image.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px' }}>
      <h1 style={{ textAlign: 'center', marginBottom: '20px', color: '#333' }}>
        AI Background Changer
      </h1>

      {/* Mode Selection */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={() => setMode('remove')}
          style={{
            padding: '10px 20px',
            backgroundColor: mode === 'remove' ? '#007bff' : '#f8f9fa',
            color: mode === 'remove' ? 'white' : '#333',
            border: '1px solid #ddd',
            borderRadius: '5px',
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          🎭 Background Removal
        </button>
        <button
          type="button"
          onClick={() => setMode('replace')}
          style={{
            padding: '10px 20px',
            backgroundColor: mode === 'replace' ? '#007bff' : '#f8f9fa',
            color: mode === 'replace' ? 'white' : '#333',
            border: '1px solid #ddd',
            borderRadius: '5px',
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          🌅 Background Replacement
        </button>
      </div>

      <form onSubmit={handleSubmit}>

        {/* Reference Image Upload */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>
            Upload Image
            <input
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              style={{
                marginTop: 4,
                padding: '8px',
                border: '2px solid #ddd',
                borderRadius: '4px',
                width: '100%',
                cursor: 'pointer'
              }}
            />
          </label>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
            📸 Chọn ảnh cần chỉnh sửa background (JPG, PNG, WEBP)
          </div>

          {referenceImage && mode === 'replace' && (
            <div style={{ marginTop: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={removeBackgroundFirst}
                  onChange={(e) => setRemoveBackgroundFirst(e.target.checked)}
                />
                <span style={{ fontSize: '14px' }}>
                  Tách nền trước khi thêm nền mới (khuyên dùng)
                </span>
              </label>
              <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                📝 Workflow: Tách nền → Thêm nền "{prompt.trim()}"
              </div>
            </div>
          )}

          {referenceImagePreview && (
            <div style={{ marginTop: 8, position: 'relative', display: 'inline-block' }}>
              <img
                src={referenceImagePreview}
                alt="Reference"
                style={{ maxWidth: 200, maxHeight: 200, border: '1px solid #ccc' }}
              />
              <button
                type="button"
                onClick={removeReferenceImage}
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  background: 'red',
                  color: 'white',
                  border: 'none',
                  borderRadius: '50%',
                  width: 24,
                  height: 24,
                  cursor: 'pointer'
                }}
              >
                ×
              </button>
            </div>
          )}

          {/* Strength Control - Only show in replace mode with traditional img2img */}
          {referenceImage && mode === 'replace' && !removeBackgroundFirst && (
            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', marginBottom: 4 }}>
                Strength: {strength.toFixed(2)} ({strength < 0.3 ? 'Keep Original' : strength < 0.7 ? 'Moderate Change' : 'Major Change'})
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={strength}
                onChange={(e) => setStrength(parseFloat(e.target.value))}
                style={{ width: '100%', marginBottom: 4 }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#666' }}>
                <span>0.0 (Giữ nguyên)</span>
                <span>0.5 (Thay đổi vừa)</span>
                <span>1.0 (Thay đổi hoàn toàn)</span>
              </div>
              <div style={{ fontSize: '12px', color: '#888', marginTop: 4 }}>
                💡 Để chỉ thay đổi background: 0.3-0.5 | Để thay đổi toàn bộ: 0.7-1.0
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setStrength(0.3)} style={{ padding: '4px 8px', fontSize: '11px' }}>Background Only</button>
                <button type="button" onClick={() => setStrength(0.5)} style={{ padding: '4px 8px', fontSize: '11px' }}>Moderate</button>
                <button type="button" onClick={() => setStrength(0.8)} style={{ padding: '4px 8px', fontSize: '11px' }}>Major Change</button>
              </div>
            </div>
          )}
        </div>

        {/* Background Prompt - Only for replacement mode */}
        {mode === 'replace' && (
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
              New Background Description
            </label>
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="blue sky with clouds, tropical beach, space with stars, white studio..."
              style={{
                width: '100%',
                padding: '12px',
                border: '2px solid #ddd',
                borderRadius: '6px',
                fontSize: '16px',
                outline: 'none',
                transition: 'border-color 0.3s'
              }}
              onFocus={(e) => e.target.style.borderColor = '#007bff'}
              onBlur={(e) => e.target.style.borderColor = '#ddd'}
            />
            <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
              💡 Mô tả background mới bạn muốn (ví dụ: "blue sky background", "beach scene", "space background")
            </div>
          </div>
        )}

        <div>
          <button
            type="submit"
            disabled={loading || (mode === 'replace' && !prompt.trim()) || !referenceImage}
          >
            {loading ? 'Processing…' :
             mode === 'remove' ? '🎭 Remove Background' :
             referenceImage ?
               (removeBackgroundFirst ? '🌅 Replace Background' : `Generate (Strength: ${strength.toFixed(2)})`):
               'Generate (Text-to-Image)'}
          </button>
        </div>
      </form>

      {error && <p style={{ color: 'red', padding: '10px', backgroundColor: '#ffe6e6', borderRadius: '4px', marginBottom: '20px' }}>{error}</p>}

      {/* Results Section */}
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {/* Original Image */}
        {referenceImagePreview && (
          <div style={{ flex: '1', minWidth: '200px', maxWidth: '300px' }}>
            <h3 style={{ textAlign: 'center', marginBottom: '10px' }}>Original</h3>
            <img
              src={referenceImagePreview}
              alt="Original"
              style={{ width: '100%', border: '2px solid #ddd', borderRadius: '8px' }}
            />
          </div>
        )}

        {/* Transparent Image (Background Removal) */}
        {transparentImageSrc && (
          <div style={{ flex: '1', minWidth: '200px', maxWidth: '300px' }}>
            <h3 style={{ textAlign: 'center', marginBottom: '10px' }}>Transparent Background</h3>
            <img
              src={transparentImageSrc}
              alt="Transparent"
              style={{ width: '100%', border: '2px solid #4CAF50', borderRadius: '8px', backgroundColor: '#f0f0f0' }}
            />
            <div style={{ marginTop: '10px', textAlign: 'center' }}>
              <button
                onClick={() => {
                  const a = document.createElement('a');
                  a.href = transparentImageSrc;
                  a.download = 'transparent-background.png';
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#4CAF50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                📥 Download PNG
              </button>
            </div>
          </div>
        )}

        {/* Final Image (Background Replacement) */}
        {imageSrc && (
          <div style={{ flex: '1', minWidth: '200px', maxWidth: '300px' }}>
            <h3 style={{ textAlign: 'center', marginBottom: '10px' }}>New Background</h3>
            <img
              src={imageSrc}
              alt="Result"
              style={{ width: '100%', border: '2px solid #2196F3', borderRadius: '8px' }}
            />
            <div style={{ marginTop: '10px', textAlign: 'center' }}>
              <button
                onClick={() => {
                  const a = document.createElement('a');
                  a.href = imageSrc;
                  a.download = 'new-background.jpg';
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#2196F3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                📥 Download JPG
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


