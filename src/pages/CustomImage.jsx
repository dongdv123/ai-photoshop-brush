import React, { useState } from 'react';
import { isRunwareConfigured, generateImageFromReference, removeImageBackground, replaceImageBackground } from '../services/runwareService';

export default function CustomImage() {
  const [filePreview, setFilePreview] = useState(null);
  const [fileData, setFileData] = useState(null); // { mimeType, data }
  const [bgPrompt, setBgPrompt] = useState('');
  const [transparentPreview, setTransparentPreview] = useState(null);
  const [resultPreview, setResultPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [removeFirst, setRemoveFirst] = useState(true);

  function handleFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError('Vui lòng chọn file ảnh (PNG/JPG/WEBP).');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const base64 = dataUrl.split(',')[1];
      setFilePreview(dataUrl);
      setFileData({ mimeType: f.type, data: base64 });
      setError(null);
    };
    reader.readAsDataURL(f);
  }

  async function handleRemoveBackground() {
    if (!fileData) return setError('Upload ảnh trước.');
    if (!isRunwareConfigured()) return setError('Chưa cấu hình API key.');
    setLoading(true);
    setError(null);
    try {
      const t = await removeImageBackground(fileData);
      const url = `data:${t.mimeType};base64,${t.data}`;
      setTransparentPreview(url);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    if (!fileData) return setError('Upload ảnh trước.');
    if (!isRunwareConfigured()) return setError('Chưa cấu hình API key.');
    if (!bgPrompt.trim()) return setError('Nhập mô tả background mới.');
    setLoading(true);
    setError(null);
    setResultPreview(null);
    try {
      if (removeFirst) {
        const out = await replaceImageBackground(fileData, bgPrompt.trim());
        setResultPreview(`data:${out.mimeType};base64,${out.data}`);
      } else {
        const out = await generateImageFromReference(bgPrompt.trim(), fileData, { strength: 0.45 });
        setResultPreview(`data:${out.mimeType};base64,${out.data}`);
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24, color: '#eee' }}>
      <div style={{ background: '#1f1330', padding: 24, borderRadius: 12 }}>
        <h2 style={{ marginTop: 0 }}>Custom Image — Background Changer</h2>
        <div style={{ display: 'flex', gap: 20 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: 8 }}>Upload image</label>
            <input type="file" accept="image/*" onChange={handleFile} />
            {filePreview && <img src={filePreview} alt="preview" style={{ width: '100%', marginTop: 12, borderRadius: 8 }} />}
            <div style={{ marginTop: 12 }}>
              <label><input type="checkbox" checked={removeFirst} onChange={(e) => setRemoveFirst(e.target.checked)} /> Tách nền trước (giữ subject)</label>
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: 8 }}>New background description</label>
            <input value={bgPrompt} onChange={(e) => setBgPrompt(e.target.value)} placeholder="e.g. tropical beach with palm trees" style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #333' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={handleRemoveBackground} disabled={loading || !fileData} style={{ padding: '10px 14px' }}>Remove background</button>
              <button onClick={handleGenerate} disabled={loading || !fileData || !bgPrompt.trim()} style={{ padding: '10px 14px' }}>{loading ? 'Processing…' : 'Generate (Replace Background)'}</button>
            </div>
            {error && <div style={{ marginTop: 12, color: '#ffb3b3' }}>{error}</div>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 20, marginTop: 20 }}>
          <div style={{ flex: 1 }}>
            <h4>Original</h4>
            {filePreview ? <img src={filePreview} alt="orig" style={{ width: '100%', borderRadius: 8 }} /> : <div style={{ height: 200, background: '#2a1f36', borderRadius: 8 }} />}
          </div>
          <div style={{ flex: 1 }}>
            <h4>Transparent (Background Removed)</h4>
            {transparentPreview ? <img src={transparentPreview} alt="transparent" style={{ width: '100%', borderRadius: 8, background: '#fff' }} /> : <div style={{ height: 200, background: '#2a1f36', borderRadius: 8 }} />}
          </div>
          <div style={{ flex: 1 }}>
            <h4>Result</h4>
            {resultPreview ? <img src={resultPreview} alt="result" style={{ width: '100%', borderRadius: 8 }} /> : <div style={{ height: 200, background: '#2a1f36', borderRadius: 8 }} />}
          </div>
        </div>
      </div>
    </div>
  );
}


