import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import GuestForm from './guest/GuestForm';
import Track from './guest/Track';
import AdminApp from './admin/AdminApp';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<GuestForm />} />
      <Route path="/t/:code" element={<Track />} />
      <Route path="/track" element={<Track />} />
      <Route path="/admin/*" element={<AdminApp />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
