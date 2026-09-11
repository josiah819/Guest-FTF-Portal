import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import GuestForm from './guest/GuestForm';
import Track from './guest/Track';
import { GuestPrivacy, StaffPrivacy } from './guest/Privacy';
import AdminApp from './admin/AdminApp';
import Join from './admin/Join';
import InstallPrompt from './components/InstallPrompt';

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<GuestForm />} />
        <Route path="/t/:code" element={<Track />} />
        <Route path="/track" element={<Track />} />
        <Route path="/privacy" element={<GuestPrivacy />} />
        <Route path="/privacy/staff" element={<StaffPrivacy />} />
        <Route path="/join/:token" element={<Join />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <InstallPrompt />
    </>
  );
}
