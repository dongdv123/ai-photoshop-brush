import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import GenerateImage from './components/GenerateImage';
import CustomImage from './pages/CustomImage';
import AiPhotoshopBrush from './pages/AiPhotoshopBrush';

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: 12 }}>
        <nav style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
          <Link to="/" style={{ textDecoration: 'none', color: '#4b4b4b', fontWeight: '600' }}>Home</Link>
          <Link to="/custom-image" style={{ textDecoration: 'none', color: '#6b21a8', fontWeight: '700' }}>Custom Image</Link>
          <Link to="/ai-photoshop-brush" style={{ textDecoration: 'none', color: '#6b21a8', fontWeight: '700' }}>AI Photoshop Brush</Link>
        </nav>

        <Routes>
          <Route path="/" element={
            <div style={{ padding: 24 }}>
              <h1>Runware Image Generator (Vite + React)</h1>
              <GenerateImage />
            </div>
          } />
          <Route path="/custom-image" element={<CustomImage />} />
          <Route path="/ai-photoshop-brush" element={<AiPhotoshopBrush />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}


