// Browser-side half of push notifications: capability detection, the
// subscribe/unsubscribe flows, and self-healing when the server's VAPID key
// or subscription row changed underneath an already-granted browser.
import { api } from '../api';

const PUSH_KEY = 'woodsvoice_push_key';   // VAPID public key this browser subscribed under

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// A short human label for the device list ("Chrome on Windows").
export function deviceLabel() {
  const ua = navigator.userAgent;
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os =
    /Windows/.test(ua) ? 'Windows' :
    /Android/.test(ua) ? 'Android' :
    /iPhone|iPad|iPod/.test(ua) ? 'iOS' :
    /Mac/.test(ua) ? 'macOS' :
    /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPadOS masquerades as Mac

// 'unsupported' | 'insecure' | 'ios-needs-install' | 'default' | 'granted' | 'denied'
export function pushSupportState() {
  if (!window.isSecureContext) return 'insecure';
  if (isIos() && !window.navigator.standalone && !window.matchMedia('(display-mode: standalone)').matches) {
    // iOS only exposes push to sites installed on the Home Screen.
    if (!('Notification' in window)) return 'ios-needs-install';
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;   // 'default' | 'granted' | 'denied'
}

async function getRegistration() {
  return navigator.serviceWorker.register('/sw.js');
}

export async function getCurrentEndpoint() {
  try {
    if (!('serviceWorker' in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg && await reg.pushManager.getSubscription();
    return sub ? sub.endpoint : null;
  } catch {
    return null;
  }
}

// Must run inside a click handler — requestPermission needs a user gesture.
export async function enablePush(publicKey) {
  const reg = await getRegistration();
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm;   // 'denied' | 'default'
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await api.pushSubscribe(sub.toJSON(), deviceLabel());
  try { localStorage.setItem(PUSH_KEY, publicKey); } catch { /* private mode */ }
  return 'granted';
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  }
  try { localStorage.removeItem(PUSH_KEY); } catch { /* private mode */ }
}

// Called from the Notifications tab when permission is already granted:
//  - server rotated its VAPID key → resubscribe under the new one;
//  - server pruned/lost our row → re-POST the current subscription.
// Either way the browser ends up subscribed under the server's current key.
export async function healPush(publicKey) {
  try {
    if (pushSupportState() !== 'granted' || !publicKey) return;
    const reg = await getRegistration();
    let sub = await reg.pushManager.getSubscription();
    let storedKey = null;
    try { storedKey = localStorage.getItem(PUSH_KEY); } catch { /* private mode */ }
    if (sub && storedKey && storedKey !== publicKey) {
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) {
      // No stored key = this device never opted in (or deliberately turned
      // push off) — a granted permission alone must not resubscribe it.
      if (!storedKey) return;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    await api.pushSubscribe(sub.toJSON(), deviceLabel());
    try { localStorage.setItem(PUSH_KEY, publicKey); } catch { /* private mode */ }
  } catch {
    // Healing is best-effort; the enable button still works by hand.
  }
}
