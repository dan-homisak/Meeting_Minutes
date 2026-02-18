import './style.css';
import { createApp } from './bootstrap/createApp.js';

createApp({
  windowObject: window,
  documentObject: document,
  navigatorObject: navigator,
  fetchImpl: fetch,
  isDevBuild: Boolean(import.meta.env?.DEV)
});
